import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { authorizeStore,createWorkspace } from "../src/modules/identity/service";
import { ingestListing,ingestOrder,correctInput,workspaceData,tenantWhere } from "../src/modules/intake/service";
import { fixtureListings,fixtureOrders } from "../src/modules/etsy/fixtures";
import { beginListingDraft,activateProduct,editProduct,productData } from "../src/modules/products/service";
import { saveSellerProfile,editStyle,applyStyle } from "../src/modules/seller-style/service";
import { buildGenerationContext } from "../src/modules/generation/context";
import { GenerationService,readGeneration,generationAccounting,requestAccounting,generationHistory } from "../src/modules/generation/service";
import { FakeGenerationProvider } from "../src/infrastructure/ai/fake";
import { CentralAIGateway } from "../src/infrastructure/ai/gateway";
import { pricingFor } from "../src/infrastructure/ai/pricing";
import { ProviderFailure, type GenerationProvider } from "../src/infrastructure/ai/provider";
import type { Scope,ExternalOrder } from "../src/modules/intake/contracts";
import type { Configuration } from "../src/modules/products/contracts";
let pg:PGlite,db:Database,a:Scope,b:Scope,unitId:string,productId:string,versionId:string,styleId:string;
const configuration:Configuration={inputs:[{id:"name",key:"name",label:"Name",type:"TEXT",required:true,helpText:"",sortOrder:0}],
 sections:[{id:"intro",title:"Introduction",instruction:"Welcome the recipient",sortOrder:0},{id:"guidance",title:"Guidance",instruction:"Give useful guidance",sortOrder:1}],output:"TEXT",workflow:"ASSISTED"};
const style={tone:"WARM" as const,detail:"DETAILED" as const,approach:"CONVERSATIONAL" as const,preferredExpressions:[],avoidExpressions:[],instructions:"Use clear language"};
function service(provider:GenerationProvider=new FakeGenerationProvider(),paid=false,budget=1000000000n) {
 const model=paid?"gemini-3.8-flash":"deterministic-v1";
 return new GenerationService(db,new CentralAIGateway(db,{provider,model,pricing:pricingFor(paid?"google":"fake",model),
 maxOutputTokens:8192,dailyBudgetNanos:budget,attemptBudgetNanos:budget}));
}
const command=(unit=unitId)=>({unitId:unit,commandKey:randomUUID()});
async function prepare(provider=new FakeGenerationProvider()) {const result=await service(provider).prepare(a,command());return {result,provider};}
async function context() {return db.transaction(tx=>buildGenerationContext(tx,a,unitId),{isolationLevel:"repeatable read"});}
beforeEach(async()=>{
 pg=new PGlite();for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;
 for(const userId of ["generation-a","generation-b"])await db.insert(schema.users).values({id:userId,name:userId});
 a=await authorizeStore(db,"generation-a",await createWorkspace(db,"generation-a","Writing Studio","fixtures"));
 b=await authorizeStore(db,"generation-b",await createWorkspace(db,"generation-b","Other Studio","fixtures"));
 for(const listing of fixtureListings)await ingestListing(db,a,listing);
 await db.insert(schema.listingSelections).values(["101","102"].map(listingExternalId=>({organizationId:a.organizationId,storeId:a.storeId,listingExternalId,selectedBy:a.userId})));
 productId=await beginListingDraft(db,a,"101","default");const product=await productData(db,a,productId);
 versionId=await activateProduct(db,a,productId,product.draft!.id,0,{name:"Personalized guidance",configuration});
 await saveSellerProfile(db,a,{displayName:"Sarah",shortBio:"Synthetic writer"});
 const draft=await editStyle(db,a);styleId=(await applyStyle(db,a,draft.id,0,style)).id;
 const order:ExternalOrder={...fixtureOrders[0],externalId:"9901",lines:[{...fixtureOrders[0].lines[0],externalId:"9991",listingId:"101",quantity:1,answers:[{label:"Name",value:"Synthetic recipient",kind:"text"}]}]};
 await ingestOrder(db,a,order);unitId=(await workspaceData(db,a)).units[0].id;
},20000);
afterEach(async()=>{vi.restoreAllMocks();await pg.close();});

import { ProductionExecutor,runProductionCycle } from "../src/modules/production/execution";
import { ProductionScheduler } from "../src/modules/production/scheduler";
import { configureMapping } from "../src/modules/intake/service";
import { readingStatus } from "../src/components/seller-status";
import { readQueueItem } from "../src/modules/production/service";
const scheduler=()=>ProductionScheduler.forInternalWorker(db);
async function claimed(){return (await scheduler().claimProductionWork()).claimed[0];}
function executor(provider:GenerationProvider=new FakeGenerationProvider()){return ProductionExecutor.forInternalWorker(db,service(provider));}

import { ProductionRecovery,requestProductionRetry,lockProductionItem } from "../src/modules/production/recovery";
import { retryCommandIdentity,productionRecoveryPolicy } from "../src/modules/production/recovery-policy";
import { ProductionTick } from "../src/modules/production/tick";
import { sql } from "drizzle-orm";
const recovery=(clock?:()=>Date,limit?:number)=>ProductionRecovery.forInternalWorker(db,{clock,limit});
const tick=(p:GenerationProvider=new FakeGenerationProvider())=>ProductionTick.forInternalWorker(db,recovery(),scheduler(),executor(p));
async function failed(code:"RATE_LIMIT"|"AUTH"|"TIMEOUT"|"PROVIDER_ERROR"="RATE_LIMIT",ambiguous=false){
 const p=new FakeGenerationProvider({failure:new ProviderFailure(code,{inputTokens:100,outputTokens:200,totalTokens:300},undefined,ambiguous)}),q=await claimed();
 const out=await executor(p).execute(q.id,q.claimToken!);return {q:await readQueueItem(db,a,q.id),p,out};
}
async function dueClaim(q:typeof schema.productionQueue.$inferSelect){
 return (await ProductionScheduler.forInternalWorker(db,{clock:()=>q.availableAt!}).claimProductionWork()).claimed[0];
}
async function crashAfterEngine(g:GenerationService,q:typeof schema.productionQueue.$inferSelect){
 const original=g.prepareProduction.bind(g);
 vi.spyOn(g,"prepareProduction").mockImplementation(async authority=>{const result=await original(authority);vi.spyOn(db,"transaction").mockRejectedValueOnce(new Error("process lost before queue acknowledgement"));return result;});
 await expect(ProductionExecutor.forInternalWorker(db,g).execute(q.id,q.claimToken!)).rejects.toThrow();
 vi.restoreAllMocks();return readQueueItem(db,a,q.id);
}
it("known retryable failure durably schedules backoff with a distinct persisted command",async()=>{
 const {q,p,out}=await failed();expect(out.status).toBe("RETRY_WAIT");expect(q).toMatchObject({state:"RETRY_WAIT",executionAttempt:2,generationCommandKey:q.id,retryCommandKey:retryCommandIdentity(q.id,2),resolutionCode:"KNOWN_RETRYABLE"});
 expect(q.availableAt!.getTime()-q.updatedAt.getTime()).toBe(productionRecoveryPolicy.backoffMs[0]);expect(p.calls).toBe(1);expect((await scheduler().claimProductionWork()).claimed).toHaveLength(0);
 expect(readingStatus([], (await workspaceData(db,a)).units[0].productionStatus)).toBe("Waiting");
});
it("retry wait identity and due timer survive restart and repeated reconciliation",async()=>{
 const {q,p}=await failed();const audit=(await db.select().from(schema.auditLogs)).length;
 await recovery().reconcileProductionWork();await recovery().reconcileProductionWork();expect(await readQueueItem(db,a,q.id)).toEqual(q);expect((await db.select().from(schema.auditLogs)).length).toBe(audit);expect(p.calls).toBe(1);
 expect((await dueClaim(q)).retryCommandKey).toBe(q.retryCommandKey);
});
it("due retry uses existing Generation with separate parent/attempt/request/usage history",async()=>{
 const {q}=await failed(),claim=await dueClaim(q),p=new FakeGenerationProvider();const out=await executor(p).execute(claim.id,claim.claimToken!);
 expect(out.status).toBe("COMPLETED");expect(out.generationId).toBe(q.generationId);expect(p.calls).toBe(1);
 const c=await generationAccounting(db,a,q.generationId!);expect(c.attempts.map(a=>a.attemptNumber)).toEqual([1,2]);expect(c.attempts[1]).toMatchObject({parentRequestId:c.attempts[0].id,commandKey:q.retryCommandKey,status:"SUCCEEDED"});expect(await db.select().from(schema.usageEvents)).toHaveLength(2);expect(await db.select().from(schema.generations)).toHaveLength(1);
 await executor(p).execute(claim.id,claim.claimToken!);await recovery().reconcileProductionWork();expect(p.calls).toBe(1);
});
it("automatic attempts stop at engine maximum three with longer second backoff",async()=>{
 const {q:one}=await failed(),p=new FakeGenerationProvider({failure:new ProviderFailure("RATE_LIMIT",{inputTokens:10,outputTokens:20})});
 const claim2=await dueClaim(one);expect((await executor(p).execute(claim2.id,claim2.claimToken!)).status).toBe("RETRY_WAIT");
 const two=await readQueueItem(db,a,one.id);expect(two.executionAttempt).toBe(3);expect(two.availableAt!.getTime()-two.updatedAt.getTime()).toBe(productionRecoveryPolicy.backoffMs[1]);
 const claim3=await dueClaim(two);expect((await executor(p).execute(claim3.id,claim3.claimToken!)).status).toBe("ATTENTION");expect((await readQueueItem(db,a,one.id)).resolutionCode).toBe("MAX_ATTEMPTS");
 await recovery().reconcileProductionWork();await expect(requestProductionRetry(db,a,unitId)).rejects.toThrow();expect((await scheduler().claimProductionWork()).claimed).toHaveLength(0);expect((await generationAccounting(db,a,one.generationId!)).attempts).toHaveLength(3);expect(p.calls).toBe(2);
});
it.each(["AUTH","PROVIDER_ERROR"] as const)("known non-retryable %s remains Problem and rejects explicit unsafe retry",async code=>{
 const {q,p}=await failed(code);expect(q.state).toBe("ATTENTION");await recovery().reconcileProductionWork();expect((await readQueueItem(db,a,q.id)).state).toBe("ATTENTION");await expect(requestProductionRetry(db,a,unitId)).rejects.toThrow();expect(p.calls).toBe(1);
});
it.each([true,false])("MRH timeout-after-dispatch regression never retries even when upstream ambiguity flag=%s",async ambiguous=>{
 const {q,p}=await failed("TIMEOUT",ambiguous);const [before]=await db.select().from(schema.aiRequests),[ledger]=await db.select().from(schema.usageEvents);
 expect(q.state).toBe("ATTENTION");expect(before.ambiguous).toBe(true);
 await recovery().reconcileProductionWork();await recovery().reconcileProductionWork();expect(await db.select().from(schema.aiRequests)).toEqual([before]);expect(await db.select().from(schema.usageEvents)).toEqual([ledger]);expect(p.calls).toBe(1);await expect(requestProductionRetry(db,a,unitId)).rejects.toThrow();expect(readingStatus([], (await workspaceData(db,a)).units[0].productionStatus)).toBe("Problem");
});
it("unknown timeout cost remains null through restart/recovery with zero second request",async()=>{
 const q=await claimed(),p=new FakeGenerationProvider({failure:new ProviderFailure("TIMEOUT",{},undefined,true)});await executor(p).execute(q.id,q.claimToken!);
 await recovery().reconcileProductionWork();const [req]=await db.select().from(schema.aiRequests),[usage]=await db.select().from(schema.usageEvents);expect(req).toMatchObject({estimatedNanos:null,costState:"unknown",inputTokens:null});expect(usage).toMatchObject({amountNanos:null,costState:"unknown"});expect(p.calls).toBe(1);expect((await scheduler().claimProductionWork()).claimed).toHaveLength(0);
});
it("known paid failures retain integer cost across retry, with distinct immutable ledger rows",async()=>{
 const fake=new FakeGenerationProvider({failure:new ProviderFailure("RATE_LIMIT",{inputTokens:100,outputTokens:200,totalTokens:300})}),provider:GenerationProvider={name:"google",generate:r=>fake.generate(r)};
 const q=await claimed();await ProductionExecutor.forInternalWorker(db,service(provider,true)).execute(q.id,q.claimToken!);const wait=await readQueueItem(db,a,q.id),first=(await generationAccounting(db,a,wait.generationId!)).attempts[0];expect(first.estimatedNanos).toBe(825000n);
 const claim=await dueClaim(wait),good=new FakeGenerationProvider(),paid:GenerationProvider={name:"google",generate:r=>good.generate(r)};await ProductionExecutor.forInternalWorker(db,service(paid,true)).execute(q.id,claim.claimToken!);
 const cost=await generationAccounting(db,a,wait.generationId!);expect(cost.attempts[0]).toEqual(first);expect(cost.knownNanos).toBe(1650000n);expect(await db.select().from(schema.usageEvents)).toHaveLength(2);
});
it("unfinished queue with durable canonical success is adopted with no new provider call",async()=>{
 const p=new FakeGenerationProvider(),q=await claimed(),crashed=await crashAfterEngine(service(p),q);expect(crashed.state).toBe("EXECUTING");
 const r=await recovery(()=>new Date(q.claimExpiresAt!.getTime()+1)).reconcileProductionWork();expect(r.outcomes[0].status).toBe("COMPLETED");expect((await readQueueItem(db,a,q.id)).state).toBe("COMPLETED");await recovery().reconcileProductionWork();expect(p.calls).toBe(1);expect(await db.select().from(schema.aiRequests)).toHaveLength(1);
});
it("abandoned executing known failure adopts accounting and schedules bounded retry",async()=>{
 const p=new FakeGenerationProvider({failure:new ProviderFailure("RATE_LIMIT",{inputTokens:20,outputTokens:10})}),q=await claimed();await crashAfterEngine(service(p),q);
 await recovery(()=>new Date(q.claimExpiresAt!.getTime()+1)).reconcileProductionWork();const item=await readQueueItem(db,a,q.id);expect(item.state).toBe("RETRY_WAIT");expect(item.executionAttempt).toBe(2);expect(p.calls).toBe(1);expect(await db.select().from(schema.usageEvents)).toHaveLength(1);
});
it("abandoned executing ambiguous failure quarantines and preserves durable history",async()=>{
 const p=new FakeGenerationProvider({failure:new ProviderFailure("TIMEOUT",{},undefined,true)}),q=await claimed();await crashAfterEngine(service(p),q);const attempts=await db.select().from(schema.aiRequests),usage=await db.select().from(schema.usageEvents);
 await recovery(()=>new Date(q.claimExpiresAt!.getTime()+1)).reconcileProductionWork();expect((await readQueueItem(db,a,q.id)).resolutionCode).toBe("OUTCOME_UNCERTAIN");expect(await db.select().from(schema.aiRequests)).toEqual(attempts);expect(await db.select().from(schema.usageEvents)).toEqual(usage);expect(p.calls).toBe(1);
});
it("abandoned RUNNING external request becomes attention without fabricating failure or cost",async()=>{
 const fake=new FakeGenerationProvider(),provider:GenerationProvider={name:"fake",generate:async r=>{const out=await fake.generate(r);vi.spyOn(db,"transaction").mockRejectedValueOnce(new Error("lost accounting settlement"));return out;}},q=await claimed();await executor(provider).execute(q.id,q.claimToken!);vi.restoreAllMocks();
 const requests=await db.select().from(schema.aiRequests),usage=await db.select().from(schema.usageEvents);await recovery().reconcileProductionWork();expect(await db.select().from(schema.aiRequests)).toEqual(requests);expect(await db.select().from(schema.usageEvents)).toEqual(usage);expect(requests[0]).toMatchObject({status:"RUNNING",estimatedNanos:null,costState:"unknown"});expect((await readQueueItem(db,a,q.id)).state).toBe("ATTENTION");expect(fake.calls).toBe(1);
});
it("abandoned execution before any Generation admission safely resumes original command",async()=>{
 const q=await claimed();await db.transaction(async tx=>{await lockProductionItem(tx,q.id);await tx.update(schema.productionQueue).set({state:"EXECUTING",generationCommandKey:q.id,executionStartedAt:new Date()}).where(eq(schema.productionQueue.id,q.id));});
 await recovery(()=>new Date(q.claimExpiresAt!.getTime()+1)).reconcileProductionWork();const wait=await readQueueItem(db,a,q.id);expect(wait).toMatchObject({state:"RETRY_WAIT",executionAttempt:1,retryCommandKey:null,generationId:null});
 const p=new FakeGenerationProvider(),claim=await dueClaim(wait);expect((await executor(p).execute(claim.id,claim.claimToken!)).status).toBe("COMPLETED");expect((await db.select().from(schema.aiRequests))[0].commandKey).toBe(q.id);expect(p.calls).toBe(1);
});
it("admitted but undispatched CLAIMED request resumes SAME command without new accounting attempt",async()=>{
 const q=await claimed(),p=new FakeGenerationProvider(),gateway=new CentralAIGateway(db,{provider:p,model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n});
 vi.spyOn(gateway,"execute").mockRejectedValueOnce(new Error("process died before dispatch"));await ProductionExecutor.forInternalWorker(db,new GenerationService(db,gateway)).execute(q.id,q.claimToken!);vi.restoreAllMocks();
 const [before]=await db.select().from(schema.aiRequests);expect(before.status).toBe("CLAIMED");expect(p.calls).toBe(0);await recovery().reconcileProductionWork();const wait=await readQueueItem(db,a,q.id),claim=await dueClaim(wait);expect(wait.executionAttempt).toBe(1);
 expect((await executor(p).execute(q.id,claim.claimToken!)).status).toBe("COMPLETED");const attempts=await db.select().from(schema.aiRequests);expect(attempts).toHaveLength(1);expect(attempts[0]).toMatchObject({id:before.id,commandKey:q.id,status:"SUCCEEDED"});expect(p.calls).toBe(1);
});
it("active executing request is not reconciled before expiration; late canonical result can be adopted",async()=>{
 let release!:()=>void;const p=new FakeGenerationProvider({delay:new Promise<void>(r=>release=r)}),q=await claimed(),running=executor(p).execute(q.id,q.claimToken!);await vi.waitFor(()=>expect(p.calls).toBe(1));
 expect((await recovery().reconcileProductionWork()).inspected).toBe(0);
 await recovery(()=>new Date(q.claimExpiresAt!.getTime()+1)).reconcileProductionWork();expect((await readQueueItem(db,a,q.id)).state).toBe("ATTENTION");release();expect((await running).status).toBe("COMPLETED");expect(p.calls).toBe(1);
});
it("inconsistent Generation/accounting state fails closed and cannot schedule retry",async()=>{
 const {q}=await failed();await pg.exec("ALTER TABLE usage_events DISABLE TRIGGER usage_accounting_consistent; ALTER TABLE usage_events DISABLE TRIGGER usage_history_immutable");await db.update(schema.usageEvents).set({currency:"USD",operation:"BROKEN"});
 // Restore EXECUTING representation of an interrupted acknowledgement to inspect immediately.
 await pg.exec("ALTER TABLE production_queue DISABLE TRIGGER production_claim_transition");await db.update(schema.productionQueue).set({state:"ATTENTION",availableAt:null,resolutionCode:"INCONSISTENT_STATE"}).where(eq(schema.productionQueue.id,q.id));await pg.exec("ALTER TABLE production_queue ENABLE TRIGGER production_claim_transition");
 await recovery().reconcileProductionWork();expect((await readQueueItem(db,a,q.id)).resolutionCode).toBe("INCONSISTENT_STATE");await expect(requestProductionRetry(db,a,unitId)).rejects.toThrow();expect((await scheduler().claimProductionWork()).claimed).toHaveLength(0);
});
it("changed customer revision fences queued retry without changing original snapshot or paid attempts",async()=>{
 const {q,p}=await failed();await correctInput(db,a,unitId,0,[{label:"Name",value:"New request",kind:"text"}],false);expect((await ProductionScheduler.forInternalWorker(db,{clock:()=>q.availableAt!}).claimProductionWork()).claimed).toHaveLength(0);expect((await readQueueItem(db,a,q.id)).state).toBe("SKIPPED");expect((await readGeneration(db,a,q.generationId!)).customerRevision).toBe(0);expect(p.calls).toBe(1);
});
it("retry retains original product/style/seller snapshots after later configuration changes",async()=>{
 const {q}=await failed(),original=await readGeneration(db,a,q.generationId!);const d=await editProduct(db,a,productId);await activateProduct(db,a,productId,d,0,{name:"Changed product",configuration:{...configuration,workflow:"MANUAL"}});const sd=await editStyle(db,a);await applyStyle(db,a,sd.id,sd.revision,{...style,tone:"DIRECT"});await saveSellerProfile(db,a,{displayName:"Changed writer",shortBio:"Changed"});
 const claim=await dueClaim(q),out=await executor().execute(q.id,claim.claimToken!);expect(out.status).toBe("COMPLETED");const retained=await readGeneration(db,a,q.generationId!);expect(retained.context).toEqual(original.context);expect(retained.productVersionId).toBe(versionId);expect(retained.styleVersionId).toBe(styleId);
});
it("safe seller retry is owner-authorized, replay-safe and rejects cross-tenant Reading IDs",async()=>{
 const q=await claimed(),g=service();vi.spyOn(g,"prepareProduction").mockRejectedValueOnce(new Error("pre-admission interruption"));await ProductionExecutor.forInternalWorker(db,g).execute(q.id,q.claimToken!);vi.restoreAllMocks();
 await expect(requestProductionRetry(db,b,unitId)).rejects.toThrow();expect((await requestProductionRetry(db,a,unitId)).status).toBe("RETRY_WAIT");const wait=await readQueueItem(db,a,q.id);expect((await requestProductionRetry(db,a,unitId)).status).toBe("RETRY_WAIT");expect(await readQueueItem(db,a,q.id)).toEqual(wait);
});
it("overlapping external ticks cannot dispatch two paid calls",async()=>{
 let release!:()=>void;const p=new FakeGenerationProvider({delay:new Promise<void>(r=>release=r)}),first=tick(p).runProductionTick();await vi.waitFor(()=>expect(p.calls).toBe(1));
 const second=await tick(p).runProductionTick();expect(second.status).toBe("BUSY");expect(p.calls).toBe(1);release();expect((await first).status).toBe("FINISHED");expect((await db.select().from(schema.productionTick))[0].token).toBeNull();
});
it("stale tick ownership can expire and restart while unfinished paid work is quarantined",async()=>{
 await db.insert(schema.productionTick).values({id:"production",token:randomUUID(),expiresAt:new Date(Date.now()-10000)});const p=new FakeGenerationProvider();const out=await tick(p).runProductionTick();expect(out.status).toBe("FINISHED");expect(out.claimed).toBe(1);expect(p.calls).toBe(1);
});
it("bounded reconciliation returns only configured number, preserving foreign Store ownership",async()=>{
 const {q,p}=await failed("AUTH");const result=await recovery(undefined,1).reconcileProductionWork();expect(result.inspected).toBe(1);expect(result.outcomes[0].queueId).toBe(q.id);await expect(readQueueItem(db,b,q.id)).rejects.toThrow();expect((await db.select().from(schema.productionQueue))[0].storeId).toBe(a.storeId);expect(p.calls).toBe(1);
});
it("database forbids automatic retry of ambiguous history and changing durable command identity",async()=>{
 const {q}=await failed("TIMEOUT",true);await expect(db.update(schema.productionQueue).set({state:"RETRY_WAIT",executionAttempt:2,retryCommandKey:retryCommandIdentity(q.id,2),availableAt:new Date(Date.now()+30000)}).where(eq(schema.productionQueue.id,q.id))).rejects.toThrow();await expect(db.update(schema.productionQueue).set({retryCommandKey:randomUUID()}).where(eq(schema.productionQueue.id,q.id))).rejects.toThrow();
});
it("retry budget rejection becomes attention without repeated automatic admission loops",async()=>{
 const {q}=await failed(),claim=await dueClaim(q),fake=new FakeGenerationProvider(),paid:GenerationProvider={name:"google",generate:r=>fake.generate(r)};
 expect((await ProductionExecutor.forInternalWorker(db,service(paid,true,1n)).execute(q.id,claim.claimToken!)).status).toBe("ATTENTION");expect((await readQueueItem(db,a,q.id)).resolutionCode).toBe("BUDGET_LIMIT");
 await recovery().reconcileProductionWork();expect((await readQueueItem(db,a,q.id)).state).toBe("ATTENTION");expect(fake.calls).toBe(0);expect(await db.select().from(schema.aiRequests)).toHaveLength(1);
});
it("safe pre-dispatch zero-cost attempt creates an explicit linked retry only if original context remains compatible",async()=>{
 const q=await claimed(),p=new FakeGenerationProvider(),gateway=new CentralAIGateway(db,{provider:p,model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n}),original=gateway.execute.bind(gateway);
 vi.spyOn(gateway,"execute").mockImplementation(async(...args)=>{await configureMapping(db,a,"101","default",true);return original(...args);});
 await ProductionExecutor.forInternalWorker(db,new GenerationService(db,gateway)).execute(q.id,q.claimToken!);vi.restoreAllMocks();expect(p.calls).toBe(0);const [request]=await db.select().from(schema.aiRequests);expect(request).toMatchObject({status:"FAILED",failureCode:"ADMISSION_CHANGED",estimatedNanos:0n,startedAt:null});expect((await readQueueItem(db,a,q.id)).state).toBe("ATTENTION");
 await configureMapping(db,a,"101","default",false);await requestProductionRetry(db,a,unitId);const wait=await readQueueItem(db,a,q.id),claim=await dueClaim(wait);expect((await executor(p).execute(q.id,claim.claimToken!)).status).toBe("COMPLETED");expect(p.calls).toBe(1);const attempts=await generationAccounting(db,a,q.generationId??(await readQueueItem(db,a,q.id)).generationId!);expect(attempts.attempts[1].parentRequestId).toBe(request.id);
});
it("mixed cart and quantity retries preserve independent Generations and command histories",async()=>{
 await correctInput(db,a,unitId,0,[],false);
 const id=await beginListingDraft(db,a,"102"),product=await productData(db,a,id);await activateProduct(db,a,id,product.draft!.id,0,{name:"Second guidance",configuration});
 await ingestOrder(db,a,{...fixtureOrders[1],externalId:"2002",lines:fixtureOrders[1].lines.map((line,i)=>({...line,externalId:String(9960+i),answers:[{label:"Name",value:"Synthetic recipient",kind:"text" as const}]}))});
 const data=await workspaceData(db,a),order=data.orders.find(o=>o.externalId==="2002")!,lines=data.lines.filter(l=>l.orderId===order.id),readings=data.units.filter(u=>lines.some(l=>l.id===u.lineItemId));expect(lines.map(l=>l.quantity).sort()).toEqual([1,2]);expect(readings).toHaveLength(3);
 for(const u of readings)if(u.issues.includes("quantity_context"))await correctInput(db,a,u.id,u.revision,[{label:"Name",value:"Recipient "+u.unitIndex,kind:"text"}],true);
 const bad=new FakeGenerationProvider({failure:new ProviderFailure("RATE_LIMIT",{inputTokens:10,outputTokens:20})});for(let i=0;i<3;i++)await runProductionCycle(scheduler(),executor(bad));
 const waits=(await db.select().from(schema.productionQueue)).filter(q=>q.state==="RETRY_WAIT");expect(waits).toHaveLength(3);expect(new Set(waits.map(q=>q.retryCommandKey)).size).toBe(3);
 const now=new Date(Math.max(...waits.map(q=>q.availableAt!.getTime()))),due=ProductionScheduler.forInternalWorker(db,{clock:()=>now}),good=new FakeGenerationProvider();for(let i=0;i<3;i++)await runProductionCycle(due,executor(good));
 expect(good.calls).toBe(3);expect(bad.calls).toBe(3);const gens=await db.select().from(schema.generations);expect(gens).toHaveLength(3);for(const g of gens){expect(g.productVersionId).toBe(readings.find(u=>u.id===g.unitId)!.productVersionId);expect((await generationAccounting(db,a,g.id)).attempts.map(a=>a.attemptNumber)).toEqual([1,2]);}
});
async function readyOtherStore(){
 for(const listing of fixtureListings)await ingestListing(db,b,listing);await db.insert(schema.listingSelections).values({organizationId:b.organizationId,storeId:b.storeId,listingExternalId:"101",selectedBy:b.userId});
 const id=await beginListingDraft(db,b,"101"),product=await productData(db,b,id);await activateProduct(db,b,id,product.draft!.id,0,{name:"Other guidance",configuration});await saveSellerProfile(db,b,{displayName:"Other writer",shortBio:""});const d=await editStyle(db,b);await applyStyle(db,b,d.id,0,style);
 await ingestOrder(db,b,{...fixtureOrders[0],externalId:"9990",lines:[{...fixtureOrders[0].lines[0],externalId:"9991",listingId:"101",quantity:1,answers:[{label:"Name",value:"Other recipient",kind:"text"}]}]});
}
it("bounded tick and recovery preserve both Stores without impersonation",async()=>{
 await readyOtherStore();const {defaultSchedulingConfiguration}=await import("../src/modules/production/scheduling"),bad=new FakeGenerationProvider({failure:new ProviderFailure("RATE_LIMIT",{inputTokens:10,outputTokens:20})}),s=ProductionScheduler.forInternalWorker(db,{configuration:{...defaultSchedulingConfiguration,claimBatchSize:1}});
 const t=()=>ProductionTick.forInternalWorker(db,recovery(undefined,1),s,executor(bad));expect((await t().runProductionTick()).claimed).toBe(1);expect((await t().runProductionTick()).claimed).toBe(1);expect(bad.calls).toBe(2);const queue=await db.select().from(schema.productionQueue);expect(queue.every(q=>q.state==="RETRY_WAIT")).toBe(true);
 const rec=await recovery(()=>new Date(Math.max(...queue.map(q=>q.availableAt!.getTime()))),1).reconcileProductionWork();expect(rec.inspected).toBe(1);for(const q of queue){const g=await db.select().from(schema.generations).where(eq(schema.generations.id,q.generationId!));expect(g[0].storeId).toBe(q.storeId);}await expect(requestProductionRetry(db,a,(await workspaceData(db,b)).units[0].id)).rejects.toThrow();
});
it("stale attempt acknowledgement cannot mutate a newer retry claim or command",async()=>{
 const {q}=await failed(),initialToken=q.claimToken!,claim=await dueClaim(q),p=new FakeGenerationProvider();expect((await executor(p).execute(q.id,initialToken)).status).toBe("STALE_CLAIM");expect((await executor(p).acknowledge(q.id,initialToken)).status).toBe("STALE_CLAIM");expect(await readQueueItem(db,a,q.id)).toEqual(claim);expect(p.calls).toBe(0);expect((await executor(p).execute(q.id,claim.claimToken!)).status).toBe("COMPLETED");
});
it("concurrent reconciliation is idempotent and does not reset existing retry timer",async()=>{
 const p=new FakeGenerationProvider({failure:new ProviderFailure("RATE_LIMIT",{inputTokens:10,outputTokens:20})}),q=await claimed();await crashAfterEngine(service(p),q);const now=new Date(q.claimExpiresAt!.getTime()+1);
 await Promise.all([recovery(()=>now).reconcileProductionWork(),recovery(()=>now).reconcileProductionWork()]);const wait=await readQueueItem(db,a,q.id);expect(wait.state).toBe("RETRY_WAIT");const before=wait.availableAt;await recovery(()=>new Date(now.getTime()+10000)).reconcileProductionWork();expect((await readQueueItem(db,a,q.id)).availableAt).toEqual(before);expect(p.calls).toBe(1);expect((await db.select().from(schema.auditLogs)).filter(a=>a.action==="reading_preparation_retry_scheduled")).toHaveLength(1);
});
it("Part 4 migration preserves populated Part 3 queue, Generation and accounting",async()=>{
 const claim=await claimed();await executor().execute(claim.id,claim.claimToken!);
 const acceptance=new PGlite();try{
  for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")&&f<"0009").sort())await acceptance.exec(readFileSync("drizzle/"+file,"utf8"));
  // Isolated historical snapshot fixture, produced by the actual engine above.
  // Disable transition triggers ONLY during snapshot restoration (not migration/application).
  // This avoids pretending published/terminal rows were newly created commands.
  await acceptance.exec("BEGIN; SET LOCAL session_replication_role=replica");
  for(const table of ["app_users","organizations","memberships","stores","listings","listing_selections","products","product_versions","listing_mappings","seller_profiles","style_profiles","style_profile_versions","orders","order_line_items","fulfillment_units","customer_inputs","generations","ai_requests","usage_events","production_queue"]){
   const rows=(await pg.query<Record<string,unknown>>(`SELECT * FROM ${table}`)).rows;
   for(const row of rows){const filtered=Object.fromEntries(Object.entries(row).filter(([key])=>!(table==="production_queue"&&["execution_attempt","retry_command_key","available_at"].includes(key))));const keys=Object.keys(filtered);await acceptance.query(`INSERT INTO ${table} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>filtered[k]));}
  }
  await acceptance.exec("SET LOCAL session_replication_role=origin; COMMIT");
  const history:Record<string,unknown>={};for(const table of ["generations","ai_requests","usage_events","products","product_versions","style_profile_versions"] )history[table]=(await acceptance.query(`SELECT * FROM ${table}`)).rows;
  const before=(await acceptance.query<Record<string,unknown>>("SELECT * FROM production_queue")).rows;
  await acceptance.exec(readFileSync("drizzle/0009_funny_shooting_star.sql","utf8"));const after=(await acceptance.query<Record<string,unknown>>("SELECT * FROM production_queue")).rows;
  expect(before[0].state).toBe("COMPLETED");expect(after).toHaveLength(before.length);expect(after[0]).toMatchObject(before[0]);expect(after[0]).toMatchObject({execution_attempt:1,retry_command_key:null,available_at:null});expect((await acceptance.query("SELECT * FROM production_tick")).rows).toHaveLength(0);
  for(const table of Object.keys(history))expect((await acceptance.query(`SELECT * FROM ${table}`)).rows).toEqual(history[table]);
 }finally{await acceptance.close();}
});
