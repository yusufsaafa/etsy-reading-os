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
import {ordersData} from "../src/modules/orders/service";
import {ordersQuery} from "../src/modules/orders/query";
it("keeps empty results genuine and clamps invalid/out-of-range pages",async()=>{
 expect(await ordersData(db,a,ordersQuery({page:"999"}))).toMatchObject({rows:[],total:0,matched:0,page:1,pages:1});
});
it("uses bounded deterministic pagination and oldest/newest purchase ordering",async()=>{
 for(let i=0;i<23;i++)await order(String(9300+i),{createdAt:Date.parse("2026-10-09T12:00:00Z")/1000});
 const first=await ordersData(db,a,ordersQuery()),second=await ordersData(db,a,ordersQuery({page:"2"})),oldest=await ordersData(db,a,ordersQuery({sort:"oldest"}));
 expect(first).toMatchObject({total:23,matched:23,page:1,pages:2});expect(first.rows).toHaveLength(20);expect(second.rows).toHaveLength(3);
 expect(new Set([...first.rows,...second.rows].map(r=>r.id)).size).toBe(23);
 expect(first.rows.map(r=>r.id)).toEqual([...first.rows.map(r=>r.id)].sort().reverse());
 expect(oldest.rows.map(r=>r.id)).toEqual([...oldest.rows.map(r=>r.id)].sort());
 expect((await ordersData(db,a,ordersQuery({page:"999"}))).page).toBe(2);
});
it("searches persisted identifiers and retained titles with literal wildcard handling and tenant isolation",async()=>{
 const own=await order("9401");await order("9402",{},1,b);
 await db.update(schema.lineItems).set({title:"Love 100%_Reading"}).where(eq(schema.lineItems.orderId,own.o.id));
 for(const q of ["9401",own.o.id,"love 100%_reading","%_"])expect((await ordersData(db,a,ordersQuery({q}))).matched).toBe(1);
 expect((await ordersData(db,a,ordersQuery({q:"9402"}))).matched).toBe(0);
 expect((await ordersData(db,a,ordersQuery({q:"no match"}))).matched).toBe(0);
});
it("uses validated lifecycle categories, cancellation precedence and combined filters",async()=>{
 const pending=await order("9501"),active=await order("9502"),generated=await order("9503"),failed=await order("9504");
 await order("9505",{canceled:true});await order("9506",{paid:false});
 const now=new Date(),id=crypto.randomUUID(),expires=new Date(now.getTime()+60000);
 await db.insert(schema.productionQueue).values({id,organizationId:a.organizationId,storeId:a.storeId,unitId:active.units[0].id,productVersionId:versionId,priorityClass:"STANDARD"});
 await db.update(schema.productionQueue).set({state:"CLAIMED",claimToken:crypto.randomUUID(),claimedAt:now,claimExpiresAt:expires,schedulingOrdinal:1n}).where(eq(schema.productionQueue.id,id));
 await db.update(schema.productionQueue).set({state:"EXECUTING",generationCommandKey:id,executionStartedAt:now,generationId:null}).where(eq(schema.productionQueue.id,id));
 await db.update(schema.productionQueue).set({state:"RETRY_WAIT",claimExpiresAt:null,resolvedAt:now,resolutionCode:"INTERRUPTED_BEFORE_DISPATCH",availableAt:expires}).where(eq(schema.productionQueue.id,id));
 await generation(generated.units[0],"SUCCEEDED",new Date());await generation(failed.units[0],"FAILED",new Date());
 const data=await ordersData(db,a,ordersQuery()),dashboard=await dashboardData(db,a);
 expect(data.rows.find(r=>r.id===pending.o.id)?.status).toBe("Pending");
 for(const [filter,count] of [["pending",1],["production",1],["generated",1],["attention",2],["canceled",1]] as const)expect((await ordersData(db,a,ordersQuery({filter}))).matched).toBe(count);
 expect((await ordersData(db,a,ordersQuery({filter:"generated",q:"9504"}))).matched).toBe(0);
 for(const row of dashboard.recent)expect(data.rows.find(r=>r.id===row.id)?.status).toBe(row.status);
});
it("does not count stale or absent generation as generated; no per-attempt order duplication",async()=>{
 const result=await order("9601");
 await generation(result.units[0],"FAILED",new Date("2026-10-01"));await generation(result.units[0],"SUCCEEDED",new Date("2026-10-02"));
 expect((await ordersData(db,a,ordersQuery({filter:"generated"}))).matched).toBe(1);
 await db.update(schema.units).set({revision:1}).where(eq(schema.units.id,result.units[0].id));
 expect((await ordersData(db,a,ordersQuery({filter:"generated"}))).matched).toBe(0);
 expect((await ordersData(db,a,ordersQuery({filter:"attention"}))).matched).toBe(1);
});
it("rejects forged scope and revoked membership before returning data",async()=>{
 await expect(ordersData(db,{...a,storeId:b.storeId},ordersQuery())).rejects.toThrow();
 await db.delete(schema.memberships).where(eq(schema.memberships.userId,a.userId));
 await expect(ordersData(db,a,ordersQuery())).rejects.toThrow();
});
it("preserves current-epoch integration guidance without inventing imported orders",async()=>{
 expect((await ordersData(db,a,ordersQuery())).connectionAttention).toBe(true);
 await db.update(schema.connections).set({status:"connected",expiresAt:new Date("2099-01-01")}).where(eq(schema.connections.storeId,a.storeId));
 expect((await ordersData(db,a,ordersQuery())).connectionAttention).toBe(false);
});


it("loads only the owned order's purchase evidence and current readings",async()=>{
 const {orderDetailData}=await import("../src/modules/orders/detail");
 await order("901");await order("902");await order("903",{},1,b);
 const [owned]=await db.select().from(schema.orders).where(eq(schema.orders.externalId,"901"));
 const detail=await orderDetailData(db,a,owned.id);expect(detail?.order.externalId).toBe("901");expect(detail?.lines).toHaveLength(1);expect(detail?.units).toHaveLength(1);expect(detail?.inputs.every(c=>detail.units.some(u=>u.id===c.unitId))).toBe(true);
 expect(await orderDetailData(db,b,owned.id)).toBeNull();expect(await orderDetailData(db,a,"DEMO-1001")).toBeNull();
},20000);
it("rejects forged or revoked scope for order detail",async()=>{
 const {orderDetailData}=await import("../src/modules/orders/detail");await order("904");
 const [owned]=await db.select().from(schema.orders).where(eq(schema.orders.externalId,"904"));
 await expect(orderDetailData(db,{...a,organizationId:b.organizationId},owned.id)).rejects.toThrow("Resource unavailable");
},20000);
it("projects buyer name minimally in real Orders without customer-name search",async()=>{
 const {ordersData}=await import("../src/modules/orders/service");const {ordersQuery}=await import("../src/modules/orders/query");
 await order("905",{buyerName:"Verified Buyer"});const data=await ordersData(db,a,ordersQuery());expect(data.rows[0].customer).toBe("Verified Buyer");expect((await ordersData(db,a,ordersQuery({q:"Verified Buyer"}))).matched).toBe(0);
},20000);
