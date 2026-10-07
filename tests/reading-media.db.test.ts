import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { authorizeStore,createWorkspace } from "../src/modules/identity/service";
import { ingestListing,ingestOrder,workspaceData } from "../src/modules/intake/service";
import { fixtureListings,fixtureOrders } from "../src/modules/etsy/fixtures";
import { beginListingDraft,activateProduct,productData,editProduct } from "../src/modules/products/service";
import { saveSellerProfile,editStyle,applyStyle } from "../src/modules/seller-style/service";
import { GenerationService } from "../src/modules/generation/service";
import { FakeGenerationProvider } from "../src/infrastructure/ai/fake";
import { CentralAIGateway } from "../src/infrastructure/ai/gateway";
import { pricingFor } from "../src/infrastructure/ai/pricing";
import { openReadingReview,approveReadingReview,saveReadingReviewDraft } from "../src/modules/review/service";
import { createDocumentDesign,updateDocumentDesign,setDefaultDocumentDesign,assignDocumentDesignToProduct,archiveDocumentDesign,getDocumentDesign } from "../src/modules/documents/service";
import { createDocumentSnapshot,getDocumentSnapshotForRender } from "../src/modules/documents/snapshot-service";
import { getApprovedReadingMedia, getApprovedReadingForDocument } from "../src/modules/review/service";
import { createDocumentRenderInput,getDocumentRenderInput } from "../src/modules/documents/media-service";
import { getDocumentLayout } from "../src/modules/documents/layout/service";
import { platformMediaRegistry } from "../src/modules/media/platform-registry";
import { setStorePreferredTarotDeck } from "../src/modules/media/service";
import { assetFixture,deckFixture } from "./media.fixture";
import { stableJson } from "../src/modules/intake/contracts";
import { createHash } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { documentMediaHash } from "../src/modules/documents/media-contract";
import { readingMediaHash } from "../src/modules/media/reading-contract";
import type { Scope } from "../src/modules/intake/contracts";
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
 await activateProduct(db,a,productId,product.draft!.id,0,{name:"Personal guidance",configuration:{inputs:[{id:"name",key:"name",label:"Name",type:"TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"intro",title:"Introduction",instruction:"Welcome",sortOrder:0},{id:"guidance",title:"Guidance",instruction:"Offer guidance",sortOrder:1}],output:"TEXT",workflow:"ASSISTED",readingMedia:{mode:"TAROT_CARDS",cardCount:3}}});
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
it("Product/context freezes requirement; successful Generation and AI accounting retain exact semantic evidence",async()=>{
 const [g]=await db.select().from(schema.generations);expect(g.context.product.configuration.readingMedia).toEqual({mode:"TAROT_CARDS",cardCount:3});expect(g.result!.readingMedia).toMatchObject({mode:"TAROT_CARDS",cards:[{position:0},{position:1},{position:2}]});expect(g.status).toBe("SUCCEEDED");const [request]=await db.select().from(schema.aiRequests);expect(request.status).toBe("SUCCEEDED");expect(request.attemptNumber).toBe(1);expect(await db.select().from(schema.usageEvents)).toHaveLength(1);
 const product=await productData(db,a,productId);await expect(db.update(schema.productVersions).set({configuration:{...product.active!.configuration,readingMedia:{mode:"TAROT_CARDS",cardCount:5}}}).where(eq(schema.productVersions.id,g.productVersionId))).rejects.toThrow();
});
it("Review pins cards; text-only draft edits and approval freeze media separately while v1 text handoff remains unchanged",async()=>{
 const initial=await openReadingReview(db,a,orderId,readingId,true);expect(initial.readingMedia.mode).toBe("TAROT_CARDS");expect(initial.draft!.content).not.toHaveProperty("readingMedia");await expect(saveReadingReviewDraft(db,a,orderId,readingId,0,{...initial.draft!.content,readingMedia:initial.readingMedia})).rejects.toThrow();const content=structuredClone(initial.draft!.content);content.sections[0].content="Edited synthetic text";await saveReadingReviewDraft(db,a,orderId,readingId,0,content);await approveReadingReview(db,a,orderId,readingId,1);const approved=await getApprovedReadingMedia(db,a,orderId,readingId);expect(approved.media).toEqual(initial.readingMedia);expect(Object.isFrozen(approved.media)).toBe(true);const text=await getApprovedReadingForDocument(db,a,orderId,readingId);expect(text.contractVersion).toBe("approved-reading/v1");expect(text).not.toHaveProperty("readingMedia");expect(text.sections[0].content).toBe("Edited synthetic text");expect((await openReadingReview(db,a,orderId,readingId)).readingMedia).toEqual(initial.readingMedia);
 const [row]=await db.select().from(schema.readingReviews);await expect(db.update(schema.readingReviews).set({approvedMedia:null}).where(eq(schema.readingReviews.id,row.id))).rejects.toThrow();
});
it("missing/retired preference rolls back new input; client cannot supply deck, cards, assets or ownership",async()=>{
 await ready();await expect(create()).rejects.toThrow("SETUP_REQUIRED");expect(await db.select().from(schema.documentSnapshots)).toHaveLength(0);await setupDeck();await select();await platformMediaRegistry(db).retireVersion({deckKey:"synthetic",deckVersion:1});await expect(create()).rejects.toThrow();
 for(const key of ["deckKey","deckVersion","assetId","cards","storeId","generationId"])await expect(createDocumentRenderInput(db,a,{orderId,readingId,[key]:randomUUID()})).rejects.toThrow();expect(await db.select().from(schema.documentMediaSnapshots)).toHaveLength(0);
});
it("exact immutable combined input is idempotent and historical despite preference/design/registry changes",async()=>{
 const d=await ready(),asset=await setupDeck();await select();const inputs=await Promise.all([create(),create(),create()]);expect(new Set(inputs.map(i=>i.media.id)).size).toBe(1);const first=inputs[0];expect(first.snapshot.contractVersion).toBe("document-snapshot/v1");expect(first.media.media).toMatchObject({mode:"TAROT_CARDS",deck:{deckKey:"synthetic",deckVersion:1},cards:expect.arrayContaining([expect.objectContaining({position:0,orientation:"UPRIGHT",asset:expect.objectContaining({id:asset.id})})])});expect(Object.isFrozen(first.media.media)).toBe(true);
 const other=await setupDeck("second");await select("second",1);const next=await create();expect(next.snapshot.id).toBe(first.snapshot.id);expect(next.media.id).not.toBe(first.media.id);expect(next.renderInputHash).not.toBe(first.renderInputHash);
 await platformMediaRegistry(db).retireVersion({deckKey:"synthetic",deckVersion:1});await setupDeck("synthetic",2);await updateDocumentDesign(db,a,d.id,(await getDocumentDesign(db,a,d.id)).revision,{name:"Changed",configuration:{...config(),footerText:"Changed"}});await setDefaultDocumentDesign(db,a,null);await archiveDocumentDesign(db,a,d.id);
 expect(await getDocumentRenderInput(db,a,first.media.id)).toEqual(first);expect(await getDocumentSnapshotForRender(db,a,first.snapshot.id)).toEqual(first.snapshot);expect(other.id).not.toBe(asset.id);await expect(db.update(schema.documentMediaSnapshots).set({mediaHash:"0".repeat(64)}).where(eq(schema.documentMediaSnapshots.id,first.media.id))).rejects.toThrow();await expect(db.delete(schema.documentMediaSnapshots).where(eq(schema.documentMediaSnapshots.id,first.media.id))).rejects.toThrow();
});
it("cross-org/sibling/forged order or Reading and cross-Store frozen media access are rejected",async()=>{
 await ready();await setupDeck();await select();const value=await create();for(const scope of [b,sibling,{...a,userId:b.userId}]) {await expect(getApprovedReadingMedia(db,scope,orderId,readingId)).rejects.toThrow();await expect(createDocumentRenderInput(db,scope,{orderId,readingId})).rejects.toThrow();await expect(getDocumentRenderInput(db,scope,value.media.id)).rejects.toThrow();}
 await expect(createDocumentRenderInput(db,a,{orderId:randomUUID(),readingId})).rejects.toThrow();await expect(createDocumentRenderInput(db,a,{orderId,readingId:randomUUID()})).rejects.toThrow();
});
it("corrupt required Generation media blocks Review and approval rather than repairing cards",async()=>{
 const [g]=await db.select().from(schema.generations);const corruptions=[undefined,{mode:"TAROT_CARDS",cards:[]},{mode:"TAROT_CARDS",cards:[{cardKey:"UNKNOWN",orientation:"SIDEWAYS",position:0}]}];for(const readingMedia of corruptions) {const result={sections:g.result!.sections,...(readingMedia?{readingMedia}:{})};await unsafe("UPDATE generations SET result=$1 WHERE id=$2",[JSON.stringify(result),g.id]);await expect(approveReadingReview(db,a,orderId,readingId,null)).rejects.toThrow("REVIEW_UNAVAILABLE");await expect(getApprovedReadingMedia(db,a,orderId,readingId)).rejects.toThrow();}expect((await db.select().from(schema.readingReviews))[0].state).toBe("PENDING");
});
it("approved-media corruption, provenance/hash and frozen asset metadata corruption fail closed",async()=>{
 await ready();await setupDeck();await select();const value=await create(),[review]=await db.select().from(schema.readingReviews);const approved=structuredClone(review.approvedMedia!);await unsafe("UPDATE reading_reviews SET approved_media=$1 WHERE id=$2",[JSON.stringify({...approved,mediaHash:"0".repeat(64)}),review.id]);await expect(getApprovedReadingMedia(db,a,orderId,readingId)).rejects.toThrow();await expect(getDocumentRenderInput(db,a,value.media.id)).rejects.toThrow();await unsafe("UPDATE reading_reviews SET approved_media=$1 WHERE id=$2",[JSON.stringify(approved),review.id]);
 for(const change of ["hash","provenance","orientation","asset","metadata"]) {const payload=structuredClone(value.media) as any;if(change==="hash")payload.mediaHash="0".repeat(64);if(change==="provenance")payload.provenance.generationId=randomUUID();if(change==="orientation")payload.media.cards[0].orientation="REVERSED";if(change==="asset")payload.media.cards[0].asset.id=randomUUID();if(change==="metadata")payload.media.cards[0].asset.width=1;if(["orientation","asset","metadata"].includes(change))payload.mediaHash=documentMediaHash(payload.media);await unsafe("UPDATE document_media_snapshots SET payload=$1,media_hash=$2 WHERE id=$3",[JSON.stringify(payload),payload.mediaHash,value.media.id]);await expect(getDocumentRenderInput(db,a,value.media.id)).rejects.toThrow("DOCUMENT_MEDIA_UNAVAILABLE");}
});
it("preference/retirement/design races commit coherent states, never hybrid deck/assets",async()=>{
 const d=await ready(),first=await setupDeck(),second=await setupDeck("second");await select();await Promise.allSettled([create(),select("second",1)]);const rows=await db.select().from(schema.documentMediaSnapshots);for(const row of rows) {const input=await getDocumentRenderInput(db,a,row.id);if(input.media.media.mode!=="TAROT_CARDS")throw Error();const media=input.media.media;expect(media.cards.every(c=>c.asset.id===(media.deck.deckKey==="synthetic"?first.id:second.id))).toBe(true);}
 await Promise.allSettled([create(),platformMediaRegistry(db).retireVersion({deckKey:"second",deckVersion:1})]);for(const row of await db.select().from(schema.documentMediaSnapshots))await getDocumentRenderInput(db,a,row.id);
 await select("synthetic",2);const revision=(await getDocumentDesign(db,a,d.id)).revision;await Promise.all([create(),updateDocumentDesign(db,a,d.id,revision,{name:"Updated",configuration:{...config(),footerText:"After"}})]);for(const row of await db.select().from(schema.documentMediaSnapshots))expect(["Thank you","After"]).toContain((await getDocumentRenderInput(db,a,row.id)).snapshot.design.configuration.footerText);
});
it("later Generation never replaces pinned Review or frozen document semantic cards",async()=>{
 await ready();await setupDeck();await select();const input=await create(),[g]=await db.select().from(schema.generations);const id=randomUUID();await unsafe("INSERT INTO generations SELECT $1::uuid,organization_id,store_id,unit_id,product_version_id,style_version_id,seller_profile_id,customer_revision,context,context_hash,status,result,created_at+interval '1 minute',completed_at FROM generations WHERE id=$2",[id,g.id]);const later={...g.result!,readingMedia:{mode:"TAROT_CARDS",cards:[{cardKey:"THE_LOVERS",orientation:"UPRIGHT",position:0},{cardKey:"THE_MOON",orientation:"REVERSED",position:1},{cardKey:"TWO_OF_CUPS",orientation:"UPRIGHT",position:2}]}};await unsafe("UPDATE generations SET result=$1 WHERE id=$2",[JSON.stringify(later),id]);expect((await getApprovedReadingMedia(db,a,orderId,readingId)).provenance.generationId).toBe(g.id);expect((await openReadingReview(db,a,orderId,readingId)).readingMedia).toEqual(g.result!.readingMedia);expect(await getDocumentRenderInput(db,a,input.media.id)).toEqual(input);
});
it("historical NONE approvals and v1 snapshots remain readable without backfill",async()=>{
 const [g]=await db.select().from(schema.generations);const c=structuredClone(g.context);delete c.product.configuration.readingMedia;await unsafe("UPDATE generations SET context=$1,context_hash=$2,result=$3 WHERE id=$4",[JSON.stringify(c),createHash("sha256").update(stableJson(c)).digest("hex"),JSON.stringify({sections:g.result!.sections}),g.id]);await ready();const [review]=await db.select().from(schema.readingReviews);await unsafe("UPDATE reading_reviews SET approved_media=NULL WHERE id=$1",[review.id]);expect((await getApprovedReadingMedia(db,a,orderId,readingId)).media).toEqual({mode:"NONE"});const input=await create();expect(input.media.media).toEqual({mode:"NONE"});expect(await getDocumentSnapshotForRender(db,a,input.snapshot.id)).toEqual(input.snapshot);expect((await db.select().from(schema.readingReviews))[0].approvedMedia).toBeNull();

});

it("invalid output accounting and retry/replay preserve admitted media after a newer ProductVersion",async()=>{
 const another=await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9902",lines:[{...fixtureOrders[0].lines[0],externalId:"9912",listingId:"101",quantity:1,answers:[{label:"Name",value:"Synthetic recipient",kind:"text"}]}]});const [unit]=await db.select({id:schema.units.id}).from(schema.units).innerJoin(schema.lineItems,eq(schema.lineItems.id,schema.units.lineItemId)).where(eq(schema.lineItems.orderId,another));
 const policy={model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n};const bad=new FakeGenerationProvider({output:JSON.stringify({sections:[{sectionId:"intro",title:"Introduction",content:"One"},{sectionId:"guidance",title:"Guidance",content:"Two"}]})});const failed=await new GenerationService(db,new CentralAIGateway(db,{...policy,provider:bad})).prepare(a,{unitId:unit.id,commandKey:randomUUID()});expect(failed.status).toBe("FAILED");const [attempt]=await db.select().from(schema.aiRequests).where(eq(schema.aiRequests.generationId,failed.id));expect(attempt.failureCode).toBe("INVALID_OUTPUT");expect(attempt.ambiguous).toBe(false);expect(attempt.costState).toBe("known_zero");
 await editProduct(db,a,productId);const draft=(await productData(db,a,productId)).draft!;await activateProduct(db,a,productId,draft.id,draft.revision,{name:"Five-card future product",configuration:{...draft.configuration,readingMedia:{mode:"TAROT_CARDS",cardCount:5}}});
 const fake=new FakeGenerationProvider(),service=new GenerationService(db,new CentralAIGateway(db,{...policy,provider:fake})),command={unitId:unit.id,commandKey:randomUUID(),retryGenerationId:failed.id};const success=await service.prepare(a,command);expect(success.id).toBe(failed.id);expect(success.contextHash).toBe(failed.contextHash);expect(success.context.product.configuration.readingMedia).toEqual({mode:"TAROT_CARDS",cardCount:3});expect(success.result!.readingMedia).toMatchObject({mode:"TAROT_CARDS",cards:[{position:0},{position:1},{position:2}]});await service.prepare(a,command);expect(fake.calls).toBe(1);expect(await db.select().from(schema.aiRequests).where(eq(schema.aiRequests.generationId,failed.id))).toHaveLength(2);
});
it("additive migration preserves populated historical text Generation/Review/Snapshot and runner replay/repeat",async()=>{
 const [g]=await db.select().from(schema.generations);const context=structuredClone(g.context);delete context.product.configuration.readingMedia;await unsafe("UPDATE generations SET context=$1,context_hash=$2,result=$3 WHERE id=$4",[JSON.stringify(context),createHash("sha256").update(stableJson(context)).digest("hex"),JSON.stringify({sections:g.result!.sections}),g.id]);await unsafe("UPDATE product_versions SET configuration=$1 WHERE id=$2",[JSON.stringify(context.product.configuration),g.productVersionId]);await ready();const [review]=await db.select().from(schema.readingReviews);await unsafe("UPDATE reading_reviews SET approved_media=NULL WHERE id=$1",[review.id]);await createDocumentSnapshot(db,a,{orderId,readingId});
 const legacy=new PGlite(),runner=new PGlite();try {
  for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql") && !f.startsWith("0019")).sort())await legacy.exec(readFileSync("drizzle/"+file,"utf8"));
  const tables=(await legacy.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  await legacy.exec("SET session_replication_role=replica");const before=new Map<string,{columns:string[];rows:unknown[]}>();
  for(const {tablename} of tables) {const columns=(await legacy.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[tablename])).rows.map(c=>c.column_name);const query=`SELECT ${columns.map(c=>'"'+c+'"').join(',')} FROM "${tablename}"`;const rows=(await pg.query(query)).rows;before.set(tablename,{columns,rows});for(const row of rows)await legacy.query(`INSERT INTO "${tablename}" SELECT (jsonb_populate_record(NULL::"${tablename}",$1::jsonb)).*`,[JSON.stringify(row,(_,v)=>typeof v==="bigint"?v.toString():v)]);}
  await legacy.exec("SET session_replication_role=origin");await legacy.exec(readFileSync("drizzle/0019_free_swarm.sql","utf8"));
  for(const [table,{columns,rows}] of before)expect((await legacy.query(`SELECT ${columns.map(c=>'"'+c+'"').join(',')} FROM "${table}"`)).rows).toEqual(rows);
  expect((await legacy.query("SELECT * FROM document_media_snapshots")).rows).toHaveLength(0);expect((await legacy.query("SELECT approved_media FROM reading_reviews")).rows.every((r:any)=>r.approved_media===null)).toBe(true);
  const native=drizzle(runner,{schema});await migrate(native,{migrationsFolder:"drizzle"});await migrate(native,{migrationsFolder:"drizzle"});expect((await runner.query("SELECT * FROM document_media_snapshots")).rows).toHaveLength(0);
 }finally {await legacy.close();await runner.close();}
},20000);

it("layout derives owned immutable input without writes; additive template and foreign scope fail closed",async()=>{
 const d=await createDocumentDesign(db,a,{name:"Atelier",configuration:{...config(),template:"tarot-atelier",display:{...config().display,cardImagery:true}}});await setDefaultDocumentDesign(db,a,d.id);await approveReadingReview(db,a,orderId,readingId,null);await setupDeck();await select();const input=await create();const before=await db.select().from(schema.documentMediaSnapshots);const layout=await getDocumentLayout(db,a,input.media.id);expect(layout.template.key).toBe("tarot-atelier");expect(layout.source.renderInputHash).toBe(input.renderInputHash);expect(layout.pages.some(p=>p.archetype==="MEDIA")).toBe(true);expect(await getDocumentLayout(db,a,input.media.id)).toEqual(layout);expect(await db.select().from(schema.documentMediaSnapshots)).toEqual(before);for(const scope of [b,sibling,{...a,userId:b.userId}])await expect(getDocumentLayout(db,scope,input.media.id)).rejects.toThrow();await expect(getDocumentLayout(db,a,randomUUID())).rejects.toThrow();
});
