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
it("claimed production executes existing GenerationService/gateway, persists canonical/accounting and settles Ready for review",async()=>{
 const network=vi.spyOn(globalThis,"fetch"),p=new FakeGenerationProvider(),q=await claimed();
 const g=service(p),engine=vi.spyOn(g,"prepareProduction"),worker=ProductionExecutor.forInternalWorker(db,g);
 const out=await worker.execute(q.id,q.claimToken!);expect(out.status).toBe("COMPLETED");expect(engine).toHaveBeenCalledOnce();expect(p.calls).toBe(1);
 const row=await readQueueItem(db,a,q.id);expect(row).toMatchObject({state:"COMPLETED",generationCommandKey:q.id,generationId:out.generationId,claimExpiresAt:null});
 const gen=await readGeneration(db,a,out.generationId!);expect(gen).toMatchObject({status:"SUCCEEDED",productVersionId:versionId,styleVersionId:styleId,customerRevision:0});expect(gen.result?.sections).toHaveLength(2);
 const cost=await generationAccounting(db,a,gen.id);expect(cost.attempts).toHaveLength(1);expect(cost.attempts[0]).toMatchObject({commandKey:q.id,provider:"fake",inputTokens:100,status:"SUCCEEDED"});expect((await requestAccounting(db,a,cost.attempts[0].id)).usage).toBeDefined();
 const u=(await workspaceData(db,a)).units.find(u=>u.id===unitId)!;expect(readingStatus(u.issues,u.productionStatus)).toBe("Ready for review");expect(network).not.toHaveBeenCalled();
 await expect(readGeneration(db,b,gen.id)).rejects.toThrow();await expect(requestAccounting(db,b,cost.attempts[0].id)).rejects.toThrow();
});
it("execution replay and worker restart retain queue command identity and never pay again",async()=>{
 const p=new FakeGenerationProvider(),q=await claimed(),first=await executor(p).execute(q.id,q.claimToken!);
 expect(await executor(p).execute(q.id,q.claimToken!)).toEqual(first);expect(await executor(p).acknowledge(q.id,q.claimToken!)).toEqual(first);
 expect(p.calls).toBe(1);expect(await db.select().from(schema.aiRequests)).toHaveLength(1);
});
it("concurrent execution and replay while provider is active do not duplicate dispatch",async()=>{
 let release!:()=>void;const p=new FakeGenerationProvider({delay:new Promise<void>(r=>release=r)}),q=await claimed(),w=executor(p);
 const running=w.execute(q.id,q.claimToken!);await vi.waitFor(()=>expect(p.calls).toBe(1));
 expect((await executor(p).execute(q.id,q.claimToken!)).status).toBe("IN_PROGRESS");expect((await executor(p).acknowledge(q.id,q.claimToken!)).status).toBe("IN_PROGRESS");
 const u=(await workspaceData(db,a)).units.find(u=>u.id===unitId)!;expect(readingStatus(u.issues,u.productionStatus)).toBe("Preparing");release();expect((await running).status).toBe("COMPLETED");expect(p.calls).toBe(1);
});
it("wrong token cannot execute or acknowledge, including terminal acknowledgement",async()=>{
 const p=new FakeGenerationProvider(),q=await claimed(),wrong=randomUUID();expect((await executor(p).execute(q.id,wrong)).status).toBe("STALE_CLAIM");expect(p.calls).toBe(0);
 await executor(p).execute(q.id,q.claimToken!);expect((await executor(p).acknowledge(q.id,wrong)).status).toBe("STALE_CLAIM");expect((await readQueueItem(db,a,q.id)).state).toBe("COMPLETED");
});
it("expired pre-execution token cannot execute or settle a replacement claim",async()=>{
 const now=new Date(),cfg={claimBatchSize:4,claimDurationMs:1000,inspectionLimit:100,agingThresholdMs:7200000,deadlineWindowMs:900000};
 // Clock fixtures are in the past; no timing sleeps.
 const old=(await ProductionScheduler.forInternalWorker(db,{configuration:cfg,clock:()=>new Date(now.getTime()-10000)}).claimProductionWork()).claimed[0];
 const p=new FakeGenerationProvider();expect((await executor(p).execute(old.id,old.claimToken!)).status).toBe("STALE_CLAIM");
 const replacement=await claimed();expect(replacement.claimToken).not.toBe(old.claimToken);expect((await executor(p).acknowledge(old.id,old.claimToken!)).status).toBe("STALE_CLAIM");expect((await executor(p).execute(replacement.id,replacement.claimToken!)).status).toBe("COMPLETED");expect(p.calls).toBe(1);
});
it.each(["hold","customer"])("final execution fence catches changed %s with zero AI accounting",async reason=>{
 const q=await claimed(),p=new FakeGenerationProvider();if(reason==="hold")await configureMapping(db,a,"101","default",true);else await correctInput(db,a,unitId,0,[],false);
 expect((await executor(p).execute(q.id,q.claimToken!)).status).toBe("SKIPPED");expect(p.calls).toBe(0);expect(await db.select().from(schema.aiRequests)).toHaveLength(0);expect(await db.select().from(schema.generations)).toHaveLength(0);
});
it("manual preparation after claim fences production without a second paid request",async()=>{
 const q=await claimed(),p=new FakeGenerationProvider();await service(p).prepare(a,command());expect((await executor(p).execute(q.id,q.claimToken!)).status).toBe("SKIPPED");expect(p.calls).toBe(1);expect(await db.select().from(schema.aiRequests)).toHaveLength(1);
});
it("manual/worker concurrent race uses shared Store lock and only one paid invocation",async()=>{
 const q=await claimed(),p=new FakeGenerationProvider(),g=service(p);
 const results=await Promise.allSettled([g.prepare(a,command()),ProductionExecutor.forInternalWorker(db,g).execute(q.id,q.claimToken!)]);
 expect(results.some(r=>r.status==="fulfilled")).toBe(true);expect(p.calls).toBe(1);expect(await db.select().from(schema.aiRequests)).toHaveLength(1);
});
it("generation uses current style/customer snapshot and retained product version",async()=>{
 const q=await claimed();await correctInput(db,a,unitId,0,[{label:"Name",value:"Revised synthetic recipient",kind:"text"}],false);
 const d=await editStyle(db,a),newStyle=await applyStyle(db,a,d.id,d.revision,{...style,instructions:"Updated style"});
 const draft=await editProduct(db,a,productId);await activateProduct(db,a,productId,draft,0,{name:"New product",configuration:{...configuration,workflow:"MANUAL"}});
 const out=await executor().execute(q.id,q.claimToken!),gen=await readGeneration(db,a,out.generationId!);expect(gen.productVersionId).toBe(versionId);expect(gen.styleVersionId).toBe(newStyle.id);expect(gen.context.customer).toMatchObject({revision:1,answers:[{value:"Revised synthetic recipient"}]});
});
it.each([false,true])("known/ambiguous paid failure remains terminal without redispatch (ambiguous=%s)",async ambiguous=>{
 const p=new FakeGenerationProvider({failure:new ProviderFailure(ambiguous?"TIMEOUT":"PROVIDER_ERROR",{inputTokens:100,outputTokens:200,totalTokens:300},undefined,ambiguous)}),q=await claimed();
 const out=await executor(p).execute(q.id,q.claimToken!);expect(out.status).toBe("ATTENTION");const row=await readQueueItem(db,a,q.id);expect(row.resolutionCode).toBe(ambiguous?"OUTCOME_UNCERTAIN":"GENERATION_FAILED");
 expect((await generationAccounting(db,a,out.generationId!)).attempts[0]).toMatchObject({status:"FAILED",inputTokens:100,ambiguous});expect(await db.select().from(schema.usageEvents)).toHaveLength(1);
 await executor(p).execute(q.id,q.claimToken!);expect((await scheduler().claimProductionWork()).claimed).toHaveLength(0);expect(p.calls).toBe(1);
});
it("interruption before accounting admission settles blocked without automatic redispatch",async()=>{
 const p=new FakeGenerationProvider(),g=service(p),q=await claimed();vi.spyOn(g,"prepareProduction").mockImplementation(async()=>{throw new Error("interrupted process");});
 expect((await ProductionExecutor.forInternalWorker(db,g).execute(q.id,q.claimToken!)).status).toBe("ATTENTION");expect((await readQueueItem(db,a,q.id)).resolutionCode).toBe("PREPARATION_BLOCKED");expect((await scheduler().claimProductionWork()).claimed).toHaveLength(0);expect(p.calls).toBe(0);
});
it("serialized/browser authority cannot invoke paid worker GenerationService path",async()=>{
 const q=await claimed(),p=new FakeGenerationProvider();await expect(service(p).prepareProduction({organizationId:a.organizationId,storeId:a.storeId,queueId:q.id,claimToken:q.claimToken!,unitId,commandKey:q.id})).rejects.toThrow();expect(p.calls).toBe(0);await expect(readQueueItem(db,b,q.id)).rejects.toThrow();
});
it("terminal history and Generation binding are immutable in PostgreSQL",async()=>{
 const q=await claimed(),out=await executor().execute(q.id,q.claimToken!);await expect(db.update(schema.productionQueue).set({state:"CLAIMED"}).where(eq(schema.productionQueue.id,q.id))).rejects.toThrow();await expect(db.update(schema.productionQueue).set({generationCommandKey:randomUUID()}).where(eq(schema.productionQueue.id,q.id))).rejects.toThrow();expect((await readQueueItem(db,a,q.id)).generationId).toBe(out.generationId);
});
it("bounded cycle executes sequentially and quantity readings remain independent",async()=>{
 await correctInput(db,a,unitId,0,[],false);
 await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9950",lines:[{...fixtureOrders[0].lines[0],externalId:"9951",listingId:"101",quantity:2,answers:[{label:"Name",value:"Synthetic",kind:"text"}]}]});
 const data=await workspaceData(db,a),order=data.orders.find(o=>o.externalId==="9950")!,line=data.lines.find(l=>l.orderId===order.id)!;
 for(const u of data.units.filter(u=>u.lineItemId===line.id))await correctInput(db,a,u.id,0,[{label:"Name",value:"Independent "+u.unitIndex,kind:"text"}],true);
 const p=new FakeGenerationProvider(),w=executor(p);const first=await runProductionCycle(scheduler(),w);expect(first.outcomes).toHaveLength(1);expect(first.outcomes[0].status).toBe("COMPLETED");const second=await runProductionCycle(scheduler(),w);expect(second.outcomes).toHaveLength(1);expect(p.calls).toBe(2);expect(new Set((await db.select().from(schema.generations)).map(g=>g.unitId)).size).toBe(2);
});
it("failure after provider dispatch preserves RUNNING unknown accounting and prevents any redispatch",async()=>{
 const fake=new FakeGenerationProvider();
 const provider:GenerationProvider={name:"fake",generate:async r=>{const response=await fake.generate(r);vi.spyOn(db,"transaction").mockImplementationOnce(async()=>{throw new Error("settlement unavailable");});return response;}};
 const q=await claimed(),out=await executor(provider).execute(q.id,q.claimToken!);expect(out.status).toBe("ATTENTION");
 expect((await readQueueItem(db,a,q.id)).resolutionCode).toBe("OUTCOME_UNCERTAIN");
 const [request]=await db.select().from(schema.aiRequests),[usage]=await db.select().from(schema.usageEvents);
 expect(request).toMatchObject({status:"RUNNING",costState:"unknown",estimatedNanos:null});expect(usage).toMatchObject({costState:"unknown",amountNanos:null});
 await executor(provider).execute(q.id,q.claimToken!);expect(fake.calls).toBe(1);expect((await scheduler().claimProductionWork()).claimed).toHaveLength(0);
});
it("paid failure retains the existing gateway integer cost calculation",async()=>{
 const fake=new FakeGenerationProvider({failure:new ProviderFailure("PROVIDER_ERROR",{inputTokens:100,outputTokens:200,totalTokens:300})}),provider:GenerationProvider={name:"google",generate:r=>fake.generate(r)};
 const q=await claimed(),out=await ProductionExecutor.forInternalWorker(db,service(provider,true)).execute(q.id,q.claimToken!);
 expect(out.status).toBe("ATTENTION");const c=await generationAccounting(db,a,out.generationId!);expect(c.knownNanos).toBe(825000n);expect(c.attempts[0].costState).toBe("estimated");expect((await requestAccounting(db,a,c.attempts[0].id)).usage?.amountNanos).toBe(825000n);
});
it("executing intent is not reclaimed even beyond its original claim deadline",async()=>{
 let release!:()=>void;const fake=new FakeGenerationProvider({delay:new Promise<void>(r=>release=r)}),q=await claimed(),running=executor(fake).execute(q.id,q.claimToken!);
 await vi.waitFor(()=>expect(fake.calls).toBe(1));
 const future=ProductionScheduler.forInternalWorker(db,{clock:()=>new Date(q.claimExpiresAt!.getTime()+1000000)});expect((await future.claimProductionWork()).claimed).toHaveLength(0);
 expect((await executor(fake).execute(q.id,q.claimToken!)).status).toBe("IN_PROGRESS");release();expect((await running).status).toBe("COMPLETED");expect(fake.calls).toBe(1);
});
it("manual preparation wins the gap after execution fence without a second AI request",async()=>{
 const q=await claimed(),p=new FakeGenerationProvider(),g=service(p),original=g.prepareProduction.bind(g);
 vi.spyOn(g,"prepareProduction").mockImplementation(async authority=>{await g.prepare(a,command());return original(authority);});
 const outcome=await ProductionExecutor.forInternalWorker(db,g).execute(q.id,q.claimToken!);expect(outcome.status).toBe("ATTENTION");expect((await readQueueItem(db,a,q.id)).resolutionCode).toBe("PREPARATION_BLOCKED");expect(p.calls).toBe(1);expect(await db.select().from(schema.aiRequests)).toHaveLength(1);
});
it("cycle mixed cart retains three independent reading/version identities",async()=>{
 await correctInput(db,a,unitId,0,[],false);
 const id=await beginListingDraft(db,a,"102"),product=await productData(db,a,id);await activateProduct(db,a,id,product.draft!.id,0,{name:"Career guidance",configuration});
 await ingestOrder(db,a,{...fixtureOrders[1],externalId:"2002",lines:fixtureOrders[1].lines.map((line,i)=>({...line,externalId:String(9960+i),answers:[{label:"Name",value:"Synthetic recipient",kind:"text" as const}]}))});
 const data=await workspaceData(db,a),order=data.orders.find(o=>o.externalId==="2002")!,lines=data.lines.filter(l=>l.orderId===order.id),readings=data.units.filter(u=>lines.some(l=>l.id===u.lineItemId));expect(lines.map(l=>l.quantity).sort()).toEqual([1,2]);expect(readings).toHaveLength(3);
 for(const u of readings)if(u.issues.includes("quantity_context"))await correctInput(db,a,u.id,u.revision,[{label:"Name",value:"Recipient "+u.unitIndex,kind:"text"}],true);
 const p=new FakeGenerationProvider();for(let i=0;i<3;i++){const cycle=await runProductionCycle(scheduler(),executor(p));expect(cycle.outcomes).toHaveLength(1);expect(cycle.outcomes[0].status).toBe("COMPLETED");}
 expect(p.calls).toBe(3);const generated=await db.select().from(schema.generations);expect(new Set(generated.map(g=>g.unitId)).size).toBe(3);for(const g of generated)expect(g.productVersionId).toBe(readings.find(u=>u.id===g.unitId)!.productVersionId);
});
it("Manual product remains outside queue and still prepares through seller authorization",async()=>{
 const d=await editProduct(db,a,productId);await activateProduct(db,a,productId,d,0,{name:"Manual guidance",configuration:{...configuration,workflow:"MANUAL"}});
 await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9970",lines:[{...fixtureOrders[0].lines[0],externalId:"9971",listingId:"101",quantity:1,answers:[{label:"Name",value:"Synthetic",kind:"text"}]}]});
 const data=await workspaceData(db,a),order=data.orders.find(o=>o.externalId==="9970")!,line=data.lines.find(l=>l.orderId===order.id)!,u=data.units.find(u=>u.lineItemId===line.id)!;
 expect((await db.select().from(schema.productionQueue)).some(q=>q.unitId===u.id)).toBe(false);expect((await service().prepare(a,command(u.id))).status).toBe("SUCCEEDED");
});
it("Part 3 additive migration preserves waiting and active claims without fabricating execution",async()=>{
 const acceptance=new PGlite(),isolated=drizzle(acceptance,{schema}) as unknown as Database;
 try{
  for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")&&f<"0008").sort())await acceptance.exec(readFileSync("drizzle/"+file,"utf8"));
  await isolated.insert(schema.users).values({id:"legacy-part2",name:"Retained seller"});const scope=await authorizeStore(isolated,"legacy-part2",await createWorkspace(isolated,"legacy-part2","Retained","fixtures"));
  for(const listing of fixtureListings)await ingestListing(isolated,scope,listing);
  await isolated.insert(schema.listingSelections).values({organizationId:scope.organizationId,storeId:scope.storeId,listingExternalId:"101",selectedBy:scope.userId});
  const id=await beginListingDraft(isolated,scope,"101"),product=await productData(isolated,scope,id);await activateProduct(isolated,scope,id,product.draft!.id,0,{name:"Retained",configuration});
  // Construct the historical intake boundary without selecting Part 3 columns.
  const production=await import("../src/modules/production/service");const admit=vi.spyOn(production,"admitReadingInTransaction").mockResolvedValue({outcome:"ineligible"});
  await ingestOrder(isolated,scope,{...fixtureOrders[0],externalId:"9980",lines:[{...fixtureOrders[0].lines[0],externalId:"9981",listingId:"101",quantity:2}]});admit.mockRestore();
  await acceptance.exec("INSERT INTO production_queue (organization_id,store_id,unit_id,product_version_id,priority_class) SELECT organization_id,store_id,id,product_version_id,'STANDARD' FROM fulfillment_units");
  await acceptance.exec("UPDATE production_queue SET state='CLAIMED',claim_token=gen_random_uuid(),claimed_at=clock_timestamp(),claim_expires_at=clock_timestamp()+interval '2 minutes',scheduling_ordinal=1 WHERE id=(SELECT id FROM production_queue ORDER BY id LIMIT 1)");
  const before=(await acceptance.query<Record<string,unknown>>("SELECT * FROM production_queue ORDER BY id")).rows,versions=await isolated.select().from(schema.productVersions),units=await isolated.select().from(schema.units);
  await acceptance.exec(readFileSync("drizzle/0008_thankful_marvex.sql","utf8"));const after=(await acceptance.query<Record<string,unknown>>("SELECT * FROM production_queue ORDER BY id")).rows;
  expect(after).toHaveLength(2);for(let i=0;i<2;i++){expect(after[i]).toMatchObject(before[i]);expect(after[i]).toMatchObject({generation_command_key:null,generation_id:null,execution_started_at:null});}
  expect(await isolated.select().from(schema.productVersions)).toEqual(versions);expect(await isolated.select().from(schema.units)).toEqual(units);expect(await isolated.select().from(schema.generations)).toHaveLength(0);
 }finally{await acceptance.close();}
});
it("one cycle obeys configured batch and uses sequential execution across Stores",async()=>{
 for(const listing of fixtureListings)await ingestListing(db,b,listing);
 await db.insert(schema.listingSelections).values({organizationId:b.organizationId,storeId:b.storeId,listingExternalId:"101",selectedBy:b.userId});
 const id=await beginListingDraft(db,b,"101"),product=await productData(db,b,id);await activateProduct(db,b,id,product.draft!.id,0,{name:"Other guidance",configuration});
 await saveSellerProfile(db,b,{displayName:"Other writer",shortBio:""});const d=await editStyle(db,b);await applyStyle(db,b,d.id,0,style);
 await ingestOrder(db,b,{...fixtureOrders[0],externalId:"9990",lines:[{...fixtureOrders[0].lines[0],externalId:"9991",listingId:"101",quantity:1,answers:[{label:"Name",value:"Other recipient",kind:"text"}]}]});
 const {defaultSchedulingConfiguration}=await import("../src/modules/production/scheduling");
 let active=0,max=0;const fake=new FakeGenerationProvider(),provider:GenerationProvider={name:"fake",generate:async r=>{active++;max=Math.max(max,active);try{return await fake.generate(r);}finally{active--;}}};
 const bounded=ProductionScheduler.forInternalWorker(db,{configuration:{...defaultSchedulingConfiguration,claimBatchSize:1}});
 expect((await runProductionCycle(bounded,executor(provider))).outcomes).toHaveLength(1);expect(fake.calls).toBe(1);
 expect((await runProductionCycle(bounded,executor(provider))).outcomes).toHaveLength(1);expect(fake.calls).toBe(2);expect(max).toBe(1);
 const generations=await db.select().from(schema.generations);expect(new Set(generations.map(g=>g.storeId))).toEqual(new Set([a.storeId,b.storeId]));
 for(const q of await db.select().from(schema.productionQueue))expect(generations.find(g=>g.id===q.generationId)?.storeId).toBe(q.storeId);
});
it("settlement interruption after successful canonical persistence is acknowledged without redispatch",async()=>{
 const p=new FakeGenerationProvider(),g=service(p),original=g.prepareProduction.bind(g),q=await claimed();
 vi.spyOn(g,"prepareProduction").mockImplementation(async authority=>{await original(authority);throw new Error("return path interrupted");});
 const out=await ProductionExecutor.forInternalWorker(db,g).execute(q.id,q.claimToken!);expect(out.status).toBe("COMPLETED");expect((await executor(p).acknowledge(q.id,q.claimToken!)).status).toBe("COMPLETED");expect(p.calls).toBe(1);
});
it.each(["seller","style"])("missing %s after claim prevents paid dispatch",async missing=>{
 const q=await claimed(),p=new FakeGenerationProvider();if(missing==="seller")await db.delete(schema.sellerProfiles).where(eq(schema.sellerProfiles.storeId,a.storeId));else await db.transaction(async tx=>{await tx.update(schema.styleVersions).set({status:"ARCHIVED"}).where(eq(schema.styleVersions.id,styleId));await tx.update(schema.styleProfiles).set({activeVersionId:null}).where(eq(schema.styleProfiles.storeId,a.storeId));});expect((await executor(p).execute(q.id,q.claimToken!)).status).toBe("SKIPPED");expect(p.calls).toBe(0);expect(await db.select().from(schema.aiRequests)).toHaveLength(0);
});
