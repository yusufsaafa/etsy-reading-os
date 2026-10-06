import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync,readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { authorizeStore,createWorkspace } from "../src/modules/identity/service";
import { ingestListing,ingestOrder,correctInput,workspaceData,tenantWhere,configureMapping } from "../src/modules/intake/service";
import { fixtureListings,fixtureOrders } from "../src/modules/etsy/fixtures";
import { beginListingDraft,activateProduct,editProduct,productData } from "../src/modules/products/service";
import { saveSellerProfile,editStyle,applyStyle } from "../src/modules/seller-style/service";
import { admitReading,reconcileProduction,readQueueItem } from "../src/modules/production/service";
import { productionPolicy,configurationSchema } from "../src/modules/products/contracts";
import type { Scope,ExternalOrder } from "../src/modules/intake/contracts";
import type { Configuration } from "../src/modules/products/contracts";
let pg:PGlite,db:Database,a:Scope,b:Scope,unitId:string,productId:string,versionId:string,styleId:string;
const configuration:Configuration={inputs:[{id:"name",key:"name",label:"Name",type:"TEXT",required:true,helpText:"",sortOrder:0}],
 sections:[{id:"intro",title:"Introduction",instruction:"Welcome the recipient",sortOrder:0},{id:"guidance",title:"Guidance",instruction:"Give useful guidance",sortOrder:1}],output:"TEXT",workflow:"ASSISTED"};
const style={tone:"WARM" as const,detail:"DETAILED" as const,approach:"CONVERSATIONAL" as const,preferredExpressions:[],avoidExpressions:[],instructions:"Use clear language"};
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

async function clearWaiting(){await db.delete(schema.productionQueue);}
async function receipt(id:string, config:Configuration=configuration,listing="101",quantity=1,answers:ExternalOrder["lines"][number]["answers"]=[{label:"Name",value:"Synthetic recipient",kind:"text"}]) {
  if(config!==configuration){const draft=await editProduct(db,a,productId);await activateProduct(db,a,productId,draft,0,{name:"Personalized guidance",configuration:config});}
  await ingestOrder(db,a,{...fixtureOrders[0],externalId:id,lines:[{...fixtureOrders[0].lines[0],externalId:id+"1",listingId:listing,quantity,answers}]});
  const data=await workspaceData(db,a),order=data.orders.find(o=>o.externalId===id)!;
  return data.units.filter(u=>data.lines.some(l=>l.id===u.lineItemId&&l.orderId===order.id));
}
it("existing Assisted version automatically queues without creating generation or making any external call",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch");
 const rows=await db.select().from(schema.productionQueue);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({unitId,productVersionId:versionId,state:"QUEUED",priorityClass:"STANDARD",targetCompletionMinutes:null,targetDeadline:null});
 await reconcileProduction(db,a);expect(fetch).not.toHaveBeenCalled();expect(await db.select().from(schema.generations)).toHaveLength(0);expect(await db.select().from(schema.aiRequests)).toHaveLength(0);expect(await db.select().from(schema.usageEvents)).toHaveLength(0);
});
it("existing Manual remains manual and policy edits preserve historical bound production",async()=>{
 const manual=await receipt("9100",{...configuration,workflow:"MANUAL"});expect((await admitReading(db,a,manual[0].id)).outcome).toBe("manual");
 await receipt("9101",{...configuration,fulfillment:{priorityClass:"EXPRESS",targetCompletionMinutes:60}});
 expect((await admitReading(db,a,manual[0].id)).outcome).toBe("manual");
 const original=await readQueueItem(db,a,(await db.select().from(schema.productionQueue))[0].id);expect(original.productVersionId).toBe(versionId);expect(original.priorityClass).toBe("STANDARD");
 const old=(await db.select().from(schema.productVersions)).find(v=>v.id===manual[0].productVersionId)!;expect(old.configuration.workflow).toBe("MANUAL");
});
it("fulfillment policy is validated and deadline derives from purchase rather than scan time",async()=>{
 const [unit]=await receipt("9110",{...configuration,fulfillment:{priorityClass:"EXPRESS",targetCompletionMinutes:45}});
 const row=(await db.select().from(schema.productionQueue)).find(q=>q.unitId===unit.id)!;
 expect(row.priorityClass).toBe("EXPRESS");expect(row.targetDeadline?.getTime()).toBe(fixtureOrders[0].createdAt*1000+45*60000);
 expect(productionPolicy(configuration)).toEqual({automation:"ASSISTED",priorityClass:"STANDARD",targetCompletionMinutes:null});
 for(const minutes of [0,-1,1.5,525601])expect(configurationSchema.safeParse({...configuration,fulfillment:{priorityClass:"EXPRESS",targetCompletionMinutes:minutes}}).success).toBe(false);
});
it("missing customer information does not queue; correction automatically admits exactly once",async()=>{
 const [unit]=await receipt("9120",configuration,"101",1,[]);expect((await admitReading(db,a,unit.id)).outcome).toBe("ineligible");
 await correctInput(db,a,unit.id,0,[{label:"Name",value:"Completed",kind:"text"}],false);expect((await admitReading(db,a,unit.id)).outcome).toBe("already_queued");
 expect((await db.select().from(schema.productionQueue)).filter(q=>q.unitId===unit.id)).toHaveLength(1);
});
it.each(["seller","style"])("missing %s setup prevents admission and completing setup auto-admits",async missing=>{
 await clearWaiting();
 if(missing==="seller")await db.delete(schema.sellerProfiles);else await db.transaction(async tx=>{await tx.update(schema.styleVersions).set({status:"ARCHIVED"}).where(eq(schema.styleVersions.id,styleId));await tx.update(schema.styleProfiles).set({activeVersionId:null});});
 expect((await admitReading(db,a,unitId)).outcome).toBe("ineligible");
 if(missing==="seller")await saveSellerProfile(db,a,{displayName:"Restored",shortBio:""});else {const d=await editStyle(db,a);await applyStyle(db,a,d.id,d.revision,style);}
 expect(await db.select().from(schema.productionQueue)).toHaveLength(1);
});
it("operational holds prevent queueing; lifting pause automatically admits",async()=>{
 await clearWaiting();await configureMapping(db,a,"101","default",true);expect((await admitReading(db,a,unitId)).outcome).toBe("ineligible");
 await configureMapping(db,a,"101","default",false);expect(await db.select().from(schema.productionQueue)).toHaveLength(1);
});
it("invalid bound product and unresolved product never queue",async()=>{
 await clearWaiting();await pg.exec("ALTER TABLE product_versions DISABLE TRIGGER immutable_published_version");await db.update(schema.productVersions).set({configuration:{...configuration,sections:[]}}).where(eq(schema.productVersions.id,versionId));
 expect((await admitReading(db,a,unitId)).outcome).toBe("ineligible");const [unconfigured]=await receipt("9130",configuration,"103");expect((await admitReading(db,a,unconfigured.id)).outcome).toBe("ineligible");expect(await db.select().from(schema.productionQueue)).toHaveLength(0);
});
it("any existing generation including success prevents a new automatic admission",async()=>{
 await clearWaiting();const {buildGenerationContext}=await import("../src/modules/generation/context");const {createHash}=await import("node:crypto");const {stableJson}=await import("../src/modules/intake/contracts");
 const context=await db.transaction(tx=>buildGenerationContext(tx,a,unitId));
 await db.insert(schema.generations).values({organizationId:a.organizationId,storeId:a.storeId,unitId,productVersionId:versionId,styleVersionId:styleId,sellerProfileId:context.seller.id,customerRevision:0,context,contextHash:createHash("sha256").update(stableJson(context)).digest("hex"),status:"SUCCEEDED",result:{sections:configuration.sections.map(s=>({sectionId:s.id,title:s.title,content:"Existing content"}))},completedAt:new Date()});
 expect((await admitReading(db,a,unitId)).outcome).toBe("ineligible");expect(await db.select().from(schema.productionQueue)).toHaveLength(0);
});
it("duplicate and concurrent admission converge with a single meaningful audit",async()=>{
 await clearWaiting();const count=(await db.select().from(schema.auditLogs)).length;
 const results=await Promise.all(Array.from({length:6},()=>admitReading(db,a,unitId)));expect(results.filter(r=>r.outcome==="queued")).toHaveLength(1);
 expect(new Set(results.map(r=>r.item?.id)).size).toBe(1);expect(await db.select().from(schema.productionQueue)).toHaveLength(1);
 expect((await db.select().from(schema.auditLogs)).length).toBe(count+1);
 await admitReading(db,a,unitId);expect((await db.select().from(schema.auditLogs)).length).toBe(count+1);
});
it("reconciliation finds missed eligible work and is replay-safe",async()=>{
 await clearWaiting();expect(await reconcileProduction(db,a)).toEqual({scanned:1,queued:1});expect(await reconcileProduction(db,a)).toEqual({scanned:1,queued:0});
});
it("mixed cart and quantity remain independent queue targets after recipient allocation and replay",async()=>{
 const id=await beginListingDraft(db,a,"102"),data=await productData(db,a,id);await activateProduct(db,a,id,data.draft!.id,0,{name:"Second product",configuration});
 await ingestOrder(db,a,fixtureOrders[1]);const data1=await workspaceData(db,a),order=data1.orders.find(o=>o.externalId==="2002")!;
 const purchased=data1.units.filter(u=>data1.lines.some(l=>l.id===u.lineItemId&&l.orderId===order.id));expect(purchased).toHaveLength(3);
 for(const unit of purchased)await correctInput(db,a,unit.id,0,[{label:"Name",value:"Recipient "+unit.id,kind:"text"}],true);
 await ingestOrder(db,a,fixtureOrders[1]);await reconcileProduction(db,a);
 const queued=(await db.select().from(schema.productionQueue)).filter(q=>purchased.some(u=>u.id===q.unitId));expect(queued).toHaveLength(3);expect(new Set(queued.map(q=>q.productVersionId)).size).toBe(2);
});
it("tenant reads/mutations and database ownership/policy forgery fail",async()=>{
 const row=(await db.select().from(schema.productionQueue))[0];await expect(readQueueItem(db,b,row.id)).rejects.toThrow();await expect(admitReading(db,b,unitId)).rejects.toThrow();await expect(reconcileProduction(db,{...a,userId:b.userId})).rejects.toThrow();
 await expect(db.insert(schema.productionQueue).values({...row,id:undefined,organizationId:b.organizationId,storeId:b.storeId})).rejects.toThrow();
 await expect(db.update(schema.productionQueue).set({priorityClass:"EXPRESS"}).where(eq(schema.productionQueue.id,row.id))).rejects.toThrow();
 const another=await editProduct(db,a,productId);await expect(db.update(schema.productionQueue).set({productVersionId:another}).where(eq(schema.productionQueue.id,row.id))).rejects.toThrow();
});
it("admission failure rolls back intake rather than losing the automatic work atomically",async()=>{
 await pg.exec("CREATE FUNCTION fail_queue_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ADMISSION_FAILURE'; END $$; CREATE TRIGGER fail_queue BEFORE INSERT ON production_queue FOR EACH ROW EXECUTE FUNCTION fail_queue_admission();");
 await expect(receipt("9190")).rejects.toThrow();expect((await workspaceData(db,a)).orders.some(o=>o.externalId==="9190")).toBe(false);
});

it("additive queue migration preserves existing rows and performs no migration-time admission",async()=>{
 const acceptance=new PGlite(),legacy=drizzle(acceptance,{schema}) as unknown as Database;
 try {
   for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")&&f<"0006").sort())await acceptance.exec(readFileSync("drizzle/"+file,"utf8"));
   // Pre-admission schema fixture: construct a retained historical reading directly.
   await legacy.insert(schema.users).values({id:"legacy-owner",name:"Legacy seller"});
   const scope=await authorizeStore(legacy,"legacy-owner",await createWorkspace(legacy,"legacy-owner","Retained Store","fixtures"));
   await ingestListing(legacy,scope,fixtureListings[0]);await legacy.insert(schema.listingSelections).values({organizationId:scope.organizationId,storeId:scope.storeId,listingExternalId:"101",selectedBy:scope.userId});
   const id=await beginListingDraft(legacy,scope,"101"),data=await productData(legacy,scope,id);const version=await activateProduct(legacy,scope,id,data.draft!.id,0,{name:"Retained product",configuration});
   const [order]=await legacy.insert(schema.orders).values({organizationId:scope.organizationId,storeId:scope.storeId,externalId:"7000",createdAt:new Date(fixtureOrders[0].createdAt*1000),buyerName:"Synthetic",paid:true,canceled:false,refund:"none",sourceUpdatedAt:fixtureOrders[0].updatedAt,purchasedSnapshot:fixtureOrders[0],latestSnapshot:fixtureOrders[0]}).returning();
   const lineData=fixtureOrders[0].lines[0];const [line]=await legacy.insert(schema.lineItems).values({organizationId:scope.organizationId,storeId:scope.storeId,orderId:order.id,externalId:"7001",listingExternalId:"101",title:lineData.title,quantity:1,sku:null,variantKey:"default",snapshot:lineData}).returning();
   await legacy.insert(schema.units).values({organizationId:scope.organizationId,storeId:scope.storeId,lineItemId:line.id,unitIndex:1,productVersionId:version,configurationState:"versioned",issues:[]});
   const before={units:await legacy.select().from(schema.units),versions:await legacy.select().from(schema.productVersions),orders:await legacy.select().from(schema.orders)};
   await acceptance.exec(readFileSync("drizzle/0006_small_rattler.sql","utf8"));
   expect(await legacy.select().from(schema.units)).toEqual(before.units);expect(await legacy.select().from(schema.productVersions)).toEqual(before.versions);expect(await legacy.select().from(schema.orders)).toEqual(before.orders);expect(await legacy.select().from(schema.productionQueue)).toHaveLength(0);expect(await legacy.select().from(schema.generations)).toHaveLength(0);
 } finally {await acceptance.close();}
});
it("authorized intake operator can admit waiting work without receiving paid-command permission",async()=>{
 await db.insert(schema.users).values({id:"operator",name:"Operator"});await db.insert(schema.memberships).values({organizationId:a.organizationId,userId:"operator",role:"operator"});
 const scope=await authorizeStore(db,"operator",a.storeId);await clearWaiting();await correctInput(db,scope,unitId,0,[{label:"Name",value:"Updated",kind:"text"}],false);
 expect(await db.select().from(schema.productionQueue)).toHaveLength(1);await expect(admitReading(db,scope,unitId)).rejects.toThrow();
});
