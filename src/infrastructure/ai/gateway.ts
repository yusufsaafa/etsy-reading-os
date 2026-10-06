import { and, eq, gte, or } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client";
import { aiRequests, usageEvents, stores } from "../../db/schema";
import { tenantWhere } from "../../modules/intake/service";
import { verifyGenerationAuthority,type GenerationAuthority } from "../../modules/generation/authority";
import { AdmissionError } from "../../modules/generation/contracts";
import { calculateCost, normalizedUsage, reserveCost, type Pricing } from "./pricing";
import { ProviderFailure, type GenerationProvider, type ProviderRequest, type ProviderResponse } from "./provider";
export type GatewayPolicy={provider:GenerationProvider;model:string;pricing:Pricing;maxOutputTokens:number;dailyBudgetNanos:bigint;attemptBudgetNanos:bigint};
export class CentralAIGateway {
 constructor(private readonly db:Database,private readonly policy:GatewayPolicy) {}
 get maxOutputTokens() {return this.policy.maxOutputTokens;}
 // Called under the Store lock. Intent + provisional UNKNOWN accounting exist before any dispatch.
 async admit(tx:DbExecutor,scope:GenerationAuthority,input:{generationId?:string;attemptNumber:number;commandKey:string;commandHash:string;parentRequestId?:string;operation:string;inputBytes:number}) {
  await verifyGenerationAuthority(tx,scope);
  const [store]=await tx.select({source:stores.source}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
  if(this.policy.provider.name==="fake"&&store.source!=="fixtures")throw new AdmissionError("READING_HOLD");
  const {pricing,model,provider,maxOutputTokens}=this.policy;
  const reservedNanos=reserveCost(input.inputBytes,maxOutputTokens,pricing);
  if(input.inputBytes>256000 || reservedNanos>this.policy.attemptBudgetNanos)throw new AdmissionError("BUDGET_LIMIT");
  const start=new Date();start.setUTCHours(0,0,0,0);
  const previous=await tx.select().from(aiRequests).where(and(tenantWhere(aiRequests,scope),or(gte(aiRequests.createdAt,start),eq(aiRequests.costState,"unknown"))));
  const liability=previous.reduce((sum,r)=>sum+(r.estimatedNanos??r.reservedNanos),0n);
  if(liability+reservedNanos>this.policy.dailyBudgetNanos)throw new AdmissionError("BUDGET_LIMIT");
  const {inputBytes,...metadata}=input;
  const [request]=await tx.insert(aiRequests).values({organizationId:scope.organizationId,storeId:scope.storeId,...metadata,
   provider:provider.name,model,pricing,reservedNanos}).returning();
  await tx.insert(usageEvents).values({organizationId:scope.organizationId,storeId:scope.storeId,aiRequestId:request.id,operation:input.operation});
  return request;
 }
 async execute<T>(scope:GenerationAuthority,requestId:string,input:ProviderRequest,accept:(response:ProviderResponse)=>T,
  finalize:(tx:DbExecutor,outcome:{result?:T;failure?:ProviderFailure})=>Promise<void>,preflight:(tx:DbExecutor)=>Promise<void>) {
  const claimed=await this.db.transaction(async tx=>{
   await verifyGenerationAuthority(tx,scope);
   await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
   await verifyGenerationAuthority(tx,scope);
   const [row]=await tx.select().from(aiRequests).where(and(tenantWhere(aiRequests,scope),eq(aiRequests.id,requestId))).for("update");
   if(!row||row.status!=="CLAIMED")return undefined;
   if(row.provider!==this.policy.provider.name||row.model!==input.model||input.maxOutputTokens!==this.policy.maxOutputTokens)throw new Error("GATEWAY_POLICY_MISMATCH");
   try{await preflight(tx);}catch{
    await tx.update(aiRequests).set({status:"FAILED",failureCode:"ADMISSION_CHANGED",costState:"known_zero",estimatedNanos:0n,finishedAt:new Date()}).where(eq(aiRequests.id,row.id));
    await tx.update(usageEvents).set({costState:"known_zero",amountNanos:0n}).where(eq(usageEvents.aiRequestId,row.id));
    await finalize(tx,{failure:new ProviderFailure("BLOCKED")});return undefined;
   }
   await tx.update(aiRequests).set({status:"RUNNING",startedAt:new Date()}).where(eq(aiRequests.id,row.id));return row;
  });
  if(!claimed)return;
  const started=performance.now();let response:ProviderResponse|undefined,result:T|undefined,failure:ProviderFailure|undefined;
  try {
   response=await this.policy.provider.generate(input);
   try{result=accept(response);}catch{failure=new ProviderFailure("INVALID_OUTPUT",response.usage,response.requestId);}
  }catch(error){failure=error instanceof ProviderFailure?error:new ProviderFailure("PROVIDER_ERROR",{},undefined,true);}
  if(failure&&["TIMEOUT","NETWORK"].includes(failure.code)&&!failure.ambiguous)failure=new ProviderFailure(failure.code,failure.usage,failure.requestId,true,failure.resolvedModel);
  const usage=normalizedUsage(response?.usage??failure?.usage??{});
  const cost=calculateCost(usage,claimed.pricing);
  const durationMs=Math.min(2147483647,Math.round(performance.now()-started));
  // Recording does not depend on current membership: the authorized dispatched intent must settle even after revocation.
  await this.db.transaction(async tx=>{
   const [row]=await tx.select().from(aiRequests).where(and(tenantWhere(aiRequests,scope),eq(aiRequests.id,requestId))).for("update");
   if(row?.status!=="RUNNING")throw new Error("AI_REQUEST_STATE_CHANGED");
   await tx.update(aiRequests).set({status:failure?"FAILED":"SUCCEEDED",failureCode:failure?.code??null,ambiguous:failure?.ambiguous??false,
    ...usage,providerRequestId:response?.requestId??failure?.requestId??null,resolvedModel:response?.resolvedModel??failure?.resolvedModel??null,
    durationMs,costState:cost.state,estimatedNanos:cost.nanos,finishedAt:new Date()}).where(and(tenantWhere(aiRequests,scope),eq(aiRequests.id,requestId)));
   await tx.update(usageEvents).set({costState:cost.state,amountNanos:cost.nanos}).where(and(tenantWhere(usageEvents,scope),eq(usageEvents.aiRequestId,requestId)));
   await finalize(tx,{result,failure});
  });
 }
}
