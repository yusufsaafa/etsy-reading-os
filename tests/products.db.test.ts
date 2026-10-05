import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { authorizeStore, createWorkspace } from "../src/modules/identity/service";
import { ingestListing, ingestOrder, workspaceData, correctInput, configureMapping, tenantWhere } from "../src/modules/intake/service";
import { fixtureListings, fixtureOrders } from "../src/modules/etsy/fixtures";
import { beginListingDraft, editProduct, productData, catalogData, saveProductDraft, activateProduct } from "../src/modules/products/service";
import { completeProductOnboarding } from "../src/modules/onboarding/service";
import { resolveSellerDestination } from "../src/modules/onboarding/destination";
import { connectFixtures } from "../src/modules/etsy/connection-service";
import type { Scope, ExternalOrder } from "../src/modules/intake/contracts";
import type { Configuration } from "../src/modules/products/contracts";
let pg:PGlite,db:Database,a:Scope,b:Scope;
const valid=():Configuration=>({inputs:[{id:"recipient",key:"recipient",label:"Recipient",type:"TEXT",required:true,helpText:"Recipient's name",sortOrder:0},{id:"message",key:"message",label:"Message",type:"LONG_TEXT",required:false,helpText:"",sortOrder:1},{id:"date",key:"date",label:"Date",type:"DATE",required:false,helpText:"",sortOrder:2}],sections:[{id:"intro",title:"Introduction",instruction:"Welcome the recipient.",sortOrder:0},{id:"closing",title:"Closing message",instruction:"Offer a thoughtful ending.",sortOrder:1}],output:"TEXT",workflow:"ASSISTED"});
const receipt=(id:string,listing="101",answers:ExternalOrder["lines"][number]["answers"]=[])=>({...fixtureOrders[0],externalId:id,lines:[{...fixtureOrders[0].lines[0],externalId:id+"1",listingId:listing,answers}]});
beforeEach(async()=>{
 vi.stubEnv("ETSY_ADAPTER","fixtures");
 pg=new PGlite();for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;
 for(const userId of ["a","b"])await db.insert(schema.users).values({id:userId,name:userId});
 a=await authorizeStore(db,"a",await createWorkspace(db,"a","Studio A","fixtures","etsy"));b=await authorizeStore(db,"b",await createWorkspace(db,"b","Studio B","fixtures"));
 await db.update(schema.stores).set({onboardingStage:"product_setup"}).where(eq(schema.stores.id,a.storeId));
 await connectFixtures(db,a);for(const listing of fixtureListings)await ingestListing(db,a,listing);
 await db.insert(schema.listingSelections).values(["101","102","103"].map(listingExternalId=>({organizationId:a.organizationId,storeId:a.storeId,listingExternalId,selectedBy:a.userId})));
},20000);
afterEach(async()=>{vi.unstubAllEnvs();await pg.close();});
async function draft(listing="101",variant="default"){const id=await beginListingDraft(db,a,listing,variant);const data=await productData(db,a,id);return {id,version:data.draft!};}
async function publish(listing="101",config=valid(),variant="default"){const d=await draft(listing,variant);await activateProduct(db,a,d.id,d.version.id,d.version.revision,{name:"Personalized message",configuration:config});return d;}
it("products and catalog are store-owned; forged scopes and cross-tenant access fail",async()=>{
 const d=await draft();expect((await productData(db,a,d.id)).product.storeId).toBe(a.storeId);expect((await catalogData(db,b)).products).toHaveLength(0);
 await expect(productData(db,b,d.id)).rejects.toThrow();await expect(productData(db,{...a,userId:b.userId},d.id)).rejects.toThrow();await expect(editProduct(db,b,d.id)).rejects.toThrow();await expect(activateProduct(db,b,d.id,d.version.id,0)).rejects.toThrow();
 await expect(db.insert(schema.mappings).values({organizationId:b.organizationId,storeId:b.storeId,listingExternalId:"101",variantKey:"default",label:"forged",productId:d.id,required:[]})).rejects.toThrow();
});
it("selected listing creates one incomplete draft; save and creation replay remain unique",async()=>{
 const d=await draft();expect(await beginListingDraft(db,a,"101")).toBe(d.id);const payload={name:"",configuration:{inputs:[],sections:[],output:null,workflow:"ASSISTED"}};
 const saved=await saveProductDraft(db,a,d.id,d.version.id,0,payload);await saveProductDraft(db,a,d.id,d.version.id,0,payload);
 const reloaded=await productData(db,a,d.id);expect(reloaded.versions).toHaveLength(1);expect(reloaded.draft?.configuration.sections).toEqual([]);expect(reloaded.draft?.revision).toBe(saved.revision);expect(reloaded.product.activeVersionId).toBeNull();
 await expect(activateProduct(db,a,d.id,d.version.id,saved.revision)).rejects.toThrow();expect((await productData(db,a,d.id)).draft?.status).toBe("DRAFT");
});
it("unselected or inactive listings and unknown variants cannot create onboarding products",async()=>{
 await db.delete(schema.listingSelections).where(eq(schema.listingSelections.listingExternalId,"101"));await expect(draft()).rejects.toThrow("SELECT_PRODUCT_FIRST");
 await expect(draft("102","unknown")).rejects.toThrow("VARIANT_UNAVAILABLE");await ingestListing(db,a,{...fixtureListings[2],state:"inactive",updatedAt:fixtureListings[2].updatedAt+1});await expect(draft("103")).rejects.toThrow("PRODUCT_UNAVAILABLE");
});
it("server activation rejects duplicate keys, invalid sections, missing output and automatic workflow",async()=>{
 const d=await draft();const cases=[{...valid(),inputs:[valid().inputs[0],{...valid().inputs[1],key:"recipient"}]},{...valid(),sections:[]},{...valid(),sections:[{...valid().sections[0],sortOrder:2}]},{...valid(),output:null},{...valid(),workflow:"AUTOMATIC" as const}];
 for(const configuration of cases)await expect(activateProduct(db,a,d.id,d.version.id,0,{name:"Generic product",configuration})).rejects.toThrow();
 const data=await productData(db,a,d.id);expect(data.product.activeVersionId).toBeNull();expect(data.draft?.configuration.output).toBeNull();expect(data.bindings).toHaveLength(1);
});
it("valid activation is transactional and replay creates no extra versions, mappings or audits",async()=>{
 const d=await publish();await activateProduct(db,a,d.id,d.version.id,0);const data=await productData(db,a,d.id);expect(data.active?.id).toBe(d.version.id);expect(data.versions).toHaveLength(1);expect(data.bindings).toHaveLength(1);
 expect((await db.select().from(schema.auditLogs).where(tenantWhere(schema.auditLogs,a))).filter(e=>e.action==="product_version_activated")).toHaveLength(1);
 await expect(db.update(schema.productVersions).set({configuration:{...valid(),output:"PDF"}}).where(eq(schema.productVersions.id,d.version.id))).rejects.toThrow();
 await expect(db.delete(schema.productVersions).where(eq(schema.productVersions.id,d.version.id))).rejects.toThrow();
});
it("editing creates a single cloned draft and invalid activation leaves old production intact",async()=>{
 const d=await publish();const editId=await editProduct(db,a,d.id);expect(await editProduct(db,a,d.id)).toBe(editId);
 expect((await productData(db,a,d.id)).draft?.configuration).toEqual(valid());await expect(activateProduct(db,a,d.id,editId,0,{name:"",configuration:{...valid(),sections:[]}})).rejects.toThrow();
 const data=await productData(db,a,d.id);expect(data.active?.id).toBe(d.version.id);expect(data.draft?.id).toBe(editId);expect(data.active?.status).toBe("ACTIVE");
 const saved=await saveProductDraft(db,a,d.id,editId,0,{name:"Draft name",configuration:{...valid(),output:"PDF"}});await expect(saveProductDraft(db,a,d.id,editId,0,{name:"Other",configuration:valid()})).rejects.toThrow("STALE_PRODUCT_DRAFT");expect(saved.revision).toBe(1);
});
it("historical readings keep v1 after v2 activation and replay; new readings use v2",async()=>{
 const d=await publish();const answers=[{label:"Recipient",value:"Sam",kind:"text" as const}];const old=receipt("4001","101",answers);await ingestOrder(db,a,old);
 const editId=await editProduct(db,a,d.id);const v2={...valid(),inputs:[...valid().inputs,{id:"occasion",key:"occasion",label:"Occasion",type:"TEXT" as const,required:true,helpText:"",sortOrder:3}]};await activateProduct(db,a,d.id,editId,0,{name:"Personalized message",configuration:v2});
 await ingestOrder(db,a,old);await ingestOrder(db,a,receipt("4002","101",answers));const data=await workspaceData(db,a);const oldOrder=data.orders.find(o=>o.externalId==="4001")!,newOrder=data.orders.find(o=>o.externalId==="4002")!;
 const oldUnit=data.units.find(u=>data.lines.some(l=>l.id===u.lineItemId&&l.orderId===oldOrder.id))!,newUnit=data.units.find(u=>data.lines.some(l=>l.id===u.lineItemId&&l.orderId===newOrder.id))!;
 expect(oldUnit.productVersionId).toBe(d.version.id);expect(oldUnit.issues).toEqual([]);expect(newUnit.productVersionId).toBe(editId);expect(newUnit.issues).toContain("missing_input");expect((await productData(db,a,d.id)).versions.map(v=>v.status)).toEqual(["ACTIVE","ARCHIVED"]);
 await expect(db.update(schema.units).set({productVersionId:editId}).where(eq(schema.units.id,oldUnit.id))).rejects.toThrow();
});
it("generic required inputs determine readiness; missing optional fields do not block; dates are deterministic",async()=>{
 await publish();await ingestOrder(db,a,receipt("4101"));let data=await workspaceData(db,a);const unit=data.units[0];expect(unit.issues).toContain("missing_input");
 await correctInput(db,a,unit.id,0,[{label:"recipient",value:"Çağla 山田 مرحباً",kind:"text"}],false);data=await workspaceData(db,a);expect(data.units[0].issues).toEqual([]);
 await correctInput(db,a,unit.id,1,[{label:"Recipient",value:"Sam",kind:"text"},{label:"Date",value:"2026-02-30",kind:"text"}],false);expect((await workspaceData(db,a)).units[0].issues).toContain("unusable_input");
 await correctInput(db,a,unit.id,2,[{label:"Recipient",value:"Sam",kind:"text"},{label:"Date",value:"2024-02-29",kind:"text"}],false);expect((await workspaceData(db,a)).units[0].issues).toEqual([]);
});
it("mixed cart and quantity expansion bind independently; rollback and replay remain idempotent",async()=>{
 const first=await publish("101"),second=await publish("102");await expect(ingestOrder(db,a,fixtureOrders[1],{failAfterLines:1})).rejects.toThrow("TEST_PARTIAL_FAILURE");expect((await workspaceData(db,a)).units).toHaveLength(0);
 await ingestOrder(db,a,fixtureOrders[1]);await ingestOrder(db,a,fixtureOrders[1]);const data=await workspaceData(db,a);expect(data.orders).toHaveLength(1);expect(data.lines).toHaveLength(2);expect(data.units).toHaveLength(3);
 expect(data.units.filter(u=>u.productVersionId===first.version.id)).toHaveLength(2);expect(data.units.filter(u=>u.productVersionId===second.version.id)).toHaveLength(1);
 for(const unit of data.units)await correctInput(db,a,unit.id,0,[{label:"Recipient",value:"Distinct recipient "+unit.unitIndex,kind:"text"}],true);expect((await workspaceData(db,a)).units.every(u=>!u.issues.length)).toBe(true);
});
it("quantity three creates exactly three independently pinned readings",async()=>{
 const d=await publish("103");await ingestOrder(db,a,fixtureOrders[5]);await ingestOrder(db,a,fixtureOrders[5]);const data=await workspaceData(db,a);expect(data.units.map(u=>u.unitIndex).sort()).toEqual([1,2,3]);expect(data.units.every(u=>u.productVersionId===d.version.id)).toBe(true);
});
it("variants resolve exact configurations; identical SKU never selects a default fallback",async()=>{
 await ingestOrder(db,a,fixtureOrders[3]);const standard=await publish("103"),variant=await publish("103",{...valid(),output:"PDF"},"500:600");
 const order={...fixtureOrders[3],externalId:"4201",lines:[{...fixtureOrders[3].lines[0],externalId:"42011",sku:"SHARED"}]};await ingestOrder(db,a,order);await ingestOrder(db,a,{...order,externalId:"4202",lines:[{...order.lines[0],externalId:"42021",variantKey:"default"}]});await ingestOrder(db,a,{...order,externalId:"4203",lines:[{...order.lines[0],externalId:"42031",variantKey:"500:999"}]});
 const data=await workspaceData(db,a);expect(data.units.filter(u=>u.productVersionId===variant.version.id)).toHaveLength(1);expect(data.units.filter(u=>u.productVersionId===standard.version.id)).toHaveLength(1);expect(data.units.filter(u=>u.issues.includes("unmapped_listing"))).toHaveLength(2);
});
it("an unresolved historical reading is not silently rebound after configuration",async()=>{
 const order=receipt("4301");await ingestOrder(db,a,order);await publish();await ingestOrder(db,a,order);const unit=(await workspaceData(db,a)).units[0];expect(unit.productVersionId).toBeNull();expect(unit.configurationState).toBe("unconfigured");expect(unit.issues).toContain("unmapped_listing");
});
it("one selected active product completes onboarding; others remain unconfigured; replay is safe",async()=>{
 await expect(completeProductOnboarding(db,a)).rejects.toThrow("ACTIVATE_ONE_SELECTED_PRODUCT");expect((await resolveSellerDestination(db,a.userId)).kind).toBe("PRODUCT_SETUP");await publish();await completeProductOnboarding(db,a);await completeProductOnboarding(db,a);
 expect((await resolveSellerDestination(db,a.userId)).kind).toBe("OPERATIONS_HOME");const data=await catalogData(db,a);expect(data.selections).toHaveLength(3);expect(data.products).toHaveLength(1);expect(data.mappings).toHaveLength(1);await expect(completeProductOnboarding(db,{...a,userId:b.userId})).rejects.toThrow();
 expect((await db.select().from(schema.auditLogs).where(tenantWhere(schema.auditLogs,a))).filter(e=>e.action==="product_onboarding_completed")).toHaveLength(1);
});
it("section ordering is deterministic after persistence and input identities remain generic",async()=>{
 const d=await draft();const c={...valid(),sections:[valid().sections[1],valid().sections[0]]};const saved=await saveProductDraft(db,a,d.id,d.version.id,0,{name:"Personalized letter",configuration:c});expect(saved.configuration.sections.map(s=>s.title)).toEqual(["Introduction","Closing message"]);await activateProduct(db,a,d.id,d.version.id,saved.revision);expect((await productData(db,a,d.id)).active?.configuration.inputs[0].key).toBe("recipient");
});
it("database guards reject cross-tenant version ownership and invalid active pointers",async()=>{
 const d=await publish();await expect(db.insert(schema.productVersions).values({organizationId:b.organizationId,storeId:b.storeId,productId:d.id,versionNumber:2,configuration:valid()})).rejects.toThrow();
 const other=await draft("102");await expect(db.update(schema.products).set({status:"active",activeVersionId:d.version.id}).where(eq(schema.products.id,other.id))).rejects.toThrow();
 await expect(db.update(schema.productVersions).set({status:"ARCHIVED"}).where(eq(schema.productVersions.id,d.version.id))).rejects.toThrow();
 await expect(db.insert(schema.productVersions).values({organizationId:a.organizationId,storeId:a.storeId,productId:other.id,versionNumber:2,status:"ACTIVE",activatedAt:new Date(),configuration:valid()})).rejects.toThrow();
 expect((await productData(db,a,d.id)).active?.status).toBe("ACTIVE");
});

it("legacy intake remains usable without pretending old mappings are configured products",async()=>{
 await configureMapping(db,a,"101","default",false);await ingestOrder(db,a,fixtureOrders[0]);let data=await workspaceData(db,a);expect(data.units[0].configurationState).toBe("legacy");expect(data.units[0].issues).toEqual([]);expect((await catalogData(db,a)).products).toHaveLength(0);
 await publish();await ingestOrder(db,a,fixtureOrders[0]);data=await workspaceData(db,a);expect(data.units[0].productVersionId).toBeNull();expect(data.units[0].issues).toEqual([]);
 await ingestOrder(db,a,{...fixtureOrders[0],externalId:"4901",lines:[{...fixtureOrders[0].lines[0],externalId:"49011"}]});expect((await workspaceData(db,a)).units.some(u=>u.configurationState==="versioned"&&u.issues.includes("missing_input"))).toBe(true);
});
it("database disallows two active versions and publishes no partial pointer after rejection",async()=>{
 const d=await publish(),v2=await editProduct(db,a,d.id);
 await expect(db.transaction(async tx=>{await tx.update(schema.productVersions).set({status:"ACTIVE",activatedAt:new Date()}).where(eq(schema.productVersions.id,v2));await tx.update(schema.products).set({activeVersionId:v2}).where(eq(schema.products.id,d.id));})).rejects.toThrow();
 const data=await productData(db,a,d.id);expect(data.active?.id).toBe(d.version.id);expect(data.draft?.id).toBe(v2);expect(data.versions.filter(v=>v.status==="ACTIVE")).toHaveLength(1);
});
