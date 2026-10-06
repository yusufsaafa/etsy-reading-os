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
it("eligible context contains exact product, active style, bounded seller identity and customer revision",async()=>{
 const c=await context();expect(c.product.id).toBe(versionId);expect(c.style.id).toBe(styleId);expect(c.seller).toMatchObject({displayName:"Sarah",shortBio:"Synthetic writer"});expect(c.customer).toMatchObject({revision:0,answers:[{label:"Name",value:"Synthetic recipient"}]});expect(c).not.toHaveProperty("sources");expect(c).not.toHaveProperty("buyerEmail");
});
it("missing required customer input fails closed without a request/accounting or provider call",async()=>{
 await correctInput(db,a,unitId,0,[],false);const provider=new FakeGenerationProvider();
 await expect(service(provider).prepare(a,command())).rejects.toThrow("CUSTOMER_INFORMATION");expect(provider.calls).toBe(0);expect(await db.select().from(schema.aiRequests)).toHaveLength(0);
});
it("missing seller profile prevents a provider call",async()=>{
 await db.delete(schema.sellerProfiles).where(eq(schema.sellerProfiles.storeId,a.storeId));const p=new FakeGenerationProvider();await expect(service(p).prepare(a,command())).rejects.toThrow("SELLER_SETUP");expect(p.calls).toBe(0);
});
it("no usable active style prevents a provider call",async()=>{
 await db.transaction(async tx=>{await tx.update(schema.styleVersions).set({status:"ARCHIVED"}).where(eq(schema.styleVersions.id,styleId));await tx.update(schema.styleProfiles).set({activeVersionId:null}).where(eq(schema.styleProfiles.storeId,a.storeId));});
 const p=new FakeGenerationProvider();await expect(service(p).prepare(a,command())).rejects.toThrow("STYLE_SETUP");expect(p.calls).toBe(0);
});
it("legacy/unconfigured readings cannot bypass product admission",async()=>{
 await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9910",lines:[{...fixtureOrders[0].lines[0],externalId:"9911",listingId:"102",quantity:1}]});const units=(await workspaceData(db,a)).units;const legacy=units.find(u=>u.id!==unitId)!;
 const p=new FakeGenerationProvider();await expect(service(p).prepare(a,command(legacy.id))).rejects.toThrow("PRODUCT_SETUP");expect(p.calls).toBe(0);
});
it("tampered invalid product configuration is rejected before a provider call",async()=>{
 await pg.exec("ALTER TABLE product_versions DISABLE TRIGGER immutable_published_version");
 await db.update(schema.productVersions).set({configuration:{...configuration,sections:[]}}).where(eq(schema.productVersions.id,versionId));
 const p=new FakeGenerationProvider();await expect(service(p).prepare(a,command())).rejects.toThrow("PRODUCT_SETUP");expect(p.calls).toBe(0);
});
it("success persists canonical content, usage, exact model/provider and zero-cost fake accounting",async()=>{
 const {result,provider}=await prepare();expect(result.status).toBe("SUCCEEDED");expect(provider.calls).toBe(1);
 expect(result.result?.sections.map(s=>s.sectionId)).toEqual(["intro","guidance"]);expect((await readGeneration(db,a,result.id)).result).toEqual(result.result);
 const cost=await generationAccounting(db,a,result.id);expect(cost.attempts).toHaveLength(1);expect(cost.attempts[0]).toMatchObject({provider:"fake",model:"deterministic-v1",resolvedModel:"deterministic-v1",inputTokens:100,outputTokens:200,totalTokens:300,status:"SUCCEEDED",costState:"known_zero",estimatedNanos:0n});
 expect((await requestAccounting(db,a,cost.attempts[0].id)).usage).toMatchObject({amountNanos:0n,currency:"USD",costState:"known_zero"});
 expect(cost.attempts[0].durationMs).toBeGreaterThanOrEqual(0);
});
it.each([
 ["unknown",[{sectionId:"extra",title:"Extra",content:"x"},{sectionId:"guidance",title:"Guidance",content:"x"}]],
 ["missing",[{sectionId:"intro",title:"Introduction",content:"x"}]],
 ["duplicate",[{sectionId:"intro",title:"Introduction",content:"x"},{sectionId:"intro",title:"Introduction",content:"x"}]],
 ["empty",[{sectionId:"intro",title:"Introduction",content:" "},{sectionId:"guidance",title:"Guidance",content:"x"}]],
 ["wrong title",[{sectionId:"intro",title:"Wrong",content:"x"},{sectionId:"guidance",title:"Guidance",content:"x"}]],
])("rejects %s sections without successful content while retaining attempt accounting",async(_,sections)=>{
 const {result}=await prepare(new FakeGenerationProvider({output:JSON.stringify({sections})}));expect(result.status).toBe("FAILED");expect(result.result).toBeNull();const c=await generationAccounting(db,a,result.id);expect(c.attempts[0]).toMatchObject({status:"FAILED",failureCode:"INVALID_OUTPUT",inputTokens:100});
});
it.each(["invalid JSON","{}",'{"sections":"bad"}'])("malformed output %s fails safely",async output=>{
 const {result}=await prepare(new FakeGenerationProvider({output}));expect(result.status).toBe("FAILED");expect(result.result).toBeNull();
});
it("a failed paid request retains known usage, integer nanos and failed history",async()=>{
 const fake=new FakeGenerationProvider({failure:new ProviderFailure("PROVIDER_ERROR",{inputTokens:100,outputTokens:200,totalTokens:300})});
 const p:GenerationProvider={name:"google",generate:r=>fake.generate(r)};
 const result=await service(p,true).prepare(a,command());const c=await generationAccounting(db,a,result.id);
 expect(result.status).toBe("FAILED");expect(c.knownNanos).toBe(825000n);expect(c.hasUnknown).toBe(false);expect(c.attempts[0].costState).toBe("estimated");
 expect((await requestAccounting(db,a,c.attempts[0].id)).usage?.amountNanos).toBe(825000n);
});
it("unknown usage/cost is null and ambiguous timeout cannot be retried",async()=>{
 const p=new FakeGenerationProvider({failure:new ProviderFailure("TIMEOUT",{},undefined,true)});
 const result=await service(p).prepare(a,command());const c=await generationAccounting(db,a,result.id);
 expect(c.hasUnknown).toBe(true);expect(c.attempts[0]).toMatchObject({estimatedNanos:null,inputTokens:null,ambiguous:true});
 expect((await requestAccounting(db,a,c.attempts[0].id)).usage?.amountNanos).toBeNull();
 await expect(service(p).prepare(a,{...command(),retryGenerationId:result.id})).rejects.toThrow("RETRY_UNCERTAIN");expect(p.calls).toBe(1);
});
it("explicit retry retains the original context and separate paid attempts, parent linkage and total cost",async()=>{
 const bad=new FakeGenerationProvider({output:"bad",usage:{inputTokens:100,outputTokens:200}});
 const failed=await service({name:"google",generate:r=>bad.generate(r)},true).prepare(a,command());
 const good=new FakeGenerationProvider({usage:{inputTokens:200,outputTokens:300}});
 const retried=await service({name:"google",generate:r=>good.generate(r)},true).prepare(a,{...command(),retryGenerationId:failed.id});
 expect(retried.id).toBe(failed.id);expect(retried.context).toEqual(failed.context);const cost=await generationAccounting(db,a,failed.id);
 expect(cost.attempts.map(a=>a.status)).toEqual(["FAILED","SUCCEEDED"]);expect(cost.attempts[1].parentRequestId).toBe(cost.attempts[0].id);expect(cost.knownNanos).toBe(2100000n);
});
it("same command replay never invokes twice; conflicting command payload is rejected",async()=>{
 const p=new FakeGenerationProvider(),s=service(p),c=command(),first=await s.prepare(a,c),second=await s.prepare(a,c);
 expect(second.id).toBe(first.id);expect(p.calls).toBe(1);await expect(s.prepare(a,{...c,retryGenerationId:first.id})).rejects.toThrow("COMMAND_CONFLICT");
 await expect(s.prepare(a,command())).rejects.toThrow("COMMAND_CONFLICT");expect(p.calls).toBe(1);
});
it("concurrent identical commands converge before delayed provider completion",async()=>{
 let release!:()=>void;const delay=new Promise<void>(r=>{release=r;});const p=new FakeGenerationProvider({delay}),s=service(p),c=command();
 const first=s.prepare(a,c);
 // Wait for durable dispatch without a paid/internet call.
 for(let i=0;i<100&&p.calls===0;i++)await new Promise(r=>setTimeout(r,2));
 expect(p.calls).toBe(1);const duplicate=await s.prepare(a,c);expect(duplicate.status).toBe("PROCESSING");expect(p.calls).toBe(1);
 await expect(s.prepare(a,command())).rejects.toThrow("ACTIVE_OPERATION");release();expect((await first).status).toBe("SUCCEEDED");expect(p.calls).toBe(1);
});
it("cross-tenant request, generation, usage, history and forged scopes fail",async()=>{
 const p=new FakeGenerationProvider();await expect(service(p).prepare(b,command())).rejects.toThrow();await expect(service(p).prepare({...a,userId:b.userId},command())).rejects.toThrow();expect(p.calls).toBe(0);
 const {result}=await prepare();await expect(readGeneration(db,b,result.id)).rejects.toThrow();await expect(generationHistory(db,b,unitId)).rejects.toThrow();
 const {attempts}=await generationAccounting(db,a,result.id);await expect(requestAccounting(db,b,attempts[0].id)).rejects.toThrow();await expect(generationAccounting(db,b,result.id)).rejects.toThrow();
});
it("product/style publication and mutable identity edits cannot rewrite generation snapshots",async()=>{
 const {result}=await prepare(),draft=await editStyle(db,a);await applyStyle(db,a,draft.id,draft.revision,{...style,tone:"DIRECT"});
 const draftId=await editProduct(db,a,productId);await activateProduct(db,a,productId,draftId,0,{name:"New product",configuration:{...configuration,sections:[{id:"new",title:"New section",instruction:"",sortOrder:0}]}});
 await saveSellerProfile(db,a,{displayName:"New identity",shortBio:"Different"});
 const old=await readGeneration(db,a,result.id);expect(old.styleVersionId).toBe(styleId);expect(old.productVersionId).toBe(versionId);expect(old.context.seller.displayName).toBe("Sarah");expect(old.context.product.configuration.sections).toEqual(configuration.sections);
 await expect(db.update(schema.generations).set({context:{...old.context,seller:{...old.context.seller,displayName:"Tampered"}}}).where(eq(schema.generations.id,old.id))).rejects.toThrow();
});
it("context uses old bound product even after new activation before initial generation",async()=>{
 const draftId=await editProduct(db,a,productId);await activateProduct(db,a,productId,draftId,0,{name:"Changed",configuration:{...configuration,sections:[{id:"new",title:"New",instruction:"",sortOrder:0}]}});
 const c=await context();expect(c.product.id).toBe(versionId);expect(c.product.configuration.sections).toEqual(configuration.sections);
});
it("customer corrections retain generated content and historical snapshot; changed revision blocks retry",async()=>{
 const {result}=await prepare(new FakeGenerationProvider({output:"bad"}));await correctInput(db,a,unitId,0,[{label:"Name",value:"New recipient",kind:"text"}],false);
 await expect(service().prepare(a,{...command(),retryGenerationId:result.id})).rejects.toThrow("CONTEXT_CHANGED");expect((await readGeneration(db,a,result.id)).context.customer.answers[0].value).toBe("Synthetic recipient");
});
it("quantity and mixed carts remain independently admitted readings",async()=>{
 const careerId=await beginListingDraft(db,a,"102","default"),career=await productData(db,a,careerId);await activateProduct(db,a,careerId,career.draft!.id,0,{name:"Career",configuration});
 const order={...fixtureOrders[1],externalId:"2002",lines:fixtureOrders[1].lines.map((l,i)=>({...l,externalId:String(9980+i),answers:[{label:"Name",value:"Recipient "+i,kind:"text" as const}]}))};
 await ingestOrder(db,a,order);const data=await workspaceData(db,a),id=data.orders.find(o=>o.externalId==="2002")!.id,lines=data.lines.filter(l=>l.orderId===id),readings=data.units.filter(u=>lines.some(l=>l.id===u.lineItemId));
 expect(lines.find(l=>l.listingExternalId==="101")?.quantity).toBe(2);expect(lines.find(l=>l.listingExternalId==="102")?.quantity).toBe(1);expect(readings).toHaveLength(3);
 const provider=new FakeGenerationProvider(),s=service(provider);
 for(const u of readings){if(u.issues.includes("quantity_context"))await correctInput(db,a,u.id,0,[{label:"Name",value:"Recipient "+u.unitIndex,kind:"text"}],true);await s.prepare(a,command(u.id));}
 expect(provider.calls).toBe(3);expect((await db.select().from(schema.generations)).map(g=>g.unitId).sort()).toEqual(readings.map(r=>r.id).sort());
});
it("central admission enforces budget before invocation",async()=>{
 const p=new FakeGenerationProvider(),paid:GenerationProvider={name:"google",generate:r=>p.generate(r)};
 await expect(service(paid,true,1n).prepare(a,command())).rejects.toThrow("BUDGET_LIMIT");expect(p.calls).toBe(0);expect(await db.select().from(schema.generations)).toHaveLength(0);
});
it("no provider call occurs when the accounting insert fails",async()=>{
 await pg.exec("CREATE FUNCTION fail_usage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_USAGE_FAILURE'; END $$; CREATE TRIGGER reject_usage BEFORE INSERT ON usage_events FOR EACH ROW EXECUTE FUNCTION fail_usage();");
 const p=new FakeGenerationProvider();await expect(service(p).prepare(a,command())).rejects.toThrow();expect(p.calls).toBe(0);expect(await db.select().from(schema.aiRequests)).toHaveLength(0);
});
it("database requires accounting and preserves final attempt/usage history",async()=>{
 const {result}=await prepare(),{attempts}=await generationAccounting(db,a,result.id);
 await expect(db.update(schema.aiRequests).set({estimatedNanos:9n}).where(eq(schema.aiRequests.id,attempts[0].id))).rejects.toThrow();await expect(db.delete(schema.usageEvents).where(eq(schema.usageEvents.aiRequestId,attempts[0].id))).rejects.toThrow();
 await expect(db.insert(schema.aiRequests).values({organizationId:a.organizationId,storeId:a.storeId,attemptNumber:1,commandKey:randomUUID(),commandHash:"x",provider:"fake",model:"deterministic-v1",operation:"TEST",pricing:pricingFor("fake","deterministic-v1"),reservedNanos:0n})).rejects.toThrow();
});
it("lifecycle audit and accounting metadata contain no customer text, instructions or content",async()=>{
 const spy=vi.spyOn(globalThis,"fetch");const {result}=await prepare();
 const {request}=await requestAccounting(db,a,(await generationAccounting(db,a,result.id)).attempts[0].id);
 const audits=await db.select().from(schema.auditLogs).where(tenantWhere(schema.auditLogs,a));const metadata=JSON.stringify({request:{...request,reservedNanos:String(request.reservedNanos),estimatedNanos:String(request.estimatedNanos)},audits});
 expect(metadata).not.toContain("Synthetic recipient");expect(metadata).not.toContain(style.instructions);expect(metadata).not.toContain("Prepared example content");
 expect(audits.map(x=>x.action)).toEqual(expect.arrayContaining(["generation_requested","generation_succeeded"]));expect(spy).not.toHaveBeenCalled();
});

it("simultaneously submitted identical commands create one durable dispatch",async()=>{
 let release!:()=>void;const delay=new Promise<void>(resolve=>{release=resolve;}),p=new FakeGenerationProvider({delay}),s=service(p),c=command();
 const first=s.prepare(a,c),second=s.prepare(a,c);
 await vi.waitFor(()=>expect(p.calls).toBe(1),{timeout:3000,interval:5});release();
 const results=await Promise.all([first,second]);expect(results[0].id).toBe(results[1].id);expect(p.calls).toBe(1);
 expect((await generationAccounting(db,a,results[0].id)).attempts).toHaveLength(1);
});
it("late customer correction keeps earlier canonical work but cannot project it as ready for review",async()=>{
 let release!:()=>void;const delay=new Promise<void>(resolve=>{release=resolve;}),p=new FakeGenerationProvider({delay});
 const running=service(p).prepare(a,command());await vi.waitFor(()=>expect(p.calls).toBe(1),{timeout:3000,interval:5});
 await correctInput(db,a,unitId,0,[{label:"Name",value:"Changed recipient",kind:"text"}],false);release();
 const result=await running;expect(result.status).toBe("SUCCEEDED");expect(result.customerRevision).toBe(0);
 expect((await workspaceData(db,a)).units.find(u=>u.id===unitId)?.productionStatus).toBe("STALE");
});
it("a changed admission between claim and dispatch settles known zero without contacting provider",async()=>{
 const p=new FakeGenerationProvider(),gateway=new CentralAIGateway(db,{provider:p,model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:0n,attemptBudgetNanos:0n});
 const original=gateway.execute.bind(gateway);
 vi.spyOn(gateway,"execute").mockImplementation(async(...args)=>{await correctInput(db,a,unitId,0,[],false);return original(...args);});
 const result=await new GenerationService(db,gateway).prepare(a,command());expect(result.status).toBe("FAILED");expect(p.calls).toBe(0);
 expect((await generationAccounting(db,a,result.id)).attempts[0]).toMatchObject({costState:"known_zero",estimatedNanos:0n,failureCode:"ADMISSION_CHANGED"});
});
it("settlement failure leaves durable unknown accounting and replay never redispatches",async()=>{
 await pg.exec("CREATE FUNCTION fail_generation_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='SUCCEEDED' THEN RAISE EXCEPTION 'TEST_SETTLEMENT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_generation_completion BEFORE UPDATE ON generations FOR EACH ROW EXECUTE FUNCTION fail_generation_completion();");
 const p=new FakeGenerationProvider(),s=service(p),c=command();
 await expect(s.prepare(a,c)).rejects.toThrow();expect(p.calls).toBe(1);
 const replay=await s.prepare(a,c);expect(replay.status).toBe("PROCESSING");const accounting=await generationAccounting(db,a,replay.id);
 expect(accounting.attempts[0].status).toBe("RUNNING");expect(accounting.hasUnknown).toBe(true);expect((await requestAccounting(db,a,accounting.attempts[0].id)).usage?.amountNanos).toBeNull();expect(p.calls).toBe(1);
});
it("database rejects cross-tenant generation links even with a valid foreign key ID",async()=>{
 const {result}=await prepare();
 await expect(db.insert(schema.generations).values({organizationId:b.organizationId,storeId:b.storeId,unitId:result.unitId,productVersionId:result.productVersionId,styleVersionId:result.styleVersionId,sellerProfileId:result.sellerProfileId,customerRevision:0,context:result.context,contextHash:result.contextHash})).rejects.toThrow();
});
it("sources remain unused and publication before admission selects the new active style only for new work",async()=>{
 const {addPreviousWork}=await import("../src/modules/seller-style/service");await addPreviousWork(db,a,{title:"Private reference",text:"REFERENCE_NOT_SENT",commandKey:randomUUID()});
 const draft=await editStyle(db,a);const v2=await applyStyle(db,a,draft.id,draft.revision,{...style,tone:"DIRECT"});
 let sent="";const fake=new FakeGenerationProvider();const provider:GenerationProvider={name:"fake",generate:r=>{sent=r.data;return fake.generate(r);}};
 const result=await service(provider).prepare(a,command());expect(result.styleVersionId).toBe(v2.id);expect(sent).not.toContain("REFERENCE_NOT_SENT");expect(sent).toContain('"tone":"DIRECT"');
});

it("migration runner application/replay and fixture seed/replay preserve existing data without fabricated generations",async()=>{
 const {migrate}=await import("drizzle-orm/pglite/migrator");
 const acceptance=new PGlite(),native=drizzle(acceptance,{schema}),isolated=native as unknown as Database;
 try{
  await migrate(native,{migrationsFolder:"drizzle"});await migrate(native,{migrationsFolder:"drizzle"});
  await isolated.insert(schema.users).values({id:"dev:owner",name:"Development seller"});
  async function seed(){
   const storeId=await createWorkspace(isolated,"dev:owner","Reading Studio · Demo","fixtures"),scope=await authorizeStore(isolated,"dev:owner",storeId,true);
   const {configureMapping}=await import("../src/modules/intake/service");
   for(const listing of fixtureListings)await ingestListing(isolated,scope,listing);
   for(const id of ["101","102"])await configureMapping(isolated,scope,id,"default",false);
   for(const order of [...fixtureOrders,fixtureOrders[1]])await ingestOrder(isolated,scope,order);
   return workspaceData(isolated,scope);
  }
  const first=await seed(),second=await seed();
  expect(first.orders).toHaveLength(6);expect(first.lines).toHaveLength(7);expect(first.units).toHaveLength(10);
  expect(second.units.map(u=>u.id).sort()).toEqual(first.units.map(u=>u.id).sort());expect(await isolated.select().from(schema.generations)).toHaveLength(0);
  expect(second.lines.filter(l=>l.orderId===second.orders.find(o=>o.externalId==="2002")!.id).map(l=>l.quantity).sort()).toEqual([1,2]);
 }finally{await acceptance.close();}
});
it("an additive migration preserves seeded pre-generation product, seller, style and order rows",async()=>{
 const acceptance=new PGlite(),legacy=drizzle(acceptance,{schema}) as unknown as Database;
 try{
  // This fixture intentionally runs the pre-generation application/schema boundary.
  // Suppress only new production admission while constructing its historical rows.
  const production=await import("../src/modules/production/service");
  const admit=vi.spyOn(production,"admitReadingInTransaction").mockResolvedValue({outcome:"ineligible"});
  const reconcile=vi.spyOn(production,"reconcileProductionInTransaction").mockResolvedValue({scanned:0,queued:0});
  const files=readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort();
  for(const file of files.filter(f=>f<"0005"))await acceptance.exec(readFileSync("drizzle/"+file,"utf8"));
  await legacy.insert(schema.users).values({id:"existing",name:"Existing seller"});
  const scope=await authorizeStore(legacy,"existing",await createWorkspace(legacy,"existing","Existing Store","fixtures"));
  for(const listing of fixtureListings)await ingestListing(legacy,scope,listing);
  await legacy.insert(schema.listingSelections).values({organizationId:scope.organizationId,storeId:scope.storeId,listingExternalId:"101",selectedBy:scope.userId});
  const id=await beginListingDraft(legacy,scope,"101"),data=await productData(legacy,scope,id);await activateProduct(legacy,scope,id,data.draft!.id,0,{name:"Existing Product",configuration});
  await saveSellerProfile(legacy,scope,{displayName:"Existing Creator",shortBio:""});
  const draft=await editStyle(legacy,scope);await applyStyle(legacy,scope,draft.id,0,style);
  for(const receipt of fixtureOrders)await ingestOrder(legacy,scope,receipt);
  const before={units:await legacy.select().from(schema.units),products:await legacy.select().from(schema.productVersions),style:await legacy.select().from(schema.styleVersions),seller:await legacy.select().from(schema.sellerProfiles)};
  await acceptance.exec(readFileSync("drizzle/"+files.find(f=>f.startsWith("0005"))!,"utf8"));
  admit.mockRestore();reconcile.mockRestore();
  expect(await legacy.select().from(schema.units)).toEqual(before.units);expect(await legacy.select().from(schema.productVersions)).toEqual(before.products);expect(await legacy.select().from(schema.styleVersions)).toEqual(before.style);expect(await legacy.select().from(schema.sellerProfiles)).toEqual(before.seller);expect(await legacy.select().from(schema.generations)).toHaveLength(0);
 }finally{await acceptance.close();}
});

it("gateway logs allowlisted transport diagnostics while retaining ambiguous unknown accounting",async()=>{
 const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
 const provider=new FakeGenerationProvider({failure:new ProviderFailure("NETWORK",{},undefined,true,undefined,"ENOTFOUND")});
 const result=await service(provider).prepare(a,command());
 expect(result.status).toBe("FAILED");expect(provider.calls).toBe(1);
 expect(warning).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:"ai_transport_failure",category:"NETWORK",transportCause:"ENOTFOUND"}));
 const accounting=await generationAccounting(db,a,result.id);
 expect(accounting.attempts[0]).toMatchObject({failureCode:"NETWORK",ambiguous:true,costState:"unknown",estimatedNanos:null});
 expect((await requestAccounting(db,a,accounting.attempts[0].id)).usage).toMatchObject({costState:"unknown",amountNanos:null});
});

// Part 3 uses real domain completion with synthetic bounded data; no analysis provider call.
async function analysis(scope=a, state="READY", voice="Reflective writing") {
 const {addPreviousWork,editStyle}=await import("../src/modules/seller-style/service");
 const {createStyleAnalysisVersion,completeStyleAnalysisVersion,failStyleAnalysisVersion,markStyleAnalysisAnalyzing}=await import("../src/modules/seller-style/analysis-service");
 let [profile]=await db.select().from(schema.styleProfiles).where(tenantWhere(schema.styleProfiles,scope));
 if(!profile){await editStyle(db,scope);[profile]=await db.select().from(schema.styleProfiles).where(tenantWhere(schema.styleProfiles,scope));}
 const source=await addPreviousWork(db,scope,{title:"Private history",text:"HISTORICAL_ONLY Customer name: Fictional Past Person. old-order-987654",commandKey:randomUUID()});
 const v=await createStyleAnalysisVersion(db,scope,{styleProfileId:profile.id,sourceIds:[source]});
 if(state==="FAILED")return failStyleAnalysisVersion(db,scope,v.id,"PROVIDER_FAILURE");
 if(state==="ANALYZING")return markStyleAnalysisAnalyzing(db,scope,v.id);
 if(state==="PENDING")return v;
 return completeStyleAnalysisVersion(db,scope,v.id,{aiRequestId:null,payload:{contractVersion:"style-intelligence/v1",voiceSummary:voice,tone:[],structure:{opening:[],development:[],transitions:[],closing:[]},diction:[],sentenceAndParagraph:[],personalization:[],uncertainty:[],formatting:[],preferredPatterns:[],avoidedPatterns:[],generationGuidance:["Use detailed explanations"]}});
}
async function anotherUnit() {
 const key="9902";await ingestOrder(db,a,{...fixtureOrders[0],externalId:key,lines:[{...fixtureOrders[0].lines[0],externalId:key,listingId:"101",quantity:1,answers:[{label:"Name",value:"New current recipient",kind:"text"}]}]});
 const data=await workspaceData(db,a),order=data.orders.find(o=>o.externalId===key)!;return data.units.find(u=>data.lines.some(l=>l.orderId===order.id&&l.id===u.lineItemId))!.id;
}
it.each(["FAILED","ANALYZING","PENDING"])("new admission pins latest READY despite newer %s; bounded prompt has no historical evidence",async state=>{
 const one=await analysis(),two=await analysis(a,"READY","New reflective voice");await analysis(a,state);
 let sent!:import("../src/infrastructure/ai/provider").ProviderRequest;const fake=new FakeGenerationProvider();
 const result=await service({name:"fake",generate:r=>{sent=r;return fake.generate(r);}}).prepare(a,command());
 expect(result.context.styleIntelligence).toEqual({analysisVersionId:two.id,versionNumber:two.versionNumber,contractVersion:two.contractVersion,payload:two.payload});
 expect(result.context.styleIntelligence?.analysisVersionId).not.toBe(one.id);
 const envelope=JSON.parse(sent.data);expect(envelope.styleIntelligence).toEqual(two.payload);expect(envelope.styleConfiguration).toEqual(style);
 for(const forbidden of ["HISTORICAL_ONLY","Fictional Past Person","old-order-987654","inputManifest","sourceIds",two.id])expect(sent.data).not.toContain(forbidden);
 expect(sent.system).toContain("explicit seller styleConfiguration");expect(sent.system).not.toContain(two.payload!.voiceSummary);
 expect(result.result?.sections.map(s=>s.sectionId)).toEqual(["intro","guidance"]);
 expect(fake.calls).toBe(1);expect(await db.select().from(schema.aiRequests)).toHaveLength(1);expect(await db.select().from(schema.usageEvents)).toHaveLength(1);
});
it.each(["FAILED","PENDING","ANALYZING"])("only %s analysis uses byte-identical legacy manual context/prompt",async state=>{
 const before=await context();await analysis(a,state);const result=await service().prepare(a,command());
 expect(result.context).toEqual(before);expect(result.context).not.toHaveProperty("styleIntelligence");
 const {assembleInstructions,PLATFORM_RULES}=await import("../src/modules/generation/instructions");expect(assembleInstructions(result.context).system).toBe(PLATFORM_RULES);
});
it.each([false,true])("later READY cannot enrich or replace pinned context on retry/replay (initial pin=%s)",async initial=>{
 if(initial)await analysis();const failed=await service(new FakeGenerationProvider({output:"bad"})).prepare(a,command());
 const newer=await analysis(a,"READY","Later voice");const p=new FakeGenerationProvider(),s=service(p),c={...command(),retryGenerationId:failed.id};
 const retry=await s.prepare(a,c),replay=await s.prepare(a,c);expect(retry.context).toEqual(failed.context);expect(retry.contextHash).toBe(failed.contextHash);expect(replay.context).toEqual(failed.context);expect(p.calls).toBe(1);
 const next=await s.prepare(a,command(await anotherUnit()));expect(next.context.styleIntelligence?.analysisVersionId).toBe(newer.id);expect(next.contextHash).not.toBe(failed.contextHash);
});
it("admission selects no foreign tenant or same-organization Store intelligence; forged style version denied",async()=>{
 await analysis(b);const otherId=randomUUID();await db.insert(schema.stores).values({id:otherId,organizationId:a.organizationId,name:"Sibling",importSince:new Date()});const sibling={...a,storeId:otherId};await analysis(sibling);
 const result=await service().prepare(a,command());expect(result.context).not.toHaveProperty("styleIntelligence");
 await saveSellerProfile(db,sibling,{displayName:"Sibling writer",shortBio:""});const siblingDraft=await editStyle(db,sibling);await applyStyle(db,sibling,siblingDraft.id,siblingDraft.revision,style);
 const {pinStyleIntelligenceInTransaction}=await import("../src/modules/seller-style/analysis-generation");const [foreign]=await db.select().from(schema.styleVersions).where(tenantWhere(schema.styleVersions,sibling));
 await expect(db.transaction(tx=>pinStyleIntelligenceInTransaction(tx,a,foreign.id))).rejects.toThrow();
 await expect(service().prepare(a,{...command(),analysisVersionId:randomUUID()})).rejects.toThrow();
});
it("pinned snapshot changes canonical hash and exact gateway reservation bytes, without extra dispatch",async()=>{
 const {assembleInstructions}=await import("../src/modules/generation/instructions");const {stableJson}=await import("../src/modules/intake/contracts");const {createHash}=await import("node:crypto");
 const original=await context();await analysis();const fake=new FakeGenerationProvider(),pricing=pricingFor("google","gemini-3.5-flash-lite"),gateway=new CentralAIGateway(db,{provider:{name:"google",generate:r=>fake.generate(r)},model:"gemini-3.5-flash-lite",pricing,maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n});
 const admit=vi.spyOn(gateway,"admit"),fetch=vi.spyOn(globalThis,"fetch");const result=await new GenerationService(db,gateway).prepare(a,command());
 const prompt=assembleInstructions(result.context),oldPrompt=assembleInstructions(original);expect(admit.mock.calls[0][2].inputBytes).toBe(Buffer.byteLength(prompt.system+prompt.data));expect(admit.mock.calls[0][2].inputBytes).toBeGreaterThan(Buffer.byteLength(oldPrompt.system+oldPrompt.data));
 expect(result.contextHash).toBe(createHash("sha256").update(stableJson(result.context)).digest("hex"));expect(result.contextHash).not.toBe(createHash("sha256").update(stableJson(original)).digest("hex"));
 const {reserveCost}=await import("../src/infrastructure/ai/pricing");const request=(await generationAccounting(db,a,result.id)).attempts[0];
 expect(request.reservedNanos).toBe(reserveCost(Buffer.byteLength(prompt.system+prompt.data),8192,pricing));expect(request.reservedNanos).toBeGreaterThan(reserveCost(Buffer.byteLength(oldPrompt.system+oldPrompt.data),8192,pricing));
 expect(fetch).not.toHaveBeenCalled();expect(fake.calls).toBe(1);
 const pinned=result.context.styleIntelligence!;const changed={...result.context,styleIntelligence:{...pinned,analysisVersionId:randomUUID(),versionNumber:pinned.versionNumber+1}};expect(stableJson(changed)).not.toBe(stableJson(result.context));
 await expect(db.update(schema.generations).set({context:changed}).where(eq(schema.generations.id,result.id))).rejects.toThrow();
});
it("concurrent duplicate enriched admission pins one immutable snapshot and creates one dispatch",async()=>{
 const ready=await analysis();let release!:()=>void;const fake=new FakeGenerationProvider({delay:new Promise<void>(r=>{release=r;})}),s=service(fake),c=command();const first=s.prepare(a,c),second=s.prepare(a,c);
 await vi.waitFor(()=>expect(fake.calls).toBe(1));await analysis(a,"READY","Later during dispatch");release();const results=await Promise.all([first,second]);expect(results[0].id).toBe(results[1].id);expect(results[0].context.styleIntelligence?.analysisVersionId).toBe(ready.id);expect(fake.calls).toBe(1);
});

it("analysis READY between admission and execution cannot enrich a previously manual context",async()=>{
 const p=new FakeGenerationProvider(),gateway=new CentralAIGateway(db,{provider:p,model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:0n,attemptBudgetNanos:0n}),original=gateway.execute.bind(gateway);
 vi.spyOn(gateway,"execute").mockImplementation(async(...args)=>{await analysis();return original(...args);});
 const result=await new GenerationService(db,gateway).prepare(a,command());expect(result.status).toBe("SUCCEEDED");expect(result.context).not.toHaveProperty("styleIntelligence");expect(p.calls).toBe(1);
});
