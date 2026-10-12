import {randomBytes,randomUUID} from "node:crypto";
import {readMigrationFiles} from "drizzle-orm/migrator";
import postgres from "postgres";
import {drizzle} from "drizzle-orm/postgres-js";
import {and,eq,inArray,sql as query} from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import type {Database} from "../../../src/db/client";
import {verifyScope,tenantWhere} from "../../../src/modules/intake/service";
import {assessReceiptForIntake} from "../../../src/modules/etsy/controlled-intake";
import {configurationSchema} from "../../../src/modules/products/contracts";
import {selectionKey} from "../../../src/modules/etsy/source-contract";
import {handleEtsyWebhook} from "../../../src/modules/etsy/webhook-receiver";
import {acceptVerifiedWebhook,runWebhookIntakeTick} from "../../../src/modules/etsy/webhook-intake";
import {ordersData} from "../../../src/modules/orders/service";
import {ordersQuery} from "../../../src/modules/orders/query";
import {orderDetailData} from "../../../src/modules/orders/detail";
import {dashboardData} from "../../../src/modules/dashboard/service";
import {identityFromResult,productArguments,expectedCounts,blockAcceptanceNetwork,requireBindings,requireCommand,requireIsolation,requireNoWorkers,syntheticReceipt,signedRequest,RECEIPT_ID,TRANSACTIONS} from "./safety";

import {acceptanceTransaction,safeErrorCode,type RunDiagnostic} from "./diagnostics";
import {inspectLive,processLive} from "./live";
const diagnostic:RunDiagnostic={stage:"ARGUMENTS_AND_ISOLATION",transaction:"NOT_STARTED"};
function stage(name:string){diagnostic.stage=name;}

function must(value:unknown,code:string):asserts value{if(!value)throw new Error(code);}
const args=process.argv.slice(2);
function option(name:string){const at=args.indexOf(name);must(at>=0&&args[at+1]&&!args[at+1].startsWith("--"),`REQUIRED_${name.replace(/-/g,"_").toUpperCase()}`);return args[at+1];}
async function serverIdentity(db:Database){const result=await db.execute(query`select current_database() as database,current_user as role,host(inet_server_addr()) as address,inet_server_port() as port`);identityFromResult(result);}
async function preflight(db:Database){
 stage("SERVER_IDENTITY");await serverIdentity(db);
 stage("MIGRATIONS");
 const applied=await db.execute(query`select hash from drizzle.__drizzle_migrations`);
 const hashes=new Set(applied.map(r=>String(r.hash)));
 must(readMigrationFiles({migrationsFolder:"./drizzle"}).every(m=>hashes.has(m.hash)),"REQUIRED_MIGRATIONS_MISSING_OR_CHANGED");
 stage("STORE_CONNECTION_AND_EPOCH");
 const storeId=option("--store-id"),productIds=productArguments(args);
 const expected=expectedCounts(productIds.length);
 const [store]=await db.select().from(schema.stores).where(eq(schema.stores.id,storeId));
 must(store?.source==="etsy"&&store.externalShopId,"CONNECTED_ETSY_STORE_REQUIRED");
 const scopeBase={organizationId:store.organizationId,storeId};
 const [grant]=await db.select().from(schema.connections).where(tenantWhere(schema.connections,scopeBase));
 must(grant?.status==="connected"&&grant.encryptedTokens&&grant.scopes.includes("transactions_r"),"CONNECTED_ORDER_READ_GRANT_REQUIRED");
 const [state]=await db.select().from(schema.automaticIntake).where(and(tenantWhere(schema.automaticIntake,scopeBase),eq(schema.automaticIntake.epoch,grant.epoch)));
 must(state,"OAUTH_INITIALIZATION_REQUIRED");const scope={...scopeBase,userId:state.actorId};await verifyScope(db,scope,true);
 stage("ACTIVE_PRODUCTS_AND_MAPPINGS");
 const products=[];
 for(const productId of productIds){
  const [product]=await db.select().from(schema.products).where(and(tenantWhere(schema.products,scope),eq(schema.products.id,productId)));
  must(product?.activeVersionId,"ACTIVE_PRODUCT_VERSION_REQUIRED");
  const [version]=await db.select().from(schema.productVersions).where(and(tenantWhere(schema.productVersions,scope),eq(schema.productVersions.id,product.activeVersionId),eq(schema.productVersions.productId,productId),eq(schema.productVersions.status,"ACTIVE")));
  must(version?.activatedAt,"ACTIVE_PRODUCT_VERSION_REQUIRED");
  const configuration=configurationSchema.parse(version.configuration),policy=configuration.etsyFulfillment;
  must(policy?.fulfillment==="READING","EXACT_ETSY_READING_POLICY_REQUIRED");
  const [mapping]=await db.select().from(schema.mappings).where(and(tenantWhere(schema.mappings,scope),eq(schema.mappings.productId,productId),eq(schema.mappings.listingExternalId,policy.listingId),eq(schema.mappings.variantKey,selectionKey(policy.purchaseSelections))));
  must(mapping&&!mapping.paused,"EXACT_UNPAUSED_LISTING_VARIANT_MAPPING_REQUIRED");
  products.push({versionId:version.id,configuration,activatedAt:version.activatedAt});
 }
 const now=Math.floor(Date.now()/1000),created=now-1;
 must(created>=state.cutoff&&products.every(p=>created>=Math.ceil(p.activatedAt.getTime()/1000)),"WAIT_FOR_CURRENT_ACTIVATION_AND_OAUTH_CUTOFF");
 // Global collision check, not only the selected tenant. Never overwrite or adopt an existing receipt.
 stage("SYNTHETIC_ID_COLLISION_CHECK");
 const collision=await db.execute(query`select exists(select 1 from orders where external_id=${RECEIPT_ID}) or exists(select 1 from order_line_items where external_id in (${TRANSACTIONS[0]},${TRANSACTIONS[1]})) or exists(select 1 from etsy_webhook_events where receipt_id=${RECEIPT_ID}) as collision`);
 must(!collision[0].collision,"SYNTHETIC_ID_COLLISION_STOP");
 stage("RECEIPT_FIXTURE_ASSESSMENT");
 const body=syntheticReceipt(products,created);
 const assessment=await assessReceiptForIntake(db,scope,body,now);
 const unexpectedHold=Object.keys(assessment.report.holdReasons).find(k=>!(expected.quantityHoldCount>0&&k==="quantity_context"));
 if(unexpectedHold)throw new Error(`FIXTURE_HOLD_${unexpectedHold.toUpperCase()}`);
 must(assessment.report.exactResolved===expected.lines&&assessment.report.intendedLines===expected.lines&&assessment.report.intendedReadings===expected.readings,"FIXTURE_MAPPING_OR_CONTRACT_UNRESOLVED");
 must(Object.values(assessment.resolvedVersions).length===expected.lines&&products.every(p=>Object.values(assessment.resolvedVersions).includes(p.versionId)),"VERSION_BINDING_MISMATCH");
 return {scope,shopId:store.externalShopId,epoch:grant.epoch,body,products,now,expected};
}
async function run(db:Database){
 // Lock guards concurrent runner executions; transaction and identity checks precede intake writes.
 stage("ACCEPTANCE_LOCK");
 await db.execute(query`select pg_advisory_xact_lock(6202001)`);
 const p=await preflight(db);
 stage("BASELINE_QUERIES");
 const before=await dashboardData(db,p.scope,7,new Date());
 const sideEffects=async()=>db.execute(query`select (select count(*) from production_queue) as queue,(select count(*) from generations) as generation,(select count(*) from ai_requests) as ai,(select count(*) from document_artifacts) as artifacts`);
 const untouched=JSON.stringify(await sideEffects());
 const otherEvents=await db.select().from(schema.webhookEvents);
 const secret="whsec_"+randomBytes(32).toString("base64");
 const eventId="msg_acceptance_"+randomUUID();
 const send=()=>handleEtsyWebhook(signedRequest(p.shopId,secret,p.now,eventId).request,{secret,nowSeconds:p.now,accept:async event=>{stage("INBOX_PERSISTENCE");try{return await acceptVerifiedWebhook(db,event);}catch(error){diagnostic.failureCode=safeErrorCode(error);throw error;}}});
 stage("SIGNED_WEBHOOK_RECEIVER");must((await send()).status===204,"RECEIVER_NOT_ACKNOWLEDGED");
 stage("DUPLICATE_WEBHOOK");must((await send()).status===204,"DUPLICATE_NOT_ACKNOWLEDGED");
 stage("INBOX_VERIFICATION");
 const events=await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.eventId,eventId));
 must(events.length===1,"DUPLICATE_INBOX");const event=events[0];
 must(event.organizationId===p.scope.organizationId&&event.storeId===p.scope.storeId&&event.shopId===p.shopId&&event.epoch===p.epoch&&event.receiptId===RECEIPT_ID&&event.status==="PENDING","INBOX_BINDING_MISMATCH");
 let reads=0;
 stage("TARGETED_WORKER");
 await runWebhookIntakeTick(db,{selector:{id:event.id,eventId,...p.scope,shopId:p.shopId,epoch:p.epoch},receipt:async(_db,scope,receiptId)=>{
  stage("CONTROLLED_RECEIPT_ADAPTER");
  must(scope.organizationId===p.scope.organizationId&&scope.storeId===p.scope.storeId&&receiptId===RECEIPT_ID,"WRONG_RECEIPT_SELECTION");reads++;stage("ORDER_INTAKE");return {body:p.body,shopId:p.shopId,epoch:p.epoch,evidence:[]};
 }});
 stage("WORKER_OUTCOME_VERIFICATION");
 must(reads===1,"EXPECTED_ONE_FIXTURE_READ");
 const [settled]=await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id,event.id));
 must(p.expected.quantityHoldCount?settled.status==="ATTENTION"&&settled.result==="PARTIAL":settled.status==="SUCCEEDED"&&settled.result==="IMPORTED","UNEXPECTED_INTAKE_OUTCOME");
 stage("ORDER_DETAIL_AND_VERSION_BINDING");
 const [order]=await db.select().from(schema.orders).where(and(tenantWhere(schema.orders,p.scope),eq(schema.orders.externalId,RECEIPT_ID)));
 must(order,"ORDER_MISSING");const detail=await orderDetailData(db,p.scope,order.id);
 must(detail&&detail.lines.length===p.expected.lines&&detail.units.length===p.expected.readings,"CARDINALITY_MISMATCH");
 requireBindings(detail.lines,detail.units,p.products.map(p=>p.versionId));
 must(detail.units.every(u=>u.issues.every(issue=>issue==="quantity_context"))&&detail.units.filter(u=>u.issues.includes("quantity_context")).length===p.expected.quantityHoldCount,"UNEXPECTED_READING_HOLDS");
 must(detail.inputs.length===p.expected.readings&&detail.inputs.every(i=>i.answers.some(a=>a.value==="Synthetic acceptance context")),"PERSONALIZATION_NOT_PERSISTED");
 stage("ORDERS_QUERY_VERIFICATION");
 const list=await ordersData(db,p.scope,ordersQuery({q:RECEIPT_ID}));must(list.rows.some(o=>o.id===order.id&&o.count===p.expected.readings),"ORDERS_QUERY_MISSING");
 stage("DASHBOARD_QUERY_VERIFICATION");
 const after=await dashboardData(db,p.scope,7,new Date(Date.now()+1000));
 must(after.metrics.total===before.metrics.total+1&&after.analytics.orders===before.analytics.orders+1&&after.recent.some(o=>o.id===order.id),"DASHBOARD_QUERY_MISMATCH");
 stage("SIDE_EFFECT_AND_UNRELATED_EVENT_VERIFICATION");
 must(JSON.stringify(await sideEffects())===untouched,"UNEXPECTED_PRODUCTION_OR_AI_SIDE_EFFECT");
 const oldRows=await db.select().from(schema.webhookEvents).where(inArray(schema.webhookEvents.id,otherEvents.map(e=>e.id)));
 must(JSON.stringify(oldRows.sort((a,b)=>a.id.localeCompare(b.id)))===JSON.stringify(otherEvents.sort((a,b)=>a.id.localeCompare(b.id))),"UNRELATED_EVENT_CHANGED");
 return {status:"PASS",receiptId:RECEIPT_ID,orderId:order.id,storeId:p.scope.storeId,lineItems:p.expected.lines,readings:p.expected.readings,inboxStatus:settled.status,result:settled.result,orderStatus:list.rows.find(o=>o.id===order.id)?.status,versions:p.products.map(p=>p.versionId),queries:"PASS",visualUI:"PENDING",routes:{dashboard:"/store",orders:"/orders",detail:`/orders/${order.id}`}};
}
async function main(){
 const command=requireCommand(args);requireNoWorkers(process.env);const url=requireIsolation(process.env.DATABASE_URL);
 // All outbound fetches fail, including accidental receipt/AI/delivery dispatch.
 if(command!=="process-live")blockAcceptanceNetwork();
 stage("DATABASE_CLIENT_SETUP");
 const client=postgres(url,{max:1,onnotice:()=>{},connection:{default_transaction_read_only:true},connect_timeout:5});
 try{
  const db=drizzle(client,{schema}) as Database;
  stage("SERVER_IDENTITY");await serverIdentity(db);
  if(command==="preflight"){const p=await preflight(db);console.log(JSON.stringify({status:"PASS",mode:"READ_ONLY",storeId:p.scope.storeId,shopId:p.shopId,epoch:p.epoch,versions:p.products.map(p=>p.versionId),expected:{orders:1,lineItems:p.expected.lines,readings:p.expected.readings,hold:p.expected.quantityHoldCount?"quantity_context":null},targetedWorker:"AVAILABLE",visualUI:"PENDING"},null,2));}
  else if(command==="inspect-live"){stage("LIVE_READ_ONLY_INSPECTION");console.log(JSON.stringify(await inspectLive(db,option("--store-id"),option("--shop-id"),Number(option("--epoch"))),null,2));}
  else if(command==="process-live"){const result=await acceptanceTransaction(db,diagnostic,async tx=>{const owned=tx as unknown as Database;stage("TRANSACTION_SERVER_IDENTITY");await serverIdentity(owned);stage("LIVE_SELECTED_EVENT");return processLive(owned,option("--store-id"),option("--shop-id"),Number(option("--epoch")),option("--event-id"));});stage("RESULT_OUTPUT");console.log(JSON.stringify(result,null,2));}
  else {const result=await acceptanceTransaction(db,diagnostic,async tx=>{const owned=tx as unknown as Database;stage("TRANSACTION_SERVER_IDENTITY");await serverIdentity(owned);return run(owned);});stage("RESULT_OUTPUT");console.log(JSON.stringify(result,null,2));}
 }finally{await client.end();}
}
main().catch((error:unknown)=>{
 console.error(JSON.stringify({status:"ACCEPTANCE_ABORTED",stage:diagnostic.stage,code:diagnostic.failureCode??safeErrorCode(error),transaction:diagnostic.transaction}));process.exitCode=1;
});
