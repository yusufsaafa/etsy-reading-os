import { randomUUID } from "node:crypto";
import { and,eq,or,lte,asc } from "drizzle-orm";
import { z } from "zod";
import type { Database,DbExecutor } from "../../db/client";
import { documentProduction,readingReviews,generations,memberships,auditLogs,stores } from "../../db/schema";
import type { Scope } from "../intake/contracts";
import { verifyScope,tenantWhere } from "../intake/service";
import { configurationSchema } from "../products/contracts";
import { getApprovedReadingForDocument,getApprovedReadingForDocumentInTransaction } from "../review/service";
import { createDocumentRenderInputInTransaction } from "../documents/media-service";
import { lockDocumentStore,produceDocumentArtifact,getDocumentArtifact } from "../documents/artifact-service";
import { ArtifactStorageError,type ImmutableArtifactStorage,type PlatformAssetStorage } from "../../infrastructure/object-storage";
import { productionRecoveryPolicy } from "./recovery-policy";
import { databaseTime } from "../generation/authority";

type Work=typeof documentProduction.$inferSelect;
/** Called after approval in the existing Store-locked transaction. No rendering/storage here. */
export async function admitDocumentProductionInTransaction(tx:DbExecutor,scope:Scope,reviewId:string,orderId:string,manual=false){
 await verifyScope(tx,scope);
 await tx.select({id:stores.id}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
 const [review]=await tx.select().from(readingReviews).where(and(tenantWhere(readingReviews,scope),eq(readingReviews.id,reviewId),eq(readingReviews.state,"APPROVED")));
 if(!review)throw new Error("REVIEW_UNAVAILABLE");
 await getApprovedReadingForDocumentInTransaction(tx,scope,orderId,review.unitId);
 const [generation]=await tx.select().from(generations).where(and(tenantWhere(generations,scope),eq(generations.id,review.generationId)));
 if(!generation)throw new Error("REVIEW_UNAVAILABLE");
 const config=configurationSchema.parse(generation.context.product.configuration);
 if(config.output!=="PDF"||(!manual&&config.workflow!=="ASSISTED"))return;
 const [work]=await tx.insert(documentProduction).values({organizationId:scope.organizationId,storeId:scope.storeId,readingId:review.unitId,orderId,reviewId}).onConflictDoNothing().returning();
 if(work)await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,resourceId:work.id,actorId:scope.userId,action:"document_production_admitted"});
}
/** Explicit owner preparation/recovery for Manual or attention work; exact frozen input retained. */
export async function requestDocumentProduction(db:Database,scope:Scope,raw:unknown){
 const command=z.strictObject({orderId:z.uuid(),readingId:z.uuid()}).parse(raw);
 return db.transaction(async tx=>{
  await lockDocumentStore(tx,scope);
  const approved=await getApprovedReadingForDocumentInTransaction(tx,scope,command.orderId,command.readingId);
  await admitDocumentProductionInTransaction(tx,scope,approved.provenance.reviewId,command.orderId,true);
  const [work]=await tx.select().from(documentProduction).where(and(tenantWhere(documentProduction,scope),eq(documentProduction.reviewId,approved.provenance.reviewId))).for("update");
  if(work?.state==="ATTENTION"){
   const [saved]=await tx.update(documentProduction).set({state:"WAITING",attempt:0,failureCode:null,updatedAt:new Date()}).where(eq(documentProduction.id,work.id)).returning();
   await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,resourceId:work.id,actorId:scope.userId,action:"document_production_retry_requested"});return saved.id;
  }
  return work?.id??null;
 });
}
export function documentFailure(error:unknown){
 if(error instanceof ArtifactStorageError)return {code:`STORAGE_${error.code==="LIMIT"?"INTEGRITY":error.code}`,retryable:["UNAVAILABLE","MISSING"].includes(error.code)};
 if(error instanceof Error&&/SETUP_REQUIRED/.test(error.message))return {code:"SETUP_REQUIRED",retryable:false};
 if(error instanceof Error&&error.message==="REVIEW_UNAVAILABLE")return {code:"READING_HOLD",retryable:false};
 return {code:"DOCUMENT_INVALID",retryable:false};
}
export type DocumentProductionPorts=Readonly<{assets:PlatformAssetStorage;artifacts:ImmutableArtifactStorage}>;
/** Existing tick invokes this bounded downstream stage; no new broker, recurring loop or AI. */
export class DocumentProductionWorker{
 private constructor(private readonly db:Database,private readonly ports:DocumentProductionPorts){}
 static forInternalWorker(db:Database,ports:DocumentProductionPorts){return new DocumentProductionWorker(db,ports);}
 async runCycle(limit=10){
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error("INVALID_DOCUMENT_BATCH");
  const now=new Date();
  const candidates=await this.db.select().from(documentProduction).where(or(eq(documentProduction.state,"WAITING"),and(eq(documentProduction.state,"RETRY_WAIT"),lte(documentProduction.availableAt,now)),and(eq(documentProduction.state,"PROCESSING"),lte(documentProduction.claimExpiresAt,now)))).orderBy(asc(documentProduction.updatedAt),asc(documentProduction.id)).limit(limit);
  const outcomes=[];
  for(const candidate of candidates)outcomes.push(await this.execute(candidate.id));
  return outcomes;
 }
 async execute(id:string){
  const [candidate]=await this.db.select().from(documentProduction).where(eq(documentProduction.id,id));
  if(!candidate)return {status:"UNAVAILABLE" as const};
  const [owner]=await this.db.select({userId:memberships.userId}).from(memberships).where(and(eq(memberships.organizationId,candidate.organizationId),eq(memberships.role,"owner"))).orderBy(asc(memberships.userId)).limit(1);
  if(!owner)return {status:"UNAVAILABLE" as const};
  const scope={organizationId:candidate.organizationId,storeId:candidate.storeId,userId:owner.userId};
  const work=await this.db.transaction(async tx=>{
   await lockDocumentStore(tx,scope);
   const [row]=await tx.select().from(documentProduction).where(eq(documentProduction.id,id)).for("update"),now=await databaseTime(tx);
   if(!row)return;
   if(!(row.state==="WAITING"||row.state==="RETRY_WAIT"&&row.availableAt!==null&&row.availableAt<=now||row.state==="PROCESSING"&&row.claimExpiresAt!==null&&row.claimExpiresAt<=now))return;
   // Expired claims are safe to retry: every external effect is an immutable conditional write.
   if(row.attempt>=3){await tx.update(documentProduction).set({state:"ATTENTION",claimToken:null,claimExpiresAt:null,availableAt:null,failureCode:"MAX_ATTEMPTS",updatedAt:now}).where(eq(documentProduction.id,id));return;}
   const [claimed]=await tx.update(documentProduction).set({state:"PROCESSING",attempt:row.attempt+1,claimToken:randomUUID(),claimExpiresAt:new Date(now.getTime()+productionRecoveryPolicy.tickLeaseMs),availableAt:null,failureCode:null,updatedAt:now}).where(eq(documentProduction.id,id)).returning();return claimed;
  });
  if(!work)return {status:"BUSY_OR_TERMINAL" as const};
  try{
   // Revalidate approval/holds before preparing required seller output. History retrieval is separate.
   await getApprovedReadingForDocument(this.db,scope,work.orderId,work.readingId);
   const mediaSnapshotId=await this.db.transaction(async tx=>{
    await lockDocumentStore(tx,scope);const [row]=await tx.select().from(documentProduction).where(eq(documentProduction.id,id)).for("update");
    if(row.claimToken!==work.claimToken||row.state!=="PROCESSING")throw new Error("DOCUMENT_SUPERSEDED");
    await getApprovedReadingForDocumentInTransaction(tx,scope,row.orderId,row.readingId);
    if(row.mediaSnapshotId)return row.mediaSnapshotId;
    const input=await createDocumentRenderInputInTransaction(tx,scope,{orderId:row.orderId,readingId:row.readingId});
    await tx.update(documentProduction).set({mediaSnapshotId:input.media.id,updatedAt:new Date()}).where(eq(documentProduction.id,id));return input.media.id;
   });
   const artifact=await produceDocumentArtifact(this.db,scope,mediaSnapshotId,this.ports.assets,this.ports.artifacts);
   return await this.settle(scope,work,{state:"COMPLETED",artifactId:artifact.id});
  }catch(error){
   const failure=documentFailure(error),retry=failure.retryable&&work.attempt<3;
   return this.settle(scope,work,{state:retry?"RETRY_WAIT":"ATTENTION",failureCode:failure.code,availableAt:retry?new Date(Date.now()+productionRecoveryPolicy.backoffMs[work.attempt-1]):null});
  }
 }
 private async settle(scope:Scope,work:Work,changes:{state:string;artifactId?:string;failureCode?:string;availableAt?:Date|null}){
  return this.db.transaction(async tx=>{
   await lockDocumentStore(tx,scope);const [row]=await tx.select().from(documentProduction).where(eq(documentProduction.id,work.id)).for("update");
   if(row.state!=="PROCESSING"||row.claimToken!==work.claimToken)return {status:"SUPERSEDED" as const};
   if(changes.state==="COMPLETED")await getApprovedReadingForDocumentInTransaction(tx,scope,row.orderId,row.readingId);
   await tx.update(documentProduction).set({...changes,claimToken:null,claimExpiresAt:null,updatedAt:new Date()}).where(eq(documentProduction.id,work.id));
   await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,resourceId:work.id,action:changes.state==="COMPLETED"?"document_production_completed":changes.state==="RETRY_WAIT"?"document_production_retry_scheduled":"document_production_needs_attention"});
   return {status:changes.state,workId:work.id,failureCode:changes.failureCode??null};
  });
 }
}
/** Backend projection for seller/Delivery integration. Approval != delivery completion. */
export async function readingOutputStatus(db:Database,scope:Scope,orderId:string,readingId:string){
 return db.transaction(async tx=>{
 const approved=await getApprovedReadingForDocumentInTransaction(tx,scope,orderId,readingId);
 const [generation]=await tx.select().from(generations).where(and(tenantWhere(generations,scope),eq(generations.id,approved.provenance.generationId)));
 if(!generation)throw new Error("REVIEW_UNAVAILABLE");
 if(configurationSchema.parse(generation.context.product.configuration).output==="TEXT")return {status:"Approved" as const,deliveryReady:true,artifactId:null};
 const [work]=await tx.select().from(documentProduction).where(and(tenantWhere(documentProduction,scope),eq(documentProduction.reviewId,approved.provenance.reviewId)));
 if(work?.state==="COMPLETED"&&work.artifactId){const artifact=await getDocumentArtifact(tx,scope,readingId,work.artifactId);if(artifact.state!=="AVAILABLE")throw new Error("ARTIFACT_UNAVAILABLE");return {status:"Ready to deliver" as const,deliveryReady:true,artifactId:artifact.id};}
 return {status:work?.state==="ATTENTION"?"Problem" as const:work?.state==="PROCESSING"?"Preparing" as const:"Waiting" as const,deliveryReady:false,artifactId:null};
 },{isolationLevel:"repeatable read"});
}
