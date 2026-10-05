import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client";
import { generations, aiRequests, usageEvents, stores, units, auditLogs } from "../../db/schema";
import { verifyScope, tenantWhere } from "../intake/service";
import { stableJson, type Scope } from "../intake/contracts";
import { AccessDenied } from "../identity/service";
import { CentralAIGateway } from "../../infrastructure/ai/gateway";
import { assembleInstructions } from "./instructions";
import { buildGenerationContext } from "./context";
import { commandSchema, AdmissionError, OPERATION, validateCanonical } from "./contracts";
const hash=(data:unknown)=>createHash("sha256").update(stableJson(data)).digest("hex");
async function audit(tx:DbExecutor,scope:Scope,action:string,resourceId:string) {
 await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action,resourceId});
}
export class GenerationService {
 constructor(private readonly db:Database,private readonly gateway:CentralAIGateway) {}
 async prepare(scope:Scope,raw:unknown) {
  const command=commandSchema.parse(raw),commandHash=hash(command);
  const claim=await this.db.transaction(async tx=>{
   await verifyScope(tx,scope,true);
   await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
   const [replay]=await tx.select().from(aiRequests).where(and(tenantWhere(aiRequests,scope),eq(aiRequests.commandKey,command.commandKey)));
   if(replay){if(replay.commandHash!==commandHash)throw new AdmissionError("COMMAND_CONFLICT");return {id:replay.generationId!,run:false};}
   const current=await buildGenerationContext(tx,scope,command.unitId);
   const existing=await tx.select().from(generations).where(and(tenantWhere(generations,scope),eq(generations.unitId,command.unitId))).orderBy(desc(generations.createdAt));
   if(existing.some(g=>g.status==="PROCESSING"))throw new AdmissionError("ACTIVE_OPERATION");
   let generation=existing[0],parent:typeof aiRequests.$inferSelect|undefined,attemptNumber=1;
   if(command.retryGenerationId){
    generation=existing.find(g=>g.id===command.retryGenerationId)!;
    if(!generation)throw new AccessDenied();
    if(generation.status!=="FAILED")throw new AdmissionError("ACTIVE_OPERATION");
    if(generation.customerRevision!==current.customer.revision||generation.productVersionId!==current.product.id)throw new AdmissionError("CONTEXT_CHANGED");
    const attempts=await tx.select().from(aiRequests).where(and(tenantWhere(aiRequests,scope),eq(aiRequests.generationId,generation.id))).orderBy(desc(aiRequests.attemptNumber));
    parent=attempts[0];attemptNumber=parent.attemptNumber+1;
    if(parent.ambiguous)throw new AdmissionError("RETRY_UNCERTAIN");
    if(attemptNumber>3)throw new AdmissionError("BUDGET_LIMIT");
    const [updated]=await tx.update(generations).set({status:"PROCESSING",completedAt:null}).where(and(tenantWhere(generations,scope),eq(generations.id,generation.id))).returning();generation=updated;
   }else{
    // This slice does not offer regeneration. Another command cannot replace existing work.
    if(generation)throw new AdmissionError("COMMAND_CONFLICT");
    [generation]=await tx.insert(generations).values({organizationId:scope.organizationId,storeId:scope.storeId,unitId:current.unitId,
     productVersionId:current.product.id,styleVersionId:current.style.id,sellerProfileId:current.seller.id,customerRevision:current.customer.revision,
     context:current,contextHash:hash(current)}).returning();
   }
   const instructions=assembleInstructions(generation.context);
   const request=await this.gateway.admit(tx,scope,{generationId:generation.id,attemptNumber,commandKey:command.commandKey,commandHash,parentRequestId:parent?.id,operation:OPERATION,inputBytes:Buffer.byteLength(instructions.system+instructions.data)});
   await audit(tx,scope,parent?"generation_retry_requested":"generation_requested",generation.id);
   return {id:generation.id,run:true,request,context:generation.context,instructions};
  });
  if(claim.run&&claim.request&&claim.context&&claim.instructions){
   const {context,request,instructions}=claim;
   await this.gateway.execute(scope,request.id,{model:request.model,...instructions,maxOutputTokens:this.gateway.maxOutputTokens,
    sections:context.product.configuration.sections.map(s=>({sectionId:s.id,title:s.title.trim()}))},
    response=>validateCanonical(response.output,context),
    async(tx,outcome)=>{
     const changed=await tx.update(generations).set({status:outcome.failure?"FAILED":"SUCCEEDED",result:outcome.result??null,completedAt:new Date()}).where(and(tenantWhere(generations,scope),eq(generations.id,claim.id),eq(generations.status,"PROCESSING"))).returning({id:generations.id});
     if(!changed.length)throw new Error("GENERATION_STATE_CHANGED");
     await audit(tx,scope,outcome.failure?"generation_failed":"generation_succeeded",claim.id);
    },async tx=>{
     // Recheck deterministic admission after claiming, never run against revised customer data.
     const [unit]=await tx.select().from(units).where(and(tenantWhere(units,scope),eq(units.id,command.unitId)));
     if(!unit||unit.revision!==context.customer.revision)throw new AdmissionError("CONTEXT_CHANGED");
     await buildGenerationContext(tx,scope,command.unitId);
    });
  }
  return readGeneration(this.db,scope,claim.id);
 }
}
export async function readGeneration(db:DbExecutor,scope:Scope,generationId:string) {
 await verifyScope(db,scope);
 const [generation]=await db.select().from(generations).where(and(tenantWhere(generations,scope),eq(generations.id,generationId)));
 if(!generation)throw new AccessDenied();return generation;
}
export async function generationHistory(db:DbExecutor,scope:Scope,unitId:string) {
 await verifyScope(db,scope);
 const [unit]=await db.select({id:units.id}).from(units).where(and(tenantWhere(units,scope),eq(units.id,unitId)));
 if(!unit)throw new AccessDenied();
 return db.select().from(generations).where(and(tenantWhere(generations,scope),eq(generations.unitId,unitId))).orderBy(desc(generations.createdAt));
}
export async function requestAccounting(db:DbExecutor,scope:Scope,requestId:string) {
 await verifyScope(db,scope);
 const [request]=await db.select().from(aiRequests).where(and(tenantWhere(aiRequests,scope),eq(aiRequests.id,requestId)));
 if(!request)throw new AccessDenied();
 const [usage]=await db.select().from(usageEvents).where(and(tenantWhere(usageEvents,scope),eq(usageEvents.aiRequestId,requestId)));
 return {request,usage};
}
export async function generationAccounting(db:DbExecutor,scope:Scope,generationId:string) {
 await readGeneration(db,scope,generationId);
 const attempts=await db.select().from(aiRequests).where(and(tenantWhere(aiRequests,scope),eq(aiRequests.generationId,generationId))).orderBy(aiRequests.attemptNumber);
 return {attempts,knownNanos:attempts.reduce((sum,a)=>sum+(a.estimatedNanos??0n),0n),hasUnknown:attempts.some(a=>a.costState==="unknown")};
}
