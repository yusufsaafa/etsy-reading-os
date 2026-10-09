import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createWorkspace, authorizeStore } from "../src/modules/identity/service";
import { ingestListing, ingestOrder, correctInput } from "../src/modules/intake/service";
import { beginListingDraft, activateProduct, productData } from "../src/modules/products/service";
import { fixtureListings, fixtureOrders } from "../src/modules/etsy/fixtures";
import { buildGenerationContext } from "../src/modules/generation/context";
import { createHash } from "node:crypto";
import { dashboardData } from "../src/modules/dashboard/service";
import type { Scope, ExternalOrder } from "../src/modules/intake/contracts";
let pg:PGlite, db:Database, a:Scope, b:Scope, versionId:string;
beforeEach(async()=>{
  vi.restoreAllMocks();
  pg=new PGlite();
  for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort()) await pg.exec(readFileSync(`drizzle/${file}`,"utf8"));
  db=drizzle(pg,{schema}) as unknown as Database;
  for(const id of ["dashboard-a","dashboard-b"]) await db.insert(schema.users).values({id,name:id});
  a=await authorizeStore(db,"dashboard-a",await createWorkspace(db,"dashboard-a","Store A","fixtures"));
  b=await authorizeStore(db,"dashboard-b",await createWorkspace(db,"dashboard-b","Store B","fixtures"));
  await ingestListing(db,a,fixtureListings[0]);
  await db.insert(schema.listingSelections).values({organizationId:a.organizationId,storeId:a.storeId,listingExternalId:"101",selectedBy:a.userId});
  const productId=await beginListingDraft(db,a,"101","default"), product=await productData(db,a,productId);
  versionId=await activateProduct(db,a,productId,product.draft!.id,0,{name:"Reading",configuration:{
    inputs:[{id:"question",key:"question",label:"Question",type:"TEXT",required:true,helpText:"",sortOrder:0}],
    sections:[{id:"intro",title:"Introduction",instruction:"Welcome the recipient",sortOrder:0},{id:"guidance",title:"Guidance",instruction:"Give useful guidance",sortOrder:1}],output:"TEXT",workflow:"ASSISTED",
  }});
},20000);
afterEach(async()=>{await pg.close();});

async function order(id:string, options:Partial<ExternalOrder>={},quantity=1,scope=a) {
  await ingestOrder(db,scope,{...fixtureOrders[0],externalId:id,...options,lines:[{...fixtureOrders[0].lines[0],externalId:`${id}1`,quantity}]});
  const [o]=await db.select().from(schema.orders).where(eq(schema.orders.externalId,id));
  const [l]=await db.select().from(schema.lineItems).where(eq(schema.lineItems.orderId,o.id));
  const units=await db.select().from(schema.units).where(eq(schema.units.lineItemId,l.id));
  if(scope===a) for(const unit of units){
    if(quantity>1) await correctInput(db,a,unit.id,0,fixtureOrders[0].lines[0].answers,true);
    await db.delete(schema.productionQueue).where(eq(schema.productionQueue.unitId,unit.id));
  }
  return {o,units};
}
async function generation(unit:typeof schema.units.$inferSelect,status:"FAILED"|"SUCCEEDED",createdAt:Date){
  const context=await buildGenerationContext(db,a,unit.id);
  return db.insert(schema.generations).values({organizationId:a.organizationId,storeId:a.storeId,unitId:unit.id,productVersionId:versionId,customerRevision:context.customer.revision,
    context,contextHash:createHash("sha256").update(JSON.stringify(context)).digest("hex"),status,createdAt,
    result:status==="SUCCEEDED"?{sections:context.product.configuration.sections.map(section=>({sectionId:section.id,title:section.title,content:"Synthetic test reading"}))}:null}).returning();
}
it("returns genuine empty aggregates and bounded empty lists",async()=>{
  expect(await dashboardData(db,a)).toEqual({storeNotice:"Your store connection needs attention.",metrics:{total:0,pending:0,active:0,generated:0,attention:0},recent:[],attention:[],production:{queued:0,active:0,retry:0,attention:0}});
});
it("counts orders once, queue entries per reading, and isolates seller data",async()=>{
  const pending=await order("9101"), active=await order("9102",{},2);
  for(const unit of active.units) await db.insert(schema.productionQueue).values({organizationId:a.organizationId,storeId:a.storeId,unitId:unit.id,productVersionId:versionId,priorityClass:"STANDARD"});
  await order("9103",{},1,b); await order("9104",{canceled:true});
  const data=await dashboardData(db,a);
  expect(data.metrics).toEqual({total:3,pending:1,active:1,generated:0,attention:0});
  expect(data.production).toEqual({queued:2,active:0,retry:0,attention:0});
  expect(data.recent.map(r=>r.externalId)).not.toContain("9103");
  expect(data.recent.find(r=>r.id===pending.o.id)?.status).toBe("Pending");
  expect((await dashboardData(db,b)).metrics.total).toBe(1);
});
it("uses only the latest attempt, detects stale data and prioritizes failure over information",async()=>{
  const failed=await order("9201"), stale=await order("9202"), info=await order("9203",{paid:false}), generated=await order("9204",{},2);
  await generation(failed.units[0],"FAILED",new Date("2026-01-01"));
  await generation(stale.units[0],"SUCCEEDED",new Date("2026-01-01"));
  await db.update(schema.units).set({revision:1}).where(eq(schema.units.id,stale.units[0].id));
  for(const unit of generated.units){await generation(unit,"FAILED",new Date("2026-01-01"));await generation(unit,"SUCCEEDED",new Date("2026-01-02"));}
  const data=await dashboardData(db,a);
  expect(data.metrics).toEqual({total:4,pending:0,active:0,generated:1,attention:3});
  expect(data.attention.map(r=>r.id)).toEqual([failed.o.id,stale.o.id,info.o.id]);
  expect(data.recent.find(r=>r.id===generated.o.id)?.status).toBe("Generated");
});
it("bounds lists and orders equal purchase dates with a stable id tie-breaker",async()=>{
  for(let i=0;i<9;i++) await order(`${9300+i}`,{paid:false,createdAt:fixtureOrders[0].createdAt+Math.floor(i/3)});
  const expected=await db.select().from(schema.orders);
  expected.sort((x,y)=>y.createdAt.getTime()-x.createdAt.getTime()||y.id.localeCompare(x.id));
  const first=await dashboardData(db,a),second=await dashboardData(db,a);
  expect(first.recent.map(r=>r.id)).toEqual(expected.slice(0,5).map(r=>r.id));
  expect(first.attention).toHaveLength(6); expect(first).toEqual(second);
  expect(first.metrics.attention).toBe(9);
});
it("rejects unauthorized, missing and forged seller scopes before querying operational data",async()=>{
  for(const scope of [{...a,userId:b.userId},{...a,userId:"missing"},{...a,organizationId:b.organizationId},{...a,storeId:crypto.randomUUID()}]) await expect(dashboardData(db,scope)).rejects.toThrow("Resource unavailable");
});
it("propagates data query failures instead of returning invented zeros",async()=>{
  vi.spyOn(db,"execute").mockRejectedValueOnce(new Error("Database unavailable"));
  await expect(dashboardData(db,a)).rejects.toThrow("Database unavailable");
});
it("maps active and retry queue states without counting generation attempts",async()=>{
  const active=await order("9401"),retry=await order("9402"),attention=await order("9403"),canceled=await order("9404");
  const now=new Date();
  for(const [unit,state] of [[active.units[0],"EXECUTING"],[retry.units[0],"RETRY_WAIT"],[attention.units[0],"ATTENTION"],[canceled.units[0],"ATTENTION"]] as const){
    const [g]=await generation(unit,"FAILED",new Date("2026-01-01")); const id=crypto.randomUUID();
    const token=crypto.randomUUID(),expires=new Date(now.getTime()+60000);
    await db.insert(schema.productionQueue).values({id,organizationId:a.organizationId,storeId:a.storeId,unitId:unit.id,productVersionId:versionId,priorityClass:"STANDARD"});
    await db.update(schema.productionQueue).set({state:"CLAIMED",claimToken:token,claimedAt:now,claimExpiresAt:expires,schedulingOrdinal:1n}).where(eq(schema.productionQueue.id,id));
    await db.update(schema.productionQueue).set({state:"EXECUTING",generationCommandKey:id,executionStartedAt:now,generationId:state==="RETRY_WAIT"?null:g.id}).where(eq(schema.productionQueue.id,id));
    if(state!=="EXECUTING") await db.update(schema.productionQueue).set({state,claimExpiresAt:null,resolvedAt:now,resolutionCode:state==="RETRY_WAIT"?"INTERRUPTED_BEFORE_DISPATCH":"TEST_FAILURE",availableAt:state==="RETRY_WAIT"?expires:null}).where(eq(schema.productionQueue.id,id));
  }
  await db.update(schema.orders).set({canceled:true}).where(eq(schema.orders.id,canceled.o.id));
  const data=await dashboardData(db,a);
  expect(data.production).toEqual({queued:0,active:1,retry:1,attention:1});
  expect(data.metrics).toEqual({total:4,pending:0,active:2,generated:0,attention:1});
  expect(data.attention.map(r=>r.id)).toEqual([attention.o.id]);
});
it("surfaces persisted information issues and preserves truthful integration notices",async()=>{
  await order("9501",{refund:"partial"});
  await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9502",lines:[{...fixtureOrders[0].lines[0],externalId:"95021",answers:[]}]});
  const data=await dashboardData(db,a);
  expect(data.metrics.attention).toBe(2);expect(data.metrics.pending).toBe(0);
  expect(data.attention.map(r=>r.status).sort()).toEqual(["Information or setup needed","Review refund"]);
  expect(data.storeNotice).toBe("Your store connection needs attention.");
  await db.update(schema.connections).set({status:"connected",expiresAt:new Date(Date.now()+60000)}).where(eq(schema.connections.storeId,a.storeId));
  expect((await dashboardData(db,a)).storeNotice).toBeNull();
});
it("does not classify partially generated orders as fully generated",async()=>{
  const partial=await order("9601",{},2);
  await generation(partial.units[0],"SUCCEEDED",new Date("2026-01-01"));
  const data=await dashboardData(db,a);
  expect(data.metrics.generated).toBe(0);expect(data.metrics.pending).toBe(1);
  expect(data.recent[0].status).toBe("Pending");
});
