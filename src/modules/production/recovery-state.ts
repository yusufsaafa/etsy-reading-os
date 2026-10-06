import { and,desc,eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { generations,aiRequests,usageEvents,productionQueue } from "../../db/schema";
import { tenantWhere } from "../intake/service";
import { buildProductionContextForStoreInTransaction } from "../generation/context";
import { AdmissionError,validateCanonical } from "../generation/contracts";
import { productionPolicy } from "../products/contracts";
import { classifyKnownFailure,productionCommand,MAX_GENERATION_ATTEMPTS,retryCommandIdentity,type RecoveryClass } from "./recovery-policy";
export type QueueItem=typeof productionQueue.$inferSelect;
export async function inspectProductionState(tx:DbExecutor,item:QueueItem){
 const [generation]=item.generationId?await tx.select().from(generations).where(and(tenantWhere(generations,item),eq(generations.id,item.generationId))):[];
 const attempts=generation?await tx.select().from(aiRequests).where(and(tenantWhere(aiRequests,item),eq(aiRequests.generationId,generation.id))).orderBy(desc(aiRequests.attemptNumber)):[];
 const request=attempts[0];
 const [usage]=request?await tx.select().from(usageEvents).where(and(tenantWhere(usageEvents,item),eq(usageEvents.aiRequestId,request.id))):[];
 let classification:RecoveryClass="INCONSISTENT";
 if(!item.generationId){
  const [unexpected]=await tx.select({id:aiRequests.id}).from(aiRequests).where(and(tenantWhere(aiRequests,item),eq(aiRequests.commandKey,productionCommand(item))));
  if(!unexpected)classification="PRE_DISPATCH_SAFE";
 }else if(generation&&generation.unitId===item.unitId&&generation.productVersionId===item.productVersionId&&request&&usage&&usage.operation===request.operation&&usage.costState===request.costState&&usage.amountNanos===request.estimatedNanos&&usage.currency==="USD"){
  const bound=attempts.some(a=>a.commandKey===item.generationCommandKey);
  if(bound){
   if(generation.status==="SUCCEEDED"&&request.status==="SUCCEEDED"){
    try{validateCanonical(JSON.stringify(generation.result),generation.context);classification="ALREADY_COMPLETED";}catch{}
   }else if(request.status==="RUNNING")classification="AMBIGUOUS";
   else if(generation.status==="PROCESSING"&&request.status==="CLAIMED"&&request.startedAt===null&&!request.ambiguous&&request.commandKey===productionCommand(item))classification="PRE_DISPATCH_SAFE";
   else if(generation.status==="FAILED"&&request.status==="FAILED")classification=classifyKnownFailure(request);
  }
 }
 return {classification,generation,request,usage};
}
export async function productionEligibility(tx:DbExecutor,item:QueueItem){
 try{
  const existing=await tx.select().from(generations).where(and(tenantWhere(generations,item),eq(generations.unitId,item.unitId)));
  if(!item.generationCommandKey&&existing.length)return "EXISTING_GENERATION";
  const context=await buildProductionContextForStoreInTransaction(tx,item,item.unitId);
  if(context.product.id!==item.productVersionId||productionPolicy(context.product.configuration).automation!=="ASSISTED")return "PRODUCT_SETUP";
  if(!item.generationCommandKey)return undefined;
  const state=await inspectProductionState(tx,item);
  if(existing.some(g=>g.id!==item.generationId)||state.classification==="INCONSISTENT")return "INCONSISTENT_STATE";
  if(state.generation&&(state.generation.customerRevision!==context.customer.revision||state.generation.productVersionId!==context.product.id))return "CONTEXT_CHANGED";
  if(state.classification==="ALREADY_COMPLETED")return "EXISTING_GENERATION";
  if(!["PRE_DISPATCH_SAFE","KNOWN_RETRYABLE"].includes(state.classification))return state.classification==="AMBIGUOUS"?"OUTCOME_UNCERTAIN":"GENERATION_FAILED";
  if(state.request?.status==="FAILED"){
   if(item.executionAttempt!==state.request.attemptNumber+1||item.executionAttempt>MAX_GENERATION_ATTEMPTS||item.retryCommandKey!==retryCommandIdentity(item.id,item.executionAttempt))return "RETRY_NOT_AUTHORIZED";
  }else if(state.request&&(state.request.commandKey!==productionCommand(item)||state.request.attemptNumber!==item.executionAttempt))return "INCONSISTENT_STATE";
  return undefined;
 }catch(error){if(error instanceof AdmissionError)return error.code;throw error;}
}
