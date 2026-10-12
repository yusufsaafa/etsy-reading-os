import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import {eq} from "drizzle-orm";
import type {Database} from "../src/db/client";
import * as schema from "../src/db/schema";
import {authorizeStore,createWorkspace} from "../src/modules/identity/service";
import {ingestListing,ingestOrder,workspaceData,correctInput} from "../src/modules/intake/service";
import {beginEtsyProductDraft,productData,activateProduct,editProduct} from "../src/modules/products/service";
import {assignReadingConfiguration,readingRecoveryData} from "../src/modules/orders/assignment";
import {buildGenerationContext} from "../src/modules/generation/context";
import {normalizeEtsyReceipt} from "../src/modules/etsy/raw-normalizer";
import {selectionKey,type EtsyProductPolicy} from "../src/modules/etsy/source-contract";
import {fixtureListings} from "../src/modules/etsy/fixtures";
import {policy} from "./fixtures/etsy-source";
import {rawReceipt} from "./fixtures/etsy-raw";
import type {Scope} from "../src/modules/intake/contracts";
import type {Configuration} from "../src/modules/products/contracts";
let pg:PGlite,db:Database,a:Scope,b:Scope,unitId:string,versionId:string,productId:string;
const config=(p=policy()):Configuration=>({etsyFulfillment:p,inputs:[{id:"question",key:"question",label:"Context",type:"LONG_TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"body",title:"Reading",instruction:"",sortOrder:0}],output:"PDF",workflow:"ASSISTED"});
async function capture(quantity=1){
 const r=rawReceipt();r.transactions[0].quantity=quantity;Object.assign(r.transactions[0],{title:"Original purchased title"});
 const source=normalizeEtsyReceipt(JSON.stringify(r),{verifiedShopId:"77",observedAt:1700000020})[0];
 await ingestOrder(db,a,{externalId:"900",buyerName:"",createdAt:1700000000,updatedAt:1700000010,paid:true,canceled:false,refund:"none",lines:[{externalId:"901",listingId:"101",title:"Original purchased title",quantity,sku:"EXAMPLE",variantKey:selectionKey(policy().purchaseSelections),variations:[],answers:[],digital:false,etsySource:source}]},{suppressProductionAdmission:true});
 return (await workspaceData(db,a)).units[0].id;
}
async function publish(p=policy(),scope=a){const product=await beginEtsyProductDraft(db,scope,p),draft=(await productData(db,scope,product)).draft!.id;await activateProduct(db,scope,product,draft,0,{name:"Approved reading",configuration:config(p)});return {product,version:draft};}
const command=(changes:Record<string,unknown>={})=>({unitId,versionId,commandId:randomUUID(),expectedRevision:0,confirmed:true,...changes});
async function noAI(){for(const table of [schema.productionQueue,schema.generations,schema.aiRequests,schema.usageEvents,schema.documentSnapshots,schema.documentArtifacts])expect(await db.select().from(table)).toHaveLength(0);}
async function rawDecision(v=versionId){const d=await workspaceData(db,a);return {organizationId:a.organizationId,storeId:a.storeId,unitId,productVersionId:v,actorId:a.userId,commandId:randomUUID(),expectedRevision:d.units.find(u=>u.id===unitId)!.revision,sourceEvidence:d.lines[0].snapshot.etsySource!};}
beforeEach(async()=>{
 vi.stubEnv("ETSY_ADAPTER","fixtures");pg=new PGlite();for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;
 for(const id of ["a","b"])await db.insert(schema.users).values({id,name:id});a=await authorizeStore(db,"a",await createWorkspace(db,"a","A","fixtures"));b=await authorizeStore(db,"b",await createWorkspace(db,"b","B","fixtures"));
 await db.update(schema.stores).set({externalShopId:"77"}).where(eq(schema.stores.id,a.storeId));await db.update(schema.stores).set({externalShopId:"88"}).where(eq(schema.stores.id,b.storeId));
 for(const scope of [a,b])for(const l of fixtureListings)await ingestListing(db,scope,l);
 unitId=await capture();const p=await publish();versionId=p.version;productId=p.product;
},20000);
afterEach(async()=>{vi.unstubAllEnvs();await pg.close();});
it("explicit first assignment preserves all identities/evidence/input rows and enables existing generation context",async()=>{
 const before=await workspaceData(db,a);await expect(buildGenerationContext(db,a,unitId)).rejects.toMatchObject({code:"PRODUCT_SETUP"});
 expect((await readingRecoveryData(db,a,unitId)).candidates[0]).toMatchObject({id:versionId,historical:true});
 const result=await assignReadingConfiguration(db,a,command());expect(result.kind).toBe("ASSIGNED");const after=await workspaceData(db,a);
 expect(after.orders).toEqual(before.orders);expect(after.lines).toEqual(before.lines);expect(after.inputs).toEqual(before.inputs);
 expect(after.units[0]).toMatchObject({id:unitId,lineItemId:before.units[0].lineItemId,unitIndex:1,revision:0,configurationState:"versioned",productVersionId:versionId,issues:[]});
 const context=await buildGenerationContext(db,a,unitId);expect(context.product.id).toBe(versionId);expect(context.customer).toEqual({revision:0,answers:[{label:"question",value:"Synthetic context",kind:"text"}]});await noAI();
});
it("same-version replay is idempotent even with a new command and after archival",async()=>{
 const c=command();await assignReadingConfiguration(db,a,c);const next=await editProduct(db,a,productId);await activateProduct(db,a,productId,next,0,{name:"New version",configuration:config()});
 expect((await assignReadingConfiguration(db,a,c)).kind).toBe("ALREADY_ASSIGNED");expect((await assignReadingConfiguration(db,a,command())).kind).toBe("ALREADY_ASSIGNED");expect(await db.select().from(schema.readingAssignments)).toHaveLength(1);expect((await buildGenerationContext(db,a,unitId)).product.id).toBe(versionId);await noAI();
});
it("a different second version conflicts and the winning binding is immutable",async()=>{
 await assignReadingConfiguration(db,a,command());const next=await editProduct(db,a,productId);await activateProduct(db,a,productId,next,0,{name:"Next",configuration:config()});await expect(assignReadingConfiguration(db,a,command({versionId:next}))).rejects.toMatchObject({code:"ASSIGNMENT_CONFLICT"});expect((await workspaceData(db,a)).units[0].productVersionId).toBe(versionId);
});
it("cross-tenant unit, version and forged owner scope are rejected",async()=>{
 const other=await publish(policy(),b);await expect(assignReadingConfiguration(db,b,command())).rejects.toThrow();await expect(assignReadingConfiguration(db,{...a,userId:"b"},command())).rejects.toThrow();await expect(assignReadingConfiguration(db,a,command({versionId:other.version}))).rejects.toMatchObject({code:"VERSION_REQUIRED"});await expect(db.insert(schema.readingAssignments).values(await rawDecision(other.version))).rejects.toThrow();expect((await workspaceData(db,a)).units[0].productVersionId).toBeNull();
});
it("wrong Etsy listing is rejected by service and direct SQL decision",async()=>{
 const other=await publish({...policy(),listingId:"102"});await expect(assignReadingConfiguration(db,a,command({versionId:other.version}))).rejects.toMatchObject({code:"LISTING_MISMATCH"});await expect(db.insert(schema.readingAssignments).values(await rawDecision(other.version))).rejects.toThrow();
});
it("wrong purchased variation never falls back through title or SKU",async()=>{
 const p:EtsyProductPolicy={...policy(),purchaseSelections:policy().purchaseSelections.map(s=>s.propertyId==="513"?{...s,valueIds:["99"]}:s)};const other=await publish(p);await expect(assignReadingConfiguration(db,a,command({versionId:other.version}))).rejects.toMatchObject({code:"OPTIONS_MISMATCH"});await expect(db.insert(schema.readingAssignments).values(await rawDecision(other.version))).rejects.toThrow();
});
it("draft ProductVersion cannot be assigned even by direct SQL",async()=>{
 const draft=await editProduct(db,a,productId);await expect(assignReadingConfiguration(db,a,command({versionId:draft}))).rejects.toMatchObject({code:"VERSION_REQUIRED"});await expect(db.insert(schema.readingAssignments).values(await rawDecision(draft))).rejects.toThrow();
});
it("missing historical evidence blocks recovery and cannot be manufactured in the decision",async()=>{
 const d=await workspaceData(db,a),line=d.lines[0],snapshot=structuredClone(line.snapshot);delete snapshot.etsySource;
 await db.update(schema.lineItems).set({snapshot}).where(eq(schema.lineItems.id,line.id));await expect(assignReadingConfiguration(db,a,command())).rejects.toMatchObject({code:"EVIDENCE_REQUIRED"});expect((await readingRecoveryData(db,a,unitId)).reason).toBe("EVIDENCE_REQUIRED");await expect(db.insert(schema.readingAssignments).values({...await rawDecision(),sourceEvidence:line.snapshot.etsySource!})).rejects.toThrow();
});
it("historical recovery requires explicit confirmation; publication never assigns by itself",async()=>{
 expect((await workspaceData(db,a)).units[0].productVersionId).toBeNull();await expect(assignReadingConfiguration(db,a,command({confirmed:false}))).rejects.toThrow();expect(await db.select().from(schema.readingAssignments)).toHaveLength(0);
});
it("saved customer revisions and corrections remain authoritative",async()=>{
 await correctInput(db,a,unitId,0,[{label:"question",value:"Seller corrected context",kind:"text"}],true);const before=await workspaceData(db,a);
 await expect(assignReadingConfiguration(db,a,command())).rejects.toMatchObject({code:"STALE_INFORMATION"});await assignReadingConfiguration(db,a,command({expectedRevision:1}));const after=await workspaceData(db,a);expect(after.inputs).toEqual(before.inputs);expect(after.units[0].revision).toBe(1);expect((await buildGenerationContext(db,a,unitId)).customer.answers[0].value).toBe("Seller corrected context");await noAI();
});
it("quantity-expanded Reading recovery affects only the selected stable index",async()=>{
 // Separate fresh historical receipt with quantity 3, captured with no historical adoption.
 await db.update(schema.stores).set({source:"etsy"}).where(eq(schema.stores.id,a.storeId));
 const r=rawReceipt();r.receipt_id=910;r.transactions[0].receipt_id=910;r.transactions[0].transaction_id=911;r.transactions[0].quantity=3;
 const {syncOrderReceipt}=await import("../src/modules/orders/sync");await db.update(schema.connections).set({status:"connected",encryptedTokens:"synthetic",scopes:["transactions_r"]}).where(eq(schema.connections.storeId,a.storeId));
 const read=async()=>({body:JSON.stringify(r),shopId:"77",epoch:0,evidence:[]});const result=await syncOrderReceipt(db,a,{receiptId:"910",commandId:randomUUID()},read);const before=await workspaceData(db,a),siblings=before.units.filter(u=>before.lines.find(l=>l.id===u.lineItemId)?.orderId===result.orderId);const target=siblings.find(u=>u.unitIndex===2)!;
 await assignReadingConfiguration(db,a,command({unitId:target.id}));const after=await workspaceData(db,a);expect(after.units.map(u=>u.id).sort()).toEqual(before.units.map(u=>u.id).sort());expect(after.units.filter(u=>u.productVersionId===versionId)).toHaveLength(1);expect(after.units.find(u=>u.id===target.id)?.issues).toContain("quantity_context");await syncOrderReceipt(db,a,{receiptId:"910",commandId:randomUUID()},read);expect((await workspaceData(db,a)).units.find(u=>u.id===target.id)?.productVersionId).toBe(versionId);await noAI();
});
it("concurrent same-version confirmations converge on one decision",async()=>{
 const results=await Promise.all([assignReadingConfiguration(db,a,command()),assignReadingConfiguration(db,a,command())]);expect(results.map(r=>r.kind).sort()).toEqual(["ALREADY_ASSIGNED","ASSIGNED"]);expect(await db.select().from(schema.readingAssignments)).toHaveLength(1);await noAI();
});
it("concurrent different published versions produce exactly one winner and deterministic conflict",async()=>{
 const next=await editProduct(db,a,productId);await activateProduct(db,a,productId,next,0,{name:"Next",configuration:config()});const results=await Promise.allSettled([assignReadingConfiguration(db,a,command()),assignReadingConfiguration(db,a,command({versionId:next}))]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);const failed=results.find(r=>r.status==="rejected") as PromiseRejectedResult;expect(failed.reason.code).toBe("ASSIGNMENT_CONFLICT");expect(await db.select().from(schema.readingAssignments)).toHaveLength(1);await noAI();
});
it("raw unit update is forbidden; append-only SQL decision atomically applies only a validated first binding",async()=>{
 await expect(db.update(schema.units).set({productVersionId:versionId,configurationState:"versioned"}).where(eq(schema.units.id,unitId))).rejects.toThrow();await expect(db.update(schema.units).set({configurationState:"legacy"}).where(eq(schema.units.id,unitId))).rejects.toThrow();
 const [decision]=await db.insert(schema.readingAssignments).values(await rawDecision()).returning();expect((await workspaceData(db,a)).units[0].productVersionId).toBe(versionId);
 await expect(db.update(schema.units).set({configurationState:"unconfigured",productVersionId:null}).where(eq(schema.units.id,unitId))).rejects.toThrow();await expect(db.update(schema.readingAssignments).set({expectedRevision:2}).where(eq(schema.readingAssignments.id,decision.id))).rejects.toThrow();await expect(db.delete(schema.readingAssignments).where(eq(schema.readingAssignments.id,decision.id))).rejects.toThrow();await noAI();
});
it("source drift and paused mapping block recovery",async()=>{
 await db.update(schema.units).set({sourceChanged:true}).where(eq(schema.units.id,unitId));await expect(assignReadingConfiguration(db,a,command())).rejects.toMatchObject({code:"PURCHASE_HOLD"});await db.update(schema.units).set({sourceChanged:false}).where(eq(schema.units.id,unitId));await db.update(schema.mappings).set({paused:true}).where(eq(schema.mappings.productId,productId));await expect(assignReadingConfiguration(db,a,command())).rejects.toMatchObject({code:"MAPPING_REQUIRED"});
});
it("missing buyer information remains a generation hold after configuration assignment",async()=>{
 await correctInput(db,a,unitId,0,[],true);await assignReadingConfiguration(db,a,command({expectedRevision:1}));await expect(buildGenerationContext(db,a,unitId)).rejects.toMatchObject({code:"CUSTOMER_INFORMATION"});expect((await workspaceData(db,a)).units[0].issues).toContain("missing_input");await noAI();
});
it("command identity cannot be reused for another assignment",async()=>{
 const c=command();await assignReadingConfiguration(db,a,c);const next=await editProduct(db,a,productId);await activateProduct(db,a,productId,next,0,{name:"Next",configuration:config()});await expect(assignReadingConfiguration(db,a,{...c,versionId:next})).rejects.toMatchObject({code:"COMMAND_CONFLICT"});
});

it("recovered assisted readings stay manual after customer saves and production reconciliation",async()=>{
 await assignReadingConfiguration(db,a,command());
 const {admitReading,reconcileProduction}=await import("../src/modules/production/service");
 expect((await admitReading(db,a,unitId)).outcome).toBe("manual");
 await correctInput(db,a,unitId,0,[{label:"question",value:"Confirmed buyer context",kind:"text"}],true);
 expect((await reconcileProduction(db,a)).queued).toBe(0);
 expect((await buildGenerationContext(db,a,unitId)).customer.answers[0].value).toBe("Confirmed buyer context");await noAI();
});
it("unresolved purchased question identity is rejected by service and database",async()=>{
 const d=await workspaceData(db,a),line=d.lines[0],snapshot=structuredClone(line.snapshot);
 snapshot.etsySource!.buyerInputs[0].questionId={presence:"value",value:"999"};
 await db.update(schema.lineItems).set({snapshot}).where(eq(schema.lineItems.id,line.id));
 await expect(assignReadingConfiguration(db,a,command())).rejects.toMatchObject({code:"INPUT_EVIDENCE_REQUIRED"});
 await expect(db.insert(schema.readingAssignments).values(await rawDecision())).rejects.toThrow();await noAI();
});
it("corroborating purchased product data must agree with exact historical option IDs",async()=>{
 const d=await workspaceData(db,a),line=d.lines[0],snapshot=structuredClone(line.snapshot),selection=snapshot.etsySource!.purchaseSelections[0];
 snapshot.etsySource!.purchaseProductData={presence:"value",value:[{sourceOrder:0,propertyId:{presence:"value",value:selection.propertyId},propertyName:{presence:"absent"},scaleId:{presence:"absent"},scaleName:{presence:"absent"},valueIds:selection.valueIds,values:{presence:"absent"}}]};
 await db.update(schema.lineItems).set({snapshot}).where(eq(schema.lineItems.id,line.id));
 expect((await readingRecoveryData(db,a,unitId)).candidates).toHaveLength(1);
 const wrong=structuredClone(snapshot);if(wrong.etsySource!.purchaseProductData?.presence!=="value")throw new Error("fixture");wrong.etsySource!.purchaseProductData.value[0].valueIds={presence:"value",value:["999"]};
 await db.update(schema.lineItems).set({snapshot:wrong}).where(eq(schema.lineItems.id,line.id));await expect(assignReadingConfiguration(db,a,command())).rejects.toMatchObject({code:"INPUT_EVIDENCE_REQUIRED"});await expect(db.insert(schema.readingAssignments).values(await rawDecision())).rejects.toThrow();
 await db.update(schema.lineItems).set({snapshot}).where(eq(schema.lineItems.id,line.id));await assignReadingConfiguration(db,a,command());await noAI();
});
it("recovered original Etsy answers remain current through review and approved document handoff",async()=>{
 await assignReadingConfiguration(db,a,command());const inputsBefore=await db.select().from(schema.customerInputs);
 const {saveSellerProfile,editStyle,applyStyle}=await import("../src/modules/seller-style/service");
 await saveSellerProfile(db,a,{displayName:"Synthetic seller",shortBio:"Synthetic"});const style=await editStyle(db,a);await applyStyle(db,a,style.id,0,{tone:"WARM",detail:"DETAILED",approach:"CONVERSATIONAL",preferredExpressions:[],avoidExpressions:[],instructions:"Clear"});
 const {CentralAIGateway}=await import("../src/infrastructure/ai/gateway"),{FakeGenerationProvider}=await import("../src/infrastructure/ai/fake"),{pricingFor}=await import("../src/infrastructure/ai/pricing"),{GenerationService}=await import("../src/modules/generation/service");
 const gateway=new CentralAIGateway(db,{provider:new FakeGenerationProvider(),model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n});
 const generated=await new GenerationService(db,gateway).prepare(a,{unitId,commandKey:randomUUID()}),{openReadingReview,approveReadingReview,getApprovedReadingForDocument}=await import("../src/modules/review/service");
 expect(generated.status).toBe("SUCCEEDED");const orderId=generated.context.orderId;
 const view=await openReadingReview(db,a,orderId,unitId);expect(view.outdated).toBe(false);expect(view.details).toContainEqual({label:"Context",value:"Synthetic context"});
 await approveReadingReview(db,a,orderId,unitId,null);expect((await getApprovedReadingForDocument(db,a,orderId,unitId)).readingId).toBe(unitId);
 expect(await db.select().from(schema.customerInputs)).toEqual(inputsBefore);expect(generated.productVersionId).toBe(versionId);
});
