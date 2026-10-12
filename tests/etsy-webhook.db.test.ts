import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {randomUUID,createHmac} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import {migrate} from "drizzle-orm/pglite/migrator";
import {eq} from "drizzle-orm";
import type {Database} from "../src/db/client";
import * as schema from "../src/db/schema";
import {authorizeStore,createWorkspace} from "../src/modules/identity/service";
import {ingestListing,workspaceData,correctInput} from "../src/modules/intake/service";
import {beginEtsyProductDraft,productData,activateProduct,editProduct} from "../src/modules/products/service";
import {fixtureListings} from "../src/modules/etsy/fixtures";
import {authenticateEtsyWebhook,handleEtsyWebhook,type VerifiedWebhook} from "../src/modules/etsy/webhook-receiver";
import {acceptVerifiedWebhook,runWebhookIntakeTick,retryWebhookEvent,webhookDiagnostics,webhookIntakeStatus} from "../src/modules/etsy/webhook-intake";
import {runAutomaticIntakeTick} from "../src/modules/etsy/automatic-intake";
import {ReceiptPilotError} from "../src/modules/etsy/receipt-read";
import {syncOrderReceipt} from "../src/modules/orders/sync";
import type {Scope} from "../src/modules/intake/contracts";
import type {Configuration} from "../src/modules/products/contracts";
import {policy} from "./fixtures/etsy-source";
import {rawReceipt} from "./fixtures/etsy-raw";
import {buildGenerationContext} from "../src/modules/generation/context";
import {admitReading} from "../src/modules/production/service";
import {ordersData} from "../src/modules/orders/service";
import {ordersQuery} from "../src/modules/orders/query";
import {orderDetailData} from "../src/modules/orders/detail";
import {purchasedAnswers,purchasedChoices} from "../src/modules/orders/purchased-choices";

let pg:PGlite,db:Database,a:Scope,b:Scope,version:string,product:string;
const secret="whsec_"+Buffer.from("synthetic-etsy-signing-key").toString("base64");
const seconds=()=>Math.floor(Date.now()/1000);
const config=(listingId="101"):Configuration=>({etsyFulfillment:{...policy(),listingId},fulfillment:{priorityClass:"EXPRESS",targetCompletionMinutes:60},inputs:[{id:"question",key:"question",label:"Context",type:"LONG_TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"body",title:"Reading",instruction:"",sortOrder:0}],output:"PDF",workflow:"ASSISTED"});
function receipt(){const r=rawReceipt();r.created_timestamp=seconds()+1;r.updated_timestamp=r.created_timestamp+1;return r;}
function evidence(shopId="77",eventType="order.paid",eventId="msg_"+randomUUID(),receiptId="900") {
  const rawBody=Buffer.from(JSON.stringify({event_type:eventType,resource_url:`https://api.etsy.com/v3/application/shops/${shopId}/receipts/${receiptId}`,shop_id:shopId})),timestamp=String(seconds());
  const signature="v1,"+createHmac("sha256",Buffer.from(secret.slice(6),"base64")).update(`${eventId}.${timestamp}.`).update(rawBody).digest("base64");
  return {rawBody,messageId:eventId,timestamp,signature,secret};
}
const event=(...args:Parameters<typeof evidence>)=>authenticateEtsyWebhook(evidence(...args))!;
const reader=(r=receipt())=>vi.fn(async()=>({body:JSON.stringify(r),shopId:"77",epoch:0,evidence:[]}));
const rows=()=>db.select().from(schema.webhookEvents);
const state=()=>rows().then(r=>r[0]);
async function accepted(...args:Parameters<typeof event>){return acceptVerifiedWebhook(db,event(...args));}
async function noExecution(queue:unknown[]=[]){
  expect(await db.select().from(schema.productionQueue)).toEqual(queue);
  for(const t of [schema.generations,schema.aiRequests,schema.usageEvents,schema.documentSnapshots,schema.documentProduction,schema.documentArtifacts])expect(await db.select().from(t)).toHaveLength(0);
}
async function polling(r=receipt()){
  return {now:new Date(Date.now()+60000),page:vi.fn(async()=>({receipts:[{receiptId:String(r.receipt_id),modified:r.updated_timestamp}],complete:true,epoch:0,shopId:"77"})),receipt:reader(r)};
}
beforeEach(async()=>{
  vi.stubEnv("ETSY_ADAPTER","fixtures");vi.stubEnv("INTERNAL_TOOLS_ENABLED","true");vi.stubEnv("INTERNAL_OPERATOR_USER_IDS","a,b");vi.stubEnv("ETSY_WEBHOOK_SIGNING_SECRET",secret);
  pg=new PGlite();for(const f of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+f,"utf8"));
  db=drizzle(pg,{schema}) as unknown as Database;
  for(const id of ["a","b"])await db.insert(schema.users).values({id,name:id});
  a=await authorizeStore(db,"a",await createWorkspace(db,"a","A","fixtures"));b=await authorizeStore(db,"b",await createWorkspace(db,"b","B","fixtures"));
  await db.update(schema.stores).set({externalShopId:"77"}).where(eq(schema.stores.id,a.storeId));
  for(const listing of fixtureListings)await ingestListing(db,a,listing);
  product=await beginEtsyProductDraft(db,a,policy());version=(await productData(db,a,product)).draft!.id;
  await activateProduct(db,a,product,version,0,{name:"Love Reading",configuration:config()});
  await db.update(schema.stores).set({source:"etsy"}).where(eq(schema.stores.id,a.storeId));
  await db.update(schema.connections).set({status:"connected",encryptedTokens:"synthetic-never-decrypted",scopes:["transactions_r"]}).where(eq(schema.connections.storeId,a.storeId));
  const cutoff=seconds()-120;
  await db.insert(schema.automaticIntake).values({organizationId:a.organizationId,storeId:a.storeId,actorId:a.userId,epoch:0,cutoff,cursor:cutoff});
},20000);
afterEach(async()=>{vi.unstubAllEnvs();await pg.close();});

it("verified HTTP paid event is durable before receipt work; worker imports with no production",async()=>{
  const proof=evidence(),req=new Request("https://reading.example/api/webhooks/etsy",{method:"POST",body:new Uint8Array(proof.rawBody),headers:{"webhook-id":proof.messageId,"webhook-timestamp":proof.timestamp,"webhook-signature":proof.signature}});
  const receipt=reader();expect((await handleEtsyWebhook(req,{secret,accept:e=>acceptVerifiedWebhook(db,e)})).status).toBe(204);
  expect(await state()).toMatchObject({status:"PENDING",epoch:0,organizationId:a.organizationId,storeId:a.storeId});expect(receipt).not.toHaveBeenCalled();expect((await workspaceData(db,a)).orders).toHaveLength(0);
  await runWebhookIntakeTick(db,{receipt});expect(await state()).toMatchObject({status:"SUCCEEDED",result:"IMPORTED",attempts:1,claim:null});
  const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,1,1]);expect(d.units[0].productVersionId).toBe(version);expect((await workspaceData(db,b)).orders).toHaveLength(0);await noExecution();
});
it("fully unconfigured purchase retains title, options, original text and quantity in seller attention",async()=>{
 const r=receipt();r.transactions[0].listing_id=999;r.transactions[0].quantity=3;Object.assign(r.transactions[0],{title:"Purchased Career Reading"});
 const e=event();await acceptVerifiedWebhook(db,e);await acceptVerifiedWebhook(db,e);await runWebhookIntakeTick(db,{receipt:reader(r)});
 const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,1,3]);expect(d.units.map(u=>u.unitIndex).sort()).toEqual([1,2,3]);
 expect(d.units.every(u=>u.productVersionId===null&&u.configurationState==="unconfigured"&&u.issues.includes("unmapped_listing"))).toBe(true);
 expect(d.lines[0].title).toBe("Purchased Career Reading");expect(purchasedChoices(d.lines[0].snapshot)).toHaveLength(2);expect(purchasedAnswers(d.lines[0].snapshot)).toEqual([{label:"Question",value:"Synthetic context",kind:"text"}]);
 const list=await ordersData(db,a,ordersQuery({filter:"attention"}));expect(list.rows.map(o=>o.id)).toEqual([d.orders[0].id]);expect(list.rows[0].count).toBe(3);expect((await orderDetailData(db,a,d.orders[0].id))?.units).toHaveLength(3);
 expect((await workspaceData(db,b)).orders).toHaveLength(0);await expect(buildGenerationContext(db,b,d.units[0].id)).rejects.toThrow();
 for(const unit of d.units){await expect(buildGenerationContext(db,a,unit.id)).rejects.toMatchObject({code:"PRODUCT_SETUP"});expect((await admitReading(db,a,unit.id)).outcome).toBe("ineligible");}
 expect(await rows()).toHaveLength(1);expect(await state()).toMatchObject({status:"ATTENTION",result:"PARTIAL",attempts:1});await noExecution();
});
it.each(["webhook_first","polling_first","concurrent"])("unconfigured %s replay converges and preserves purchase identity",async ordering=>{
 const r=receipt();r.transactions[0].listing_id=999;r.transactions[0].quantity=2;Object.assign(r.transactions[0],{title:"Original purchased title"});await accepted();const p=await polling(r),w={receipt:reader(r)};
 if(ordering==="webhook_first"){await runWebhookIntakeTick(db,w);await runAutomaticIntakeTick(db,p);}else if(ordering==="polling_first"){await runAutomaticIntakeTick(db,p);await runWebhookIntakeTick(db,w);}else await Promise.all([runWebhookIntakeTick(db,w),runAutomaticIntakeTick(db,p)]);
 const before=await workspaceData(db,a);expect([before.orders.length,before.lines.length,before.units.length]).toEqual([1,1,2]);
 Object.assign(r.transactions[0],{title:"Changed live title"});r.updated_timestamp+=10;await syncOrderReceipt(db,a,{receiptId:"900",commandId:randomUUID()},reader(r));const after=await workspaceData(db,a);
 expect(after.lines).toEqual(before.lines);expect(after.orders[0].purchasedSnapshot).toEqual(before.orders[0].purchasedSnapshot);expect(after.units.map(u=>u.id).sort()).toEqual(before.units.map(u=>u.id).sort());expect(after.units.every(u=>u.sourceChanged&&u.productVersionId===null)).toBe(true);await noExecution();
});
it("later setup never reassigns an unconfigured purchase and DB immutability stays authoritative",async()=>{
 const r=receipt();r.transactions[0].variations[0].value_id=99;r.transactions[0].product_data[0].value_ids=[99];await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});const before=await workspaceData(db,a),unit=before.units[0];
 const newPolicy={...policy(),purchaseSelections:policy().purchaseSelections.map(s=>s.propertyId==="513"?{...s,valueIds:["99"]}:s)};
 await db.update(schema.stores).set({source:"fixtures"}).where(eq(schema.stores.id,a.storeId));const p=await beginEtsyProductDraft(db,a,newPolicy),v=(await productData(db,a,p)).draft!.id;await activateProduct(db,a,p,v,0,{name:"New option",configuration:{...config(),etsyFulfillment:newPolicy}});await db.update(schema.stores).set({source:"etsy"}).where(eq(schema.stores.id,a.storeId));
 await syncOrderReceipt(db,a,{receiptId:"900",commandId:randomUUID()},reader(r));expect((await workspaceData(db,a)).units[0].productVersionId).toBeNull();
 await expect(db.update(schema.units).set({productVersionId:v,configurationState:"versioned"}).where(eq(schema.units.id,unit.id))).rejects.toThrow();
 expect((await workspaceData(db,a)).units.map(u=>u.id)).toEqual([unit.id]);await noExecution();
});
it("duplicate and concurrent deliveries produce one immutable obligation",async()=>{
  const e=event();await Promise.all([acceptVerifiedWebhook(db,e),acceptVerifiedWebhook(db,e)]);await acceptVerifiedWebhook(db,e);
  expect(await rows()).toHaveLength(1);const read=reader();await Promise.all([runWebhookIntakeTick(db,{receipt:read}),runWebhookIntakeTick(db,{receipt:read})]);
  expect(read).toHaveBeenCalledTimes(1);expect((await workspaceData(db,a)).units).toHaveLength(1);await noExecution();
});
it("replay identity rejects changed authenticated evidence and never rebinds epoch",async()=>{
  const id="msg_"+randomUUID();await accepted("77","order.paid",id);
  await expect(accepted("77","order.paid",id,"901")).rejects.toThrow("WEBHOOK_ID_CONFLICT");
  await db.update(schema.connections).set({epoch:1}).where(eq(schema.connections.storeId,a.storeId));
  await accepted("77","order.paid",id);expect(await state()).toMatchObject({epoch:0,status:"PENDING"});
  const read=reader();await runWebhookIntakeTick(db,{receipt:read});expect(read).not.toHaveBeenCalled();expect((await state()).status).toBe("ATTENTION");await noExecution();
});
it("unsigned/forged evidence cannot reach durable acceptance",async()=>{
  await expect(acceptVerifiedWebhook(db,{eventId:"forged"} as VerifiedWebhook)).rejects.toThrow("UNVERIFIED_WEBHOOK");expect(await rows()).toHaveLength(0);
});
it("failed durable insert cannot return a successful acknowledgement",async()=>{
  await pg.exec("CREATE FUNCTION fail_webhook_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END; $$; CREATE TRIGGER fail_insert BEFORE INSERT ON etsy_webhook_events FOR EACH ROW EXECUTE FUNCTION fail_webhook_insert();");
  const p=evidence();const req=new Request("https://reading.example",{method:"POST",body:new Uint8Array(p.rawBody),headers:{"webhook-id":p.messageId,"webhook-timestamp":p.timestamp,"webhook-signature":p.signature}});
  expect((await handleEtsyWebhook(req,{secret,accept:e=>acceptVerifiedWebhook(db,e)})).status).toBe(503);expect(await rows()).toHaveLength(0);await noExecution();
});
it("unknown shop is quarantined without tenant binding or receipt fetch",async()=>{
  await accepted("88");expect(await state()).toMatchObject({status:"ATTENTION",errorCode:"UNKNOWN_SHOP",organizationId:null,storeId:null,epoch:null});const read=reader();await runWebhookIntakeTick(db,{receipt:read});expect(read).not.toHaveBeenCalled();expect(await webhookDiagnostics(db,a)).toHaveLength(0);await noExecution();
});
it("ambiguous shop evidence is quarantined even if uniqueness defense were absent",async()=>{
  await pg.exec("ALTER TABLE stores DROP CONSTRAINT stores_source_external_shop_id_unique");
  await db.update(schema.stores).set({source:"etsy",externalShopId:"77"}).where(eq(schema.stores.id,b.storeId));await accepted();
  expect(await state()).toMatchObject({status:"ATTENTION",errorCode:"AMBIGUOUS_SHOP",storeId:null});const read=reader();await runWebhookIntakeTick(db,{receipt:read});expect(read).not.toHaveBeenCalled();await noExecution();
});
it.each(["disconnected","reauthorization_required","missing_scope","revoked_actor"])("acceptance does not authorize a %s connection",async kind=>{
  if(kind==="missing_scope")await db.update(schema.connections).set({scopes:[]}).where(eq(schema.connections.storeId,a.storeId));
  else if(kind==="revoked_actor")await db.update(schema.memberships).set({role:"operator"}).where(eq(schema.memberships.userId,a.userId));
  else await db.update(schema.connections).set({status:kind,encryptedTokens:null}).where(eq(schema.connections.storeId,a.storeId));
  await accepted();const read=reader();await runWebhookIntakeTick(db,{receipt:read});expect(read).not.toHaveBeenCalled();expect((await state()).status).toBe("ATTENTION");expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it.each(["disconnect","epoch","scope","actor"])("worker rechecks %s before external I/O",async kind=>{
  await accepted();
  if(kind==="disconnect")await db.update(schema.connections).set({status:"disconnected",encryptedTokens:null}).where(eq(schema.connections.storeId,a.storeId));
  if(kind==="epoch")await db.update(schema.connections).set({epoch:1}).where(eq(schema.connections.storeId,a.storeId));
  if(kind==="scope")await db.update(schema.connections).set({scopes:[]}).where(eq(schema.connections.storeId,a.storeId));
  if(kind==="actor")await db.update(schema.memberships).set({role:"operator"}).where(eq(schema.memberships.userId,a.userId));
  const read=reader();await runWebhookIntakeTick(db,{receipt:read});expect(read).not.toHaveBeenCalled();expect((await state()).status).toBe("ATTENTION");await noExecution();
});
it.each(["epoch","disconnect","scope","actor"])("post-fetch %s race blocks new order writes",async kind=>{
  await accepted();const read=reader();read.mockImplementationOnce(async()=>{
    if(kind==="epoch")await db.update(schema.connections).set({epoch:1}).where(eq(schema.connections.storeId,a.storeId));
    if(kind==="disconnect")await db.update(schema.connections).set({status:"disconnected",encryptedTokens:null}).where(eq(schema.connections.storeId,a.storeId));
    if(kind==="scope")await db.update(schema.connections).set({scopes:[]}).where(eq(schema.connections.storeId,a.storeId));
    if(kind==="actor")await db.update(schema.memberships).set({role:"operator"}).where(eq(schema.memberships.userId,a.userId));
    return reader()();
  });await runWebhookIntakeTick(db,{receipt:read});expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it.each(["shop","receipt"])("authoritative %s mismatch prevents cross-tenant mutation",async kind=>{
  await accepted();const r=receipt();if(kind==="receipt")r.receipt_id=901;
  const read=reader(r);if(kind==="shop")read.mockResolvedValueOnce({...await reader()(),shopId:"88"});
  await runWebhookIntakeTick(db,{receipt:read});expect((await workspaceData(db,a)).orders).toHaveLength(0);expect((await workspaceData(db,b)).orders).toHaveLength(0);expect((await state()).status).toBe("ATTENTION");await noExecution();
});
it("mixed Love x2 Career x1 preserves exact choices, pins and independent readings",async()=>{
  const p=await beginEtsyProductDraft(db,a,{...policy(),listingId:"102"}),v=(await productData(db,a,p)).draft!.id;
  await activateProduct(db,a,p,v,0,{name:"Career Reading",configuration:config("102")});
  const r=receipt();r.transactions[0].quantity=2;r.transactions.push({...structuredClone(r.transactions[0]),listing_id:102,transaction_id:902,quantity:1});
  await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});const d=await workspaceData(db,a);
  expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,2,3]);expect(d.units.filter(u=>u.productVersionId===version).map(u=>u.unitIndex).sort()).toEqual([1,2]);expect(d.units.filter(u=>u.productVersionId===v)).toHaveLength(1);
  expect(d.units.filter(u=>u.productVersionId===version).every(u=>u.issues.includes("quantity_context"))).toBe(true);expect(d.units.find(u=>u.productVersionId===v)?.issues).toEqual([]);expect(d.lines.every(l=>l.variantKey.startsWith("etsy-selection/1:"))).toBe(true);expect((await state()).result).toBe("PARTIAL");await noExecution();
});
it.each(["missing_input","unmapped_choice","paused","canceled","refunded","unpaid"])("conservative %s hold is retained, not silently fulfilled",async kind=>{
  const r=receipt();
  if(kind==="missing_input")r.transactions[0].variations[2].formatted_value="";
  if(kind==="unmapped_choice"){r.transactions[0].variations[0].value_id=99;r.transactions[0].product_data[0].value_ids=[99];}
  if(kind==="paused")await db.update(schema.mappings).set({paused:true}).where(eq(schema.mappings.storeId,a.storeId));
  if(kind==="canceled")r.status="Canceled";if(kind==="refunded")r.status="Fully Refunded";if(kind==="unpaid")r.is_paid=false;
  await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});expect((await state()).status).toBe("ATTENTION");expect((await workspaceData(db,a)).orders).toHaveLength(["canceled","refunded","unpaid"].includes(kind)?0:1);await noExecution();
});
it("held sibling stays independent while the eligible line is imported",async()=>{
  const r=receipt(),held={...structuredClone(r.transactions[0]),transaction_id:902};held.variations[2].formatted_value="";r.transactions.push(held);await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});
  const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,2,2]);expect(d.units.filter(u=>u.issues.length===0)).toHaveLength(1);expect(d.units.filter(u=>u.issues.length>0)).toHaveLength(1);expect((await state()).result).toBe("PARTIAL");await noExecution();
});
it("unmapped ambiguous sibling is captured independently without blocking the configured line",async()=>{
  const r=receipt();r.transactions[0].quantity=2;r.transactions.push({...structuredClone(r.transactions[0]),listing_id:999,transaction_id:902,quantity:1});await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});expect((await state()).status).toBe("ATTENTION");const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,2,3]);expect(d.units.filter(u=>u.productVersionId===version)).toHaveLength(2);expect(d.units.filter(u=>u.configurationState==="unconfigured"&&u.productVersionId===null)).toHaveLength(1);await noExecution();
});
it("webhook cannot bypass the existing 100-reading command bound",async()=>{
  const r=receipt();r.transactions[0].quantity=101;await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});expect((await state()).status).toBe("ATTENTION");expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("historical cutoff remains mandatory despite a freshly signed paid notification",async()=>{
  const r=receipt();r.created_timestamp=1700000000;await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});
  expect(await state()).toMatchObject({status:"ATTENTION",errorCode:"HISTORICAL_APPROVAL_REQUIRED"});expect((await workspaceData(db,a)).orders).toHaveLength(0);expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(0);await noExecution();
});
it("missing ProductVersion cannot manufacture a configuration or success",async()=>{
  await db.update(schema.mappings).set({productId:null}).where(eq(schema.mappings.storeId,a.storeId));await accepted();await runWebhookIntakeTick(db,{receipt:reader()});expect((await state()).status).toBe("ATTENTION");const d=await workspaceData(db,a);expect(d.orders).toHaveLength(1);expect(d.units[0]).toMatchObject({configurationState:"unconfigured",productVersionId:null});await noExecution();
});
it("corrections, original pins and source snapshots survive later webhook replay",async()=>{
  const r=receipt();await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});const d=await workspaceData(db,a);
  await correctInput(db,a,d.units[0].id,0,[{label:"question",value:"Corrected context",kind:"text"}],true);
  const v=await editProduct(db,a,product);await activateProduct(db,a,product,v,0,{name:"Updated product",configuration:config()});
  const before=await workspaceData(db,a),queue=await db.select().from(schema.productionQueue);
  await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});const after=await workspaceData(db,a);
  expect(after.units).toHaveLength(1);expect(after.units[0].productVersionId).toBe(version);expect(after.inputs).toEqual(before.inputs);expect(after.lines).toEqual(before.lines);expect(after.orders[0].purchasedSnapshot).toEqual(before.orders[0].purchasedSnapshot);await noExecution(queue);
});
it("changed source evidence is held without rewriting original purchase identity",async()=>{
  const r=receipt();await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});const before=await workspaceData(db,a);
  r.transactions[0].sku="changed-source";await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});const after=await workspaceData(db,a);expect(after.lines).toEqual(before.lines);expect(after.units).toHaveLength(1);expect(after.units[0].issues).toContain("source_changed");expect((await rows()).find(e=>e.result==="PARTIAL")).toBeDefined();await noExecution();
});
it("worker restart reclaims expired lease but fences the previous token",async()=>{
  await accepted();const e=await state();await db.update(schema.webhookEvents).set({status:"PROCESSING",claim:randomUUID(),leaseUntil:new Date(0),attempts:1}).where(eq(schema.webhookEvents.id,e.id));
  await runWebhookIntakeTick(db,{receipt:reader()});expect(await state()).toMatchObject({status:"SUCCEEDED",attempts:2,claim:null});expect((await workspaceData(db,a)).units).toHaveLength(1);await noExecution();
});
it("crash after intake commit recovers through the same idempotent command",async()=>{
  const r=receipt();await accepted();const e=await state();
  await syncOrderReceipt(db,a,{receiptId:e.receiptId,commandId:e.id},reader(r));
  await db.update(schema.webhookEvents).set({status:"PROCESSING",claim:randomUUID(),leaseUntil:new Date(0),attempts:1}).where(eq(schema.webhookEvents.id,e.id));
  await runWebhookIntakeTick(db,{receipt:reader(r)});expect(await state()).toMatchObject({status:"SUCCEEDED",result:"ALREADY_IMPORTED",attempts:2});expect((await workspaceData(db,a)).units).toHaveLength(1);await noExecution();
});
it("lost or expired lease after external read cannot commit intake",async()=>{
  await accepted();const read=reader();read.mockImplementationOnce(async()=>{await db.update(schema.webhookEvents).set({leaseUntil:new Date(0)});return reader()();});await runWebhookIntakeTick(db,{receipt:read});expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("replaced lease token fences the previous worker and preserves the new claim",async()=>{
  await accepted();const replacement=randomUUID(),read=reader();read.mockImplementationOnce(async()=>{await db.update(schema.webhookEvents).set({claim:replacement});return reader()();});await runWebhookIntakeTick(db,{receipt:read});expect((await state()).claim).toBe(replacement);expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it.each(["timeout","rate_limit","revoked"])("bounded %s failure stores safe retry evidence",async kind=>{
  await accepted();const read=reader();read.mockRejectedValueOnce(kind==="timeout"?new DOMException("synthetic sensitive details","TimeoutError"):new ReceiptPilotError("detail",kind==="revoked"?401:429,120));
  await runWebhookIntakeTick(db,{receipt:read});const e=await state();expect(JSON.stringify(e)).not.toContain("sensitive details");expect(e.errorCode).toBe(kind==="revoked"?"AUTHORIZATION_REQUIRED":kind==="rate_limit"?"RATE_LIMITED":"RETRY_PENDING");
  if(kind!=="revoked"){expect(e.status).toBe("PENDING");await runWebhookIntakeTick(db,{receipt:read,now:new Date(e.nextAt.getTime()+1)});expect((await state()).status).toBe("SUCCEEDED");expect((await workspaceData(db,a)).units).toHaveLength(1);}else expect(e.status).toBe("ATTENTION");await noExecution();
});
it("five attempts are a hard bound, including crash recovery",async()=>{
  await accepted();await db.update(schema.webhookEvents).set({attempts:5,status:"PROCESSING",claim:randomUUID(),leaseUntil:new Date(0)});const read=reader();await runWebhookIntakeTick(db,{receipt:read});expect(read).not.toHaveBeenCalled();expect(await state()).toMatchObject({status:"ATTENTION",attempts:5,errorCode:"RETRY_LIMIT"});await noExecution();
});
it("provider Retry-After is not shortened and restricted retry cannot bypass it",async()=>{
  await accepted();const read=reader();read.mockRejectedValueOnce(new ReceiptPilotError("detail",429,90000));await runWebhookIntakeTick(db,{receipt:read});const e=await state();expect(e.nextAt.getTime()).toBeGreaterThan(Date.now()+89900000);
  await db.update(schema.webhookEvents).set({status:"ATTENTION"}).where(eq(schema.webhookEvents.id,e.id));await expect(retryWebhookEvent(db,a,{id:e.id,commandId:randomUUID()})).rejects.toThrow("RETRY_UNAVAILABLE");await noExecution();
});
it.each(["webhook_first","polling_first","concurrent"])("%s produces one receipt-atomic mixed cart without AI",async ordering=>{
  const r=receipt();r.transactions[0].quantity=2;r.transactions.push({...structuredClone(r.transactions[0]),transaction_id:902,quantity:1});await accepted();const p=await polling(r),w={receipt:reader(r)};
  if(ordering==="webhook_first"){await runWebhookIntakeTick(db,w);await runAutomaticIntakeTick(db,p);}
  else if(ordering==="polling_first"){await runAutomaticIntakeTick(db,p);await runWebhookIntakeTick(db,w);}
  else await Promise.all([runWebhookIntakeTick(db,w),runAutomaticIntakeTick(db,p)]);
  const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,2,3]);expect(d.units.every(u=>u.productVersionId===version)).toBe(true);expect(await db.select().from(schema.automaticReceipts)).toHaveLength(1);expect(await rows()).toHaveLength(1);await noExecution();
});
it.each(["order.canceled","order.shipped","order.delivered"])("%s is safely ignored and cannot mark readings delivered",async type=>{
  await accepted("77",type);const read=reader();await runWebhookIntakeTick(db,{receipt:read});expect(read).not.toHaveBeenCalled();expect(await state()).toMatchObject({status:"SUCCEEDED",result:"IGNORED_EVENT"});expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("diagnostics and retry require internal owner permission and isolate tenants",async()=>{
  const r=receipt();r.transactions[0].variations[2].formatted_value="";await accepted();await runWebhookIntakeTick(db,{receipt:reader(r)});const e=await state(),command={id:e.id,commandId:randomUUID()};
  expect(await webhookDiagnostics(db,a)).toHaveLength(1);expect(await webhookDiagnostics(db,b)).toHaveLength(0);await expect(retryWebhookEvent(db,b,command)).rejects.toThrow();
  vi.stubEnv("INTERNAL_TOOLS_ENABLED","false");await expect(webhookDiagnostics(db,a)).rejects.toThrow();await expect(retryWebhookEvent(db,a,command)).rejects.toThrow();vi.stubEnv("INTERNAL_TOOLS_ENABLED","true");
  await db.insert(schema.memberships).values({organizationId:a.organizationId,userId:b.userId,role:"operator"});const operator=await authorizeStore(db,b.userId,a.storeId);
  await expect(webhookDiagnostics(db,operator)).rejects.toThrow();await expect(retryWebhookEvent(db,operator,command)).rejects.toThrow();
  await retryWebhookEvent(db,a,command);await retryWebhookEvent(db,a,command);expect((await state()).status).toBe("PENDING");expect((await db.select().from(schema.auditLogs)).filter(r=>r.action.startsWith("webhook_retry:"))).toHaveLength(1);await noExecution();
});
it("status reports configuration and observed progress without claiming interoperability",async()=>{
  expect(await webhookIntakeStatus(db,a)).toContain("not yet verified");expect(await webhookIntakeStatus(db,a)).toContain("No order webhook");
  await accepted();expect(await webhookIntakeStatus(db,a)).toContain("was received");await runWebhookIntakeTick(db,{receipt:reader()});expect(await webhookIntakeStatus(db,a)).toContain("intake succeeded");
  vi.stubEnv("ETSY_WEBHOOK_SIGNING_SECRET","");expect(await webhookIntakeStatus(db,a)).toContain("not configured");
});
it("additive constraints reject partial/cross-tenant binding and preserve immutable evidence",async()=>{
  await accepted();const e=await state();
  for(const values of [{bodyHash:"0".repeat(64)},{epoch:1},{shopId:"88"},{storeId:b.storeId}])await expect(db.update(schema.webhookEvents).set(values).where(eq(schema.webhookEvents.id,e.id))).rejects.toMatchObject({cause:{message:"IMMUTABLE_WEBHOOK_EVIDENCE"}});
  const base={eventId:"msg_"+randomUUID(),eventType:"order.paid",shopId:"77",receiptId:"900",bodyHash:"0".repeat(64),signedAt:seconds()};
  await expect(db.insert(schema.webhookEvents).values({...base,organizationId:a.organizationId,storeId:a.storeId,epoch:null})).rejects.toThrow();
  await expect(db.insert(schema.webhookEvents).values({...base,organizationId:a.organizationId,storeId:b.storeId,epoch:0})).rejects.toThrow();expect(await rows()).toHaveLength(1);await noExecution();
});
it("0028 migration is additive and leaves existing connection/checkpoint history untouched",async()=>{
  const separate=new PGlite();try{
    for(const f of readdirSync("drizzle").filter(f=>f.endsWith(".sql")&&f<"0028_").sort())await separate.exec(readFileSync("drizzle/"+f,"utf8"));
    const old=drizzle(separate,{schema}) as unknown as Database;await old.insert(schema.users).values({id:"migration-owner",name:"Synthetic"});const s=await authorizeStore(old,"migration-owner",await createWorkspace(old,"migration-owner","Existing","fixtures"));
    const prior=await old.select().from(schema.connections);await separate.exec(readFileSync("drizzle/0028_etsy_webhook_inbox.sql","utf8"));expect(await old.select().from(schema.connections)).toEqual(prior);expect(await old.select().from(schema.webhookEvents)).toHaveLength(0);expect(s.storeId).toBeTruthy();
  }finally{await separate.close();}
});
it("the generated Drizzle journal applies the complete additive migration in isolation",async()=>{
  const separate=new PGlite();try{const migrated=drizzle(separate,{schema});await migrate(migrated,{migrationsFolder:"drizzle"});expect(await migrated.select().from(schema.webhookEvents)).toHaveLength(0);}finally{await separate.close();}
});
