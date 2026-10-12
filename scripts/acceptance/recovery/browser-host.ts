/** Host-only verified reuse/provisioning and loopback app launch. No native retesting. */
import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {existsSync,readFileSync} from "node:fs";
import {createRequire} from "node:module";
import postgres from "postgres";
import {drizzle} from "drizzle-orm/postgres-js";
import {readMigrationFiles} from "drizzle-orm/migrator";
import {and,eq} from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import {authorizeStore} from "../../../src/modules/identity/service";
import {ingestOrder,workspaceData} from "../../../src/modules/intake/service";
import {readingRecoveryData} from "../../../src/modules/orders/assignment";
import {saveSellerProfile,editStyle,applyStyle,sellerStyleData} from "../../../src/modules/seller-style/service";
import {normalizeEtsyReceipt} from "../../../src/modules/etsy/raw-normalizer";
import {selectionKey} from "../../../src/modules/etsy/source-contract";
import {rawReceipt} from "../../../tests/fixtures/etsy-raw";
import {policy} from "../../../tests/fixtures/etsy-source";
import {TARGET,ROLE,requireRuntime,requireIdentity,connectionOptions} from "./safety";
import {browserEnvironment} from "./browser-environment";

let stage="prerequisites",client:ReturnType<typeof postgres>|undefined;
let launchEnv:NodeJS.ProcessEnv|undefined,orderId:string|undefined;
try {
 requireRuntime(process.versions.node);
 assert.equal(process.env.RECOVERY_BROWSER_CONFIRM,TARGET,"EXPLICIT_BROWSER_FIXTURE_CONFIRMATION_REQUIRED");
 assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"codex/ui-ux-design-lock");
 assert.equal(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),"034c111bddd9f0ff870f5a7b54118a1143a403cb");
 const url=new URL(`postgresql://${ROLE}@127.0.0.1:5432/${TARGET}`);url.password=process.env.RECOVERY_ACCEPTANCE_PASSWORD??"";
 const keys:string[]=[];
 for(const file of [".env.development.local",".env.local",".env.development",".env"])if(existsSync(file))for(const match of readFileSync(file,"utf8").matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm))keys.push(match[1]);
 launchEnv=browserEnvironment(process.env,keys,url.toString());
 process.env.ETSY_ADAPTER="fixtures";
 globalThis.fetch=async()=>{throw new Error("EXTERNAL_HTTP_FORBIDDEN_IN_BROWSER_FIXTURE_SETUP");};
 stage="retained database identity";
 client=postgres(connectionOptions(TARGET,process.env.RECOVERY_ACCEPTANCE_PASSWORD??""));
 const identity=await client`SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS address,inet_server_port() AS port,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS oid`;
 requireIdentity(identity[0],TARGET);
 const db=drizzle(client,{schema});
 stage="migration provenance and synthetic fixture suitability";
 const migrations=readMigrationFiles({migrationsFolder:"drizzle"});
 const applied=await client`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id`;
 assert.equal(applied.length,migrations.length);migrations.forEach((m,i)=>{assert.equal(applied[i].hash,m.hash);assert.equal(Number(applied[i].created_at),m.folderMillis);});
 const users=await db.select().from(schema.users),stores=await db.select().from(schema.stores),connections=await db.select().from(schema.connections),lines=await db.select().from(schema.lineItems);
 assert.equal(stores.length,2);assert.ok(stores.every(s=>s.source==="fixtures"&&s.onboardingStage==="complete"&&["Synthetic recovery studio A","Synthetic recovery studio B"].includes(s.name)));
 assert.ok(users.every(u=>(u.id.startsWith("recovery-acceptance-")||u.id==="dev:owner")&&!u.email&&!u.passwordHash));
 assert.ok(connections.every(c=>!c.encryptedTokens&&c.status==="disconnected"));
 assert.ok(lines.length>0&&lines.every(l=>["Synthetic historical purchase","Synthetic browser purchase"].includes(l.title)));
 assert.ok((await db.select().from(schema.readingAssignments)).length>=6,"NATIVE_ASSIGNMENT_FIXTURES_REQUIRED");
 for(const table of [schema.generations,schema.aiRequests,schema.usageEvents,schema.productionQueue,schema.documentSnapshots,schema.documentArtifacts])assert.equal((await db.select().from(table)).length,0,"EXISTING_AI_OR_PRODUCTION_WORK_REFUSING_REUSE");
 const store=stores.find(s=>s.name==="Synthetic recovery studio A")!;
 assert.equal(store.externalShopId,"77");
 const owners=await db.select().from(schema.memberships).where(and(eq(schema.memberships.organizationId,store.organizationId),eq(schema.memberships.role,"owner")));
 const owner=owners.find(m=>m.userId.startsWith("recovery-acceptance-"));assert.ok(owner);
 const scope=await authorizeStore(db,owner.userId,store.id,true);
 stage="synthetic browser fixture";
 const r=rawReceipt();r.receipt_id=99000;r.transactions[0].receipt_id=99000;r.transactions[0].transaction_id=99001;r.transactions[0].quantity=1;
 const source=normalizeEtsyReceipt(JSON.stringify(r),{verifiedShopId:"77",observedAt:1700000020})[0];
 await ingestOrder(db,scope,{externalId:"99000",buyerName:"Synthetic buyer",createdAt:1700000000,updatedAt:1700000010,paid:true,canceled:false,refund:"none",lines:[{externalId:"99001",listingId:"101",title:"Synthetic browser purchase",quantity:1,sku:"SYNTHETIC",variantKey:selectionKey(policy().purchaseSelections),variations:[],answers:[],digital:false,etsySource:source}]},{suppressProductionAdmission:true});
 const data=await workspaceData(db,scope),line=data.lines.find(l=>l.externalId==="99001")!;orderId=line.orderId;
 const units=data.units.filter(u=>u.lineItemId===line.id);assert.equal(units.length,1);assert.equal(units[0].configurationState,"unconfigured","BROWSER_FIXTURE_ALREADY_RECOVERED_REFUSING_RESET");
 assert.ok((await readingRecoveryData(db,scope,units[0].id)).candidates.length,"NO_COMPATIBLE_BROWSER_CONFIGURATION");
 stage="synthetic development identity";
 await db.transaction(async tx=>{
  const existing=await tx.select().from(schema.memberships).where(eq(schema.memberships.userId,"dev:owner"));assert.ok(existing.every(m=>m.organizationId===store.organizationId&&m.role==="owner"),"DEMO_IDENTITY_HAS_OTHER_OWNERSHIP");
  await tx.insert(schema.users).values({id:"dev:owner",name:"Synthetic browser seller"}).onConflictDoNothing();
  if(!existing.length)await tx.insert(schema.memberships).values({organizationId:store.organizationId,userId:"dev:owner",role:"owner"});
 });
 // Reuse existing profile/style services so the real preparation UI can become available.
 const profile=await sellerStyleData(db,scope);
 if(!profile.seller)await saveSellerProfile(db,scope,{displayName:"Synthetic browser seller",shortBio:"Synthetic acceptance only"});
 if(!profile.active){const draft=await editStyle(db,scope);await applyStyle(db,scope,draft.id,draft.revision,{tone:"WARM",detail:"DETAILED",approach:"CONVERSATIONAL",preferredExpressions:[],avoidExpressions:[],instructions:"Synthetic acceptance style"});}
 for(const table of [schema.generations,schema.aiRequests,schema.usageEvents,schema.productionQueue,schema.documentSnapshots,schema.documentArtifacts])assert.equal((await db.select().from(table)).length,0);
 console.log(`Verified synthetic database: ${TARGET}; role: ${ROLE}. No native tests repeated.`);
 console.log(`Open http://127.0.0.1:3100/sign-in → Development demo account. Use the password you supplied.`);
 console.log(`Then open http://127.0.0.1:3100/orders/${orderId}. Receipt 99000: one unconfigured Reading.`);
 console.log("Confirm first assignment in the browser. Verify Prepare reading becomes available; do not click generation or PDF actions.");
}catch(error){const e=error as {code?:string;message?:string};const code=e.code??(e.message&&/^[A-Z0-9_]+$/.test(e.message)?e.message:"BROWSER_PREFLIGHT_FAILED");console.error(`FAIL: ${stage}; ${code}. No app started.`);process.exitCode=1;launchEnv=undefined;}
finally{await client?.end({timeout:3});}
if(launchEnv&&orderId){
 const next=createRequire(import.meta.url).resolve("next/dist/bin/next");
 const child=spawn(process.execPath,[next,"dev","--webpack","--hostname","127.0.0.1","--port","3100"],{env:launchEnv,stdio:"inherit"});
 for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>child.kill(signal));
 child.on("error",()=>{console.error("FAIL: application process could not start");process.exitCode=1;});
 child.on("exit",code=>{process.exitCode=code??1;});
}
