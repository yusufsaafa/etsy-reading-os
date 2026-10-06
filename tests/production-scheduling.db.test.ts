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
import { ProductionScheduler } from "../src/modules/production/scheduler";
import { defaultSchedulingConfiguration as defaults } from "../src/modules/production/scheduling";
import { GenerationService } from "../src/modules/generation/service";
import { CentralAIGateway } from "../src/infrastructure/ai/gateway";
import { FakeGenerationProvider } from "../src/infrastructure/ai/fake";
import { pricingFor } from "../src/infrastructure/ai/pricing";
import { randomUUID,createHash } from "node:crypto";
import { buildGenerationContext } from "../src/modules/generation/context";
import { stableJson } from "../src/modules/intake/contracts";
let pg:PGlite,db:Database,a:Scope,b:Scope,now:Date;
const configuration:Configuration={inputs:[{id:"name",key:"name",label:"Name",type:"TEXT",required:true,helpText:"",sortOrder:0}],
 sections:[{id:"intro",title:"Introduction",instruction:"Welcome the recipient",sortOrder:0},{id:"guidance",title:"Guidance",instruction:"Give useful guidance",sortOrder:1}],output:"TEXT",workflow:"ASSISTED"};
const style={tone:"WARM" as const,detail:"DETAILED" as const,approach:"CONVERSATIONAL" as const,preferredExpressions:[],avoidExpressions:[],instructions:"Use clear language"};

async function readyStore(user:string){
 await db.insert(schema.users).values({id:user,name:user});const scope=await authorizeStore(db,user,await createWorkspace(db,user,"Synthetic Studio","fixtures"));
 for(const listing of fixtureListings)await ingestListing(db,scope,listing);
 await db.insert(schema.listingSelections).values(["101","102"].map(listingExternalId=>({organizationId:scope.organizationId,storeId:scope.storeId,listingExternalId,selectedBy:user})));
 for(const listing of ["101","102"]){const id=await beginListingDraft(db,scope,listing),data=await productData(db,scope,id);await activateProduct(db,scope,id,data.draft!.id,0,{name:"Guidance",configuration});}
 await saveSellerProfile(db,scope,{displayName:"Synthetic seller",shortBio:""});const styleDraft=await editStyle(db,scope);await applyStyle(db,scope,styleDraft.id,0,style);return scope;
}
async function receipt(scope:Scope,id:string,quantity=1,mixed=false){
 const raw={...fixtureOrders[0],externalId:id,createdAt:Math.floor(now.getTime()/1000),lines:[{...fixtureOrders[0].lines[0],externalId:id+"1",quantity,answers:[{label:"Name",value:"Synthetic recipient",kind:"text" as const}]}]};
 if(mixed)raw.lines.push({...raw.lines[0],externalId:id+"2",listingId:"102",quantity:1});
 await ingestOrder(db,scope,raw);const data=await workspaceData(db,scope),order=data.orders.find(o=>o.externalId===id)!;
 const readings=data.units.filter(u=>data.lines.some(l=>l.orderId===order.id&&l.id===u.lineItemId));
 if(quantity>1)for(const reading of readings)await correctInput(db,scope,reading.id,0,[{label:"Name",value:"Allocated "+reading.unitIndex,kind:"text"}],true);
 return (await db.select().from(schema.productionQueue)).filter(q=>readings.some(u=>u.id===q.unitId));
}
function worker(batch=4){return ProductionScheduler.forInternalWorker(db,{configuration:{...defaults,claimBatchSize:batch},clock:()=>now});}
beforeEach(async()=>{
 pg=new PGlite();for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;
 now=new Date("2026-10-06T09:00:00Z");a=await readyStore("sched-a");b=await readyStore("sched-b");
},20000);
afterEach(async()=>{vi.restoreAllMocks();await pg.close();});

it("queued work receives a durable owned claim; no Generation/gateway/provider/network/accounting side effects",async()=>{
 const [row]=await receipt(a,"8000");
 const generation=vi.spyOn(GenerationService.prototype,"prepare"),gateway=vi.spyOn(CentralAIGateway.prototype,"execute"),provider=vi.spyOn(FakeGenerationProvider.prototype,"generate"),fetch=vi.spyOn(globalThis,"fetch");
 const audits=(await db.select().from(schema.auditLogs)).length;
 const result=await worker().claimProductionWork();expect(result.claimed).toHaveLength(1);
 const durable=await readQueueItem(db,a,row.id);expect(durable).toMatchObject({state:"CLAIMED",organizationId:a.organizationId,storeId:a.storeId,productVersionId:row.productVersionId,claimedAt:now,schedulingOrdinal:1n});
 expect(durable.claimToken).toMatch(/^[a-f0-9-]{36}$/);expect(durable.claimExpiresAt?.getTime()).toBe(now.getTime()+defaults.claimDurationMs);
 for(const spy of [generation,gateway,provider,fetch])expect(spy).not.toHaveBeenCalled();
 expect(await db.select().from(schema.generations)).toHaveLength(0);expect(await db.select().from(schema.aiRequests)).toHaveLength(0);expect(await db.select().from(schema.usageEvents)).toHaveLength(0);expect((await db.select().from(schema.auditLogs)).length).toBe(audits);
});
it("concurrent worker calls return disjoint active work and cannot steal an unexpired claim",async()=>{
 await receipt(a,"8010");await receipt(a,"8011");await receipt(b,"8012");
 const results=await Promise.all([worker(1).claimProductionWork(),worker(1).claimProductionWork(),worker(1).claimProductionWork()]);
 const claims=results.flatMap(r=>r.claimed);expect(claims).toHaveLength(3);expect(new Set(claims.map(c=>c.id)).size).toBe(3);expect(new Set(claims.map(c=>c.claimToken)).size).toBe(3);
 expect((await worker().claimProductionWork()).claimed).toHaveLength(0);
});
it("batch limit and one-per-Store cycle cap are enforced",async()=>{
 for(const id of ["8020","8021","8022"])await receipt(a,id);await receipt(b,"8023");
 const first=await worker(1).claimProductionWork();expect(first.claimed).toHaveLength(1);expect((await worker(10).claimProductionWork()).claimed).toHaveLength(2);
});
it("persisted fairness rotates Stores across batch-size-one cycles despite unequal backlogs",async()=>{
 for(const id of ["8030","8031","8032","8033"])await receipt(a,id);for(const id of ["8040","8041"])await receipt(b,id);
 const stores=[];for(let i=0;i<4;i++)stores.push((await worker(1).claimProductionWork()).claimed[0].storeId);
 expect(stores[0]).not.toBe(stores[1]);expect(stores[0]).toBe(stores[2]);expect(stores[1]).toBe(stores[3]);
});
it("claims use generation eligibility without depending on any seller membership/session",async()=>{
 await receipt(a,"8050");await db.delete(schema.memberships).where(eq(schema.memberships.organizationId,a.organizationId));
 const result=await worker().claimProductionWork();expect(result.claimed[0].storeId).toBe(a.storeId);
 await expect(readQueueItem(db,a,result.claimed[0].id)).rejects.toThrow();
});
it("mixed cart and quantity readings are independently claimed on subsequent Store turns",async()=>{
 const rows=await receipt(a,"8060",2,true);expect(rows).toHaveLength(3);
 const claimed=[];for(let i=0;i<3;i++)claimed.push(...(await worker().claimProductionWork()).claimed);
 expect(new Set(claimed.map(q=>q.unitId))).toEqual(new Set(rows.map(q=>q.unitId)));expect(new Set(claimed.map(q=>q.productVersionId)).size).toBe(2);
});
it("blocking customer correction is resolved durably without a claim; resolution cannot be reversed",async()=>{
 const [row]=await receipt(a,"8070");await correctInput(db,a,row.unitId,0,[],false);
 const result=await worker().claimProductionWork();expect(result).toMatchObject({claimed:[],skipped:1});
 const durable=await readQueueItem(db,a,row.id);expect(durable).toMatchObject({state:"SKIPPED",resolutionCode:"CUSTOMER_INFORMATION",resolvedAt:now,claimToken:null});
 await expect(db.update(schema.productionQueue).set({state:"QUEUED",resolvedAt:null,resolutionCode:null}).where(eq(schema.productionQueue.id,row.id))).rejects.toThrow();
 expect((await worker().claimProductionWork()).skipped).toBe(0);
});
it("mapping hold resolves stale waiting work without dispatch",async()=>{
 const [row]=await receipt(a,"8080");await configureMapping(db,a,"101","default",true);const result=await worker().claimProductionWork();expect(result.claimed).toHaveLength(0);expect((await readQueueItem(db,a,row.id)).resolutionCode).toBe("READING_HOLD");
});
it.each(["SUCCEEDED","PROCESSING","FAILED"] as const)("existing %s Generation excludes claim/reclaim without creating accounting",async status=>{
 const [row]=await receipt(a,"8090");
 const context=await db.transaction(tx=>buildGenerationContext(tx,a,row.unitId));
 await db.insert(schema.generations).values({organizationId:a.organizationId,storeId:a.storeId,unitId:row.unitId,productVersionId:row.productVersionId,styleVersionId:context.style.id,sellerProfileId:context.seller.id,customerRevision:0,context,contextHash:createHash("sha256").update(stableJson(context)).digest("hex"),status,result:status==="SUCCEEDED"?{sections:configuration.sections.map(s=>({sectionId:s.id,title:s.title,content:"Retained content"}))}:null,completedAt:status==="PROCESSING"?null:now});
 const result=await worker().claimProductionWork();expect(result.claimed).toHaveLength(0);expect((await readQueueItem(db,a,row.id)).resolutionCode).toBe("EXISTING_GENERATION");expect(await db.select().from(schema.aiRequests)).toHaveLength(0);
});
it("successful manual preparation after admission leaves no schedulable duplicate",async()=>{
 const [row]=await receipt(a,"8100"),provider=new FakeGenerationProvider();
 const service=new GenerationService(db,new CentralAIGateway(db,{provider,model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:0n,attemptBudgetNanos:0n}));
 const generated=await service.prepare(a,{unitId:row.unitId,commandKey:randomUUID()});expect(generated.status).toBe("SUCCEEDED");
 const count=(await db.select().from(schema.aiRequests)).length;expect((await worker().claimProductionWork()).claimed).toHaveLength(0);expect(provider.calls).toBe(1);expect((await db.select().from(schema.aiRequests)).length).toBe(count);
});
it("expired safe Part 2-only claim rotates token durably at the exact boundary",async()=>{
 const [row]=await receipt(a,"8110"),first=(await worker().claimProductionWork()).claimed[0];now=new Date(first.claimExpiresAt!.getTime()-1);
 expect((await worker().claimProductionWork()).claimed).toHaveLength(0);now=new Date(now.getTime()+1);
 const second=(await worker().claimProductionWork()).claimed[0];expect(second.id).toBe(row.id);expect(second.claimToken).not.toBe(first.claimToken);expect(second.schedulingOrdinal).toBe(2n);expect(second.claimedAt).toEqual(now);
});
it("expired claim with a newly blocking hold is skipped and retains prior claim time and advances fairness turn",async()=>{
 const [row]=await receipt(a,"8120"),first=(await worker().claimProductionWork()).claimed[0];await correctInput(db,a,row.unitId,0,[],false);now=first.claimExpiresAt!;
 const result=await worker().claimProductionWork();expect(result.claimed).toHaveLength(0);expect((await readQueueItem(db,a,row.id))).toMatchObject({state:"SKIPPED",schedulingOrdinal:2n,claimedAt:first.claimedAt,claimToken:null});
});
it("database rejects active token theft and inconsistent claim metadata",async()=>{
 const [row]=await receipt(a,"8130"),first=(await worker().claimProductionWork()).claimed[0];
 await expect(db.update(schema.productionQueue).set({claimToken:randomUUID(),schedulingOrdinal:2n}).where(eq(schema.productionQueue.id,row.id))).rejects.toThrow();
 await expect(db.update(schema.productionQueue).set({claimToken:null}).where(eq(schema.productionQueue.id,row.id))).rejects.toThrow();expect((await readQueueItem(db,a,row.id)).claimToken).toBe(first.claimToken);
});
it("cross-tenant seller selectors fail while internal selection retains exact owners",async()=>{
 const [ar]=await receipt(a,"8140"),[br]=await receipt(b,"8141");await expect(readQueueItem(db,b,ar.id)).rejects.toThrow();await expect(readQueueItem(db,{...a,userId:b.userId},ar.id)).rejects.toThrow();
 const result=await worker().claimProductionWork();expect(result.claimed).toHaveLength(2);for(const claim of result.claimed)expect(claim.organizationId).toBe(claim.id===ar.id?a.organizationId:b.organizationId);expect(result.claimed.some(c=>c.id===br.id)).toBe(true);
});
it("unexpected claim persistence failure rolls the cycle back without partially owning work",async()=>{
 const [row]=await receipt(a,"8150");await pg.exec("CREATE FUNCTION fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='CLAIMED' THEN RAISE EXCEPTION 'TEST_CLAIM_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_claim BEFORE UPDATE ON production_queue FOR EACH ROW EXECUTE FUNCTION fail_claim();");
 await expect(worker().claimProductionWork()).rejects.toThrow();expect((await readQueueItem(db,a,row.id)).state).toBe("QUEUED");expect(await db.select().from(schema.aiRequests)).toHaveLength(0);
});
it("expired claim with a subsequently started Generation is skipped rather than reclaimed",async()=>{
 const [row]=await receipt(a,"8160"),first=(await worker().claimProductionWork()).claimed[0];
 const context=await db.transaction(tx=>buildGenerationContext(tx,a,row.unitId));
 await db.insert(schema.generations).values({organizationId:a.organizationId,storeId:a.storeId,unitId:row.unitId,productVersionId:row.productVersionId,styleVersionId:context.style.id,sellerProfileId:context.seller.id,customerRevision:0,context,contextHash:createHash("sha256").update(stableJson(context)).digest("hex")});
 now=first.claimExpiresAt!;expect((await worker().claimProductionWork()).claimed).toHaveLength(0);expect((await readQueueItem(db,a,row.id)).resolutionCode).toBe("EXISTING_GENERATION");
 expect(await db.select().from(schema.aiRequests)).toHaveLength(0);
});
it("claim-cycle inspection limit bounds stale resolution before unbounded backlog traversal",async()=>{
 for(const id of ["8170","8171","8172"]){const [row]=await receipt(a,id);await correctInput(db,a,row.unitId,0,[],false);}
 const scheduler=ProductionScheduler.forInternalWorker(db,{configuration:{...defaults,inspectionLimit:2},clock:()=>now});
 expect(await scheduler.claimProductionWork()).toMatchObject({inspected:2,skipped:2,claimed:[]});expect(await scheduler.claimProductionWork()).toMatchObject({inspected:1,skipped:1,claimed:[]});
});
it("Part 2 migration preserves populated Part 1 waiting rows and recipe/history data",async()=>{
 const acceptance=new PGlite(),original=db;
 try{
  for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")&&f<"0007").sort())await acceptance.exec(readFileSync("drizzle/"+file,"utf8"));
  db=drizzle(acceptance,{schema}) as unknown as Database;
  const production=await import("../src/modules/production/service");
  const admit=vi.spyOn(production,"admitReadingInTransaction").mockResolvedValue({outcome:"ineligible"});
  const reconcile=vi.spyOn(production,"reconcileProductionInTransaction").mockResolvedValue({scanned:0,queued:0});
  const scope=await readyStore("legacy-part1");
  await ingestOrder(db,scope,{...fixtureOrders[0],externalId:"8180",lines:[{...fixtureOrders[0].lines[0],externalId:"8181",answers:[{label:"Name",value:"Synthetic",kind:"text"}]}]});
  await acceptance.exec("INSERT INTO production_queue (organization_id,store_id,unit_id,product_version_id,priority_class) SELECT organization_id,store_id,id,product_version_id,'STANDARD' FROM fulfillment_units");
  const before=(await acceptance.query<Record<string,unknown>>("SELECT * FROM production_queue")).rows;
  const recipes=await db.select().from(schema.productVersions),readings=await db.select().from(schema.units);
  await acceptance.exec(readFileSync("drizzle/0007_unknown_dreadnoughts.sql","utf8"));
  const after=(await acceptance.query<Record<string,unknown>>("SELECT * FROM production_queue")).rows;
  expect(after).toHaveLength(1);expect(after[0]).toMatchObject(before[0]);expect(after[0]).toMatchObject({claim_token:null,claimed_at:null,claim_expires_at:null,scheduling_ordinal:null,resolved_at:null,resolution_code:null});
  expect(await db.select().from(schema.productVersions)).toEqual(recipes);expect(await db.select().from(schema.units)).toEqual(readings);expect(await db.select().from(schema.generations)).toHaveLength(0);
  admit.mockRestore();reconcile.mockRestore();
 }finally{db=original;await acceptance.close();}
});
async function policy(scope:Scope,fulfillment:NonNullable<Configuration["fulfillment"]>){
 const mapping=(await db.select().from(schema.mappings).where(tenantWhere(schema.mappings,scope))).find(m=>m.listingExternalId==="101")!;
 const draft=await editProduct(db,scope,mapping.productId!);await activateProduct(db,scope,mapping.productId!,draft,0,{name:"Guidance",configuration:{...configuration,fulfillment}});
}
it("scheduler chooses Express over unaged Standard within the same Store",async()=>{
 await receipt(a,"8190");await policy(a,{priorityClass:"EXPRESS",targetCompletionMinutes:null});const [express]=await receipt(a,"8191");
 expect((await worker(1).claimProductionWork()).claimed[0].id).toBe(express.id);
});
it("scheduler chooses a near-deadline Standard ahead of nonurgent Express",async()=>{
 await policy(a,{priorityClass:"EXPRESS",targetCompletionMinutes:null});await receipt(a,"8200");
 await policy(a,{priorityClass:"STANDARD",targetCompletionMinutes:5});const [urgent]=await receipt(a,"8201");
 expect((await worker(1).claimProductionWork()).claimed[0].id).toBe(urgent.id);
});
it("aged Standard waiting work overtakes fresh Express and near-deadline arrivals",async()=>{
 const [standard]=await receipt(a,"8210");await db.delete(schema.productionQueue).where(eq(schema.productionQueue.id,standard.id));
 // Deterministic old waiting fixture; published policy/binding remain unchanged.
 await db.insert(schema.productionQueue).values({...standard,createdAt:new Date(now.getTime()-defaults.agingThresholdMs)});
 await policy(a,{priorityClass:"EXPRESS",targetCompletionMinutes:1});await receipt(a,"8211");
 expect((await worker(1).claimProductionWork()).claimed[0].id).toBe(standard.id);
});
it("a stale high-volume Store cannot exhaust every cycle before another Store gets a claim",async()=>{
 for(const id of ["8220","8221","8222"]){const [row]=await receipt(a,id);await correctInput(db,a,row.unitId,0,[],false);}
 const [eligible]=await receipt(b,"8230");
 const scheduler=ProductionScheduler.forInternalWorker(db,{configuration:{...defaults,inspectionLimit:2},clock:()=>now});
 const result=await scheduler.claimProductionWork();expect(result.claimed.map(q=>q.id)).toEqual([eligible.id]);expect(result.inspected).toBe(2);expect(result.skipped).toBe(1);
});
