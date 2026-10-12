import {expect,it,vi} from "vitest";
import {PgDialect} from "drizzle-orm/pg-core";
import {blockAcceptanceNetwork,requireBindings,requireIsolation,requireIdentity,requireCommand,requireNoWorkers,syntheticReceipt,signedRequest,TRANSACTIONS} from "../scripts/acceptance/webhook/safety";
import {webhookEventSelection,runWebhookIntakeTick} from "../src/modules/etsy/webhook-intake";
import {verifyEtsyWebhookSignature} from "../src/modules/etsy/webhook-digest";
import {normalizeEtsyReceipt} from "../src/modules/etsy/raw-normalizer";
import {assessEtsySource,selectionKey} from "../src/modules/etsy/source-contract";
import {policy} from "./fixtures/etsy-source";
import type {Configuration} from "../src/modules/products/contracts";
import type {Database} from "../src/db/client";
import {drizzle} from "drizzle-orm/postgres-js";
import {sql} from "drizzle-orm";
import {webhookEvents} from "../src/db/schema";
const url="postgresql://yusufsafakilic@127.0.0.1:5432/etsy_reading_os_webhook_test";
it("requires explicit exact disposable connection and server identity",()=>{
 expect(requireIsolation(url)).toBe(url);
 for(const value of [undefined,"bad",url.replace("127.0.0.1","localhost"),url.replace("5432","5433"),url.replace("_webhook_test",""),url.replace("yusufsafakilic","postgres"),url+"?host=evil.example"]){expect(()=>requireIsolation(value)).toThrow();}
 const row={database:"etsy_reading_os_webhook_test",role:"yusufsafakilic",address:"127.0.0.1",port:5432};expect(()=>requireIdentity(row)).not.toThrow();
 for(const patch of [{database:"etsy_reading_os"},{role:"other"},{address:"10.0.0.1"},{port:5433}])expect(()=>requireIdentity({...row,...patch})).toThrow();
});
it("write command requires confirmation before database construction; worker flags fail closed",()=>{
 expect(requireCommand(["preflight"])).toBe("preflight");expect(()=>requireCommand(["run"])).toThrow("EXPLICIT_WRITE_CONFIRMATION_REQUIRED");
 expect(requireCommand(["run","--confirm-disposable-db-write"])).toBe("run");
 expect(()=>requireNoWorkers({ETSY_WEBHOOK_WORKER_ENABLED:"true"})).toThrow();expect(()=>requireNoWorkers({ETSY_AUTOMATIC_INTAKE_ENABLED:"true"})).toThrow();
});
const selector={id:"11111111-1111-4111-8111-111111111111",organizationId:"22222222-2222-4222-8222-222222222222",storeId:"33333333-3333-4333-8333-333333333333",shopId:"77",epoch:3,eventId:"msg_acceptance_fixture"};
it("encodes lease timestamps for postgres-js instead of passing Date to its wire encoder",async()=>{
 const now=new Date("2026-10-11T18:00:00.000Z");
 const options={parsers:{} as Record<string,(value:unknown)=>unknown>,serializers:{} as Record<string,(value:unknown)=>unknown>};
 const unsafe=vi.fn((_query:string,params:unknown[])=>({values:async()=>{
  // postgres-js Bind applies the timestamp serializer then bytes.str calls
  // Buffer.byteLength. Drizzle installs a transparent timestamp serializer.
  for(const value of params){
   const encoded=value instanceof Date?options.serializers["1184"](value):String(value);
   Buffer.byteLength(encoded as string);
  }
  return [];
 }}));
 const db=drizzle({options,unsafe} as unknown as import("postgres").Sql);
 const oldQuery=new PgDialect().sqlToQuery(sql`${webhookEvents.leaseUntil}<${now}`);
 expect(oldQuery.params[0]).toBe(now);
 expect(()=>Buffer.byteLength(options.serializers["1184"](oldQuery.params[0]) as string)).toThrow(TypeError);
 const receipt=vi.fn();
 await expect(runWebhookIntakeTick(db as unknown as Database,{selector,now,receipt})).resolves.toBeUndefined();
 expect(unsafe).toHaveBeenCalledOnce();
 expect(unsafe.mock.calls[0][1]).toEqual(expect.arrayContaining([now.toISOString(),selector.id,selector.eventId,selector.storeId,selector.epoch]));
 expect(unsafe.mock.calls[0][1].some(value=>value instanceof Date)).toBe(false);
 expect(receipt).not.toHaveBeenCalled();
});
it("target predicate includes every event/store/shop/epoch identity without broad selection",()=>{
 const q=new PgDialect().sqlToQuery(webhookEventSelection(selector)!);
 expect(q.params).toEqual([selector.id,selector.eventId,selector.organizationId,selector.storeId,selector.shopId,3,"order.paid"]);
 for(const field of ["id","event_id","organization_id","store_id","shop_id","epoch"])expect(q.sql).toContain(`"${field}"`);
 expect(()=>webhookEventSelection({...selector,eventId:"invalid message id"})).toThrow();expect(()=>webhookEventSelection({...selector,epoch:-1})).toThrow();
});
it("unmatched targeted event cannot claim unrelated work or fetch a receipt",async()=>{
 let predicate:unknown;
 const limit=vi.fn(async()=>[]),orderBy=vi.fn(()=>({limit})),where=vi.fn((q)=>{predicate=q;return {orderBy};}),from=vi.fn(()=>({where}));
 const receipt=vi.fn(),transaction=vi.fn(),update=vi.fn();
 await runWebhookIntakeTick({select:()=>({from}),transaction,update} as unknown as Database,{selector,receipt});
 expect(new PgDialect().sqlToQuery(predicate as Parameters<PgDialect["sqlToQuery"]>[0]).params).toEqual(expect.arrayContaining(Object.values(selector)));
 expect(transaction).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();expect(receipt).not.toHaveBeenCalled();
});
const config=(listingId:string):Configuration=>({etsyFulfillment:{...policy(),listingId},inputs:[{id:"question",key:"question",label:"Question",type:"LONG_TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"body",title:"Reading",instruction:"",sortOrder:0}],output:"PDF",workflow:"ASSISTED"});
it("synthetic contract preserves mixed quantities, exact choices and mapped personalization",()=>{
 const configs=[config("101"),config("102")];const body=syntheticReceipt(configs.map((configuration,i)=>({configuration,versionId:`version-${i}`})),1791722935);
 const sources=normalizeEtsyReceipt(body,{verifiedShopId:"77",observedAt:1791722935000});
 expect(sources).toHaveLength(2);expect(sources.map(s=>s.transaction.quantity)).toEqual([2,1]);expect(sources.reduce((n,s)=>n+s.transaction.quantity,0)).toBe(3);
 expect(sources.map(s=>s.transaction.transactionId)).toEqual([...TRANSACTIONS]);
 for(const [i,s] of sources.entries()){expect(assessEtsySource(s,configs[i].etsyFulfillment).issues).toEqual([]);expect(selectionKey(s.purchaseSelections.map(p=>({propertyId:p.propertyId,valueIds:p.valueIds.presence==="value"?p.valueIds.value:[]})))).toBe(selectionKey(configs[i].etsyFulfillment!.purchaseSelections));}
});
it("non-test webhook is authenticated by production v1 verification with an isolated key",async()=>{
 const secret="whsec_"+Buffer.from("synthetic-acceptance-key").toString("base64"),now=1791722935;
 const {request,eventId}=signedRequest("77",secret,now,"msg_acceptance_fixture");
 expect(eventId).toBe("msg_acceptance_fixture");expect(request.headers.has("webhook-test")).toBe(false);
 expect(verifyEtsyWebhookSignature({messageId:eventId,timestamp:String(now),signature:request.headers.get("webhook-signature")!,secret,rawBody:new Uint8Array(await request.arrayBuffer()),nowSeconds:now})).toBe(true);
});

it("receipt verification requires exact quantity expansion and historical version pins",()=>{
 const lines=[{id:"love",externalId:TRANSACTIONS[0],quantity:2},{id:"career",externalId:TRANSACTIONS[1],quantity:1}];
 const units=[{lineItemId:"love",productVersionId:"v-love"},{lineItemId:"love",productVersionId:"v-love"},{lineItemId:"career",productVersionId:"v-career"}];
 expect(()=>requireBindings(lines,units,["v-love","v-career"])).not.toThrow();
 expect(()=>requireBindings(lines,units.slice(1),["v-love","v-career"])).toThrow();
 expect(()=>requireBindings(lines,units,["v-new","v-career"])).toThrow("PINNED_VERSION_MISMATCH");
});

it("acceptance network guard rejects accidental Etsy/AI dispatch without making requests",async()=>{
 const original=globalThis.fetch;
 try{blockAcceptanceNetwork();await expect(fetch("https://api.etsy.com/v3/application/shops/77/receipts/900")).rejects.toThrow("ACCEPTANCE_NETWORK_DISPATCH_FORBIDDEN");}
 finally{globalThis.fetch=original;}
});

it("extracts named postgres-js RowList identity and rejects invalid shapes/types",async()=>{
 const {identityFromResult}=await import("../scripts/acceptance/webhook/safety");
 const row={database:"etsy_reading_os_webhook_test",role:"yusufsafakilic",address:"127.0.0.1",port:5432};
 const rows=Object.assign([row],{count:1,command:"SELECT"});expect(identityFromResult(rows)).toEqual(row);
 for(const result of [{rows:[row]},[],[row,row],[[Object.values(row)]],[{...row,port:"5432"}],[{...row,address:"127.0.0.1/32"}],[{...row,database:"etsy_reading_os"}]])expect(()=>identityFromResult(result)).toThrow();
});
it("installed Drizzle postgres-js execute preserves named row objects without values mode",async()=>{
 const {drizzle}=await import("drizzle-orm/postgres-js");const {sql}=await import("drizzle-orm");
 const row={database:"etsy_reading_os_webhook_test",role:"yusufsafakilic",address:"127.0.0.1",port:5432};
 const unsafe=vi.fn(async()=>[row]);
 const client={unsafe,options:{parsers:{},serializers:{}}};
 const db=drizzle(client as unknown as import("postgres").Sql);
 expect(await db.execute(sql`select host(inet_server_addr()) as address`)).toEqual([row]);
 expect(unsafe).toHaveBeenCalledOnce();
});
it("supports single product mode and preserves mixed cart argument mode",async()=>{
 const {productArguments,expectedCounts}=await import("../scripts/acceptance/webhook/safety");
 expect(productArguments(["--product-id","one"])).toEqual(["one"]);
 expect(productArguments(["--love-product-id","love","--career-product-id","career"])).toEqual(["love","career"]);
 expect(()=>productArguments(["--product-id","one","--career-product-id","career"])).toThrow();
 expect(expectedCounts(1)).toEqual({lines:1,readings:1,quantityHoldCount:0});
 const configuration=config("101"),body=syntheticReceipt([{configuration,versionId:"version-one"}],1791722935);
 const sources=normalizeEtsyReceipt(body,{verifiedShopId:"77",observedAt:1791722935});
 expect(sources).toHaveLength(1);expect(sources[0].transaction.quantity).toBe(1);expect(assessEtsySource(sources[0],configuration.etsyFulfillment).issues).toEqual([]);
 expect(()=>requireBindings([{id:"one",externalId:TRANSACTIONS[0],quantity:1}],[{lineItemId:"one",productVersionId:"version-one"}],["version-one"])).not.toThrow();
});

it("real message selection retains exact identity and topic fences",()=>{
 const real={...selector,eventId:"msg_real_Etsy_delivery"};
 const q=new PgDialect().sqlToQuery(webhookEventSelection(real)!);
 expect(q.params).toEqual([real.id,real.eventId,real.organizationId,real.storeId,real.shopId,real.epoch,"order.paid"]);
});
it("live processing requires explicit write confirmation",()=>{
 expect(requireCommand(["inspect-live"])).toBe("inspect-live");
 expect(()=>requireCommand(["process-live"])).toThrow("EXPLICIT_WRITE_CONFIRMATION_REQUIRED");
 expect(requireCommand(["process-live","--confirm-disposable-db-write"])).toBe("process-live");
});
it("live eligibility rejects wrong tenant/store/shop/epoch, unrelated events and completed duplicates",async()=>{
 const {requireLiveEvent}=await import("../scripts/acceptance/webhook/live");
 const now=new Date(),event={...selector,eventType:"order.paid",status:"PENDING",attempts:0,nextAt:new Date(now.getTime()-1),leaseUntil:null};
 expect(()=>requireLiveEvent(event,selector,now)).not.toThrow();
 for(const patch of [{id:"other"},{eventId:"other"},{organizationId:"other"},{storeId:"other"},{shopId:"other"},{epoch:4},{eventType:"order.canceled"}])expect(()=>requireLiveEvent({...event,...patch},selector,now)).toThrow("LIVE_EVENT_BINDING_MISMATCH");
 for(const patch of [{status:"SUCCEEDED"},{status:"ATTENTION"},{status:"PROCESSING"},{attempts:5},{nextAt:new Date(now.getTime()+1000)},{status:"PROCESSING",leaseUntil:new Date(now.getTime()+1000)}])expect(()=>requireLiveEvent({...event,...patch},selector,now)).toThrow("LIVE_EVENT_NOT_ELIGIBLE");
 expect(()=>requireLiveEvent({...event,status:"PROCESSING",leaseUntil:new Date(now.getTime()-1)},selector,now)).not.toThrow();
});
it("live outbound guard permits only selected receipt GET and forbids redirects, refresh, AI and unrelated receipts",async()=>{
 const {restrictLiveReceiptNetwork}=await import("../scripts/acceptance/webhook/live");
 const original=globalThis.fetch,fetcher=vi.fn(async()=>new Response("{}"));globalThis.fetch=fetcher;
 const restore=restrictLiveReceiptNetwork("77","123");
 try{
  await fetch("https://api.etsy.com/v3/application/shops/77/receipts/123",{method:"GET",redirect:"error"});
  for(const [url,init] of [["https://api.etsy.com/v3/application/shops/77/receipts/124",{method:"GET",redirect:"error"}],["https://api.etsy.com/v3/application/shops/77/receipts/123",{method:"GET",redirect:"follow"}],["https://api.etsy.com/v3/public/oauth/token",{method:"POST"}],["https://example.com/ai",{method:"POST"}]] as const)await expect(fetch(url,init)).rejects.toThrow("ACCEPTANCE_NETWORK_DISPATCH_FORBIDDEN");
  expect(fetcher).toHaveBeenCalledOnce();
 }finally{restore();globalThis.fetch=original;}
});
