import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "./adapter";
import { drizzle } from "./adapter";
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { authorizeStore,createWorkspace } from "../../src/modules/identity/service";
import { ingestListing,ingestOrder,workspaceData } from "../../src/modules/intake/service";
import { fixtureListings,fixtureOrders } from "../../src/modules/etsy/fixtures";
import { beginListingDraft,activateProduct,productData,editProduct } from "../../src/modules/products/service";
import { saveSellerProfile,editStyle,applyStyle } from "../../src/modules/seller-style/service";
import { GenerationService } from "../../src/modules/generation/service";
import { FakeGenerationProvider } from "../../src/infrastructure/ai/fake";
import { CentralAIGateway } from "../../src/infrastructure/ai/gateway";
import { pricingFor } from "../../src/infrastructure/ai/pricing";
import { openReadingReview,approveReadingReview,saveReadingReviewDraft } from "../../src/modules/review/service";
import { createDocumentDesign,updateDocumentDesign,setDefaultDocumentDesign,assignDocumentDesignToProduct,archiveDocumentDesign,getDocumentDesign } from "../../src/modules/documents/service";
import { createDocumentSnapshot,getDocumentSnapshotForRender } from "../../src/modules/documents/snapshot-service";
import { getApprovedReadingMedia, getApprovedReadingForDocument } from "../../src/modules/review/service";
import { createDocumentRenderInput,getDocumentRenderInput } from "../../src/modules/documents/media-service";
import { getDocumentLayout } from "../../src/modules/documents/layout/service";
import { prepareDocumentRendering,getProductionDocumentLayout } from "../../src/modules/documents/resources/service";
import { renderDocumentPdfForReading } from "../../src/modules/documents/pdf/service";
import { readFrozenPlatformAssetBytes } from "../../src/modules/media/service";
import { syntheticImage } from "../render-resources.fixture";
import { platformMediaRegistry } from "../../src/modules/media/platform-registry";
import { setStorePreferredTarotDeck } from "../../src/modules/media/service";
import { assetFixture,deckFixture } from "../media.fixture";
import { stableJson } from "../../src/modules/intake/contracts";
import { createHash } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { documentMediaHash } from "../../src/modules/documents/media-contract";
import { readingMediaHash } from "../../src/modules/media/reading-contract";
import type { Scope } from "../../src/modules/intake/contracts";
let pg:PGlite,db:Database,a:Scope,b:Scope,sibling:Scope,readingId:string,orderId:string,productId:string,generationId:string;
const config=()=>({contractVersion:"document-design/v1",template:"classic",brand:{name:"Studio",primaryColor:"#112233",accentColor:"#abcdef"},typography:{heading:"inter",body:"source-serif-4"},cover:"BRAND",display:{customerName:true,readingDate:true,sectionDividers:true,cardImagery:false,footer:true},footerText:"Thank you"});
const design=(name="Main")=>createDocumentDesign(db,a,{name,configuration:config()});
const create=()=>createDocumentRenderInput(db,a,{orderId,readingId});
beforeEach(async()=>{
 pg=new PGlite();for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;
 for(const id of ["snapshot-a","snapshot-b"])await db.insert(schema.users).values({id,name:id});
 a=await authorizeStore(db,"snapshot-a",await createWorkspace(db,"snapshot-a","Studio","fixtures"));b=await authorizeStore(db,"snapshot-b",await createWorkspace(db,"snapshot-b","Other","fixtures"));
 const [store]=await db.insert(schema.stores).values({organizationId:a.organizationId,name:"Sibling",importSince:new Date()}).returning();sibling=await authorizeStore(db,a.userId,store.id);
 await ingestListing(db,a,fixtureListings[0]);await db.insert(schema.listingSelections).values({organizationId:a.organizationId,storeId:a.storeId,listingExternalId:"101",selectedBy:a.userId});
 productId=await beginListingDraft(db,a,"101");const product=await productData(db,a,productId);
 await activateProduct(db,a,productId,product.draft!.id,0,{name:"Personal guidance",configuration:{inputs:[{id:"name",key:"name",label:"Name",type:"TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"intro",title:"Introduction",instruction:"Welcome",sortOrder:0},{id:"guidance",title:"Guidance",instruction:"Offer guidance",sortOrder:1}],output:"PDF",workflow:"ASSISTED",readingMedia:{mode:"TAROT_CARDS",cardCount:3}}});
 await saveSellerProfile(db,a,{displayName:"Synthetic seller",shortBio:"Synthetic"});const style=await editStyle(db,a);await applyStyle(db,a,style.id,0,{tone:"WARM",detail:"DETAILED",approach:"CONVERSATIONAL",preferredExpressions:[],avoidExpressions:[],instructions:"Clear"});
 orderId=await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9901",lines:[{...fixtureOrders[0].lines[0],externalId:"9911",listingId:"101",quantity:1,answers:[{label:"Name",value:"Synthetic recipient",kind:"text"}]}]});readingId=(await workspaceData(db,a)).units[0].id;
 const gateway=new CentralAIGateway(db,{provider:new FakeGenerationProvider(),model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n});
 const generated=await new GenerationService(db,gateway).prepare(a,{unitId:readingId,commandKey:randomUUID()});generationId=generated.id;
 await openReadingReview(db,a,orderId,readingId);
},20000);
afterEach(async()=>{await pg.close();});

async function setupDeck(key="synthetic",version=1) {const registry=platformMediaRegistry(db),asset=assetFixture();await registry.registerAsset(asset);if(!(await db.select().from(schema.tarotDecks)).some(d=>d.key===key))await registry.registerDeck({key,name:"Synthetic",description:"Fixture only"});await registry.publishVersion(deckFixture(asset.id,key,version));return asset;}
async function ready() {const d=await design();await setDefaultDocumentDesign(db,a,d.id);await approveReadingReview(db,a,orderId,readingId,null);return d;}
async function select(key="synthetic",expectedRevision=0,version=1) {return setStorePreferredTarotDeck(db,a,{deckKey:key,deckVersion:version,expectedRevision});}
async function unsafe(sql:string,args:unknown[]) {await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");try{await pg.query(sql,args);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");}catch(e){await pg.exec("ROLLBACK");throw e;}}
import { createDocumentRenderInputInTransaction } from "../../src/modules/documents/media-service";
import { sql } from "drizzle-orm";
async function waitForLocks(count:number){const deadline=Date.now()+5000;while(Date.now()<deadline){const rows=await pg.query<{pid:number}>("select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock'");if(rows.rows.length>=count)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error("Expected independent PostgreSQL lock waiters not observed");}
function barrier(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};}
for(let iteration=1;iteration<=5;iteration++){
 it(`native duplicate snapshot and approval blocked on Store, iteration ${iteration}`,async()=>{
  await ready();await setupDeck();await select();const held=barrier(),entered=barrier();
  const holder=db.transaction(async tx=>{await tx.execute(sql`select id from stores where id=${a.storeId} for update`);entered.release();await held.promise;});await entered.promise;
  const results=Promise.all([create(),create(),approveReadingReview(db,a,orderId,readingId,null)]);
  try{await waitForLocks(3);}finally{held.release();}await holder;const [one,two]=await results;expect(one.media.id).toBe(two.media.id);expect(await db.select().from(schema.documentSnapshots)).toHaveLength(1);expect(await db.select().from(schema.documentMediaSnapshots)).toHaveLength(1);
 });
 it(`native pinned input blocks preference and retirement, iteration ${iteration}`,async()=>{
  await ready();const first=await setupDeck();await setupDeck("second");await select();const held=barrier(),entered=barrier();let pinned!:Awaited<ReturnType<typeof create>>;
  const creator=db.transaction(async tx=>{pinned=await createDocumentRenderInputInTransaction(tx,a,{orderId,readingId});entered.release();await held.promise;});await entered.promise;
  const preference=select("second",1),retirement=platformMediaRegistry(db).retireVersion({deckKey:"synthetic",deckVersion:1});
  try{await waitForLocks(2);}finally{held.release();}await Promise.all([creator,preference,retirement]);expect(pinned.media.media.mode).toBe("TAROT_CARDS");if(pinned.media.media.mode!=="TAROT_CARDS")throw Error();expect(pinned.media.media.deck.deckKey).toBe("synthetic");expect(pinned.media.media.cards.every(c=>c.asset.id===first.id)).toBe(true);expect(await getDocumentRenderInput(db,a,pinned.media.id)).toEqual(pinned);
 });
}
it("native backend identities and isolation",async()=>{const connections=await Promise.all(Array.from({length:4},()=>pg.client.reserve()));try{const ids=await Promise.all(connections.map(c=>c`select pg_backend_pid() as pid, current_setting('transaction_isolation') as isolation`));expect(new Set(ids.map(r=>r[0].pid)).size).toBe(4);expect(ids.every(r=>r[0].isolation==="read committed")).toBe(true);}finally{connections.forEach(c=>c.release());}});
for(let iteration=1;iteration<=5;iteration++){
 it(`native expected revision competing preferences, iteration ${iteration}`,async()=>{
  await setupDeck();await setupDeck("second");await setupDeck("third");await select();
  const held=barrier(),entered=barrier();const holder=db.transaction(async tx=>{await tx.execute(sql`select id from stores where id=${a.storeId} for update`);entered.release();await held.promise;});await entered.promise;
  const pending=Promise.allSettled([select("second",1),select("third",1)]);try{await waitForLocks(2);}finally{held.release();}await holder;const outcomes=await pending;expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(outcomes.filter(r=>r.status==="rejected")).toHaveLength(1);const bad=outcomes.find(r=>r.status==="rejected") as PromiseRejectedResult;expect(String(bad.reason)).toContain("TAROT_PREFERENCE_CONFLICT");
 });
 it(`native creation versus design default assignment revision, iteration ${iteration}`,async()=>{
  const old=await ready();await setupDeck();await select();const next=await design("Next"),revision=(await getDocumentDesign(db,a,old.id)).revision;
  const held=barrier(),entered=barrier();const holder=db.transaction(async tx=>{await tx.execute(sql`select id from stores where id=${a.storeId} for update`);entered.release();await held.promise;});await entered.promise;
  const pending=Promise.allSettled([create(),setDefaultDocumentDesign(db,a,next.id),assignDocumentDesignToProduct(db,a,productId,next.id),updateDocumentDesign(db,a,old.id,revision,{name:"Edited",configuration:{...config(),footerText:"After"}})]);
  try{await waitForLocks(4);}finally{held.release();}await holder;const outcomes=await pending;for(const result of outcomes)if(result.status==="rejected")expect(String(result.reason)).toContain("DOCUMENT_DESIGN_CONFLICT");const first=outcomes[0];expect(first.status).toBe("fulfilled");if(first.status!=="fulfilled")throw first.reason;const frozen=first.value as Awaited<ReturnType<typeof create>>;expect(["Thank you","After"]).toContain(frozen.snapshot.design.configuration.footerText);expect(await getDocumentRenderInput(db,a,frozen.media.id)).toEqual(frozen);
 });
}
for(let iteration=1;iteration<=5;iteration++)it(`native selection versus uncommitted publication, iteration ${iteration}`,async()=>{
 const asset=await setupDeck();const held=barrier(),entered=barrier();await platformMediaRegistry(db).registerDeck({key:"publishing",name:"Synthetic publishing",description:"Fixture only"});const manifest=deckFixture(asset.id,"publishing",1);
 const publication=db.transaction(async tx=>{await tx.execute(sql`select key from tarot_decks where key='publishing' for update`);await tx.insert(schema.tarotDeckVersions).values({deckKey:"publishing",version:1,status:"PUBLISHED",manifest});entered.release();await held.promise;});await Promise.race([entered.promise,publication]);
 try{await expect(select("publishing",0,1)).rejects.toThrow();expect(await db.select().from(schema.storeTarotPreferences)).toHaveLength(0);}finally{held.release();}await publication;expect(await select("publishing",0,1)).toMatchObject({status:"CONFIGURED",deckVersion:1,revision:1});
});
import { DocumentProductionWorker } from "../../src/modules/production/documents";
import { MemoryArtifactStorage } from "../artifact-storage.fixture";
for(let iteration=1;iteration<=5;iteration++)it(`native independent claims block then converge, iteration ${iteration}`,async()=>{
 await ready();await setupDeck();await select();const held=barrier(),entered=barrier();const storage=new MemoryArtifactStorage();const ports={assets:{async read(){throw Error("imagery disabled");}},artifacts:storage};
 const holder=db.transaction(async tx=>{await tx.execute(sql`select id from stores where id=${a.storeId} for update`);entered.release();await held.promise;});await entered.promise;
 const results=Promise.all([DocumentProductionWorker.forInternalWorker(db,ports).runCycle(),DocumentProductionWorker.forInternalWorker(db,ports).runCycle()]);try{await waitForLocks(2);}finally{held.release();}await holder;expect((await results).flat().filter(r=>r.status==="COMPLETED")).toHaveLength(1);expect(await db.select().from(schema.documentArtifacts)).toHaveLength(1);expect((await db.select().from(schema.documentArtifacts))[0].state).toBe("AVAILABLE");expect(storage.objects.size).toBe(1);
});
import postgres from "postgres";
import { userInfo } from "node:os";
import { drizzle as nativeDrizzle } from "drizzle-orm/postgres-js";
for(let iteration=1;iteration<=5;iteration++)it(`native distinct backend stale settlement, iteration ${iteration}`,async()=>{
 await ready();await setupDeck();await select();
 const clients=[0,1].map(()=>postgres({host:"127.0.0.1",port:5432,username:userInfo().username,password:"",ssl:false,database:pg.name,max:1,onnotice:()=>{},connection:{statement_timeout:15000,lock_timeout:10000}}));
 const storage=new MemoryArtifactStorage(),held=barrier(),entered=barrier();const original=storage.putImmutable.bind(storage);let first=true;storage.putImmutable=async value=>{if(first){first=false;entered.release();await held.promise;}await original(value);};
 let old:Promise<unknown>|undefined;
 try{const pids=await Promise.all(clients.map(c=>c`select pg_backend_pid() as pid`));expect(pids[0][0].pid).not.toBe(pids[1][0].pid);
  const workers=clients.map(c=>DocumentProductionWorker.forInternalWorker(nativeDrizzle(c,{schema}),{assets:{async read(){throw Error("imagery disabled");}},artifacts:storage}));const [work]=await db.select().from(schema.documentProduction);
  old=workers[0].execute(work.id);await Promise.race([entered.promise,old]);
  await unsafe("UPDATE document_production SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[work.id]);
  expect(await workers[1].execute(work.id)).toMatchObject({status:"COMPLETED"});held.release();expect(await old).toEqual({status:"SUPERSEDED"});expect(await db.select().from(schema.documentArtifacts)).toHaveLength(1);expect(storage.objects.size).toBe(1);expect((await db.select().from(schema.documentProduction))[0].attempt).toBe(2);
 }finally{held.release();if(old)await old.catch(()=>{});await Promise.all(clients.map(c=>c.end()));}
});
