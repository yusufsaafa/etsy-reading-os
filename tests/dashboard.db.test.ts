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
import { pricingFor } from "../src/infrastructure/ai/pricing";
import { OPERATION } from "../src/modules/generation/contracts";
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
async function generation(unit:typeof schema.units.$inferSelect,status:"FAILED"|"SUCCEEDED",createdAt:Date,scope=a){
  const context=await buildGenerationContext(db,scope,unit.id);
  return db.insert(schema.generations).values({organizationId:scope.organizationId,storeId:scope.storeId,unitId:unit.id,productVersionId:context.product.id,customerRevision:context.customer.revision,
    context,contextHash:createHash("sha256").update(JSON.stringify(context)).digest("hex"),status,createdAt,
    result:status==="SUCCEEDED"?{sections:context.product.configuration.sections.map(section=>({sectionId:section.id,title:section.title,content:"Synthetic test reading"}))}:null}).returning();
}
it("returns genuine empty aggregates and bounded empty lists",async()=>{
  expect(await dashboardData(db,a)).toMatchObject({storeNotice:"Your store connection needs attention.",metrics:{total:0,pending:0,active:0,generated:0,attention:0},recent:[],attention:[],production:{queued:0,active:0,retry:0,attention:0}});
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
  expect(first.attention).toHaveLength(6); expect(first.recent).toEqual(second.recent); expect(first.attention).toEqual(second.attention); expect(first.metrics).toEqual(second.metrics);
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
const cutoff=new Date("2026-10-09T12:00:00Z");
const epoch=(date:string)=>new Date(date).getTime()/1000;
it.each([7,30,90])("returns exactly %s UTC daily buckets with a partial today cutoff",async days=>{
  const start=new Date(cutoff);start.setUTCHours(0,0,0,0);start.setUTCDate(start.getUTCDate()-days+1);
  await order("9701",{createdAt:start.getTime()/1000});
  await order("9702",{createdAt:start.getTime()/1000-1});
  await order("9703",{createdAt:epoch("2026-10-09T11:59:59Z"),canceled:true});
  await order("9704",{createdAt:cutoff.getTime()/1000});
  await order("9705",{createdAt:epoch("2026-10-10T01:00:00Z")});
  await order("9706",{createdAt:epoch("2026-10-09T01:00:00Z")},1,b);
  await pg.exec("set timezone to 'Asia/Tokyo'");
  const data=await dashboardData(db,a,String(days),cutoff);
  expect(data.analytics.orders).toBe(2);expect(data.analytics.daily).toHaveLength(days);
  expect(data.analytics.daily[0]).toEqual({date:start.toISOString().slice(0,10),count:1});
  expect(data.analytics.daily.at(-1)).toEqual({date:"2026-10-09",count:1});
  expect(data.analytics.daily.slice(1,-1).every(day=>day.count===0)).toBe(true);
  expect(data.analytics.daily.reduce((sum,day)=>sum+day.count,0)).toBe(2);
  expect(data.analytics.cutoff).toBe(cutoff.toISOString());expect(data.metrics.total).toBe(5);
});
it("distinguishes empty periods from lifetime-empty stores and keeps older attention",async()=>{
  await order("9711",{createdAt:epoch("2026-01-01T00:00:00Z"),paid:false});
  const data=await dashboardData(db,a,"7",cutoff);
  expect(data.metrics.total).toBe(1);expect(data.analytics.orders).toBe(0);expect(data.metrics.attention).toBe(1);
  expect(data.attention[0].externalId).toBe("9711");expect(data.recent[0].externalId).toBe("9711");
  expect(data.analytics.averageAiMs).toBeNull();expect(data.analytics.aiSamples).toBe(0);
});
it("ranks distinct order/listing pairs, ignoring quantity and duplicate variants",async()=>{
  const line=fixtureOrders[0].lines[0];
  await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9801",createdAt:epoch("2026-10-08T08:00:00Z"),canceled:true,lines:[
    {...line,externalId:"98011",listingId:"101",quantity:3},
    {...line,externalId:"98012",listingId:"101",variantKey:"different",quantity:2},
    {...line,externalId:"98013",listingId:"102",title:"Retained second listing",quantity:1},
  ]});
  await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9802",createdAt:epoch("2026-10-09T08:00:00Z"),lines:[{...line,externalId:"98021",listingId:"102",title:"Latest retained title",quantity:2}]});
  await db.update(schema.listings).set({state:"inactive",title:"Current owned title"}).where(eq(schema.listings.externalId,"101"));
  const data=await dashboardData(db,a,7,cutoff);
  expect(data.analytics.orders).toBe(2);expect(data.analytics.topProducts).toEqual([
    {listingId:"102",title:"Latest retained title",orders:2},
    {listingId:"101",title:"Current owned title",orders:1},
  ]);
});
it("bounds ranking to five listings with deterministic ties and safe title fallback",async()=>{
  const line=fixtureOrders[0].lines[0];
  for(let i=0;i<6;i++) await ingestOrder(db,a,{...fixtureOrders[0],externalId:`981${i}`,createdAt:epoch("2026-10-09T08:00:00Z"),lines:[{...line,externalId:`981${i}1`,listingId:`10${i+1}`,title:i===1?"Unconfigured purchase":`Retained ${i}`,quantity:1}]});
  await order("9821",{createdAt:epoch("2026-01-01T00:00:00Z")});
  await order("9822",{createdAt:epoch("2026-10-09T08:00:00Z")},1,b);
  const {topProducts}= (await dashboardData(db,a,"7",cutoff)).analytics;
  expect(topProducts.map(p=>p.listingId)).toEqual(["101","102","103","104","105"]);
  expect(topProducts.every(p=>p.orders===1)).toBe(true);expect(topProducts[1].title).toBe("Listing #102");
});
// Synthetic persisted request records exercise aggregation without dispatching AI.
async function request(generationId:string|null,options:Partial<typeof schema.aiRequests.$inferInsert>={},scope=a){
  const provider=options.provider??"google",model=provider==="fake"?"deterministic-v1":"gemini-3.5-flash-lite";
  return db.transaction(async tx=>{
  const row = (await tx.insert(schema.aiRequests).values({organizationId:scope.organizationId,storeId:scope.storeId,generationId,attemptNumber:1,
    commandKey:crypto.randomUUID(),commandHash:"a".repeat(64),operation:OPERATION,provider,model,
    pricing:pricingFor(provider,model),reservedNanos:0n,status:"SUCCEEDED",costState:"estimated",estimatedNanos:1n,
    startedAt:new Date("2026-10-09T08:00:00Z"),finishedAt:new Date("2026-10-09T08:00:10Z"),durationMs:1000,...options}).returning())[0];
    await tx.insert(schema.usageEvents).values({organizationId:scope.organizationId,storeId:scope.storeId,aiRequestId:row.id,operation:row.operation,amountNanos:row.estimatedNanos,costState:row.costState,currency:"USD"});
    return row;
  });
}
it("averages only successful measured real reading requests, excluding retries and unrelated operations",async()=>{
  const makeGeneration=async(id:string)=>{const reading=await order(id,{createdAt:epoch("2026-10-08T08:00:00Z")});return (await generation(reading.units[0],"SUCCEEDED",new Date("2026-10-08T08:00:00Z")))[0];};
  const one=await makeGeneration("9901"),two=await makeGeneration("9902"),three=await makeGeneration("9903");
  const failed=await request(one.id,{status:"FAILED",failureCode:"RATE_LIMIT",durationMs:9000});
  await request(one.id,{attemptNumber:2,parentRequestId:failed.id,durationMs:3000});
  await request(two.id,{durationMs:1000});
  await request(three.id,{provider:"fake",durationMs:5000});
  await request(three.id,{attemptNumber:2,durationMs:null});
  await request(three.id,{attemptNumber:3,startedAt:null,durationMs:4000});
  await request(three.id,{attemptNumber:4,finishedAt:new Date("2026-10-09T07:00:00Z"),durationMs:7000});
  await request(three.id,{attemptNumber:5,startedAt:new Date("2026-01-01"),finishedAt:new Date("2026-01-01T00:00:10Z"),durationMs:8000});
  await request(three.id,{attemptNumber:6,finishedAt:cutoff,durationMs:8000});
  await request(three.id,{attemptNumber:7,status:"RUNNING",costState:"unknown",estimatedNanos:null,finishedAt:null,durationMs:null});
  await request(null,{operation:"style-analysis/v1",durationMs:8000});
  const data=await dashboardData(db,a,7,cutoff);
  expect(data.analytics.averageAiMs).toBe(2000);expect(data.analytics.aiSamples).toBe(2);
});
it("scopes eligible AI timing requests to the authorized store",async()=>{
  await ingestListing(db,b,fixtureListings[0]);
  await db.insert(schema.listingSelections).values({organizationId:b.organizationId,storeId:b.storeId,listingExternalId:"101",selectedBy:b.userId});
  const productId=await beginListingDraft(db,b,"101","default"),product=await productData(db,b,productId);
  const [v]=await db.select().from(schema.productVersions).where(eq(schema.productVersions.id,versionId));
  await activateProduct(db,b,productId,product.draft!.id,0,{name:"Other reading",configuration:v.configuration});
  const reading=await order("9911",{createdAt:epoch("2026-10-08T08:00:00Z")},1,b);
  const [g]=await generation(reading.units[0],"SUCCEEDED",new Date("2026-10-08T08:00:00Z"),b);
  await request(g.id,{durationMs:99000},b);
  expect((await dashboardData(db,a,7,cutoff)).analytics.averageAiMs).toBeNull();
  expect((await dashboardData(db,b,7,cutoff)).analytics.averageAiMs).toBe(99000);
});
it("uses the current connection epoch and safely represents absent connections",async()=>{
  await db.update(schema.connections).set({status:"connected",epoch:2,expiresAt:new Date("2026-11-01")}).where(eq(schema.connections.storeId,a.storeId));
  await db.insert(schema.syncRuns).values({organizationId:a.organizationId,storeId:a.storeId,actorId:a.userId,commandKey:"old-failed-import",connectionEpoch:1,status:"failed"});
  let data=await dashboardData(db,a,7,cutoff);expect(data.integration.syncStatus).toBeNull();expect(data.storeNotice).toBeNull();
  const [run]=await db.insert(schema.syncRuns).values({organizationId:a.organizationId,storeId:a.storeId,actorId:a.userId,commandKey:"current-import",connectionEpoch:2,status:"queued"}).returning();
  for(const status of ["queued","running","failed","succeeded"] as const){await db.update(schema.syncRuns).set({status}).where(eq(schema.syncRuns.id,run.id));data=await dashboardData(db,a,7,cutoff);expect(data.integration.syncStatus).toBe(status);}
  await db.update(schema.connections).set({expiresAt:new Date("2026-10-08")}).where(eq(schema.connections.storeId,a.storeId));
  expect((await dashboardData(db,a,7,cutoff)).integration.expired).toBe(true);
  await db.delete(schema.connections).where(eq(schema.connections.storeId,a.storeId));
  expect((await dashboardData(db,a,7,cutoff)).integration.connectionStatus).toBeNull();
});
