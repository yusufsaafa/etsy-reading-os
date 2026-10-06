import { and,eq } from "drizzle-orm";
import { z } from "zod";
import type { Database,DbExecutor } from "../../db/client";
import { productionQueue,auditLogs } from "../../db/schema";
import { tenantWhere } from "../intake/service";
import { GenerationService } from "../generation/service";
import { databaseTime,issueProductionAuthority } from "../generation/authority";
import { AdmissionError } from "../generation/contracts";
import { lockProductionItem,resolveProduction } from "./recovery";
import { productionEligibility } from "./recovery-state";
import { ProductionScheduler } from "./scheduler";
type Item=typeof productionQueue.$inferSelect;
export type ExecutionResult={queueId:string;status:"COMPLETED"|"ATTENTION"|"SKIPPED"|"IN_PROGRESS"|"STALE_CLAIM"|"RETRY_WAIT";generationId?:string};
const identity=z.string().uuid();
// Server-only trusted entry point. Not a route/action; no seller impersonation.
export class ProductionExecutor {
 private constructor(private readonly db:Database,private readonly generation:GenerationService) {}
 static forInternalWorker(db:Database,generation:GenerationService){return new ProductionExecutor(db,generation);}
 async execute(queueId:string,claimToken:string):Promise<ExecutionResult>{
  identity.parse(queueId);identity.parse(claimToken);
  const begin=await this.db.transaction(async tx=>{
   const item=await lockProductionItem(tx,queueId);
   if(!item||item.claimToken!==claimToken)return {result:result(queueId,"STALE_CLAIM")};
   if(item.state!=="CLAIMED")return {result:await settle(tx,item,false)};
   const now=await databaseTime(tx);
   if(!item.claimExpiresAt||item.claimExpiresAt<=now)return {result:result(queueId,"STALE_CLAIM")};
   const reason=await productionEligibility(tx,item);
   if(reason){
    await tx.update(productionQueue).set({state:"SKIPPED",claimToken:null,claimExpiresAt:null,resolvedAt:now,resolutionCode:reason,updatedAt:now}).where(and(tenantWhere(productionQueue,item),eq(productionQueue.id,item.id)));
    await audit(tx,item,"reading_preparation_skipped");return {result:result(queueId,"SKIPPED")};
   }
   await tx.update(productionQueue).set({state:"EXECUTING",generationCommandKey:item.generationCommandKey??item.id,executionStartedAt:item.executionStartedAt??now,updatedAt:now}).where(and(tenantWhere(productionQueue,item),eq(productionQueue.id,item.id)));
   const authority=await issueProductionAuthority(tx,item.id,claimToken);
   return {authority};
  });
  if(begin.result)return begin.result;
  let interrupted=false,rejection:string|undefined;
  try{await this.generation.prepareProduction(begin.authority!);}
  catch(error){interrupted=true;if(error instanceof AdmissionError)rejection=error.code;}
  // No transaction was held across GenerationService/provider execution.
  return this.db.transaction(async tx=>{
   const item=await lockProductionItem(tx,queueId);
   if(!item||item.claimToken!==claimToken)return result(queueId,"STALE_CLAIM");
   return settle(tx,item,interrupted,rejection);
  });
 }
 // Restart/replay acknowledges persisted outcomes only. NEVER redispatches EXECUTING.
 async acknowledge(queueId:string,claimToken:string):Promise<ExecutionResult>{
  identity.parse(queueId);identity.parse(claimToken);
  return this.db.transaction(async tx=>{
   const item=await lockProductionItem(tx,queueId);
   return !item||item.claimToken!==claimToken?result(queueId,"STALE_CLAIM"):settle(tx,item,false);
  });
 }
}
const result=(queueId:string,status:ExecutionResult["status"],generationId?:string):ExecutionResult=>({queueId,status,...(generationId?{generationId}:{})});
async function audit(tx:DbExecutor,item:Item,action:string){await tx.insert(auditLogs).values({organizationId:item.organizationId,storeId:item.storeId,resourceId:item.id,action});}
async function settle(tx:DbExecutor,item:Item,interrupted:boolean,rejection?:string):Promise<ExecutionResult>{
 if(!["EXECUTING","ATTENTION","COMPLETED","RETRY_WAIT"].includes(item.state))return result(item.id,"STALE_CLAIM");
 const settled=await resolveProduction(tx,item,await databaseTime(tx),{interrupted,rejection});
 return result(item.id,settled.status,settled.generationId);
}
export async function runProductionCycle(scheduler:ProductionScheduler,executor:ProductionExecutor){
 const cycle=await scheduler.claimProductionWork();const outcomes:ExecutionResult[]=[];
 // Deliberately sequential. Claim batch bounds work; no distributed concurrency promise.
 for(const item of cycle.claimed)outcomes.push(await executor.execute(item.id,item.claimToken!));
 return {inspected:cycle.inspected,skipped:cycle.skipped,outcomes};
}
