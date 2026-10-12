import {createHash} from "node:crypto";
import {and,desc,eq,sql} from "drizzle-orm";
import {z} from "zod";
import type {Database,DbExecutor} from "../../db/client";
import {units,lineItems,orders,generations,readingReviews,documentArtifacts,documentSnapshots,documentProduction,manualDeliveryEvents,auditLogs,stores,users} from "../../db/schema";
import type {Scope} from "../intake/contracts";
import {stableJson} from "../intake/contracts";
import {tenantWhere,verifyScope} from "../intake/service";
import {getApprovedReadingForDocumentInTransaction} from "../review/service";
import {getDocumentArtifact,retrieveDocumentArtifact} from "../documents/artifact-service";
import type {ImmutableArtifactStorage} from "../../infrastructure/object-storage";
import {purchasedChoices,purchasedAnswers} from "../orders/purchased-choices";
export const deliveryStatuses=["NOT_READY","AWAITING_DELIVERY","DELIVERED","NEEDS_ATTENTION"] as const;
export type DeliveryStatus=typeof deliveryStatuses[number];
export const deliveryLabels:Record<DeliveryStatus,string>={NOT_READY:"Not ready",AWAITING_DELIVERY:"Awaiting delivery",DELIVERED:"Delivered",NEEDS_ATTENTION:"Needs attention"};
export class DeliveryError extends Error{constructor(public readonly code:"UNAVAILABLE"|"NOT_READY"|"CONFLICT"|"CONFIRMATION_REQUIRED"){super(code);}}
const commandSchema=z.strictObject({readingId:z.uuid(),artifactId:z.uuid(),commandId:z.uuid(),expectedSequence:z.number().int().min(0).max(2147483646),action:z.enum(["CONFIRMED","CORRECTED"]),confirmed:z.literal(true),note:z.string().trim().max(1000).default("")});
async function ownedReading(db:DbExecutor,scope:Scope,readingId:string){
 await verifyScope(db,scope);if(!z.uuid().safeParse(readingId).success)throw new DeliveryError("UNAVAILABLE");
 const [row]=await db.select({unit:units,line:lineItems,order:orders}).from(units)
  .innerJoin(lineItems,and(tenantWhere(lineItems,scope),eq(lineItems.id,units.lineItemId)))
  .innerJoin(orders,and(tenantWhere(orders,scope),eq(orders.id,lineItems.orderId))).where(and(tenantWhere(units,scope),eq(units.id,readingId)));
 if(!row)throw new DeliveryError("UNAVAILABLE");return row;
}
async function history(db:DbExecutor,scope:Scope,readingId:string){
 const rows=await db.select({event:manualDeliveryEvents,actorName:users.name}).from(manualDeliveryEvents).leftJoin(users,eq(users.id,manualDeliveryEvents.actorId)).where(and(tenantWhere(manualDeliveryEvents,scope),eq(manualDeliveryEvents.readingId,readingId))).orderBy(desc(manualDeliveryEvents.sequence));
 return rows.map(r=>({...r.event,actorName:r.actorName??"Seller"}));
}
/** Read-only inspection. Never renders, admits work, changes status, or contacts Etsy. */
export async function inspectDelivery(db:Database,scope:Scope,readingId:string,storage?:ImmutableArtifactStorage){
 const row=await ownedReading(db,scope,readingId),events=await history(db,scope,readingId),latest=events[0];
 const [generation]=await db.select({id:generations.id,status:generations.status,createdAt:generations.createdAt}).from(generations).where(and(tenantWhere(generations,scope),eq(generations.unitId,readingId))).orderBy(desc(generations.createdAt),desc(generations.id)).limit(1);
 const [review]=await db.select({id:readingReviews.id,state:readingReviews.state,approvedAt:readingReviews.approvedAt}).from(readingReviews).where(and(tenantWhere(readingReviews,scope),eq(readingReviews.unitId,readingId)));
 let status:DeliveryStatus="NOT_READY",reason="Generate and approve this reading in the Orders workflow.",artifactId:string|null=null,pdf:"Not ready"|"Ready"|"Unavailable"="Not ready";
 if(review?.state==="APPROVED"){
  try{
   const approved=await db.transaction(tx=>getApprovedReadingForDocumentInTransaction(tx,scope,row.order.id,readingId),{isolationLevel:"repeatable read"});
   const candidates=await db.select({id:documentArtifacts.id}).from(documentArtifacts)
    .innerJoin(documentSnapshots,and(tenantWhere(documentSnapshots,scope),eq(documentSnapshots.id,documentArtifacts.documentSnapshotId),eq(documentSnapshots.readingId,readingId),eq(documentSnapshots.reviewId,approved.provenance.reviewId),eq(documentSnapshots.generationId,approved.provenance.generationId)))
    .where(and(tenantWhere(documentArtifacts,scope),eq(documentArtifacts.readingId,readingId),eq(documentArtifacts.orderId,row.order.id),eq(documentArtifacts.state,"AVAILABLE"),...(latest?.action==="CONFIRMED"?[eq(documentArtifacts.id,latest.artifactId)]:[])))
    .orderBy(desc(documentArtifacts.createdAt),desc(documentArtifacts.id)).limit(1);
   if(!candidates.length){
    const [work]=await db.select({state:documentProduction.state}).from(documentProduction).where(and(tenantWhere(documentProduction,scope),eq(documentProduction.reviewId,review.id)));
    reason="Prepare the approved PDF in the Review Workspace.";
    if(work?.state==="ATTENTION"||latest?.action==="CONFIRMED"){status="NEEDS_ATTENTION";pdf="Unavailable";reason="The approved PDF needs attention. Open the Review Workspace.";}
   }else{
    artifactId=candidates[0].id;
    if(!storage)throw new DeliveryError("NOT_READY");
    // Existing bounded byte/hash validation is authoritative, not artifact metadata alone.
    await retrieveDocumentArtifact(db,scope,{readingId,artifactId},storage);
    pdf="Ready";status=latest?.action==="CONFIRMED"?"DELIVERED":"AWAITING_DELIVERY";
    reason=status==="DELIVERED"?"The seller recorded manual delivery through Etsy.":"Download the PDF, send it through Etsy, then record your confirmation.";
   }
  }catch{status="NEEDS_ATTENTION";pdf="Unavailable";reason="The approved PDF is unavailable or the reading has changed. Check the Review Workspace and document storage.";}
 }else if(latest?.action==="CONFIRMED"){status="NEEDS_ATTENTION";reason="A recorded delivery needs review. Its confirmation history is preserved.";}
 return {readingId,orderId:row.order.id,orderReference:row.order.externalId,customer:row.order.buyerName||"Customer",product:row.line.title,index:row.unit.unitIndex,quantity:row.line.quantity,
  status,reason,pdf,artifactId:pdf==="Ready"?artifactId:null,approval:review?.state==="APPROVED"?"Approved":"Not approved",approvedAt:review?.approvedAt?.toISOString()??null,
  generatedAt:generation?.createdAt.toISOString()??null,generationStatus:generation?.status??"Not generated",sequence:latest?.sequence??0,confirmed:latest?.action==="CONFIRMED",
  confirmedArtifactId:latest?.action==="CONFIRMED"?latest.artifactId:null,confirmedAt:latest?.action==="CONFIRMED"?latest.createdAt.toISOString():null,
  options:purchasedChoices(row.line.snapshot),customerDetails:purchasedAnswers(row.line.snapshot).map(a=>({label:a.label,value:a.value})),
  history:events.map(e=>({id:e.id,action:e.action,sequence:e.sequence,artifactId:e.artifactId,actorId:e.actorId,actorName:e.actorName,note:e.note,createdAt:e.createdAt.toISOString()}))};
}
export type DeliveryView=Awaited<ReturnType<typeof inspectDelivery>>;
export const deliveryQuerySchema=z.object({q:z.string().trim().max(120).default(""),status:z.enum(["ALL",...deliveryStatuses]).default("ALL"),sort:z.enum(["ACTION","NEWEST","OLDEST"]).default("ACTION"),page:z.coerce.number().int().min(1).max(1000000).default(1)});
export function deliveryQuery(raw:Record<string,unknown>){const parsed=deliveryQuerySchema.safeParse(raw);return parsed.success?parsed.data:deliveryQuerySchema.parse({});}
export type DeliveryQuery=z.infer<typeof deliveryQuerySchema>;
/** Generated readings only. Exact readiness checks precede status filtering/pagination. */
export async function listDeliveries(db:Database,scope:Scope,query:DeliveryQuery,storage?:ImmutableArtifactStorage){
 await verifyScope(db,scope);
 const rows=await db.select({id:units.id,customer:orders.buyerName,product:lineItems.title,reference:orders.externalId}).from(units)
  .innerJoin(lineItems,and(tenantWhere(lineItems,scope),eq(lineItems.id,units.lineItemId)))
  .innerJoin(orders,and(tenantWhere(orders,scope),eq(orders.id,lineItems.orderId)))
  .where(and(tenantWhere(units,scope),sql`exists(select 1 from generations g where g.organization_id=${scope.organizationId} and g.store_id=${scope.storeId} and g.unit_id=${units.id})`));
 const searched=rows.filter(r=>[r.customer,r.product,r.reference,r.id].some(s=>s.toLowerCase().includes(query.q.toLowerCase()))),views:DeliveryView[]=[];
 // Bound parallel database/storage requests; do not buffer PDF bytes in list projections.
 for(let i=0;i<searched.length;i+=4)views.push(...await Promise.all(searched.slice(i,i+4).map(r=>inspectDelivery(db,scope,r.id,storage))));
 const rank:Record<DeliveryStatus,number>={NEEDS_ATTENTION:0,AWAITING_DELIVERY:1,NOT_READY:2,DELIVERED:3};
 const filtered=views.filter(v=>query.status==="ALL"||v.status===query.status).sort((a,b)=>(query.sort==="ACTION"?rank[a.status]-rank[b.status]:0)||(query.sort==="OLDEST"?(a.generatedAt??"").localeCompare(b.generatedAt??""):(b.generatedAt??"").localeCompare(a.generatedAt??""))||a.readingId.localeCompare(b.readingId));
 const pages=Math.max(1,Math.ceil(filtered.length/25)),page=Math.min(query.page,pages);
 return {rows:filtered.slice((page-1)*25,page*25),total:filtered.length,pages,page};
}
/** Manual bookkeeping only. A download never invokes this operation. */
export async function recordManualDelivery(db:Database,scope:Scope,raw:unknown,storage?:ImmutableArtifactStorage){
 const parsed=commandSchema.safeParse(raw);if(!parsed.success)throw new DeliveryError("CONFIRMATION_REQUIRED");const command=parsed.data;
 if(command.action==="CORRECTED"&&!command.note)throw new DeliveryError("CONFIRMATION_REQUIRED");
 await verifyScope(db,scope,true);
 const commandHash=createHash("sha256").update(stableJson(command)).digest("hex");
 // Authorize and verify bytes before entering the Store-locked bookkeeping transaction.
 if(command.action==="CONFIRMED"){
  const replay=await db.select().from(manualDeliveryEvents).where(and(tenantWhere(manualDeliveryEvents,scope),eq(manualDeliveryEvents.commandId,command.commandId)));
  if(!replay.length){if(!storage)throw new DeliveryError("NOT_READY");await ownedReading(db,scope,command.readingId);await retrieveDocumentArtifact(db,scope,{readingId:command.readingId,artifactId:command.artifactId},storage);}
 }
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
  const row=await ownedReading(tx,scope,command.readingId);
  const [replay]=await tx.select().from(manualDeliveryEvents).where(and(tenantWhere(manualDeliveryEvents,scope),eq(manualDeliveryEvents.commandId,command.commandId)));
  if(replay){if(replay.commandHash!==commandHash)throw new DeliveryError("CONFLICT");return {eventId:replay.id,sequence:replay.sequence,replayed:true};}
  const [latest]=await history(tx,scope,command.readingId);
  if(command.action==="CONFIRMED"&&latest?.action==="CONFIRMED"){
   if(latest.artifactId!==command.artifactId||latest.note!==command.note)throw new DeliveryError("CONFLICT");
   return {eventId:latest.id,sequence:latest.sequence,replayed:true};
  }
  if((latest?.sequence??0)!==command.expectedSequence)throw new DeliveryError("CONFLICT");
  if(command.action==="CORRECTED"){
   if(latest?.action!=="CONFIRMED"||latest.artifactId!==command.artifactId)throw new DeliveryError("CONFLICT");
  }else{
   const approved=await getApprovedReadingForDocumentInTransaction(tx,scope,row.order.id,command.readingId);
   const artifact=await getDocumentArtifact(tx,scope,command.readingId,command.artifactId);
   const [snapshot]=await tx.select({reviewId:documentSnapshots.reviewId,generationId:documentSnapshots.generationId}).from(documentSnapshots).where(and(tenantWhere(documentSnapshots,scope),eq(documentSnapshots.id,artifact.documentSnapshotId)));
   if(artifact.state!=="AVAILABLE"||snapshot?.reviewId!==approved.provenance.reviewId||snapshot.generationId!==approved.provenance.generationId)throw new DeliveryError("NOT_READY");
  }
  const [event]=await tx.insert(manualDeliveryEvents).values({organizationId:scope.organizationId,storeId:scope.storeId,readingId:command.readingId,artifactId:command.artifactId,sequence:(latest?.sequence??0)+1,action:command.action,actorId:scope.userId,commandId:command.commandId,commandHash,note:command.note}).returning();
  await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,resourceId:event.id,action:command.action==="CONFIRMED"?"manual_delivery_confirmed":"manual_delivery_corrected"});
  return {eventId:event.id,sequence:event.sequence,replayed:false};
 });
}
