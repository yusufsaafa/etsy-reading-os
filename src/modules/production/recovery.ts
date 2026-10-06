import { and,eq,or,lte,asc } from "drizzle-orm";
import { z } from "zod";
import type { Database,DbExecutor } from "../../db/client";
import { productionQueue,stores,auditLogs } from "../../db/schema";
import type { Scope } from "../intake/contracts";
import { tenantWhere,verifyScope } from "../intake/service";
import { AccessDenied } from "../identity/service";
import { databaseTime } from "../generation/authority";
import { AdmissionError } from "../generation/contracts";
import { inspectProductionState,productionEligibility,type QueueItem } from "./recovery-state";
import { productionRecoveryPolicy,retryCommandIdentity,MAX_GENERATION_ATTEMPTS } from "./recovery-policy";
export async function lockProductionItem(tx:DbExecutor,id:string,scope?:{organizationId:string;storeId:string}){
 const [hint]=await tx.select().from(productionQueue).where(scope?and(tenantWhere(productionQueue,scope),eq(productionQueue.id,id)):eq(productionQueue.id,id));
 if(!hint)return;
 await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,hint.organizationId),eq(stores.id,hint.storeId))).for("update");
 const [item]=await tx.select().from(productionQueue).where(and(tenantWhere(productionQueue,hint),eq(productionQueue.id,id))).for("update");return item;
}
export async function resolveProduction(tx:DbExecutor,item:QueueItem,now:Date,{interrupted=false,recover=false,explicit=false,rejection,actorId}:{interrupted?:boolean;recover?:boolean;explicit?:boolean;rejection?:string;actorId?:string}={}){
 if(item.state==="COMPLETED"||item.state==="SKIPPED")return {status:item.state as "COMPLETED"|"SKIPPED",generationId:item.generationId??undefined};
 const state=await inspectProductionState(tx,item);
 let status:"COMPLETED"|"ATTENTION"|"RETRY_WAIT"|"IN_PROGRESS",code:string,changes:Partial<typeof productionQueue.$inferInsert>={};
 if(state.classification==="ALREADY_COMPLETED"){status="COMPLETED";code="SUCCEEDED";}
 else if(item.state==="RETRY_WAIT"&&["PRE_DISPATCH_SAFE","KNOWN_RETRYABLE"].includes(state.classification)&&!await productionEligibility(tx,item))return {status:"RETRY_WAIT" as const,generationId:item.generationId??undefined};
 else if(item.state==="ATTENTION"&&!recover&&!explicit)return {status:"ATTENTION" as const,generationId:item.generationId??undefined};
 else if(rejection==="BUDGET_LIMIT"||(item.resolutionCode==="BUDGET_LIMIT"&&!explicit)){status="ATTENTION";code="BUDGET_LIMIT";}
 else if(state.classification==="INCONSISTENT"){status="ATTENTION";code="INCONSISTENT_STATE";}
 else if(state.classification==="AMBIGUOUS"){
  if(state.request?.status!=="FAILED"&&!interrupted&&!recover)return {status:"IN_PROGRESS" as const,generationId:item.generationId??undefined};
  status="ATTENTION";code="OUTCOME_UNCERTAIN";
 }else if(state.classification==="KNOWN_NON_RETRYABLE"){status="ATTENTION";code="GENERATION_FAILED";}
 else if(state.classification==="KNOWN_RETRYABLE"||(state.classification==="PRE_DISPATCH_SAFE"&&(recover||explicit||state.request?.status==="FAILED"))){
  const next=state.request?.status==="FAILED"?state.request.attemptNumber+1:item.executionAttempt;
  if(next>MAX_GENERATION_ATTEMPTS){status="ATTENTION";code="MAX_ATTEMPTS";}
  else{
   const candidate={...item,executionAttempt:next,retryCommandKey:next>1?retryCommandIdentity(item.id,next):null};
   const reason=await productionEligibility(tx,candidate);
   if(reason){status="ATTENTION";code=reason;}
   else{
    status="RETRY_WAIT";code=state.classification;
    const base=now;
    const delay=productionRecoveryPolicy.backoffMs[Math.max(0,Math.min((state.request?.attemptNumber??1)-1,productionRecoveryPolicy.backoffMs.length-1))];
    changes={executionAttempt:next,retryCommandKey:candidate.retryCommandKey,availableAt:new Date(base.getTime()+delay)};
   }
  }
 }else{
  if(!interrupted)return {status:"IN_PROGRESS" as const,generationId:item.generationId??undefined};
  status="ATTENTION";code="PREPARATION_BLOCKED";
 }
 if(explicit&&status!=="RETRY_WAIT")throw new AdmissionError(code==="CONTEXT_CHANGED"?"CONTEXT_CHANGED":"RETRY_UNCERTAIN");
 const changed=status!==item.state||code!==item.resolutionCode;
 await tx.update(productionQueue).set({...changes,state:status,claimExpiresAt:null,resolvedAt:item.resolvedAt??now,resolutionCode:code,updatedAt:now}).where(and(tenantWhere(productionQueue,item),eq(productionQueue.id,item.id),eq(productionQueue.state,item.state),eq(productionQueue.claimToken,item.claimToken!)));
 if(changed)await tx.insert(auditLogs).values({organizationId:item.organizationId,storeId:item.storeId,resourceId:item.id,actorId,action:status==="COMPLETED"?"reading_preparation_completed":status==="RETRY_WAIT"?"reading_preparation_retry_scheduled":"reading_preparation_needs_attention"});
 return {status,generationId:item.generationId??undefined};
}
// Trusted server boundary; no browser route or seller impersonation.
export class ProductionRecovery {
 private constructor(private readonly db:Database,private readonly limit:number,private readonly clock?:()=>Date){}
 static forInternalWorker(db:Database,options:{limit?:number;clock?:()=>Date}={}){
  return new ProductionRecovery(db,z.number().int().min(1).max(1000).parse(options.limit??productionRecoveryPolicy.inspectionLimit),options.clock);
 }
 async reconcileProductionWork(){
  const now=this.clock?.()??await databaseTime(this.db);
  if(!Number.isFinite(now.getTime()))throw new Error("INVALID_RECOVERY_CLOCK");
  const candidates=await this.db.select({id:productionQueue.id}).from(productionQueue).where(or(eq(productionQueue.state,"ATTENTION"),and(eq(productionQueue.state,"EXECUTING"),lte(productionQueue.claimExpiresAt,now)),and(eq(productionQueue.state,"RETRY_WAIT"),lte(productionQueue.availableAt,now)))).orderBy(asc(productionQueue.updatedAt),asc(productionQueue.id)).limit(this.limit);
  const outcomes=[];
  for(const candidate of candidates)outcomes.push(await this.db.transaction(async tx=>{
   const item=await lockProductionItem(tx,candidate.id);
   if(!item)return {queueId:candidate.id,status:"UNAVAILABLE"};
   if(item.state==="EXECUTING"&&item.claimExpiresAt&&item.claimExpiresAt>now)return {queueId:item.id,status:"IN_PROGRESS"};
   if(!["EXECUTING","ATTENTION","RETRY_WAIT"].includes(item.state))return {queueId:item.id,status:item.state};
   return {queueId:item.id,...await resolveProduction(tx,item,now,{recover:true})};
  }));
  return {inspected:candidates.length,outcomes};
 }
}
// Seller-safe command accepts Reading identity only and uses normal owner authorization.
export async function requestProductionRetry(db:Database,scope:Scope,unitId:string){
 z.string().uuid().parse(unitId);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  const [hint]=await tx.select({id:productionQueue.id}).from(productionQueue).where(and(tenantWhere(productionQueue,scope),eq(productionQueue.unitId,unitId)));
  if(!hint)throw new AccessDenied();
  const item=await lockProductionItem(tx,hint.id,scope);if(!item)throw new AccessDenied();
  await verifyScope(tx,scope,true);
  if(item.state==="RETRY_WAIT")return {status:"RETRY_WAIT" as const};
  if(item.state!=="ATTENTION")throw new AdmissionError("ACTIVE_OPERATION");
  return resolveProduction(tx,item,await databaseTime(tx),{explicit:true,actorId:scope.userId});
 });
}
