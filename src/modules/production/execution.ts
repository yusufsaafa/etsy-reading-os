import { and,eq } from "drizzle-orm";
import { z } from "zod";
import type { Database,DbExecutor } from "../../db/client";
import { productionQueue,stores,generations,aiRequests,auditLogs } from "../../db/schema";
import { tenantWhere } from "../intake/service";
import { GenerationService } from "../generation/service";
import { databaseTime,issueProductionAuthority } from "../generation/authority";
import { buildProductionContextForStoreInTransaction } from "../generation/context";
import { AdmissionError } from "../generation/contracts";
import { productionPolicy } from "../products/contracts";
import { ProductionScheduler } from "./scheduler";
type Item=typeof productionQueue.$inferSelect;
export type ExecutionResult={queueId:string;status:"COMPLETED"|"ATTENTION"|"SKIPPED"|"IN_PROGRESS"|"STALE_CLAIM";generationId?:string};
const identity=z.string().uuid();
// Server-only trusted entry point. Not a route/action; no seller impersonation.
export class ProductionExecutor {
 private constructor(private readonly db:Database,private readonly generation:GenerationService) {}
 static forInternalWorker(db:Database,generation:GenerationService){return new ProductionExecutor(db,generation);}
 async execute(queueId:string,claimToken:string):Promise<ExecutionResult>{
  identity.parse(queueId);identity.parse(claimToken);
  const begin=await this.db.transaction(async tx=>{
   const item=await lockItem(tx,queueId);
   if(!item||item.claimToken!==claimToken)return {result:result(queueId,"STALE_CLAIM")};
   if(item.state!=="CLAIMED")return {result:await settle(tx,item,false)};
   const now=await databaseTime(tx);
   if(!item.claimExpiresAt||item.claimExpiresAt<=now)return {result:result(queueId,"STALE_CLAIM")};
   let reason:string|undefined;
   const [existing]=await tx.select({id:generations.id}).from(generations).where(and(tenantWhere(generations,item),eq(generations.unitId,item.unitId))).limit(1);
   if(existing)reason="EXISTING_GENERATION";
   else try{
    const context=await buildProductionContextForStoreInTransaction(tx,item,item.unitId);
    if(context.product.id!==item.productVersionId||productionPolicy(context.product.configuration).automation!=="ASSISTED")reason="PRODUCT_SETUP";
   }catch(error){if(error instanceof AdmissionError)reason=error.code;else throw error;}
   if(reason){
    await tx.update(productionQueue).set({state:"SKIPPED",claimToken:null,claimExpiresAt:null,resolvedAt:now,resolutionCode:reason,updatedAt:now}).where(and(tenantWhere(productionQueue,item),eq(productionQueue.id,item.id)));
    await audit(tx,item,"reading_preparation_skipped");return {result:result(queueId,"SKIPPED")};
   }
   await tx.update(productionQueue).set({state:"EXECUTING",generationCommandKey:item.id,executionStartedAt:now,updatedAt:now}).where(and(tenantWhere(productionQueue,item),eq(productionQueue.id,item.id)));
   const authority=await issueProductionAuthority(tx,item.id,claimToken);
   return {authority};
  });
  if(begin.result)return begin.result;
  let interrupted=false;
  try{await this.generation.prepareProduction(begin.authority!);}
  catch{interrupted=true;}
  // No transaction was held across GenerationService/provider execution.
  return this.db.transaction(async tx=>{
   const item=await lockItem(tx,queueId);
   if(!item||item.claimToken!==claimToken)return result(queueId,"STALE_CLAIM");
   return settle(tx,item,interrupted);
  });
 }
 // Restart/replay acknowledges persisted outcomes only. NEVER redispatches EXECUTING.
 async acknowledge(queueId:string,claimToken:string):Promise<ExecutionResult>{
  identity.parse(queueId);identity.parse(claimToken);
  return this.db.transaction(async tx=>{
   const item=await lockItem(tx,queueId);
   return !item||item.claimToken!==claimToken?result(queueId,"STALE_CLAIM"):settle(tx,item,false);
  });
 }
}
async function lockItem(tx:DbExecutor,id:string){
 const [hint]=await tx.select().from(productionQueue).where(eq(productionQueue.id,id));
 if(!hint)return;
 await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,hint.organizationId),eq(stores.id,hint.storeId))).for("update");
 const [item]=await tx.select().from(productionQueue).where(and(tenantWhere(productionQueue,hint),eq(productionQueue.id,id))).for("update");return item;
}
const result=(queueId:string,status:ExecutionResult["status"],generationId?:string):ExecutionResult=>({queueId,status,...(generationId?{generationId}:{})});
async function audit(tx:DbExecutor,item:Item,action:string){await tx.insert(auditLogs).values({organizationId:item.organizationId,storeId:item.storeId,resourceId:item.id,action});}
async function settle(tx:DbExecutor,item:Item,interrupted:boolean):Promise<ExecutionResult>{
 if(item.state==="COMPLETED"||item.state==="ATTENTION")return result(item.id,item.state,item.generationId??undefined);
 if(item.state!=="EXECUTING")return result(item.id,"STALE_CLAIM");
 const [generation]=item.generationId?await tx.select().from(generations).where(and(tenantWhere(generations,item),eq(generations.id,item.generationId))):[];
 const [request]=generation?await tx.select().from(aiRequests).where(and(tenantWhere(aiRequests,item),eq(aiRequests.generationId,generation.id),eq(aiRequests.commandKey,item.generationCommandKey!))):[];
 let state:"COMPLETED"|"ATTENTION",code:string;
 if(generation?.status==="SUCCEEDED"){state="COMPLETED";code="SUCCEEDED";}
 else if(generation?.status==="FAILED"){state="ATTENTION";code=request?.ambiguous?"OUTCOME_UNCERTAIN":"GENERATION_FAILED";}
 else if(interrupted){state="ATTENTION";code=!request?"PREPARATION_BLOCKED":"OUTCOME_UNCERTAIN";}
 else return result(item.id,"IN_PROGRESS",item.generationId??undefined);
 const now=await databaseTime(tx);
 await tx.update(productionQueue).set({state,claimExpiresAt:null,resolvedAt:now,resolutionCode:code,updatedAt:now}).where(and(tenantWhere(productionQueue,item),eq(productionQueue.id,item.id),eq(productionQueue.claimToken,item.claimToken!),eq(productionQueue.state,"EXECUTING")));
 await audit(tx,item,state==="COMPLETED"?"reading_preparation_completed":"reading_preparation_needs_attention");
 return result(item.id,state,item.generationId??undefined);
}
export async function runProductionCycle(scheduler:ProductionScheduler,executor:ProductionExecutor){
 const cycle=await scheduler.claimProductionWork();const outcomes:ExecutionResult[]=[];
 // Deliberately sequential. Claim batch bounds work; no distributed concurrency promise.
 for(const item of cycle.claimed)outcomes.push(await executor.execute(item.id,item.claimToken!));
 return {inspected:cycle.inspected,skipped:cycle.skipped,outcomes};
}
