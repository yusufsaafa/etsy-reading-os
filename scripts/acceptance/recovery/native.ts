/** HOST ONLY. This module is an executable runner, never imported by tests/application. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {drizzle} from "drizzle-orm/postgres-js";
import {migrate} from "drizzle-orm/postgres-js/migrator";
import {readMigrationFiles} from "drizzle-orm/migrator";
import {and,eq} from "drizzle-orm";
import type {Database} from "../../../src/db/client";
import * as schema from "../../../src/db/schema";
import {authorizeStore,createWorkspace} from "../../../src/modules/identity/service";
import {ingestListing,ingestOrder,workspaceData,correctInput} from "../../../src/modules/intake/service";
import {beginEtsyProductDraft,productData,activateProduct,editProduct} from "../../../src/modules/products/service";
import {assignReadingConfiguration,readingRecoveryData} from "../../../src/modules/orders/assignment";
import {buildGenerationContext} from "../../../src/modules/generation/context";
import {admitReading} from "../../../src/modules/production/service";
import {normalizeEtsyReceipt} from "../../../src/modules/etsy/raw-normalizer";
import {selectionKey,type EtsyProductPolicy} from "../../../src/modules/etsy/source-contract";
import {fixtureListings} from "../../../src/modules/etsy/fixtures";
import {policy} from "../../../tests/fixtures/etsy-source";
import {rawReceipt} from "../../../tests/fixtures/etsy-raw";
import type {Scope} from "../../../src/modules/intake/contracts";
import type {Configuration} from "../../../src/modules/products/contracts";
import {TARGET,ROLE,requireRuntime,requireConfirmation,requireIdentity,requireAbsent,connectionOptions,IdentityMismatch} from "./safety";

const clients: ReturnType<typeof postgres>[]=[];
let stage="prerequisites",created=false,targetOid:number|undefined;
const passed:string[]=[];
const deadline=setTimeout(()=>{console.error("FAIL: RUNNER_DEADLINE_EXCEEDED; database retained, no cleanup performed");process.exit(1);},180000);
let blockedHTTP=0;
// No env-file loading, provider construction, workers, GenerationService, renderer or delivery.
process.env.ETSY_ADAPTER="fixtures";
for(const key of Object.keys(process.env))if(key==="DATABASE_URL"||/^PG/.test(key)||/GEMINI|GOOGLE_API|ETSY.*(TOKEN|KEY|SECRET)|WORKER|AUTOMATIC_INTAKE/.test(key))delete process.env[key];
globalThis.fetch=async()=>{blockedHTTP++;throw new Error("EXTERNAL_HTTP_FORBIDDEN_IN_ACCEPTANCE");};
const open=(database:string)=>{const client=postgres(connectionOptions(database,process.env.RECOVERY_ACCEPTANCE_PASSWORD??""));clients.push(client);return client;};
async function identity(client:ReturnType<typeof postgres>,database:string){
 const rows=await client`SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS address,inet_server_port() AS port,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS oid,pg_backend_pid() AS pid, current_setting('statement_timeout')::interval=interval '20 seconds' AS statement_bounded,current_setting('lock_timeout')::interval=interval '5 seconds' AS lock_bounded,current_setting('idle_in_transaction_session_timeout')::interval=interval '15 seconds' AS idle_bounded`;
 requireIdentity(rows[0],database);
 assert.ok(rows[0].statement_bounded&&rows[0].lock_bounded&&rows[0].idle_bounded,"DATABASE_TIMEOUTS_REQUIRED");
 if(database===TARGET&&targetOid!==undefined)assert.equal(rows[0].oid,targetOid,"DATABASE_OID_CHANGED");
 return rows[0];
}
function command(unitId:string,versionId:string,expectedRevision=0){return {unitId,versionId,expectedRevision,commandId:randomUUID(),confirmed:true};}
const configuration=(p=policy()):Configuration=>({etsyFulfillment:p,inputs:[{id:"question",key:"question",label:"Context",type:"LONG_TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"body",title:"Reading",instruction:"",sortOrder:0}],output:"PDF",workflow:"ASSISTED"});
async function rejects(work:()=>Promise<unknown>,code?:string){
 let error:unknown;try{await work();}catch(e){error=e;}
 assert.ok(error,"EXPECTED_REJECTION");
 if(code)assert.equal((error as {code?:string}).code,code,"UNEXPECTED_REJECTION_CODE");
}
async function sqlRejects(work:()=>Promise<unknown>,message:string){
 let error:unknown;try{await work();}catch(e){error=e;}
 // Drizzle wraps PostgreSQL errors; check only expected fixed database messages.
 const e=error as {message?:string;cause?:{message?:string}}|undefined;
 assert.ok(e && (e.cause?.message??e.message??"").includes(message),"EXPECTED_DATABASE_GUARD_REJECTION");
}

try {
 requireRuntime(process.versions.node);requireConfirmation(process.env);
 assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"codex/ui-ux-design-lock","EXPECTED_BRANCH_REQUIRED");
 assert.equal(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),"034c111bddd9f0ff870f5a7b54118a1143a403cb","EXPECTED_HEAD_REQUIRED");
 const journal=JSON.parse(readFileSync("drizzle/meta/_journal.json","utf8")) as {entries:{idx:number;when:number;tag:string}[]};
 const migrations=readMigrationFiles({migrationsFolder:"drizzle"});
 assert.ok(journal.entries.some(e=>e.tag==="0029_reading_first_assignment"),"MIGRATION_0029_REQUIRED");
 assert.equal(migrations.length,journal.entries.length);
 assert.equal(new Set(journal.entries.map(e=>e.tag)).size,migrations.length);
 for(const [i,e] of journal.entries.entries()){assert.equal(e.idx,i);assert.equal(e.when,migrations[i].folderMillis);if(i)assert.ok(e.when>journal.entries[i-1].when);}
 stage="maintenance identity and creation";
 const maintenance=open("postgres");await identity(maintenance,"postgres");
 const roles=await maintenance`SELECT rolcreatedb,rolsuper FROM pg_roles WHERE rolname=current_user`;
 assert.ok(roles[0]?.rolcreatedb||roles[0]?.rolsuper,"DATABASE_CREATION_PRIVILEGE_REQUIRED");
 requireAbsent(await maintenance`SELECT datname FROM pg_database WHERE datname=${TARGET}`);
 // Fixed, reviewed SQL; no target interpolation, reuse or automatic DROP.
 await maintenance.unsafe('CREATE DATABASE "etsy_reading_os_recovery_acceptance" OWNER "yusufsafakilic" TEMPLATE template0');created=true;
 const first=open(TARGET),second=open(TARGET),control=open(TARGET);
 const id=await identity(first,TARGET);targetOid=id.oid;const id2=await identity(second,TARGET);await identity(control,TARGET);
 assert.notEqual(id.pid,id2.pid,"INDEPENDENT_POSTGRESQL_CONNECTIONS_REQUIRED");
 console.log(`Database: ${TARGET}; role: ${ROLE}; host: 127.0.0.1:5432; independent connections verified`);
 const db=drizzle(first,{schema}) as Database,db2=drizzle(second,{schema}) as Database;
 stage="migrations";
 await identity(first,TARGET);await migrate(db,{migrationsFolder:"drizzle"});
 const migrationRows=await first`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id`;
 assert.equal(migrationRows.length,migrations.length);
 migrations.forEach((m,i)=>{assert.equal(migrationRows[i].hash,m.hash);assert.equal(Number(migrationRows[i].created_at),m.folderMillis);});
 await identity(first,TARGET);await migrate(db,{migrationsFolder:"drizzle"});
 assert.equal(Number((await first`SELECT count(*) AS n FROM drizzle.__drizzle_migrations`)[0].n),migrations.length);
 const triggers=await first`SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid IN ('reading_configuration_assignments'::regclass,'fulfillment_units'::regclass) AND NOT tgisinternal`;
 for(const name of ["reading_assignment_guard","reading_assignment_apply","unit_configuration_immutable"])assert.ok(triggers.some(t=>t.tgname===name&&t.tgenabled==="O"),"REQUIRED_TRIGGER_MISSING");
 const constraints=await first`SELECT conname,contype,convalidated FROM pg_constraint WHERE conrelid='reading_configuration_assignments'::regclass`;
 for(const name of ["assignment_unit_unique","assignment_command_unique","assignment_revision","assignment_evidence"])assert.ok(constraints.some(c=>c.conname===name&&c.convalidated),"ASSIGNMENT_CONSTRAINT_MISSING");
 assert.equal(constraints.filter(c=>c.contype==="f"&&c.convalidated).length,3);
 const unitConstraints=await first`SELECT conname,convalidated FROM pg_constraint WHERE conrelid='fulfillment_units'::regclass`;
 for(const name of ["unit_owned_version_fk","unit_configuration_state"])assert.ok(unitConstraints.some(c=>c.conname===name&&c.convalidated));
 passed.push("migration sequence, hashes/journal replay, tables, triggers and constraints");

 stage="synthetic fixtures";await identity(first,TARGET);
 async function tenant(name:string,shop:string){const userId="recovery-acceptance-"+randomUUID();await db.insert(schema.users).values({id:userId,name});const scope=await authorizeStore(db,userId,await createWorkspace(db,userId,name,"fixtures"),true);await db.update(schema.stores).set({externalShopId:shop}).where(eq(schema.stores.id,scope.storeId));for(const listing of fixtureListings)await ingestListing(db,scope,listing);return scope;}
 const a=await tenant("Synthetic recovery studio A","77"),b=await tenant("Synthetic recovery studio B","88");
 let receipt=900;
 async function capture(quantity=1){
  const r=rawReceipt();const receiptId=String(receipt+=10),transactionId=String(receipt+1);r.receipt_id=Number(receiptId);r.transactions[0].receipt_id=Number(receiptId);r.transactions[0].transaction_id=Number(transactionId);r.transactions[0].quantity=quantity;
  const source=normalizeEtsyReceipt(JSON.stringify(r),{verifiedShopId:"77",observedAt:1700000020})[0];
  await ingestOrder(db,a,{externalId:receiptId,buyerName:"Synthetic buyer",createdAt:1700000000,updatedAt:1700000010,paid:true,canceled:false,refund:"none",lines:[{externalId:transactionId,listingId:"101",title:"Synthetic historical purchase",quantity,sku:"SYNTHETIC",variantKey:selectionKey(policy().purchaseSelections),variations:[],answers:[],digital:false,etsySource:source}]},{suppressProductionAdmission:true});
  const data=await workspaceData(db,a),line=data.lines.find(l=>l.externalId===transactionId)!;return data.units.filter(u=>u.lineItemId===line.id).sort((x,y)=>x.unitIndex-y.unitIndex);
 }
 async function publish(p=policy(),scope=a){const product=await beginEtsyProductDraft(db,scope,p),version=(await productData(db,scope,product)).draft!.id;await activateProduct(db,scope,product,version,0,{name:"Synthetic approved reading",configuration:configuration(p)});return {product,version};}
 const [unit]=await capture();const valid=await publish();
 async function noWork(){for(const table of [schema.productionQueue,schema.generations,schema.aiRequests,schema.usageEvents,schema.documentSnapshots,schema.documentArtifacts])assert.equal((await db.select().from(table)).length,0,"UNEXPECTED_GENERATION_AI_OR_DOCUMENT_WRITE");assert.equal(blockedHTTP,0,"EXTERNAL_HTTP_ATTEMPTED");}
 async function test(name:string,work:()=>Promise<void>){stage=name;await identity(first,TARGET);await identity(second,TARGET);await work();await noWork();passed.push(name);console.log(`PASS: ${name}`);}
 async function decision(unitId=unit.id,versionId=valid.version){const d=await workspaceData(db,a),u=d.units.find(x=>x.id===unitId)!,line=d.lines.find(l=>l.id===u.lineItemId)!;return {organizationId:a.organizationId,storeId:a.storeId,unitId,productVersionId:versionId,actorId:a.userId,commandId:randomUUID(),expectedRevision:u.revision,sourceEvidence:line.snapshot.etsySource!};}
 await test("unconfigured generation rejection and raw SQL first-binding guard",async()=>{await rejects(()=>buildGenerationContext(db,a,unit.id),"PRODUCT_SETUP");await sqlRejects(()=>db.update(schema.units).set({productVersionId:valid.version,configurationState:"versioned"}).where(eq(schema.units.id,unit.id)),"UNIT_CONFIGURATION_IMMUTABLE");});
 await test("valid first assignment, purchase identity and generation context",async()=>{
  const before=await workspaceData(db,a);assert.ok((await readingRecoveryData(db,a,unit.id)).candidates.some(c=>c.id===valid.version));
  assert.equal((await assignReadingConfiguration(db,a,command(unit.id,valid.version))).kind,"ASSIGNED");const after=await workspaceData(db,a);
  assert.deepEqual(after.orders,before.orders);assert.deepEqual(after.lines,before.lines);assert.deepEqual(after.inputs,before.inputs);
  const winner=after.units.find(u=>u.id===unit.id)!;assert.equal(winner.lineItemId,unit.lineItemId);assert.equal(winner.unitIndex,unit.unitIndex);assert.equal(winner.revision,unit.revision);assert.equal(winner.productVersionId,valid.version);assert.equal(winner.configurationState,"versioned");
  const context=await db.transaction(tx=>buildGenerationContext(tx,a,unit.id),{isolationLevel:"repeatable read"});assert.equal(context.product.id,valid.version);assert.equal(context.customer.answers[0].value,"Synthetic context");assert.equal((await admitReading(db,a,unit.id)).outcome,"manual");
 });
 const next=await editProduct(db,a,valid.product);await activateProduct(db,a,valid.product,next,0,{name:"Synthetic second version",configuration:configuration()});
 await test("same-version replay and different-version conflict",async()=>{assert.equal((await assignReadingConfiguration(db,a,command(unit.id,valid.version))).kind,"ALREADY_ASSIGNED");await rejects(()=>assignReadingConfiguration(db,a,command(unit.id,next)),"ASSIGNMENT_CONFLICT");});
 await test("configured binding and approval remain immutable in native SQL",async()=>{
  await sqlRejects(()=>db.update(schema.units).set({productVersionId:next}).where(eq(schema.units.id,unit.id)),"UNIT_CONFIGURATION_IMMUTABLE");
  await sqlRejects(()=>db.update(schema.units).set({productVersionId:null,configurationState:"unconfigured"}).where(eq(schema.units.id,unit.id)),"UNIT_CONFIGURATION_IMMUTABLE");
  await sqlRejects(()=>db.update(schema.readingAssignments).set({expectedRevision:99}).where(eq(schema.readingAssignments.unitId,unit.id)),"ASSIGNMENT_IMMUTABLE");
  assert.equal((await workspaceData(db,a)).units.find(u=>u.id===unit.id)?.productVersionId,valid.version);
 });
 const [held]=await capture();const foreign=await publish(policy(),b),wrong=await publish({...policy(),listingId:"102"}),optionPolicy:EtsyProductPolicy={...policy(),purchaseSelections:policy().purchaseSelections.map(s=>s.propertyId==="513"?{...s,valueIds:["99"]}:s)},options=await publish(optionPolicy);
 await test("cross-tenant, wrong listing and wrong variation rejection",async()=>{
  await rejects(()=>assignReadingConfiguration(db,b,command(held.id,next)));await rejects(()=>assignReadingConfiguration(db,{...a,userId:b.userId},command(held.id,next)));
  await rejects(()=>assignReadingConfiguration(db,a,command(held.id,foreign.version)),"VERSION_REQUIRED");await rejects(()=>assignReadingConfiguration(db,a,command(held.id,wrong.version)),"LISTING_MISMATCH");await rejects(()=>assignReadingConfiguration(db,a,command(held.id,options.version)),"OPTIONS_MISMATCH");
  for(const v of [foreign.version,wrong.version,options.version])await rejects(async()=>db.insert(schema.readingAssignments).values(await decision(held.id,v)));
  assert.equal((await workspaceData(db,a)).units.find(u=>u.id===held.id)?.productVersionId,null);
 });
 await test("customer revisions preserved and readiness holds retained",async()=>{
  await correctInput(db,a,held.id,0,[{label:"question",value:"Synthetic seller correction",kind:"text"}],true);const before=await workspaceData(db,a);
  await rejects(()=>assignReadingConfiguration(db,a,command(held.id,next)),"STALE_INFORMATION");await assignReadingConfiguration(db,a,command(held.id,next,1));const after=await workspaceData(db,a);assert.deepEqual(after.inputs,before.inputs);assert.deepEqual(after.lines,before.lines);assert.equal((await buildGenerationContext(db,a,held.id)).customer.answers[0].value,"Synthetic seller correction");
  const [empty]=await capture();await correctInput(db,a,empty.id,0,[],true);await assignReadingConfiguration(db,a,command(empty.id,next,1));await rejects(()=>buildGenerationContext(db,a,empty.id),"CUSTOMER_INFORMATION");
 });
 await test("quantity-expanded IDs and untouched siblings preserved",async()=>{
  const units=await capture(3);await assignReadingConfiguration(db,a,command(units[1].id,next));const after=await workspaceData(db,a);for(const u of units){const current=after.units.find(x=>x.id===u.id)!;assert.equal(current.lineItemId,u.lineItemId);assert.equal(current.unitIndex,u.unitIndex);assert.equal(current.productVersionId,u.id===units[1].id?next:null);}await rejects(()=>buildGenerationContext(db,a,units[1].id),"CUSTOMER_INFORMATION");
 });
 async function race(unitId:string,versions:[string,string]){
  // Hold the Store lock on a third connection until BOTH independently identified
  // service connections are waiting. Proves real lock contention, not Promise-only overlap.
  let release!:()=>void,ready!:()=>void;const gate=new Promise<void>(r=>release=r),locked=new Promise<void>(r=>ready=r);
  const holder=control.begin(async tx=>{await tx`SELECT id FROM stores WHERE id=${a.storeId} FOR UPDATE`;ready();await gate;});
  await Promise.race([locked,holder.then(()=>{throw new Error("CONCURRENCY_BARRIER_FAILED");})]);
  const attempts=Promise.allSettled([assignReadingConfiguration(db,a,command(unitId,versions[0])),assignReadingConfiguration(db2,a,command(unitId,versions[1]))]);
  try {
   const end=Date.now()+3500;let waiting=0;
   do{const rows=await maintenance`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=${TARGET} AND pid IN (${id.pid},${id2.pid}) AND wait_event_type='Lock'`;waiting=rows[0].n;if(waiting===2)break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<end);
   assert.equal(waiting,2,"TWO_CONNECTION_LOCK_CONTENTION_NOT_OBSERVED");
  }finally{release();await holder;}
  const results=await attempts;const [winner]=await db.select().from(schema.units).where(eq(schema.units.id,unitId));const approvals=await db.select().from(schema.readingAssignments).where(and(eq(schema.readingAssignments.storeId,a.storeId),eq(schema.readingAssignments.unitId,unitId)));assert.equal(approvals.length,1);assert.equal(winner.configurationState,"versioned");assert.equal(approvals[0].productVersionId,winner.productVersionId);return {results,winner};
 }
 await test("two-connection different-version contention: one winner, deterministic conflict",async()=>{const [u]=await capture();const {results,winner}=await race(u.id,[valid.version,next]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);const loser=results.find(r=>r.status==="rejected") as PromiseRejectedResult;assert.equal(loser.reason.code,"ASSIGNMENT_CONFLICT");assert.ok([valid.version,next].includes(winner.productVersionId!));await rejects(()=>assignReadingConfiguration(db,a,command(u.id,winner.productVersionId===next?valid.version:next)),"ASSIGNMENT_CONFLICT");});
 await test("two-connection same-version contention: assigned and idempotent replay",async()=>{const [u]=await capture();const {results,winner}=await race(u.id,[next,next]);assert.ok(results.every(r=>r.status==="fulfilled"));assert.deepEqual(results.map(r=>r.status==="fulfilled"?r.value.kind:"FAILED").sort(),["ALREADY_ASSIGNED","ASSIGNED"]);assert.equal(winner.productVersionId,next);});
 console.log(`Native PostgreSQL backend: PASS (${passed.length} checks); AI/HTTP/queue/document writes: zero`);
 console.log("Seller browser flow: NOT VERIFIED (runner does not start an application or authenticate a browser)");
 console.log("Overall Milestone 6.3S: PARTIAL — browser seller-flow acceptance remains; database retained, never dropped");
} catch(error) {
 // Only fixed field labels are logged; no identity values, credentials or environment.
 if(error instanceof IdentityMismatch)console.error(`Identity verification failed: fields=${error.fields.join(",")}`);
 // Do not print connection strings, SQL parameters, credentials, source rows or raw errors.
 const candidate=error as {code?:string;message?:string};
 const code=candidate.code??(candidate.message&&/^[A-Z0-9_]{1,80}$/.test(candidate.message)?candidate.message:undefined);
 console.error(`FAIL: stage=${stage}; code=${code&&/^[A-Z0-9_]{1,80}$/.test(code)?code:"ACCEPTANCE_CHECK_FAILED"}; checksPassed=${passed.length}; acceptanceDatabaseCreated=${created}`);
 process.exitCode=1;
} finally {
 clearTimeout(deadline);await Promise.allSettled(clients.map(client=>client.end({timeout:3})));
}
