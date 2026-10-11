import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {migrate} from "drizzle-orm/pglite/migrator";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {eq} from "drizzle-orm";
import type {Database} from "../src/db/client";
import * as schema from "../src/db/schema";
import {authorizeStore,createWorkspace} from "../src/modules/identity/service";
import {ingestListing,workspaceData} from "../src/modules/intake/service";
import {beginEtsyProductDraft,productData,activateProduct,editProduct} from "../src/modules/products/service";
import {authorizeHistoricalAdoption} from "../src/modules/products/historical-adoption";
import {resolveEtsySourceConfiguration} from "../src/modules/products/runtime";
import {assessReceiptForIntake,ingestControlledReceipt} from "../src/modules/etsy/controlled-intake";
import {readOwnedReceipt} from "../src/modules/etsy/owned-receipt";
import {normalizeEtsyReceipt} from "../src/modules/etsy/raw-normalizer";
import {sourceFingerprint} from "../src/modules/etsy/source-fingerprint";
import {buildGenerationContext} from "../src/modules/generation/context";
import {fixtureListings} from "../src/modules/etsy/fixtures";
import type {Scope} from "../src/modules/intake/contracts";
import type {Configuration} from "../src/modules/products/contracts";
import {policy} from "./fixtures/etsy-source";
import {rawReceipt} from "./fixtures/etsy-raw";
let pg:PGlite,db:Database,a:Scope,b:Scope,version:string,product:string;
const answer="  Synthetic name + date\nAnother person.  Question?\n ";
const now=()=>Math.ceil(Date.now()/1000)+1;
function receipt(historical=false){const r={...rawReceipt(),buyer_user_id:456};r.created_timestamp=historical?1700000000:now();r.updated_timestamp=r.created_timestamp+1;r.transactions[0].variations[2].formatted_value=answer;return r;}
const body=(r=receipt())=>JSON.stringify(r);
const source=(r=receipt(true))=>normalizeEtsyReceipt(body(r),{verifiedShopId:"77",observedAt:now()})[0];
const config=():Configuration=>({etsyFulfillment:policy(),fulfillment:{priorityClass:"EXPRESS",targetCompletionMinutes:60},inputs:[{id:"question",key:"question",label:"Context",type:"LONG_TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"body",title:"Reading",instruction:"",sortOrder:0}],output:"PDF",workflow:"ASSISTED"});
const command=(r=receipt())=>({commandId:randomUUID(),receiptId:String(r.receipt_id),approvedVersions:Object.fromEntries(r.transactions.filter(t=>t.listing_id===101).map(t=>[String(t.transaction_id),version]))});
const adoption=(r=receipt(true),v=version)=>({contractVersion:"etsy-historical-adoption/v2",commandId:randomUUID(),productVersionId:v,source:source(r)});
beforeEach(async()=>{vi.stubEnv("INTERNAL_TOOLS_ENABLED","true");vi.stubEnv("INTERNAL_OPERATOR_USER_IDS","a,b");vi.stubEnv("ETSY_ADAPTER","fixtures");pg=new PGlite();for(const f of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+f,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;for(const id of ["a","b"])await db.insert(schema.users).values({id,name:id});a=await authorizeStore(db,"a",await createWorkspace(db,"a","A","fixtures"));b=await authorizeStore(db,"b",await createWorkspace(db,"b","B","fixtures"));await db.update(schema.stores).set({externalShopId:"77"}).where(eq(schema.stores.id,a.storeId));for(const l of fixtureListings)await ingestListing(db,a,l);product=await beginEtsyProductDraft(db,a,policy());version=(await productData(db,a,product)).draft!.id;await activateProduct(db,a,product,version,0,{name:"Reading",configuration:config()});},20000);
afterEach(async()=>{vi.unstubAllEnvs();await pg.close();});
async function noExecution(){for(const table of [schema.generations,schema.productionQueue,schema.aiRequests,schema.documentSnapshots,schema.documentArtifacts])expect(await db.select().from(table)).toHaveLength(0);}
it("normal purchase creates one order/line/reading, exact purchaser and untouched complete answer, pinned policy",async()=>{const r=receipt();await ingestControlledReceipt(db,a,body(r),now(),command(r));const d=await workspaceData(db,a);expect(d.orders).toHaveLength(1);expect(d.lines).toHaveLength(1);expect(d.units).toHaveLength(1);expect(d.orders[0].purchasedSnapshot.purchaser).toEqual({source:"etsy",role:"PURCHASER",accountId:"456"});expect(d.orders[0].buyerName).toBe("");expect(d.inputs[0].answers[0].value).toBe(answer);expect(d.units[0].productVersionId).toBe(version);expect(d.units[0].issues).toEqual([]);const context=await buildGenerationContext(db,a,d.units[0].id);expect(context.product.configuration).toEqual({...config(),productMetadata:{contractVersion:"product-metadata/v1",title:"Reading"}});expect(context.product.title).toBe("Reading");expect(d.lines[0].title).toBe("Reading");expect(context.customer.answers[0].value).toBe(answer);await noExecution();});
it("quantity two expands stable units, retains allocation hold and does not dispatch",async()=>{const r=receipt();r.transactions[0].quantity=2;await ingestControlledReceipt(db,a,body(r),now(),command(r));const d=await workspaceData(db,a);expect(d.orders).toHaveLength(1);expect(d.lines).toHaveLength(1);expect(d.units.map(u=>u.unitIndex).sort()).toEqual([1,2]);expect(d.units.every(u=>u.issues.includes("quantity_context"))).toBe(true);await noExecution();});
it("two eligible lines preserve transaction cardinality",async()=>{const r=receipt();r.transactions.push({...structuredClone(r.transactions[0]),transaction_id:902});await ingestControlledReceipt(db,a,body(r),now(),command(r));const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,2,2]);await noExecution();});
it("mixed receipt preserves unsupported line held with no cross-configuration fallback",async()=>{const r=receipt();const other=structuredClone(r.transactions[0]);other.transaction_id=902;other.variations[0].value_id=99;other.product_data[0].value_ids=[99];r.transactions.push(other);await ingestControlledReceipt(db,a,body(r),now(),{...command(r),approvedVersions:{"901":version}});const d=await workspaceData(db,a);expect(d.lines).toHaveLength(2);expect(d.units.filter(u=>u.productVersionId===version)).toHaveLength(1);expect(d.units.filter(u=>u.productVersionId===null&&u.issues.includes("unmapped_purchase_selection"))).toHaveLength(1);await noExecution();});
it("historical default dry run holds and creates nothing",async()=>{const r=receipt(true),d=await assessReceiptForIntake(db,a,body(r),now());expect(d.report.historicalAdoptionRequired).toBe(1);expect(d.report.intendedOrders).toBe(0);await expect(ingestControlledReceipt(db,a,body(r),now(),command(r))).rejects.toThrow("NO_ELIGIBLE_LINES");expect((await workspaceData(db,a)).orders).toHaveLength(0);expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(0);});
it("explicit v2 adoption pins shop/transaction/fingerprint and owner, then allows ingestion",async()=>{const r=receipt(true),c=adoption(r);const decision=await authorizeHistoricalAdoption(db,a,c);expect(decision).toMatchObject({transactionId:"901",shopId:"77",sourceFingerprint:sourceFingerprint(c.source),authorizedBy:"a",productVersionId:version});await ingestControlledReceipt(db,a,body(r),now(),command(r));expect((await workspaceData(db,a)).units[0].productVersionId).toBe(version);await noExecution();});
it("adoption command replay is idempotent and conflict cannot rebind",async()=>{const c=adoption(),first=await authorizeHistoricalAdoption(db,a,c);expect((await authorizeHistoricalAdoption(db,a,c)).id).toBe(first.id);expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(1);const draft=await editProduct(db,a,product);await activateProduct(db,a,product,draft,0,{name:"Next",configuration:config()});await expect(authorizeHistoricalAdoption(db,a,{...c,productVersionId:draft})).rejects.toThrow("HISTORICAL_COMMAND_CONFLICT");expect((await resolveEtsySourceConfiguration(db,a,c.source,undefined,{lineAdoptionOnly:true})).version?.id).toBe(version);});
it("approval for another line cannot authorize same-combination sibling",async()=>{const r=receipt(true);await authorizeHistoricalAdoption(db,a,adoption(r));r.transactions[0].transaction_id=902;expect((await assessReceiptForIntake(db,a,body(r),now())).resolvedVersions).toEqual({});});
it("changed source answer holds instead of repairing adoption",async()=>{const r=receipt(true);await authorizeHistoricalAdoption(db,a,adoption(r));r.transactions[0].variations[2].formatted_value+=" changed";const d=await assessReceiptForIntake(db,a,body(r),now());expect(d.report.holdReasons.source_changed).toBe(1);await expect(ingestControlledReceipt(db,a,body(r),now(),command(r))).rejects.toThrow();});
it("legacy receipt-wide permission is not authority for controlled line intake",async()=>{await authorizeHistoricalAdoption(db,a,{contractVersion:"etsy-historical-adoption/v1",commandId:randomUUID(),receiptId:"900",productVersionId:version,purchaseFrom:1700000000,purchaseThrough:1700000000});expect((await assessReceiptForIntake(db,a,body(receipt(true)),now())).resolvedVersions).toEqual({});});
it("duplicate ingestion and observation-time-only replay create no duplicate records/audits",async()=>{const r=receipt(),c=command(r);await ingestControlledReceipt(db,a,body(r),now(),c);await ingestControlledReceipt(db,a,body(r),now()+100,c);const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length,d.inputs.length]).toEqual([1,1,1,1]);expect(d.units[0].sourceChanged).toBe(false);expect((await assessReceiptForIntake(db,a,body(r),now()+101)).report).toMatchObject({intendedOrders:0,intendedLines:0,intendedReadings:0});expect((await db.select().from(schema.auditLogs)).filter(x=>x.action.startsWith("etsy_controlled_ingestion:"))).toHaveLength(1);await noExecution();});
it("concurrent replay uses existing transaction discipline without duplicate units",async()=>{const r=receipt(),c=command(r);await Promise.all([ingestControlledReceipt(db,a,body(r),now(),c),ingestControlledReceipt(db,a,body(r),now(),c)]);const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,1,1]);});
it("partial failure rolls back entire receipt and retry converges",async()=>{const r=receipt();r.transactions.push({...structuredClone(r.transactions[0]),transaction_id:902});const c=command(r);await expect(ingestControlledReceipt(db,a,body(r),now(),c,{failAfterLines:1})).rejects.toThrow("TEST_PARTIAL_FAILURE");expect((await workspaceData(db,a)).orders).toHaveLength(0);await ingestControlledReceipt(db,a,body(r),now(),c);expect((await workspaceData(db,a)).units).toHaveLength(2);});
it("unauthorized/cross-tenant source and forged approval fail before writes",async()=>{const r=receipt();await expect(ingestControlledReceipt(db,{...a,userId:"b"},body(r),now(),command(r))).rejects.toThrow();await expect(authorizeHistoricalAdoption(db,b,adoption())).rejects.toThrow();const c=adoption();c.source.receipt.shopId="88";await expect(authorizeHistoricalAdoption(db,a,c)).rejects.toThrow();expect((await workspaceData(db,a)).orders).toHaveLength(0);});
it("wrong ProductVersion and explicit source selection reject",async()=>{const r=receipt();await expect(ingestControlledReceipt(db,a,body(r),now(),{...command(r),approvedVersions:{"901":randomUUID()}})).rejects.toThrow("PRODUCT_VERSION_MISMATCH");await expect(ingestControlledReceipt(db,a,body(r),now(),{...command(r),receiptId:"999"})).rejects.toThrow("SOURCE_SELECTION_MISMATCH");});
it("inactive draft cannot be adopted and stale normal version cannot be approved",async()=>{const draft=await editProduct(db,a,product);await expect(authorizeHistoricalAdoption(db,a,adoption(receipt(true),draft))).rejects.toThrow();await activateProduct(db,a,product,draft,0,{name:"New",configuration:config()});const r=receipt();await expect(ingestControlledReceipt(db,a,body(r),now(),command(r))).rejects.toThrow("PRODUCT_VERSION_MISMATCH");});
it("unsupported buyer input, unpaid/refund/canceled and missing context never bypass gates",async()=>{for(const kind of ["dropdown","upload","unknown","unpaid","refund","canceled","missing"]){const r=receipt();if(kind==="dropdown")r.transactions[0].variations[2].value_id=42;if(kind==="upload")r.transactions[0].variations[2].mime_type="image/png";if(kind==="unknown")r.transactions[0].variations[2].question_id=null;if(kind==="unpaid")r.is_paid=false;if(kind==="refund")r.status="Fully Refunded";if(kind==="canceled")r.status="Canceled";if(kind==="missing")r.transactions[0].variations[2].formatted_value="";await expect(ingestControlledReceipt(db,a,body(r),now(),command(r))).rejects.toThrow();}expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();});
it("missing identity, unsafe identifier and invalid quantity reject safely",async()=>{for(const change of [{quantity:0},{quantity:1001},{transaction_id:0},{transaction_id:1e20},{listing_id:0}]){const r=receipt();Object.assign(r.transactions[0],change);await expect(ingestControlledReceipt(db,a,body(r),now(),command(r))).rejects.toThrow();}});
it("approval append-only SQL and source/shop checks reject tampering",async()=>{const row=await authorizeHistoricalAdoption(db,a,adoption());await expect(db.update(schema.etsyHistoricalAdoptions).set({transactionId:"902"}).where(eq(schema.etsyHistoricalAdoptions.id,row.id))).rejects.toThrow();const {id,createdAt,...insert}=row;await expect(db.insert(schema.etsyHistoricalAdoptions).values({...insert,commandId:randomUUID(),transactionId:"902",shopId:"88"})).rejects.toThrow();});
it("replaying changed purchased context holds and saved answer remains exact",async()=>{const r=receipt();await ingestControlledReceipt(db,a,body(r),now(),command(r));r.transactions[0].variations[2].formatted_value="changed";await expect(ingestControlledReceipt(db,a,body(r),now(),command(r))).rejects.toThrow();expect((await workspaceData(db,a)).inputs[0].answers[0].value).toBe(answer);});

it("replay retains original approved version after a later activation",async()=>{const r=receipt(),c=command(r);await ingestControlledReceipt(db,a,body(r),now(),c);const next=await editProduct(db,a,product);const newer=config();newer.sections[0].title="New structure";await activateProduct(db,a,product,next,0,{name:"New",configuration:newer});await ingestControlledReceipt(db,a,body(r),now()+10,c);const d=await workspaceData(db,a);expect(d.units).toHaveLength(1);expect(d.units[0].productVersionId).toBe(version);expect((await buildGenerationContext(db,a,d.units[0].id)).product.configuration.sections[0].title).toBe("Reading");await noExecution();});

it("migration upgrades existing legacy decisions without rewriting, replays/no-ops and preserves history",async()=>{
 await authorizeHistoricalAdoption(db,a,{contractVersion:"etsy-historical-adoption/v1",commandId:randomUUID(),receiptId:"900",productVersionId:version,purchaseFrom:1700000000,purchaseThrough:1700000000});
 const separate=new PGlite(),folder=mkdtempSync(join(tmpdir(),"etsy-line-migration-"));
 try{
  mkdirSync(join(folder,"meta"));const journal=JSON.parse(readFileSync("drizzle/meta/_journal.json","utf8"));
  for(const f of readdirSync("drizzle").filter(f=>f.endsWith(".sql")))writeFileSync(join(folder,f),readFileSync("drizzle/"+f));
  writeFileSync(join(folder,"meta/_journal.json"),JSON.stringify({...journal,entries:journal.entries.filter((entry:{idx:number})=>entry.idx<26)}));const migrated=drizzle(separate,{schema});await separate.exec("SELECT 1");await migrate(migrated,{migrationsFolder:folder});
  const tables=(await pg.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const expected=new Map<string,unknown[]>();await separate.exec("SET session_replication_role=replica");
  for(const {tablename} of tables){const rows=(await pg.query(`SELECT * FROM "${tablename}"`)).rows;expected.set(tablename,rows);for(const row of rows)await separate.query(`INSERT INTO "${tablename}" SELECT (jsonb_populate_record(NULL::"${tablename}",$1::jsonb)).*`,[JSON.stringify(row)]);}
  await separate.exec("SET session_replication_role=origin");writeFileSync(join(folder,"meta/_journal.json"),JSON.stringify(journal));await migrate(migrated,{migrationsFolder:folder});await migrate(migrated,{migrationsFolder:folder});
  for(const [table,rows] of expected)expect((await separate.query(`SELECT * FROM "${table}"`)).rows).toEqual(rows);
  expect((await separate.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows).toEqual([{count:journal.entries.length}]);
 }finally{await separate.close();rmSync(folder,{recursive:true,force:true});}
},30000);

it("first historical ingestion may use an explicitly adopted archived version only",async()=>{const r=receipt(true);await authorizeHistoricalAdoption(db,a,adoption(r));const next=await editProduct(db,a,product);await activateProduct(db,a,product,next,0,{name:"Next",configuration:config()});await ingestControlledReceipt(db,a,body(r),now(),command(r));expect((await workspaceData(db,a)).units[0].productVersionId).toBe(version);await noExecution();});

it("owned receipt transport rejects unauthorized/disconnected grants before any HTTP",async()=>{const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);try{await expect(readOwnedReceipt(db,{...a,userId:"b"},"900")).rejects.toThrow();await expect(readOwnedReceipt(db,a,"900")).rejects.toThrow("ETSY_REAUTHORIZE");expect(fetcher).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}});
it("command identity cannot authorize a different receipt; conflict rolls back new records",async()=>{const r=receipt(),c=command(r);await ingestControlledReceipt(db,a,body(r),now(),c);const next=receipt();next.receipt_id=910;next.transactions[0].receipt_id=910;next.transactions[0].transaction_id=911;await expect(ingestControlledReceipt(db,a,body(next),now(),{...command(next),commandId:c.commandId})).rejects.toThrow("INGEST_COMMAND_CONFLICT");const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,1,1]);});

// Review is a separate, non-authorizing private evidence boundary.
import {reviewCandidates,recordCandidateReview,confirmCandidateReview,loadCandidateReview} from "../src/modules/etsy/candidate-review";
const reviewReader=(r=receipt(true))=>async()=>({body:body(r),shopId:"77",epoch:0,evidence:[]});
const reviewCommand=()=>({receiptId:"900",transactionId:"901",productVersionId:version});
it("private review preserves exact identity and fingerprint without storing answers or approving adoption",async()=>{
 const c=(await reviewCandidates(db,a,body(receipt(true))))[0];expect(c.reasons).toEqual([]);expect(c.versionId).toBe(version);expect(JSON.stringify(c)).not.toContain(answer);
 const id=await recordCandidateReview(db,a,reviewCommand(),reviewReader());const row=await loadCandidateReview(db,a,id);
 expect(row).toMatchObject({receiptId:"900",transactionId:"901",shopId:"77",productVersionId:version,sourceFingerprint:sourceFingerprint(source())});
 expect(JSON.stringify(row)).not.toContain(answer);expect(row.confirmedAt).toBeNull();expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(0);expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("review replay and confirmation replay converge without authority or domain writes",async()=>{
 const reader=reviewReader(),id=await recordCandidateReview(db,a,reviewCommand(),reader);
 expect(await recordCandidateReview(db,a,reviewCommand(),reader)).toBe(id);
 expect(await confirmCandidateReview(db,a,id,reader)).toEqual({confirmed:true});const first=await loadCandidateReview(db,a,id);
 expect(await confirmCandidateReview(db,a,id,reader)).toEqual({confirmed:true});expect((await loadCandidateReview(db,a,id)).confirmedAt).toEqual(first.confirmedAt);
 expect(await db.select().from(schema.etsyCandidateReviews)).toHaveLength(1);expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(0);await noExecution();
});
it("changed answer fingerprint invalidates even previously confirmed review",async()=>{
 const id=await recordCandidateReview(db,a,reviewCommand(),reviewReader());await confirmCandidateReview(db,a,id,reviewReader());
 const changed=receipt(true);changed.transactions[0].variations[2].formatted_value="Different synthetic answer";
 expect(await confirmCandidateReview(db,a,id,reviewReader(changed))).toEqual({confirmed:false});expect((await loadCandidateReview(db,a,id)).invalidatedAt).not.toBeNull();expect(await confirmCandidateReview(db,a,id,reviewReader())).toEqual({confirmed:false});
});
it("another transaction cannot replace selected purchase and changed active ProductVersion invalidates",async()=>{
 await expect(recordCandidateReview(db,a,{...reviewCommand(),transactionId:"902"},reviewReader())).rejects.toThrow();
 await expect(recordCandidateReview(db,a,{...reviewCommand(),productVersionId:randomUUID()},reviewReader())).rejects.toThrow();
 const id=await recordCandidateReview(db,a,reviewCommand(),reviewReader());const next=await editProduct(db,a,product);await activateProduct(db,a,product,next,0,{name:"Next",configuration:config()});expect(await confirmCandidateReview(db,a,id,reviewReader())).toEqual({confirmed:false});
});
it("review rejects unauthorized owner, cross tenant and forged review identifier before transport",async()=>{
 const reader=vi.fn(reviewReader());await expect(recordCandidateReview(db,{...a,userId:"b"},reviewCommand(),reader)).rejects.toThrow();expect(reader).not.toHaveBeenCalled();
 const id=await recordCandidateReview(db,a,reviewCommand(),reviewReader());await expect(loadCandidateReview(db,b,id)).rejects.toThrow();await expect(confirmCandidateReview(db,b,id,reader)).rejects.toThrow();expect(reader).not.toHaveBeenCalled();
});
it("stale malformed receipt invalidates review and private evidence cannot be rebound by SQL",async()=>{
 const id=await recordCandidateReview(db,a,reviewCommand(),reviewReader());const malformed=reviewReader();
 expect(await confirmCandidateReview(db,a,id,async()=>({...await malformed(),body:"{}"}))).toEqual({confirmed:false});
 await expect(db.update(schema.etsyCandidateReviews).set({transactionId:"902"}).where(eq(schema.etsyCandidateReviews.id,id))).rejects.toThrow();await expect(db.delete(schema.etsyCandidateReviews).where(eq(schema.etsyCandidateReviews.id,id))).rejects.toThrow();
});
it("receipt status holds cannot acquire review and sibling never inherits review",async()=>{
 const r=receipt(true);r.is_paid=false;await expect(recordCandidateReview(db,a,reviewCommand(),reviewReader(r))).rejects.toThrow();
 const mixed=receipt(true);mixed.transactions.push({...structuredClone(mixed.transactions[0]),transaction_id:902});const id=await recordCandidateReview(db,a,reviewCommand(),reviewReader(mixed));expect((await loadCandidateReview(db,a,id)).transactionId).toBe("901");expect(await db.select().from(schema.etsyCandidateReviews)).toHaveLength(1);expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(0);
});
it("future approval precheck requires confirmed review and fresh evidence but never approves",async()=>{
 const {revalidateConfirmedReview}=await import("../src/modules/etsy/candidate-review");const id=await recordCandidateReview(db,a,reviewCommand(),reviewReader());await expect(revalidateConfirmedReview(db,a,id,reviewReader())).rejects.toThrow("CONFIRMED_REVIEW_REQUIRED");await confirmCandidateReview(db,a,id,reviewReader());expect((await revalidateConfirmedReview(db,a,id,reviewReader())).productVersionId).toBe(version);const changed=receipt(true);changed.transactions[0].quantity=2;await expect(revalidateConfirmedReview(db,a,id,reviewReader(changed))).rejects.toThrow("REVIEW_INVALIDATED");expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(0);
});
it("operator membership cannot review owner purchases",async()=>{
 await db.insert(schema.memberships).values({organizationId:a.organizationId,userId:"b",role:"operator"});const scope=await authorizeStore(db,"b",a.storeId);await expect(reviewCandidates(db,scope,body(receipt(true)))).rejects.toThrow();await expect(recordCandidateReview(db,scope,reviewCommand(),reviewReader())).rejects.toThrow();
});


it("new authorized Etsy receipt captures exact finance without affecting operational identity or dispatch",async()=>{
 await db.update(schema.stores).set({source:"etsy"}).where(eq(schema.stores.id,a.storeId));
 const r={...receipt(),grandtotal:{amount:2499,divisor:100,currency_code:"EUR"}};
 const result=await ingestControlledReceipt(db,a,body(r),now(),command(r));expect(result.finance).toBe("VERIFIED");
 const [finance]=await db.select().from(schema.orderFinances);expect(finance).toMatchObject({orderId:result.orderId,receiptId:"900",shopId:"77",amount:2499n,divisor:100n,currency:"EUR"});
 const before=await workspaceData(db,a);await ingestControlledReceipt(db,a,body(r),now()+1,command(r));const after=await workspaceData(db,a);expect(after.units).toEqual(before.units);expect(after.inputs).toEqual(before.inputs);expect(after.lines).toEqual(before.lines);expect(after.orders[0].purchasedSnapshot).toEqual(before.orders[0].purchasedSnapshot);expect(await db.select().from(schema.orderFinances)).toHaveLength(1);await noExecution();
});
it("optional finance savepoint failure leaves authorized purchase intake intact and observable",async()=>{
 await db.update(schema.stores).set({source:"etsy"}).where(eq(schema.stores.id,a.storeId));await pg.exec('ALTER TABLE order_finances RENAME TO unavailable_finances');
 const r={...receipt(),grandtotal:{amount:2499,divisor:100,currency_code:"USD"}};
 const result=await ingestControlledReceipt(db,a,body(r),now(),command(r));expect(result.finance).toBe("FAILED");expect((await workspaceData(db,a)).units).toHaveLength(1);await noExecution();
});

// Operational wrapper uses synthetic owned reads; no Etsy/AI/storage calls.
import {orderSyncAccess,syncOrderReceipt} from "../src/modules/orders/sync";
import {ordersWorkQueue} from "../src/modules/orders/work-queue";
import {ordersQuery} from "../src/modules/orders/query";
import {purchasedChoices} from "../src/modules/orders/purchased-choices";
import {correctInput} from "../src/modules/intake/service";
async function operationalGrant(){
 await db.update(schema.stores).set({source:"etsy"}).where(eq(schema.stores.id,a.storeId));
 await db.update(schema.connections).set({status:"connected",encryptedTokens:"synthetic-never-decrypted",scopes:["transactions_r"]}).where(eq(schema.connections.storeId,a.storeId));
}
const operationalCommand=()=>({receiptId:"900",commandId:randomUUID()});
it("owner explicit sync imports exact receipt and quantity-expanded mixed cart without admission",async()=>{
 await operationalGrant();const r=receipt();r.transactions[0].quantity=2;r.transactions.push({...structuredClone(r.transactions[0]),transaction_id:902,quantity:1});
 expect((await orderSyncAccess(db,a)).allowed).toBe(true);
 const result=await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r));expect(result.kind).toBe("PARTIAL");
 const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,2,3]);expect(d.units.every(u=>u.productVersionId===version)).toBe(true);expect(d.units.filter(u=>u.issues.includes("quantity_context"))).toHaveLength(2);
 expect(purchasedChoices(d.lines[0].snapshot).join(" ")).toContain("property");
 const queue=await ordersWorkQueue(db,a,ordersQuery());expect(queue.rows[0]).toMatchObject({count:3,status:"Information or setup needed"});await noExecution();
});
it("operational duplicate and concurrent replay preserve units, corrections and immutable pins",async()=>{
 await operationalGrant();const r=receipt(),c=operationalCommand();await Promise.all([syncOrderReceipt(db,a,c,reviewReader(r)),syncOrderReceipt(db,a,c,reviewReader(r))]);
 const d=await workspaceData(db,a);await correctInput(db,a,d.units[0].id,d.units[0].revision,[{label:"question",value:"Owner correction",kind:"text"}],true);
 const before=await workspaceData(db,a);const result=await syncOrderReceipt(db,a,c,reviewReader(r));expect(result.kind).toBe("ALREADY_IMPORTED");
 const after=await workspaceData(db,a);expect([after.orders.length,after.lines.length,after.units.length]).toEqual([1,1,1]);expect(after.inputs).toEqual(before.inputs);expect(after.units[0].productVersionId).toBe(version);
 // correctInput retains its established admission policy; sync adds no work.
 expect(await db.select().from(schema.aiRequests)).toHaveLength(0);
});
it("owner authorization, disconnected and missing scopes reject before reader invocation",async()=>{
 const reader=vi.fn(reviewReader(receipt()));await expect(syncOrderReceipt(db,a,operationalCommand(),reader)).rejects.toThrow("SYNC_CONNECTION_REQUIRED");
 await operationalGrant();await db.update(schema.connections).set({scopes:[]}).where(eq(schema.connections.storeId,a.storeId));await expect(syncOrderReceipt(db,a,operationalCommand(),reader)).rejects.toThrow("SYNC_CONNECTION_REQUIRED");
 await expect(syncOrderReceipt(db,{...a,userId:"b"},operationalCommand(),reader)).rejects.toThrow();expect(reader).not.toHaveBeenCalled();await noExecution();
});
it("operator cannot sync even with a forged owner scope",async()=>{
 await operationalGrant();await db.insert(schema.memberships).values({organizationId:a.organizationId,userId:"b",role:"operator"});
 expect((await orderSyncAccess(db,{...a,userId:"b"})).allowed).toBe(false);
 const reader=vi.fn(reviewReader());await expect(syncOrderReceipt(db,{...a,userId:"b"},operationalCommand(),reader)).rejects.toThrow();expect(reader).not.toHaveBeenCalled();
});
it("epoch fencing and wrong shop reject fetched receipt before intake",async()=>{
 await operationalGrant();await expect(syncOrderReceipt(db,a,operationalCommand(),async()=>({...await reviewReader(receipt())(),epoch:1}))).rejects.toThrow("CONNECTION_CHANGED");
 await expect(syncOrderReceipt(db,a,operationalCommand(),async()=>({...await reviewReader(receipt())(),shopId:"88"}))).rejects.toThrow("CONNECTION_CHANGED");
 expect((await workspaceData(db,a)).orders).toHaveLength(0);
});
it("historical receipt including mixed current sibling is never silently adopted",async()=>{
 await operationalGrant();const r=receipt(true);const result=await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r));expect(result.kind).toBe("HISTORICAL");expect((await workspaceData(db,a)).orders).toHaveLength(0);expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(0);await noExecution();
});
it("fully held missing input, unmapped, paused, canceled, refund and unpaid receipt does not bypass intake",async()=>{
 await operationalGrant();for(const kind of ["missing","unmapped","canceled","refund","unpaid"]){const r=receipt();if(kind==="missing")r.transactions[0].variations[2].formatted_value="";if(kind==="unmapped"){r.transactions[0].variations[0].value_id=99;r.transactions[0].product_data[0].value_ids=[99];}if(kind==="canceled")r.status="Canceled";if(kind==="refund")r.status="Fully Refunded";if(kind==="unpaid")r.is_paid=false;
 const result=await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r));expect(["INELIGIBLE","UNRESOLVED"]).toContain(result.kind);expect(result.holds.length).toBeGreaterThan(0);}
 await db.update(schema.mappings).set({paused:true}).where(eq(schema.mappings.storeId,a.storeId));expect((await syncOrderReceipt(db,a,operationalCommand(),reviewReader(receipt()))).kind).toBe("INELIGIBLE");expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("existing cancellation reconciliation preserves snapshots and pins and adds safety holds",async()=>{
 await operationalGrant();const r=receipt();await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r));const before=await workspaceData(db,a);r.status="Canceled";r.updated_timestamp+=10;
 expect((await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r))).kind).toBe("PARTIAL");const after=await workspaceData(db,a);expect(after.orders[0].canceled).toBe(true);expect(after.orders[0].purchasedSnapshot).toEqual(before.orders[0].purchasedSnapshot);expect(after.lines[0].snapshot).toEqual(before.lines[0].snapshot);expect(after.inputs).toEqual(before.inputs);expect(after.units[0].productVersionId).toBe(version);expect(after.units[0].issues).toContain("canceled");await noExecution();
});
it("existing reconciliation cannot expand quantity or invent another purchased line",async()=>{
 await operationalGrant();const r=receipt();await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r));r.transactions[0].quantity=2;
 expect((await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r))).kind).toBe("UNRESOLVED");expect((await workspaceData(db,a)).units).toHaveLength(1);await noExecution();
});
it("transport failure and transaction failure do not report successful partial intake",async()=>{
 await operationalGrant();await expect(syncOrderReceipt(db,a,operationalCommand(),async()=>{throw new Error("Synthetic API failure");})).rejects.toThrow();
 const r=receipt(),c=operationalCommand();await syncOrderReceipt(db,a,c,reviewReader(r));const other=receipt();other.receipt_id=910;other.transactions[0].receipt_id=910;other.transactions[0].transaction_id=911;
 await expect(syncOrderReceipt(db,a,{...c,receiptId:"910"},reviewReader(other))).rejects.toThrow("INGEST_COMMAND_CONFLICT");expect((await workspaceData(db,a)).orders).toHaveLength(1);await noExecution();
});
it("current normal order is ready for preparation but no generation or delivery is invented",async()=>{
 await operationalGrant();await syncOrderReceipt(db,a,operationalCommand(),reviewReader(receipt()));const queue=await ordersWorkQueue(db,a,ordersQuery());expect(queue.rows[0].status).toBe("Ready for Preparation");expect(queue.rows[0].status).not.toMatch(/Delivered|Completed/);await noExecution();
});
it("operational receipt bound prevents unbounded quantity work atomically",async()=>{
 await operationalGrant();const r=receipt();r.transactions[0].quantity=101;await expect(syncOrderReceipt(db,a,operationalCommand(),reviewReader(r))).rejects.toThrow("SYNC_RECEIPT_BOUND");expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("connection revoked during owned read fences intake after HTTP without an open transaction",async()=>{
 await operationalGrant();const reader=async()=>{await db.update(schema.connections).set({epoch:1,status:"disconnected",encryptedTokens:null}).where(eq(schema.connections.storeId,a.storeId));return reviewReader(receipt())();};await expect(syncOrderReceipt(db,a,operationalCommand(),reader)).rejects.toThrow("CONNECTION_CHANGED");expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("cross-store owned receipt evidence cannot be imported",async()=>{
 await operationalGrant();await expect(syncOrderReceipt(db,{...a,organizationId:b.organizationId},operationalCommand(),reviewReader(receipt()))).rejects.toThrow();expect((await workspaceData(db,a)).orders).toHaveLength(0);expect((await workspaceData(db,b)).orders).toHaveLength(0);
});
it("operational replay keeps archived original version after a newer publication",async()=>{
 await operationalGrant();const r=receipt();await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r));const next=await editProduct(db,a,product);await activateProduct(db,a,product,next,0,{name:"New",configuration:config()});await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r));expect((await workspaceData(db,a)).units[0].productVersionId).toBe(version);await noExecution();
});
it("duplicate sync reports persisted quantity allocation rather than obsolete receipt-level holds",async()=>{
 await operationalGrant();const r=receipt();r.transactions[0].quantity=2;await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r));const d=await workspaceData(db,a);
 for(const u of d.units)await correctInput(db,a,u.id,0,[{label:"question",value:`Recipient ${u.unitIndex}`,kind:"text"}],true);
 const before=await db.select().from(schema.productionQueue);const result=await syncOrderReceipt(db,a,operationalCommand(),reviewReader(r));expect(result.kind).toBe("ALREADY_IMPORTED");expect(result.holds).not.toContain("quantity_context");expect(result.readings).toBe(2);expect(await db.select().from(schema.productionQueue)).toEqual(before);expect(await db.select().from(schema.aiRequests)).toHaveLength(0);
});

// Automatic OAuth receipt polling: synthetic ports only, no live transport.
import {runAutomaticIntakeTick,automaticIntakeStatus,retryAutomaticIntake,intakeDiagnostics} from "../src/modules/etsy/automatic-intake";
import {ReceiptPilotError} from "../src/modules/etsy/receipt-read";
async function automaticSetup(r=receipt()){
 await operationalGrant();const cutoff=now()-120;
 const [state]=await db.insert(schema.automaticIntake).values({organizationId:a.organizationId,storeId:a.storeId,actorId:a.userId,epoch:0,cutoff,cursor:cutoff}).returning();
 const page=vi.fn(async()=>({receipts:[{receiptId:String(r.receipt_id),modified:r.updated_timestamp}],complete:true,epoch:0,shopId:"77"}));
 return {state,page,receipt:vi.fn(reviewReader(r)),now:new Date((now()+60)*1000)};
}
it("automatic intake imports mixed quantities with independent units and no execution",async()=>{
 const r=receipt();r.transactions[0].quantity=2;r.transactions.push({...structuredClone(r.transactions[0]),transaction_id:902,quantity:1});const p=await automaticSetup(r);await runAutomaticIntakeTick(db,p);
 const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,2,3]);expect(d.units.every(u=>u.productVersionId===version)).toBe(true);expect((await db.select().from(schema.automaticReceipts))[0]).toMatchObject({status:"ATTENTION",result:"PARTIAL"});await noExecution();
});
it("automatic concurrent discovery and replay produce one receipt and one order",async()=>{
 const p=await automaticSetup();await Promise.all([runAutomaticIntakeTick(db,p),runAutomaticIntakeTick(db,p)]);await runAutomaticIntakeTick(db,{...p,now:new Date(p.now.getTime()+61000)});
 expect(await db.select().from(schema.automaticReceipts)).toHaveLength(1);const d=await workspaceData(db,a);expect([d.orders.length,d.lines.length,d.units.length]).toEqual([1,1,1]);await noExecution();
});
it("automatic pagination is durable and overlapping windows keep receipt identities unique",async()=>{
 const p=await automaticSetup();p.page.mockResolvedValueOnce({...await p.page(),complete:false});await runAutomaticIntakeTick(db,p);let s=(await db.select().from(schema.automaticIntake))[0];expect(s.offset).toBe(1);const end=s.windowEnd;
 await runAutomaticIntakeTick(db,p);s=(await db.select().from(schema.automaticIntake))[0];expect(s.offset).toBe(0);expect(s.cursor).toBe(end);expect(p.page.mock.calls[1]).toBeDefined();expect(await db.select().from(schema.automaticReceipts)).toHaveLength(1);await noExecution();
});
it("automatic discovery failure retains cursor and bounded retry evidence",async()=>{
 const p=await automaticSetup();p.page.mockRejectedValueOnce(new ReceiptPilotError("discovery",429,120));await runAutomaticIntakeTick(db,p);const s=(await db.select().from(schema.automaticIntake))[0];expect(s.cursor).toBe(p.state.cursor);expect(s.errorCode).toBe("RATE_LIMITED");expect(s.nextAt.getTime()).toBeGreaterThanOrEqual(p.now.getTime()+120000);expect(await db.select().from(schema.automaticReceipts)).toHaveLength(0);
});
it("automatic revoked or disconnected grants cannot fetch or import",async()=>{
 const p=await automaticSetup();await db.update(schema.connections).set({status:"disconnected",encryptedTokens:null}).where(eq(schema.connections.storeId,a.storeId));await runAutomaticIntakeTick(db,p);expect(p.page).not.toHaveBeenCalled();expect(p.receipt).not.toHaveBeenCalled();expect((await workspaceData(db,a)).orders).toHaveLength(0);
});
it("automatic missing scopes and operator actor fail before transport",async()=>{
 const p=await automaticSetup();await db.update(schema.connections).set({scopes:[]}).where(eq(schema.connections.storeId,a.storeId));await runAutomaticIntakeTick(db,p);expect(p.page).not.toHaveBeenCalled();expect((await db.select().from(schema.automaticIntake))[0].errorCode).toBe("AUTHORIZATION_REQUIRED");
 await db.update(schema.connections).set({scopes:["transactions_r"]}).where(eq(schema.connections.storeId,a.storeId));await db.update(schema.memberships).set({role:"operator"}).where(eq(schema.memberships.userId,a.userId));await db.update(schema.automaticIntake).set({attempts:0}).where(eq(schema.automaticIntake.id,p.state.id));await runAutomaticIntakeTick(db,p);expect(p.page).not.toHaveBeenCalled();await noExecution();
});
it("automatic epoch revocation during discovery fences durable writes",async()=>{
 const p=await automaticSetup();p.page.mockImplementationOnce(async()=>{await db.update(schema.connections).set({epoch:1}).where(eq(schema.connections.storeId,a.storeId));return {receipts:[{receiptId:"900",modified:now()}],complete:true,epoch:0,shopId:"77"};});await runAutomaticIntakeTick(db,p);expect(await db.select().from(schema.automaticReceipts)).toHaveLength(0);expect(p.receipt).not.toHaveBeenCalled();
});
it("automatic receipt ownership mismatch cannot cross tenants",async()=>{
 const p=await automaticSetup();p.receipt.mockResolvedValueOnce({...await reviewReader()(),shopId:"88"});await runAutomaticIntakeTick(db,p);expect((await workspaceData(db,a)).orders).toHaveLength(0);expect((await workspaceData(db,b)).orders).toHaveLength(0);expect((await db.select().from(schema.automaticReceipts))[0].status).toBe("ATTENTION");await noExecution();
});
it("automatic disconnect during detail read rejects intake after Store locking",async()=>{
 const p=await automaticSetup();p.receipt.mockImplementationOnce(async()=>{await db.update(schema.connections).set({epoch:1,status:"disconnected",encryptedTokens:null}).where(eq(schema.connections.storeId,a.storeId));return reviewReader()();});await runAutomaticIntakeTick(db,p);expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("automatic historical cutoff and unmapped orders remain attention without adoption",async()=>{
 const p=await automaticSetup(receipt(true));await runAutomaticIntakeTick(db,p);expect((await workspaceData(db,a)).orders).toHaveLength(0);expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(0);expect((await db.select().from(schema.automaticReceipts))[0].status).toBe("ATTENTION");await noExecution();
});
it("automatic entirely held receipt does not disappear as success",async()=>{
 const r=receipt();r.transactions[0].variations[2].formatted_value="";const p=await automaticSetup(r);await runAutomaticIntakeTick(db,p);expect((await db.select().from(schema.automaticReceipts))[0]).toMatchObject({status:"ATTENTION",result:"INELIGIBLE"});expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("automatic crash after durable discovery recovers expired processing lease",async()=>{
 const p=await automaticSetup();await db.insert(schema.automaticReceipts).values({organizationId:a.organizationId,storeId:a.storeId,epoch:0,receiptId:"900",sourceModified:receipt().updated_timestamp,status:"PROCESSING",attempts:1,claim:randomUUID(),leaseUntil:new Date(0)});await runAutomaticIntakeTick(db,p);expect((await db.select().from(schema.automaticReceipts))[0]).toMatchObject({status:"SUCCEEDED",attempts:2});expect((await workspaceData(db,a)).orders).toHaveLength(1);await noExecution();
});
it("automatic lost claim rejects receipt before new persisted order side effects",async()=>{
 const p=await automaticSetup();p.receipt.mockImplementationOnce(async()=>{await db.update(schema.automaticReceipts).set({claim:randomUUID()});return reviewReader()();});await runAutomaticIntakeTick(db,p);expect((await workspaceData(db,a)).orders).toHaveLength(0);await noExecution();
});
it("automatic timeout retains pending receipt and retries without duplicates",async()=>{
 const p=await automaticSetup();p.receipt.mockRejectedValueOnce(new DOMException("synthetic","TimeoutError"));await runAutomaticIntakeTick(db,p);let item=(await db.select().from(schema.automaticReceipts))[0];expect(item).toMatchObject({status:"PENDING",attempts:1,errorCode:"RETRY_PENDING"});await runAutomaticIntakeTick(db,{...p,now:new Date(item.nextAt.getTime()+1)});item=(await db.select().from(schema.automaticReceipts))[0];expect(item.status).toBe("SUCCEEDED");expect((await workspaceData(db,a)).units).toHaveLength(1);await noExecution();
});
it("automatic retry requires internal owner authorization and preserves command idempotency",async()=>{
 const r=receipt();r.transactions[0].variations[2].formatted_value="";const p=await automaticSetup(r);await runAutomaticIntakeTick(db,p);const item=(await db.select().from(schema.automaticReceipts))[0],command={id:item.id,kind:"receipt",commandId:randomUUID()};
 vi.stubEnv("INTERNAL_TOOLS_ENABLED","false");await expect(retryAutomaticIntake(db,a,command)).rejects.toThrow();vi.stubEnv("INTERNAL_TOOLS_ENABLED","true");await expect(retryAutomaticIntake(db,b,command)).rejects.toThrow();await retryAutomaticIntake(db,a,command);await retryAutomaticIntake(db,a,command);expect((await db.select().from(schema.auditLogs)).filter(r=>r.action.startsWith("automatic_intake_retry:"))).toHaveLength(1);expect((await db.select().from(schema.automaticReceipts))[0].status).toBe("PENDING");await noExecution();
});
it("automatic status does not promise activity without worker evidence and diagnostics isolate tenants",async()=>{
 const p=await automaticSetup();vi.stubEnv("ETSY_AUTOMATIC_INTAKE_ENABLED","true");vi.stubEnv("ETSY_LIVE_OAUTH_ENABLED","true");vi.stubEnv("ETSY_ADAPTER","etsy");expect(await automaticIntakeStatus(db,a)).toContain("not confirmed");await runAutomaticIntakeTick(db,p);await db.insert(schema.automaticReceipts).values({organizationId:a.organizationId,storeId:a.storeId,epoch:0,receiptId:"900",sourceModified:receipt().updated_timestamp-1,status:"ATTENTION",errorCode:"INELIGIBLE"});expect(await automaticIntakeStatus(db,a)).toContain("recently checked");expect((await intakeDiagnostics(db,a)).receipts).toHaveLength(2);expect((await intakeDiagnostics(db,b)).receipts).toHaveLength(0);await expect(intakeDiagnostics(db,{...a,userId:"b"})).rejects.toThrow();
});
it("automatic durable inserts are receipt-atomic on invalid discovery and retain cursor",async()=>{
 const p=await automaticSetup();p.page.mockResolvedValueOnce({receipts:[{receiptId:"900",modified:now()},{receiptId:"invalid",modified:now()}],complete:true,epoch:0,shopId:"77"});await runAutomaticIntakeTick(db,p);expect(await db.select().from(schema.automaticReceipts)).toHaveLength(0);expect((await db.select().from(schema.automaticIntake))[0].cursor).toBe(p.state.cursor);await noExecution();
});
it("automatic later receipt processing preserves customer corrections and immutable ProductVersion pins",async()=>{
 const r=receipt(),p=await automaticSetup(r);await runAutomaticIntakeTick(db,p);const d=await workspaceData(db,a);await correctInput(db,a,d.units[0].id,0,[{label:"question",value:"Corrected context",kind:"text"}],true);
 const next=await editProduct(db,a,product);await activateProduct(db,a,product,next,0,{name:"New configuration",configuration:config()});const before=await workspaceData(db,a),queue=await db.select().from(schema.productionQueue);
 p.page.mockResolvedValueOnce({receipts:[{receiptId:"900",modified:r.updated_timestamp+1}],complete:true,epoch:0,shopId:"77"});await runAutomaticIntakeTick(db,{...p,now:new Date(p.now.getTime()+61000)});
 const after=await workspaceData(db,a);expect(after.units).toHaveLength(1);expect(after.units[0].productVersionId).toBe(version);expect(after.inputs).toEqual(before.inputs);expect(await db.select().from(schema.productionQueue)).toEqual(queue);expect(await db.select().from(schema.generations)).toHaveLength(0);expect(await db.select().from(schema.aiRequests)).toHaveLength(0);
});
it("automatic additive migration initializes existing owned grants from deployment time and preserves prior rows",async()=>{
 const separate=new PGlite();try{for(const f of readdirSync("drizzle").filter(f=>f.endsWith(".sql")&&!f.startsWith("0027_")).sort())await separate.exec(readFileSync("drizzle/"+f,"utf8"));const old=drizzle(separate,{schema}) as unknown as Database;await old.insert(schema.users).values({id:"migration-owner",name:"Synthetic"});const s=await authorizeStore(old,"migration-owner",await createWorkspace(old,"migration-owner","Existing","fixtures"));await old.update(schema.stores).set({source:"etsy",externalShopId:"88"}).where(eq(schema.stores.id,s.storeId));await old.update(schema.connections).set({status:"connected",epoch:7,encryptedTokens:"synthetic",scopes:["transactions_r"]}).where(eq(schema.connections.storeId,s.storeId));await old.insert(schema.auditLogs).values({organizationId:s.organizationId,storeId:s.storeId,actorId:s.userId,action:"etsy_connected",createdAt:new Date(1700000000000)});const prior=await old.select().from(schema.connections);const started=Math.floor(Date.now()/1000);await separate.exec(readFileSync("drizzle/0027_automatic_receipt_intake.sql","utf8"));const rows=await old.select().from(schema.automaticIntake);expect(rows).toHaveLength(1);expect(rows[0].cutoff).toBeGreaterThanOrEqual(started);expect(rows[0].epoch).toBe(7);expect(await old.select().from(schema.connections)).toEqual(prior);expect(await old.select().from(schema.automaticReceipts)).toHaveLength(0);}finally{await separate.close();}
});

it("automatic revoked actor quarantines expired claims without blocking other tenants",async()=>{
 const p=await automaticSetup();await db.update(schema.automaticIntake).set({claim:randomUUID(),leaseUntil:new Date(0)}).where(eq(schema.automaticIntake.id,p.state.id));await db.insert(schema.automaticReceipts).values({organizationId:a.organizationId,storeId:a.storeId,epoch:0,receiptId:"900",sourceModified:now(),status:"PROCESSING",claim:randomUUID(),leaseUntil:new Date(0)});await db.update(schema.memberships).set({role:"operator"}).where(eq(schema.memberships.userId,a.userId));await runAutomaticIntakeTick(db,p);expect((await db.select().from(schema.automaticIntake))[0]).toMatchObject({claim:null,attempts:5,errorCode:"AUTHORIZATION_REQUIRED"});expect((await db.select().from(schema.automaticReceipts))[0]).toMatchObject({status:"ATTENTION",claim:null,errorCode:"AUTHORIZATION_REQUIRED"});expect(p.page).not.toHaveBeenCalled();expect(p.receipt).not.toHaveBeenCalled();await noExecution();
});
