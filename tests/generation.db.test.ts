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
it("order review projection preserves individual review authorization with bounded reads and no mutations",async()=>{
 const {orderReadingReviewStatuses,readingReviewStatus,openReadingReview,approveReadingReview}=await import("../src/modules/review/service");
 const {result}=await prepare(),orderId=result.context.orderId;
 const requests=(await db.select().from(schema.aiRequests)).length;
 expect(await orderReadingReviewStatuses(db,a,orderId)).toEqual(new Map([[unitId,await readingReviewStatus(db,a,orderId,unitId)]]));
 expect(await db.select().from(schema.readingReviews)).toHaveLength(0);
 await openReadingReview(db,a,orderId,unitId);await approveReadingReview(db,a,orderId,unitId,null);
 expect((await orderReadingReviewStatuses(db,a,orderId)).get(unitId)).toBe("Approved");
 expect(await orderReadingReviewStatuses(db,b,orderId)).toEqual(new Map());await expect(orderReadingReviewStatuses(db,{...a,storeId:b.storeId},orderId)).rejects.toThrow();
 await correctInput(db,a,unitId,0,[{label:"Name",kind:"text",value:"Updated synthetic name"}],false);
 expect((await orderReadingReviewStatuses(db,a,orderId)).has(unitId)).toBe(false);expect((await db.select().from(schema.aiRequests)).length).toBe(requests);
});
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
it("missing seller profile uses owned Store identity without a fake profile",async()=>{
 await db.delete(schema.sellerProfiles).where(eq(schema.sellerProfiles.storeId,a.storeId));const p=new FakeGenerationProvider();const r=await service(p).prepare(a,command());expect(r.status).toBe("SUCCEEDED");expect(r.sellerProfileId).toBeNull();expect(r.context.seller.source).toBe("STORE");expect(p.calls).toBe(1);
});
it("no active manual style uses platform fallback without creating a replacement",async()=>{
 await db.transaction(async tx=>{await tx.update(schema.styleVersions).set({status:"ARCHIVED"}).where(eq(schema.styleVersions.id,styleId));await tx.update(schema.styleProfiles).set({activeVersionId:null}).where(eq(schema.styleProfiles.storeId,a.storeId));});
 const p=new FakeGenerationProvider();const r=await service(p).prepare(a,command());expect(r.status).toBe("SUCCEEDED");expect(r.styleVersionId).toBeNull();expect(r.context.styleResolution).toMatchObject({source:"PLATFORM_DEFAULT",version:"reading-os-default-style/v1"});expect(p.calls).toBe(1);
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
 const review=await import("../src/modules/review/service");expect(await review.reviewAvailable(db,a,result.context.orderId,unitId)).toBe(false);
 await expect(review.openReadingReview(db,a,result.context.orderId,unitId,true)).rejects.toThrow("REVIEW_UNAVAILABLE");expect(await db.select().from(schema.readingReviews)).toHaveLength(0);
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
 const {assembleInstructions,PLATFORM_RULES,INTEGRATION_RULES}=await import("../src/modules/generation/instructions");
 const prompt=assembleInstructions(result.context);
 expect(result.context.integrationVersion).toBe("generation-context/v2");
 expect(prompt.system).toBe(assembleInstructions(before).system);
 expect(JSON.parse(prompt.data)).toEqual(JSON.parse(assembleInstructions(before).data));
 expect(prompt.system).toBe(PLATFORM_RULES+"\n"+INTEGRATION_RULES);
 expect(JSON.parse(prompt.data).customerFields).toEqual(before.product.configuration.inputs.map(({key,label,type,helpText,required})=>({key,label,type,helpText,required})));
 expect(JSON.parse(prompt.data).customerContext).toEqual(before.customer.answers);
 const legacy=structuredClone(before);delete legacy.integrationVersion;
 const legacyPrompt=assembleInstructions(legacy);
 expect(legacyPrompt.system).toBe(PLATFORM_RULES);
 expect(JSON.parse(legacyPrompt.data)).not.toHaveProperty("customerFields");
 expect(JSON.parse(legacyPrompt.data)).not.toHaveProperty("product");
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

// Review reads and admission reuse real synthetic generation fixtures; no new provider operation.
it("review pins exact successful evidence, frozen answers, labels and section order without new dispatch",async()=>{
 const {openReadingReview,reviewAvailable}=await import("../src/modules/review/service");
 const {result,provider}=await prepare();const orderId=result.context.orderId;
 expect(await reviewAvailable(db,a,orderId,unitId)).toBe(true);expect(await db.select().from(schema.readingReviews)).toHaveLength(0);
 const original=await readGeneration(db,a,result.id);
 const views=await Promise.all([openReadingReview(db,a,orderId,unitId),openReadingReview(db,a,orderId,unitId)]);
 expect(views[0]).toEqual(views[1]);expect(views[0].details).toEqual([{label:"Name",value:"Synthetic recipient"}]);expect(views[0].sections.map(s=>s.title)).toEqual(["Introduction","Guidance"]);
 const [review]=await db.select().from(schema.readingReviews);expect(review).toMatchObject({unitId,generationId:result.id,state:"PENDING"});expect(provider.calls).toBe(1);
 expect(await readGeneration(db,a,result.id)).toEqual(original);
 await expect(db.update(schema.readingReviews).set({generationId:randomUUID()}).where(eq(schema.readingReviews.id,review.id))).rejects.toThrow();
 await expect(db.delete(schema.readingReviews).where(eq(schema.readingReviews.id,review.id))).rejects.toThrow();
});
it("review rejects missing, failed, processing, ambiguous, forged and cross-store readings",async()=>{
 const {openReadingReview,reviewAvailable}=await import("../src/modules/review/service");
 const c=await context();expect(await reviewAvailable(db,a,c.orderId,unitId)).toBe(false);
 await expect(openReadingReview(db,a,c.orderId,randomUUID())).rejects.toThrow();
 const {result}=await prepare(new FakeGenerationProvider({failure:new ProviderFailure("NETWORK",{},undefined,true)}));
 expect(await reviewAvailable(db,a,c.orderId,unitId)).toBe(false);
 await expect(openReadingReview(db,b,c.orderId,unitId)).rejects.toThrow();
 await expect(openReadingReview(db,a,randomUUID(),unitId)).rejects.toThrow();
 const [sibling]=await db.insert(schema.stores).values({organizationId:a.organizationId,name:"Sibling",source:"fixtures",importSince:new Date()}).returning();
 await expect(openReadingReview(db,{...a,storeId:sibling.id},c.orderId,unitId)).rejects.toThrow();
 await expect(db.insert(schema.readingReviews).values({organizationId:a.organizationId,storeId:a.storeId,unitId,generationId:result.id})).rejects.toThrow();
 expect(await db.select().from(schema.readingReviews)).toHaveLength(0);
});
it("pinned review does not float to a newer successful reading and does not use mutable answers",async()=>{
 const {openReadingReview}=await import("../src/modules/review/service");const {result}=await prepare();
 const original=await openReadingReview(db,a,result.context.orderId,unitId);
 await correctInput(db,a,unitId,0,[{label:"Name",value:"Changed recipient",kind:"text"}],false);
 const {createHash}=await import("node:crypto"),{stableJson}=await import("../src/modules/intake/contracts");
 const changed=await context();const [newer]=await db.insert(schema.generations).values({...result,id:randomUUID(),status:"PROCESSING",result:null,completedAt:null,createdAt:new Date(result.createdAt.getTime()+1000),customerRevision:changed.customer.revision,context:changed,contextHash:createHash("sha256").update(stableJson(changed)).digest("hex")}).returning();
 expect(await (await import("../src/modules/review/service")).reviewAvailable(db,a,result.context.orderId,unitId)).toBe(false);
 await db.update(schema.generations).set({status:"SUCCEEDED",result:result.result,completedAt:new Date()}).where(eq(schema.generations.id,newer.id));
 const retained=await openReadingReview(db,a,result.context.orderId,unitId);expect(retained).toEqual({...original,outdated:true});
 expect((await db.select().from(schema.readingReviews))[0].generationId).toBe(result.id);
});
it("review mixed-cart and quantity readings remain independently owned and pinned",async()=>{
 const {openReadingReview,reviewAvailable}=await import("../src/modules/review/service");
 const order:ExternalOrder={...fixtureOrders[0],externalId:"9910",lines:[{...fixtureOrders[0].lines[0],externalId:"9998",listingId:"101",quantity:2,answers:[{label:"Name",value:"First",kind:"text"}]},{...fixtureOrders[0].lines[0],externalId:"9999",listingId:"101",quantity:1,answers:[{label:"Name",value:"Other line",kind:"text"}]}]};
 await ingestOrder(db,a,order);const data=await workspaceData(db,a),o=data.orders.find(o=>o.externalId==="9910")!,ls=data.lines.filter(l=>l.orderId===o.id),us=data.units.filter(u=>ls.some(l=>l.id===u.lineItemId));
 for(const [i,u]of us.entries()){
  await correctInput(db,a,u.id,u.revision,[{label:"Name",value:`Person ${i}`,kind:"text"}],true);
  const generated=await service().prepare(a,command(u.id));const view=await openReadingReview(db,a,o.id,u.id);
  expect(view.details[0].value).toBe(`Person ${i}`);expect(view.quantity).toBe(ls.find(l=>l.id===u.lineItemId)!.quantity);expect(view.index).toBe(u.unitIndex);
  expect(generated.context.unitId).toBe(u.id);
 }
 const {saveReadingReviewDraft}=await import("../src/modules/review/service");
 for(const [i,u]of us.entries()){
  const editable=await openReadingReview(db,a,o.id,u.id,true),content=structuredClone(editable.draft!.content);content.sections[0].content=`Independent draft ${i}`;
  await saveReadingReviewDraft(db,a,o.id,u.id,0,content);
 }
 for(const [i,u]of us.entries())expect((await openReadingReview(db,a,o.id,u.id)).sections[0].content).toBe(`Independent draft ${i}`);
 const {approveReadingReview}=await import("../src/modules/review/service");
 await approveReadingReview(db,a,o.id,us[0].id,1);
 expect((await openReadingReview(db,a,o.id,us[0].id)).approved).toBe(true);
 for(const u of us.slice(1))expect((await openReadingReview(db,a,o.id,u.id)).approved).toBe(false);
 const pins=us.map(u=>u.productVersionId);
 await correctInput(db,a,us[1].id,1,[{label:"Name",value:"Changed sibling recipient",kind:"text"}],true);
 expect((await openReadingReview(db,a,o.id,us[1].id)).outdated).toBe(true);
 await expect(approveReadingReview(db,a,o.id,us[1].id,1)).rejects.toMatchObject({kind:"STALE"});
 expect((await openReadingReview(db,a,o.id,us[0].id)).outdated).toBe(false);expect((await openReadingReview(db,a,o.id,us[2].id)).outdated).toBe(false);
 await approveReadingReview(db,a,o.id,us[2].id,1);
 const retainedUnits=(await workspaceData(db,a)).units;for(const [i,u]of us.entries())expect(retainedUnits.find(r=>r.id===u.id)?.productVersionId).toBe(pins[i]);
 expect(await db.select().from(schema.readingReviewDrafts)).toHaveLength(3);
 expect(await db.select().from(schema.readingReviews)).toHaveLength(3);
 expect(await reviewAvailable(db,a,(await context()).orderId,us[0].id)).toBe(false);
});
it("review blocks production attention and active preparation without relying on queued intent",async()=>{
 const {reviewAvailable}=await import("../src/modules/review/service");const {result}=await prepare();
 const [queue]=await db.select().from(schema.productionQueue).where(eq(schema.productionQueue.unitId,unitId));
 expect(queue.state).toBe("QUEUED");expect(await reviewAvailable(db,a,result.context.orderId,unitId)).toBe(true);
 // Isolated corruption/operational fixtures; do not bypass production triggers in application code.
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");
 await pg.query("UPDATE production_queue SET state='ATTENTION',generation_command_key=id,execution_started_at=now(),claim_token=gen_random_uuid(),claimed_at=now(),scheduling_ordinal=1,resolved_at=now(),resolution_code='INCONSISTENT_STATE' WHERE id=$1",[queue.id]);
 await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");
 expect(await reviewAvailable(db,a,result.context.orderId,unitId)).toBe(false);
});
it("review corrupt canonical data fails closed at the owned read boundary",async()=>{
 const {reviewAvailable,openReadingReview}=await import("../src/modules/review/service");const {result}=await prepare();
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");
 await pg.query("UPDATE generations SET result=$1 WHERE id=$2",[JSON.stringify({sections:[]}),result.id]);
 await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");
 expect(await reviewAvailable(db,a,result.context.orderId,unitId)).toBe(false);
 await expect(openReadingReview(db,a,result.context.orderId,unitId)).rejects.toThrow("REVIEW_UNAVAILABLE");expect(await db.select().from(schema.readingReviews)).toHaveLength(0);
});

it("review drafts initialize once from pinned evidence and edits persist without changing original records",async()=>{
 const {openReadingReview,saveReadingReviewDraft}=await import("../src/modules/review/service");const {result}=await prepare(),orderId=result.context.orderId;
 const untouched=await openReadingReview(db,a,orderId,unitId);expect(untouched.draft).toBeNull();
 const [first,second]=await Promise.all([openReadingReview(db,a,orderId,unitId,true),openReadingReview(db,a,orderId,unitId,true)]);
 expect(first.draft).toEqual(second.draft);expect(first.draft).toMatchObject({revision:0,modified:false});expect(await db.select().from(schema.readingReviewDrafts)).toHaveLength(1);
 const original=await readGeneration(db,a,result.id),review=(await db.select().from(schema.readingReviews))[0],ledger=await generationAccounting(db,a,result.id);
 const content=structuredClone(first.draft!.content);content.sections[0].content="<script>alert('text only')</script>\n\nSeller correction";content.sections[1].content="Second correction";
 expect(await saveReadingReviewDraft(db,a,orderId,unitId,0,content)).toEqual({revision:1,modified:true});
 const saved=await openReadingReview(db,a,orderId,unitId);expect(saved.sections[0].content).toBe(content.sections[0].content);expect(saved.draft).toMatchObject({revision:1,content,modified:true});
 expect((await openReadingReview(db,a,orderId,unitId,true)).draft).toEqual(saved.draft);
 expect(saved.details).toEqual(untouched.details);expect(await readGeneration(db,a,result.id)).toEqual(original);expect((await db.select().from(schema.readingReviews))[0]).toEqual(review);expect(await generationAccounting(db,a,result.id)).toEqual(ledger);
 expect(await saveReadingReviewDraft(db,a,orderId,unitId,1,first.draft!.content)).toEqual({revision:2,modified:false});expect((await openReadingReview(db,a,orderId,unitId)).draft?.modified).toBe(false);
 expect((await openReadingReview(db,a,orderId,unitId)).draft?.revision).toBe(2);
 const archive=await db.select().from(schema.readingReviewDraftVersions).orderBy(schema.readingReviewDraftVersions.revision);
 expect(archive.map(v=>v.revision)).toEqual([0,1,2]);expect(archive[0].content).toEqual(first.draft!.content);expect(archive[1].content).toEqual(content);
 await expect(db.update(schema.readingReviewDraftVersions).set({content})).rejects.toThrow();
 await expect(db.delete(schema.readingReviewDraftVersions)).rejects.toThrow();
 await expect(db.insert(schema.readingReviewDraftVersions).values({...archive[0],revision:99})).rejects.toThrow();
 expect(await db.select().from(schema.readingReviewDraftVersions).orderBy(schema.readingReviewDraftVersions.revision)).toEqual(archive);
 const audits=await db.select().from(schema.auditLogs);expect(audits.filter(x=>x.action.startsWith("reading_review_draft_saved:")).map(x=>x.action)).toEqual(["reading_review_draft_saved:1","reading_review_draft_saved:2"]);
});
it("concurrent draft saves reject stale revision without overwriting the winner",async()=>{
 const {openReadingReview,saveReadingReviewDraft}=await import("../src/modules/review/service");const {result}=await prepare(),orderId=result.context.orderId;
 const view=await openReadingReview(db,a,orderId,unitId,true),one=structuredClone(view.draft!.content),two=structuredClone(one);one.sections[0].content="First writer";two.sections[0].content="Second writer";
 const outcomes=await Promise.allSettled([saveReadingReviewDraft(db,a,orderId,unitId,0,one),saveReadingReviewDraft(db,a,orderId,unitId,0,two)]);
 expect(outcomes.filter(o=>o.status==="fulfilled")).toHaveLength(1);expect(outcomes.filter(o=>o.status==="rejected")).toHaveLength(1);
 const saved=await openReadingReview(db,a,orderId,unitId);expect(saved.draft?.revision).toBe(1);expect(["First writer","Second writer"]).toContain(saved.sections[0].content);
 await expect(saveReadingReviewDraft(db,a,orderId,unitId,0,one)).rejects.toThrow("CONFLICT");
 expect((await openReadingReview(db,a,orderId,unitId)).draft).toEqual(saved.draft);
});
it("draft writes reject section structure changes, malformed content and foreign/forged relationships",async()=>{
 const {openReadingReview,saveReadingReviewDraft}=await import("../src/modules/review/service");const {result}=await prepare(),orderId=result.context.orderId;
 const view=await openReadingReview(db,a,orderId,unitId,true),base=view.draft!.content;
 const mutations=[{sections:base.sections.slice(1)},{sections:[...base.sections,base.sections[0]]},{sections:[...base.sections].reverse()},{sections:base.sections.map((s,i)=>i? s:{...s,sectionId:"injected"})},{sections:base.sections.map((s,i)=>i?s:{...s,title:"Changed title"})},{sections:base.sections.map((s,i)=>i?s:{...s,content:"x".repeat(40001)})},{sections:base.sections.map((s,i)=>i?s:{...s,content:" "})},null,{...base,customer:"changed"}];
 for(const mutation of mutations)await expect(saveReadingReviewDraft(db,a,orderId,unitId,0,mutation)).rejects.toThrow("INVALID");
 await expect(saveReadingReviewDraft(db,b,orderId,unitId,0,base)).rejects.toThrow();await expect(openReadingReview(db,b,orderId,unitId,true)).rejects.toThrow();
 const [sibling]=await db.insert(schema.stores).values({organizationId:a.organizationId,name:"Sibling drafts",source:"fixtures",importSince:new Date()}).returning();
 await expect(saveReadingReviewDraft(db,{...a,storeId:sibling.id},orderId,unitId,0,base)).rejects.toThrow();await expect(openReadingReview(db,{...a,storeId:sibling.id},orderId,unitId,true)).rejects.toThrow();
 await expect(saveReadingReviewDraft(db,a,randomUUID(),unitId,0,base)).rejects.toThrow();await expect(saveReadingReviewDraft(db,a,orderId,randomUUID(),0,base)).rejects.toThrow();
 const [draft]=await db.select().from(schema.readingReviewDrafts);expect(draft.revision).toBe(0);
 await expect(db.update(schema.readingReviewDrafts).set({reviewId:randomUUID(),revision:1}).where(eq(schema.readingReviewDrafts.reviewId,draft.reviewId))).rejects.toThrow();
});

it("approval freezes canonical-only content atomically and is immutable and idempotent",async()=>{
 const {openReadingReview,approveReadingReview,reviewContentHash}=await import("../src/modules/review/service");
 const {result}=await prepare(),orderId=result.context.orderId;
 await openReadingReview(db,a,orderId,unitId);
 const original=await readGeneration(db,a,result.id),ledger=await generationAccounting(db,a,result.id);
 const outcomes=await Promise.all([approveReadingReview(db,a,orderId,unitId,null),approveReadingReview(db,a,orderId,unitId,null)]);
 expect(outcomes[0]).toEqual(outcomes[1]);expect(outcomes[0]).toMatchObject({state:"APPROVED",approvedByUserId:a.userId,generationId:result.id,approvedContent:result.result,approvedDraftRevision:null,approvedContentHash:reviewContentHash(result.result!)});
 expect((await openReadingReview(db,a,orderId,unitId)).approved).toBe(true);
 expect(await readGeneration(db,a,result.id)).toEqual(original);expect(await generationAccounting(db,a,result.id)).toEqual(ledger);
 expect(await db.select().from(schema.readingReviews)).toHaveLength(1);
 await expect(openReadingReview(db,a,orderId,unitId,true)).rejects.toThrow();
 for(const update of [{state:"PENDING"},{approvedContentHash:"0".repeat(64)},{generationId:randomUUID()},{approvedDraftRevision:2}])await expect(db.update(schema.readingReviews).set(update)).rejects.toThrow();
 await expect(db.delete(schema.readingReviews)).rejects.toThrow();
});
it("approval requires the exact saved revision and preserves saved draft and original evidence",async()=>{
 const {openReadingReview,approveReadingReview,saveReadingReviewDraft}=await import("../src/modules/review/service");
 const {result}=await prepare(),orderId=result.context.orderId;
 const first=await openReadingReview(db,a,orderId,unitId,true),content=structuredClone(first.draft!.content);
 content.sections[0].content="<script>untrusted</script>\nSeller edited text";
 await saveReadingReviewDraft(db,a,orderId,unitId,0,content);
 await expect(approveReadingReview(db,a,orderId,unitId,0)).rejects.toMatchObject({kind:"CONFLICT"});
 expect((await db.select().from(schema.readingReviews))[0].state).toBe("PENDING");
 await expect(approveReadingReview(db,a,orderId,unitId,null)).rejects.toMatchObject({kind:"CONFLICT"});
 const before=(await db.select().from(schema.readingReviewDrafts))[0];
 const approved=await approveReadingReview(db,a,orderId,unitId,1);
 expect(approved.approvedContent).toEqual(content);expect(approved.approvedDraftRevision).toBe(1);
 await approveReadingReview(db,a,orderId,unitId,1);
 const approvals=(await db.select().from(schema.auditLogs)).filter(x=>x.action==="reading_review_approved");expect(approvals).toHaveLength(1);expect(approvals[0]).toMatchObject({actorId:a.userId,resourceId:approved.id,storeId:a.storeId});
 expect((await db.select().from(schema.readingReviewDrafts))[0]).toEqual(before);
 expect((await openReadingReview(db,a,orderId,unitId)).sections).toEqual(content.sections.map(({title,content})=>({title,content})));
 await expect(saveReadingReviewDraft(db,a,orderId,unitId,1,content)).rejects.toThrow();
 await expect(db.update(schema.readingReviewDrafts).set({revision:2,content})).rejects.toThrow();
 expect((await readGeneration(db,a,result.id)).result).toEqual(result.result);
});
it("approval rejects foreign ownership, forged relationships and invalid revision without partial state",async()=>{
 const {openReadingReview,approveReadingReview}=await import("../src/modules/review/service");
 const {result}=await prepare(),orderId=result.context.orderId;await openReadingReview(db,a,orderId,unitId);
 const [sibling]=await db.insert(schema.stores).values({organizationId:a.organizationId,name:"Sibling approvals",source:"fixtures",importSince:new Date()}).returning();
 for(const [scope,order,unit,revision] of [[b,orderId,unitId,null],[{...a,storeId:sibling.id},orderId,unitId,null],[a,randomUUID(),unitId,null],[a,orderId,randomUUID(),null],[a,orderId,unitId,-1]] as const)await expect(approveReadingReview(db,scope,order,unit,revision)).rejects.toThrow();
 const [review]=await db.select().from(schema.readingReviews);expect(review.state).toBe("PENDING");expect(review.approvedContent).toBeNull();
 await expect(db.update(schema.readingReviews).set({state:"APPROVED"})).rejects.toThrow();
 await expect(db.update(schema.readingReviews).set({state:"APPROVED",approvedContent:{sections:[]},approvedContentHash:"0".repeat(64),approvedAt:new Date()})).rejects.toThrow();
 expect((await db.select().from(schema.readingReviews))[0]).toEqual(review);
});

it("approved display stays frozen despite unrelated draft corruption and fails closed on approved corruption",async()=>{
 const {openReadingReview,approveReadingReview,readingReviewStatus}=await import("../src/modules/review/service");const {result}=await prepare(),orderId=result.context.orderId;
 await openReadingReview(db,a,orderId,unitId,true);const approved=await approveReadingReview(db,a,orderId,unitId,0);
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE reading_review_drafts SET content=$1 WHERE review_id=$2",[JSON.stringify({sections:[]}),approved.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");
 expect((await openReadingReview(db,a,orderId,unitId)).sections).toEqual(approved.approvedContent!.sections.map(({title,content})=>({title,content})));
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE reading_reviews SET approved_content_hash=$1 WHERE id=$2",["0".repeat(64),approved.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");
 await expect(openReadingReview(db,a,orderId,unitId)).rejects.toThrow("REVIEW_UNAVAILABLE");expect(await readingReviewStatus(db,a,orderId,unitId)).toBeNull();
});
it("unmodified draft approval retains deterministic draft provenance",async()=>{
 const {openReadingReview,approveReadingReview}=await import("../src/modules/review/service");const {result}=await prepare(),orderId=result.context.orderId;
 const view=await openReadingReview(db,a,orderId,unitId,true);expect(view.draft?.modified).toBe(false);
 const approved=await approveReadingReview(db,a,orderId,unitId,0);expect(approved.approvedContent).toEqual(view.draft!.content);expect(approved.approvedDraftRevision).toBe(0);
});
it("racing save and approval never approves unseen content or advances an approved draft",async()=>{
 const {openReadingReview,approveReadingReview,saveReadingReviewDraft}=await import("../src/modules/review/service");const {result}=await prepare(),orderId=result.context.orderId;
 const view=await openReadingReview(db,a,orderId,unitId,true),content=structuredClone(view.draft!.content);content.sections[0].content="Another tab saved";
 const outcomes=await Promise.allSettled([approveReadingReview(db,a,orderId,unitId,0),saveReadingReviewDraft(db,a,orderId,unitId,0,content)]);
 expect(outcomes.filter(o=>o.status==="fulfilled")).toHaveLength(1);
 const [review]=await db.select().from(schema.readingReviews),[draft]=await db.select().from(schema.readingReviewDrafts);
 if(review.state==="APPROVED"){expect(review.approvedContent).toEqual(view.draft!.content);expect(draft.revision).toBe(0);}else{expect(review.approvedContent).toBeNull();expect(draft.revision).toBe(1);}
});

it.each([false,true])("complete review lifecycle hands off only exact immutable approved content (edited=%s)",async edited=>{
 const {openReadingReview,approveReadingReview,saveReadingReviewDraft,getApprovedReadingForDocument}=await import("../src/modules/review/service");
 const {result,provider}=await prepare(),orderId=result.context.orderId;
 await expect(getApprovedReadingForDocument(db,a,orderId,unitId)).rejects.toThrow("REVIEW_UNAVAILABLE");
 await openReadingReview(db,a,orderId,unitId);
 await expect(getApprovedReadingForDocument(db,a,orderId,unitId)).rejects.toThrow("REVIEW_UNAVAILABLE");
 let revision:number|null=null;
 if(edited){const view=await openReadingReview(db,a,orderId,unitId,true),content=structuredClone(view.draft!.content);content.sections[0].content="Seller correction — 猫 🐾\n\nhttps://example.invalid/"+"x".repeat(20000);
  await expect(getApprovedReadingForDocument(db,a,orderId,unitId)).rejects.toThrow("REVIEW_UNAVAILABLE");await saveReadingReviewDraft(db,a,orderId,unitId,0,content);revision=1;}
 const approved=await approveReadingReview(db,a,orderId,unitId,revision),first=await getApprovedReadingForDocument(db,a,orderId,unitId),second=await getApprovedReadingForDocument(db,a,orderId,unitId);
 expect(first).toEqual(second);expect(first.sections).toEqual(approved.approvedContent!.sections);expect(first.contentHash).toBe(approved.approvedContentHash);expect(first.provenance).toEqual({reviewId:approved.id,generationId:result.id});
 expect(first).toMatchObject({organizationId:a.organizationId,storeId:a.storeId,readingId:unitId,contractVersion:"approved-reading/v1"});
 expect(Object.isFrozen(first)).toBe(true);expect(Object.isFrozen(first.sections)).toBe(true);expect(Object.isFrozen(first.sections[0])).toBe(true);
 expect(()=>{(first.sections[0] as {content:string}).content="Downstream mutation";}).toThrow();
 expect(JSON.stringify(first)).not.toMatch(/draft|AIRequest|UsageEvent|provider|model|styleIntelligence|contextHash|queue/);expect(provider.calls).toBe(1);
 await expect(openReadingReview(db,a,orderId,unitId,true)).rejects.toThrow();
});
it("approved handoff rejects foreign Stores, sibling Stores and forged Order/Reading pairs",async()=>{
 const {openReadingReview,approveReadingReview,getApprovedReadingForDocument}=await import("../src/modules/review/service");const {result}=await prepare(),orderId=result.context.orderId;
 await openReadingReview(db,a,orderId,unitId);await approveReadingReview(db,a,orderId,unitId,null);
 const [sibling]=await db.insert(schema.stores).values({organizationId:a.organizationId,name:"Sibling handoff",source:"fixtures",importSince:new Date()}).returning();
 for(const [scope,order,reading]of [[b,orderId,unitId],[{...a,storeId:sibling.id},orderId,unitId],[a,randomUUID(),unitId],[a,orderId,randomUUID()]] as const)await expect(getApprovedReadingForDocument(db,scope,order,reading)).rejects.toThrow("REVIEW_UNAVAILABLE");
});
it("handoff and Orders fail closed on corrupt approval and pending draft content",async()=>{
 const {openReadingReview,approveReadingReview,getApprovedReadingForDocument,readingReviewStatus,reviewContentHash}=await import("../src/modules/review/service");const {result}=await prepare(),orderId=result.context.orderId;
 await openReadingReview(db,a,orderId,unitId,true);const [review]=await db.select().from(schema.readingReviews);
 async function corrupt(sql:string,parameters:unknown[]){await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query(sql,parameters);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");}
 await corrupt("UPDATE reading_review_drafts SET content=$1 WHERE review_id=$2",[JSON.stringify({sections:[]}),review.id]);
 expect(await readingReviewStatus(db,a,orderId,unitId)).toBeNull();await expect(openReadingReview(db,a,orderId,unitId)).rejects.toThrow("REVIEW_UNAVAILABLE");
 await corrupt("UPDATE reading_review_drafts SET content=$1 WHERE review_id=$2",[JSON.stringify(result.result),review.id]);
 const approved=await approveReadingReview(db,a,orderId,unitId,0);
 for(const content of [{sections:[]},{sections:approved.approvedContent!.sections.map((s,i)=>({...s,sectionId:i===0?"forged":s.sectionId}))}]){
  await corrupt("UPDATE reading_reviews SET approved_content=$1,approved_content_hash=$2 WHERE id=$3",[JSON.stringify(content),reviewContentHash(content),review.id]);
  await expect(getApprovedReadingForDocument(db,a,orderId,unitId)).rejects.toThrow("REVIEW_UNAVAILABLE");
 }
 await corrupt("UPDATE reading_reviews SET approved_content=$1,approved_content_hash=$2 WHERE id=$3",[JSON.stringify(approved.approvedContent),"0".repeat(64),review.id]);await expect(getApprovedReadingForDocument(db,a,orderId,unitId)).rejects.toThrow("REVIEW_UNAVAILABLE");
});
it("approved handoff never replaces content with later successful evidence or mutable draft content",async()=>{
 const {openReadingReview,approveReadingReview,getApprovedReadingForDocument}=await import("../src/modules/review/service");const {result}=await prepare(),orderId=result.context.orderId;
 await openReadingReview(db,a,orderId,unitId,true);const approved=await approveReadingReview(db,a,orderId,unitId,0),original=await getApprovedReadingForDocument(db,a,orderId,unitId);
 const changed=structuredClone(result.result!);changed.sections[0].content="Later content, never approved";
 const [later]=await db.insert(schema.generations).values({...result,id:randomUUID(),status:"PROCESSING",result:null,completedAt:null,createdAt:new Date(result.createdAt.getTime()+1000)}).returning();await db.update(schema.generations).set({status:"SUCCEEDED",result:changed,completedAt:new Date()}).where(eq(schema.generations.id,later.id));
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE reading_review_drafts SET content=$1 WHERE review_id=$2",[JSON.stringify(changed),approved.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");
 await expect(getApprovedReadingForDocument(db,a,orderId,unitId)).rejects.toThrow("REVIEW_UNAVAILABLE");
 const historical=await openReadingReview(db,a,orderId,unitId);expect(historical.outdated).toBe(true);expect(historical.sections).toEqual(original.sections.map(({title,content})=>({title,content})));
});

// MVP defaults: a fresh owned Store with no seller/style/history setup.
async function zeroStyleUnit(){
 await ingestListing(db,b,fixtureListings[0]);const id=await beginListingDraft(db,b,"101"),d=(await productData(db,b,id)).draft!;
 await activateProduct(db,b,id,d.id,d.revision,{name:"Fresh seller reading",configuration});
 await ingestOrder(db,b,{...fixtureOrders[0],externalId:"8000",lines:[{...fixtureOrders[0].lines[0],externalId:"8001",quantity:1,answers:[{label:"Name",value:"Synthetic",kind:"text"}]}]});
 return (await workspaceData(db,b)).units[0].id;
}
it("zero history/style/profile generates with versioned default and pinned English, without fake records",async()=>{
 const id=await zeroStyleUnit();let sent!:import("../src/infrastructure/ai/provider").ProviderRequest;const p=new FakeGenerationProvider();
 const c=command(id),r=await service({name:"fake",generate:req=>{sent=req;return p.generate(req);}}).prepare(b,c);
 expect(r.status).toBe("SUCCEEDED");expect(r.styleVersionId).toBeNull();expect(r.sellerProfileId).toBeNull();
 expect(r.context.style.id).toBe("reading-os-default-style/v1");expect(r.context.styleResolution).toMatchObject({source:"PLATFORM_DEFAULT",version:"reading-os-default-style/v1"});expect(r.context.outputLanguage).toBe("en");
 expect(sent.system).toContain("in English (en)");expect(JSON.parse(sent.data).outputRequirements.language).toBe("en");
 for(const table of [schema.styleSources,schema.styleProfiles,schema.styleVersions,schema.styleAnalysisVersions,schema.sellerProfiles])expect(await db.select().from(table).where(tenantWhere(table,b))).toHaveLength(0);
 expect((await service(p).prepare(b,c)).context).toEqual(r.context);expect(p.calls).toBe(1);
 expect((await db.select().from(schema.productionQueue).where(tenantWhere(schema.productionQueue,b)))).toHaveLength(1);
});
it("READY owned intelligence wins even without a published manual style; provenance is exact",async()=>{
 const id=await zeroStyleUnit(),ready=await analysis(b);const r=await service().prepare(b,command(id));
 expect(r.context.styleResolution).toEqual({source:"SELLER_STYLE_INTELLIGENCE",analysisVersionId:ready.id,versionNumber:ready.versionNumber,contractVersion:"style-intelligence/v1"});expect(r.context.styleIntelligence?.analysisVersionId).toBe(ready.id);expect(r.context.outputLanguage).toBe("en");expect(r.styleVersionId).toBeNull();
});
it("later seller setup/intelligence cannot replace pinned default or English on retry",async()=>{
 const id=await zeroStyleUnit(),failed=await service(new FakeGenerationProvider({output:"bad"})).prepare(b,command(id));
 await saveSellerProfile(db,b,{displayName:"Later seller",shortBio:""});const d=await editStyle(db,b);await applyStyle(db,b,d.id,d.revision,style);await analysis(b);
 const p=new FakeGenerationProvider(),c={...command(id),retryGenerationId:failed.id},retry=await service(p).prepare(b,c),replay=await service(p).prepare(b,c);
 expect(retry.status).toBe("SUCCEEDED");expect(retry.context).toEqual(failed.context);expect(retry.contextHash).toBe(failed.contextHash);expect(replay.context).toEqual(failed.context);expect(retry.context.outputLanguage).toBe("en");expect(retry.context.styleResolution?.source).toBe("PLATFORM_DEFAULT");expect(p.calls).toBe(1);
 await expect(db.update(schema.generations).set({context:{...retry.context,outputLanguage:undefined}}).where(eq(schema.generations.id,retry.id))).rejects.toThrow();
});
it("default SQL bindings reject fabricated seller/style identities",async()=>{
 const id=await zeroStyleUnit();const context=await db.transaction(tx=>buildGenerationContext(tx,b,id));
 const row={organizationId:b.organizationId,storeId:b.storeId,unitId:id,productVersionId:context.product.id,styleVersionId:null,sellerProfileId:null,customerRevision:0,context,contextHash:"a".repeat(64)};
 await expect(db.insert(schema.generations).values({...row,context:{...context,seller:{...context.seller,id:a.storeId}}})).rejects.toThrow();
 await expect(db.insert(schema.generations).values({...row,context:{...context,style:{...context.style,id:styleId}}})).rejects.toThrow();
});
it("defaults migration preserves old generations and repeat migration is a no-op",async()=>{
 const {result}=await prepare();const old=(await pg.query("SELECT * FROM generations")).rows;
 await pg.exec(readFileSync("drizzle/0022_bored_eddie_brock.sql","utf8"));expect((await pg.query("SELECT * FROM generations")).rows).toEqual(old);
 expect((await readGeneration(db,a,result.id)).context.style.id).toBe(styleId);
 const {migrate}=await import("drizzle-orm/pglite/migrator");const runner=new PGlite();try{const d=drizzle(runner,{schema});await migrate(d,{migrationsFolder:"drizzle"});await migrate(d,{migrationsFolder:"drizzle"});const journal=JSON.parse(readFileSync("drizzle/meta/_journal.json","utf8"));expect((await runner.query("SELECT * FROM drizzle.__drizzle_migrations")).rows).toHaveLength(journal.entries.length);}finally{await runner.close();}
},20000);
it("new context pins approved title, field meanings and attribution despite mutable Product edits",async()=>{
 const c=await context();expect(c.integrationVersion).toBe("generation-context/v2");expect(c.product.title).toBe("Personalized guidance");expect(c.product.source).toBe("PRODUCT_VERSION");
 await db.update(schema.products).set({name:"Mutable renamed product"}).where(eq(schema.products.id,productId));
 expect((await context()).product.title).toBe("Personalized guidance");
 const {assembleInstructions}=await import("../src/modules/generation/instructions");const p=JSON.parse(assembleInstructions(c).data);
 expect(p.product.title).toBe("Personalized guidance");expect(p.customerFields[0]).toMatchObject({key:"name",label:"Name",required:true,type:"TEXT"});expect(p.sellerIdentity.displayName).toBe(c.seller.displayName);
});

// Milestone 6.2A: persisted freshness is separate from historical Review identity.
it("customer correction before initialization cannot create actionable review or draft",async()=>{
 const review=await import("../src/modules/review/service"),{result}=await prepare();
 await correctInput(db,a,unitId,0,[{label:"Name",value:"Updated",kind:"text"}],false);
 await expect(review.openReadingReview(db,a,result.context.orderId,unitId,true)).rejects.toThrow("REVIEW_UNAVAILABLE");
 expect(await db.select().from(schema.readingReviews)).toHaveLength(0);expect(await db.select().from(schema.readingReviewDrafts)).toHaveLength(0);
});
it.each([false,true])("customer correction after review/draft save (%s) preserves history and blocks advancement",async save=>{
 const review=await import("../src/modules/review/service"),{result}=await prepare(),orderId=result.context.orderId;
 const initial=await review.openReadingReview(db,a,orderId,unitId,true),content=structuredClone(initial.draft!.content);
 content.sections[0].content="Historical seller edit";if(save)await review.saveReadingReviewDraft(db,a,orderId,unitId,0,content);
 const drafts=await db.select().from(schema.readingReviewDrafts),reviews=await db.select().from(schema.readingReviews),pin=(await db.select().from(schema.units))[0].productVersionId;
 await correctInput(db,a,unitId,0,[{label:"Name",value:"Updated",kind:"text"}],false);
 const old=await review.openReadingReview(db,a,orderId,unitId,true);expect(old.outdated).toBe(true);expect(old.details).toEqual(initial.details);
 await expect(review.saveReadingReviewDraft(db,a,orderId,unitId,save?1:0,content)).rejects.toMatchObject({kind:"STALE"});
 await expect(review.approveReadingReview(db,a,orderId,unitId,save?1:0)).rejects.toMatchObject({kind:"STALE"});
 expect(await db.select().from(schema.readingReviewDrafts)).toEqual(drafts);expect(await db.select().from(schema.readingReviews)).toEqual(reviews);
 expect((await db.select().from(schema.units))[0].productVersionId).toBe(pin);expect(await review.readingReviewStatus(db,a,orderId,unitId)).toBeNull();
});
it("outdated edit opening cannot lazily initialize a historical draft",async()=>{
 const review=await import("../src/modules/review/service"),{result}=await prepare(),orderId=result.context.orderId;
 await review.openReadingReview(db,a,orderId,unitId);await correctInput(db,a,unitId,0,[{label:"Name",value:"Updated",kind:"text"}],false);
 expect((await review.openReadingReview(db,a,orderId,unitId,true)).draft).toBeNull();expect(await db.select().from(schema.readingReviewDrafts)).toHaveLength(0);
});
it.each([true,false])("correction racing approval serializes in transaction order (correction first %s)",async correctionFirst=>{
 const review=await import("../src/modules/review/service"),{result}=await prepare(),orderId=result.context.orderId;await review.openReadingReview(db,a,orderId,unitId);
 const correct=()=>correctInput(db,a,unitId,0,[{label:"Name",value:"Updated",kind:"text"}],false),approve=()=>review.approveReadingReview(db,a,orderId,unitId,null);
 const outcomes=await Promise.allSettled(correctionFirst?[correct(),approve()]:[approve(),correct()]);expect(outcomes[correctionFirst?0:1].status).toBe("fulfilled");
 const approval=outcomes[correctionFirst?1:0];expect(approval.status).toBe(correctionFirst?"rejected":"fulfilled");
 expect((await db.select().from(schema.readingReviews))[0].state).toBe(correctionFirst?"PENDING":"APPROVED");
 expect((await review.openReadingReview(db,a,orderId,unitId)).outdated).toBe(true);await expect(review.getApprovedReadingForDocument(db,a,orderId,unitId)).rejects.toThrow();
});
it.each(["canceled","refund","unpaid","source","allocation"])("new review operations reject persisted %s hold but preserve initialized history",async hold=>{
 const review=await import("../src/modules/review/service"),{result}=await prepare(),orderId=result.context.orderId;const initial=await review.openReadingReview(db,a,orderId,unitId,true);
 if(hold==="source")await db.update(schema.units).set({sourceChanged:true}).where(eq(schema.units.id,unitId));
 else if(hold==="allocation")await db.update(schema.units).set({issues:["quantity_context"]}).where(eq(schema.units.id,unitId));
 else await db.update(schema.orders).set(hold==="canceled"?{canceled:true}:hold==="refund"?{refund:"full"}:{paid:false}).where(eq(schema.orders.id,orderId));
 expect((await review.openReadingReview(db,a,orderId,unitId)).outdated).toBe(true);
 await expect(review.saveReadingReviewDraft(db,a,orderId,unitId,0,initial.draft!.content)).rejects.toMatchObject({kind:"STALE"});await expect(review.approveReadingReview(db,a,orderId,unitId,0)).rejects.toMatchObject({kind:"STALE"});
});
it("superseding in-flight generation blocks older approval without rebinding history",async()=>{
 const review=await import("../src/modules/review/service"),{result}=await prepare(),orderId=result.context.orderId;await review.openReadingReview(db,a,orderId,unitId);
 await db.insert(schema.generations).values({...result,id:randomUUID(),status:"PROCESSING",result:null,completedAt:null,createdAt:new Date(result.createdAt.getTime()+1000)});
 await expect(review.approveReadingReview(db,a,orderId,unitId,null)).rejects.toMatchObject({kind:"STALE"});expect((await review.openReadingReview(db,a,orderId,unitId)).outdated).toBe(true);expect((await db.select().from(schema.readingReviews))[0].generationId).toBe(result.id);
});
