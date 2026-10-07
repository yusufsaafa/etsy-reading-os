import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
import type { Scope } from "../src/modules/intake/contracts";
let pg:PGlite,db:Database,a:Scope,b:Scope,sibling:Scope,readingId:string,orderId:string,productId:string,generationId:string;
const config=()=>({contractVersion:"document-design/v1",template:"classic",brand:{name:"Studio",primaryColor:"#112233",accentColor:"#abcdef"},typography:{heading:"inter",body:"source-serif-4"},cover:"BRAND",display:{customerName:true,readingDate:true,sectionDividers:true,cardImagery:false,footer:true},footerText:"Thank you"});
const design=(name="Main")=>createDocumentDesign(db,a,{name,configuration:config()});
const create=()=>createDocumentSnapshot(db,a,{orderId,readingId});
beforeEach(async()=>{
 pg=new PGlite();for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;
 for(const id of ["snapshot-a","snapshot-b"])await db.insert(schema.users).values({id,name:id});
 a=await authorizeStore(db,"snapshot-a",await createWorkspace(db,"snapshot-a","Studio","fixtures"));b=await authorizeStore(db,"snapshot-b",await createWorkspace(db,"snapshot-b","Other","fixtures"));
 const [store]=await db.insert(schema.stores).values({organizationId:a.organizationId,name:"Sibling",importSince:new Date()}).returning();sibling=await authorizeStore(db,a.userId,store.id);
 await ingestListing(db,a,fixtureListings[0]);await db.insert(schema.listingSelections).values({organizationId:a.organizationId,storeId:a.storeId,listingExternalId:"101",selectedBy:a.userId});
 productId=await beginListingDraft(db,a,"101");const product=await productData(db,a,productId);
 await activateProduct(db,a,productId,product.draft!.id,0,{name:"Personal guidance",configuration:{inputs:[{id:"name",key:"name",label:"Name",type:"TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"intro",title:"Introduction",instruction:"Welcome",sortOrder:0},{id:"guidance",title:"Guidance",instruction:"Offer guidance",sortOrder:1}],output:"PDF",workflow:"ASSISTED"}});
 await saveSellerProfile(db,a,{displayName:"Synthetic seller",shortBio:"Synthetic"});const style=await editStyle(db,a);await applyStyle(db,a,style.id,0,{tone:"WARM",detail:"DETAILED",approach:"CONVERSATIONAL",preferredExpressions:[],avoidExpressions:[],instructions:"Clear"});
 orderId=await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9901",lines:[{...fixtureOrders[0].lines[0],externalId:"9911",listingId:"101",quantity:1,answers:[{label:"Name",value:"Synthetic recipient",kind:"text"}]}]});readingId=(await workspaceData(db,a)).units[0].id;
 const gateway=new CentralAIGateway(db,{provider:new FakeGenerationProvider(),model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n});
 const generated=await new GenerationService(db,gateway).prepare(a,{unitId:readingId,commandKey:randomUUID()});generationId=generated.id;
 await openReadingReview(db,a,orderId,readingId);
},20000);
afterEach(async()=>{await pg.close();});

import { createDocumentRenderInput } from "../src/modules/documents/media-service";
import { produceDocumentArtifact,retrieveDocumentArtifact,regenerateDocumentArtifact } from "../src/modules/documents/artifact-service";
import { DocumentProductionWorker,requestDocumentProduction,readingOutputStatus } from "../src/modules/production/documents";
import { MemoryArtifactStorage } from "./artifact-storage.fixture";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sha256 } from "../src/modules/documents/resources/bytes";
import { renderDocumentPdfForReading } from "../src/modules/documents/pdf/service";
import { ArtifactStorageError } from "../src/infrastructure/object-storage";
const assets={async read(){throw new Error("Unexpected image read");}};
async function ready(){const d=await design();await setDefaultDocumentDesign(db,a,d.id);await approveReadingReview(db,a,orderId,readingId,null);return d;}
async function input(){return createDocumentRenderInput(db,a,{orderId,readingId});}
const produce=(mediaId:string,storage:MemoryArtifactStorage)=>produceDocumentArtifact(db,a,mediaId,assets,storage);
const retrieve=(id:string,storage:MemoryArtifactStorage,scope=a)=>retrieveDocumentArtifact(db,scope,{readingId,artifactId:id},storage);
it("actual PDF becomes owned AVAILABLE evidence with exact hashes/size/pages and detached download",async()=>{
 await ready();const frozen=await input(),storage=new MemoryArtifactStorage(),artifact=await produce(frozen.media.id,storage);
 const pdf=await renderDocumentPdfForReading(db,a,frozen.media.id,assets);for(const key of ["sha256","byteLength","pageCount","rendererVersion","layoutHash","resourceHash"] as const)expect(artifact[key]).toBe(pdf.metadata[key]);
 expect(artifact.state).toBe("AVAILABLE");expect(artifact.documentSnapshotId).toBe(frozen.snapshot.id);expect(artifact.mediaSnapshotId).toBe(frozen.media.id);expect(artifact.rendererVersion).toBe("reading-pdf/1");
 const result=await retrieve(artifact.id,storage);expect(result.metadata.contractVersion).toBe("available-document-artifact/v1");expect(result.metadata.contentType).toBe("application/pdf");expect(result.metadata).not.toHaveProperty("objectKey");expect(sha256(result.copyBytes())).toBe(artifact.sha256);expect(result.copyBytes().length).toBe(artifact.byteLength);expect(Buffer.from(result.copyBytes().subarray(0,8)).toString()).toBe("%PDF-1.7");
 result.copyBytes().fill(0);expect(sha256((await retrieve(artifact.id,storage)).copyBytes())).toBe(artifact.sha256);
});
it("duplicate logical workers converge; AVAILABLE lookup needs neither rendering nor assets",async()=>{
 await ready();const frozen=await input(),storage=new MemoryArtifactStorage();const results=await Promise.all([produce(frozen.media.id,storage),produce(frozen.media.id,storage)]);
 expect(new Set(results.map(r=>r.id)).size).toBe(1);expect(await db.select().from(schema.documentArtifacts)).toHaveLength(1);expect(storage.objects.size).toBe(1);
 const writes=storage.writes;expect(await produceDocumentArtifact(db,a,frozen.media.id,{read:async()=>{throw Error("no rendering");}},storage)).toEqual(results[0]);expect(storage.writes).toBe(writes);
});
it("SQL protects every artifact evidence field and prevents delete/invalid AVAILABLE insertion",async()=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage(),artifact=await produce(f.media.id,storage);
 for(const patch of [{sha256:"a".repeat(64)},{byteLength:99},{pageCount:99},{rendererVersion:"other/1"},{layoutHash:"a".repeat(64)},{resourceHash:"b".repeat(64)},{objectKey:"other"},{readingId:randomUUID()},{mediaSnapshotId:randomUUID()},{documentSnapshotId:randomUUID()},{storeId:b.storeId},{contentType:"text/plain"},{availableAt:new Date()}])await expect(db.update(schema.documentArtifacts).set(patch).where(eq(schema.documentArtifacts.id,artifact.id))).rejects.toThrow();
 await expect(db.delete(schema.documentArtifacts).where(eq(schema.documentArtifacts.id,artifact.id))).rejects.toThrow();
 const {contractVersion,...row}=artifact;void contractVersion;
 await expect(db.insert(schema.documentArtifacts).values({...row,id:randomUUID(),createdAt:new Date(row.createdAt),availableAt:new Date(row.availableAt!)})).rejects.toThrow();
});
it("failure before write persists PENDING intent, rejects download and retries same artifact",async()=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage();storage.failBefore=true;await expect(produce(f.media.id,storage)).rejects.toThrow("UNAVAILABLE");
 const [pending]=await db.select().from(schema.documentArtifacts);expect(pending.state).toBe("PENDING");expect(storage.objects.size).toBe(0);await expect(retrieve(pending.id,storage)).rejects.toThrow("ARTIFACT_NOT_AVAILABLE");
 storage.failBefore=false;expect((await produce(f.media.id,storage)).id).toBe(pending.id);expect(await db.select().from(schema.documentArtifacts)).toHaveLength(1);
});
it("lost successful write response is adopted without rendering/rewriting after restart",async()=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage();storage.loseWriteResponse=true;await expect(produce(f.media.id,storage)).rejects.toThrow("UNAVAILABLE");const [pending]=await db.select().from(schema.documentArtifacts);expect(storage.objects.size).toBe(1);expect(pending.state).toBe("PENDING");
 const adopted=await produceDocumentArtifact(db,a,f.media.id,{read:async()=>{throw Error("no rendering");}},storage);expect(adopted.id).toBe(pending.id);expect(adopted.state).toBe("AVAILABLE");expect(storage.writes).toBe(1);
});
it("DB finalization failure leaves written object recoverable",async()=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage();
 await pg.exec("CREATE FUNCTION qa_block_finalize() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='AVAILABLE' THEN RAISE EXCEPTION 'Synthetic DB failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_block_finalize BEFORE UPDATE ON document_artifacts FOR EACH ROW EXECUTE FUNCTION qa_block_finalize()");
 await expect(produce(f.media.id,storage)).rejects.toThrow();const [pending]=await db.select().from(schema.documentArtifacts);expect(pending.state).toBe("PENDING");expect(storage.objects.size).toBe(1);
 await pg.exec("DROP TRIGGER qa_block_finalize ON document_artifacts; DROP FUNCTION qa_block_finalize()");expect((await produce(f.media.id,storage)).id).toBe(pending.id);expect(storage.writes).toBe(1);
});
it.each(["missing","truncated","sha","mime","oversized","key"])("retrieval rejects %s stored evidence",async mode=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage(),artifact=await produce(f.media.id,storage),object=storage.objects.get(artifact.objectKey)!;
 if(mode==="missing")storage.objects.delete(artifact.objectKey);if(mode==="truncated")object.bytes=object.bytes.subarray(0,5);if(mode==="sha")object.bytes[0]^=255;if(mode==="mime")object.contentType="text/plain";if(mode==="oversized")object.bytes=new Uint8Array(artifact.byteLength+1);if(mode==="key")object.objectKey="wrong";
 await expect(retrieve(artifact.id,storage)).rejects.toThrow();
});
it("foreign organization, sibling, forged membership/Reading/artifact/key authorize no storage read",async()=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage(),artifact=await produce(f.media.id,storage),reads=storage.reads;
 for(const scope of [b,sibling,{...a,userId:b.userId}]){await expect(retrieve(artifact.id,storage,scope)).rejects.toThrow();await expect(produceDocumentArtifact(db,scope,f.media.id,assets,storage)).rejects.toThrow();}
 for(const command of [{readingId:randomUUID(),artifactId:artifact.id},{readingId,artifactId:randomUUID()},{readingId,artifactId:artifact.id,objectKey:artifact.objectKey},{objectKey:artifact.objectKey}])await expect(retrieveDocumentArtifact(db,a,command,storage)).rejects.toThrow();expect(storage.reads).toBe(reads);
});
it("old output survives changed design, assignment/default and archive; new snapshot makes new artifact",async()=>{
 const d=await ready(),f=await input(),storage=new MemoryArtifactStorage(),first=await produce(f.media.id,storage);
 const current=await getDocumentDesign(db,a,d.id);await updateDocumentDesign(db,a,d.id,current.revision,{name:"Changed",configuration:{...config(),brand:{...config().brand,primaryColor:"#AA0000"}}});const f2=await input(),second=await produce(f2.media.id,storage);expect(second.id).not.toBe(first.id);
 const replacement=await design("Replacement");await assignDocumentDesignToProduct(db,a,productId,replacement.id);await setDefaultDocumentDesign(db,a,replacement.id);await archiveDocumentDesign(db,a,d.id);
 expect(sha256((await retrieve(first.id,storage)).copyBytes())).toBe(first.sha256);expect((await produce(f.media.id,storage)).id).toBe(first.id);expect(await db.select().from(schema.documentArtifacts)).toHaveLength(2);
});
it("approval atomically admits assisted PDF; production completion is delivery-ready, never delivered",async()=>{
 await ready();const storage=new MemoryArtifactStorage(),worker=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage});expect((await readingOutputStatus(db,a,orderId,readingId)).deliveryReady).toBe(false);
 expect(await worker.runCycle()).toMatchObject([{status:"COMPLETED"}]);const result=await readingOutputStatus(db,a,orderId,readingId);expect(result).toMatchObject({status:"Ready to deliver",deliveryReady:true});expect(result.artifactId).toBeTruthy();expect(await worker.runCycle()).toEqual([]);expect(await db.select().from(schema.documentArtifacts)).toHaveLength(1);
 await approveReadingReview(db,a,orderId,readingId,null);expect(await db.select().from(schema.documentProduction)).toHaveLength(1);
});
it("safe storage failures use durable shared backoff and frozen input; explicit recovery retains history",async()=>{
 await ready();const storage=new MemoryArtifactStorage();storage.failBefore=true;const worker=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage});await worker.runCycle();const [work]=await db.select().from(schema.documentProduction);expect(work.state).toBe("RETRY_WAIT");expect(work.failureCode).toBe("STORAGE_UNAVAILABLE");expect(work.availableAt!.getTime()-work.updatedAt.getTime()).toBeGreaterThan(29000);expect(work.mediaSnapshotId).toBeTruthy();expect(await worker.runCycle()).toEqual([]);
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE document_production SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",[work.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");storage.failBefore=false;expect(await worker.runCycle()).toMatchObject([{status:"COMPLETED"}]);const [done]=await db.select().from(schema.documentProduction);expect(done.attempt).toBe(2);expect(done.mediaSnapshotId).toBe(work.mediaSnapshotId);
});
it("missing setup is Problem, explicit retry after remedy succeeds with no AI work",async()=>{
 await approveReadingReview(db,a,orderId,readingId,null);const before=await db.select().from(schema.aiRequests),storage=new MemoryArtifactStorage(),worker=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage});expect(await worker.runCycle()).toMatchObject([{status:"ATTENTION",failureCode:"SETUP_REQUIRED"}]);expect(await readingOutputStatus(db,a,orderId,readingId)).toMatchObject({status:"Problem",deliveryReady:false});const d=await design();await setDefaultDocumentDesign(db,a,d.id);await requestDocumentProduction(db,a,{orderId,readingId});expect(await worker.runCycle()).toMatchObject([{status:"COMPLETED"}]);expect(await db.select().from(schema.aiRequests)).toEqual(before);
});
it("two downstream workers fence claims and converge to one successful artifact",async()=>{
 await ready();const storage=new MemoryArtifactStorage(),one=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage}),two=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage});const results=await Promise.all([one.runCycle(),two.runCycle()]);expect(results.flat().filter(r=>r.status==="COMPLETED")).toHaveLength(1);expect(await db.select().from(schema.documentArtifacts)).toHaveLength(1);expect(storage.objects.size).toBe(1);
});
it("expired document claim safely resumes pinned input and adopts already-written PDF",async()=>{
 await ready();const storage=new MemoryArtifactStorage();storage.loseWriteResponse=true;const worker=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage});await worker.runCycle();const [work]=await db.select().from(schema.documentProduction);const [artifact]=await db.select().from(schema.documentArtifacts);
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE document_production SET state='PROCESSING',failure_code=NULL,available_at=NULL,claim_token=$1,claim_expires_at=clock_timestamp()-interval '1 second' WHERE id=$2",[randomUUID(),work.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");
 expect(await worker.runCycle()).toMatchObject([{status:"COMPLETED"}]);const [done]=await db.select().from(schema.documentProduction);expect(done.artifactId).toBe(artifact.id);expect(done.mediaSnapshotId).toBe(work.mediaSnapshotId);expect(storage.writes).toBe(1);
});
it("storage integrity conflict is attention, not automatic retry",async()=>{
 await ready();const storage=new MemoryArtifactStorage();storage.putImmutable=async()=>{throw new ArtifactStorageError("CONFLICT");};expect(await DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage}).runCycle()).toMatchObject([{status:"ATTENTION",failureCode:"STORAGE_CONFLICT"}]);expect((await db.select().from(schema.documentArtifacts))[0].state).toBe("PENDING");
});
it("migration runner replay is a no-op and additive application preserves populated history",async()=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage();await produce(f.media.id,storage);
 const legacy=new PGlite(),runner=new PGlite();try{
  for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")&&f<"0020").sort())await legacy.exec(readFileSync("drizzle/"+file,"utf8"));
  const tables=(await legacy.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  await legacy.exec("SET session_replication_role=replica");const before=new Map<string,unknown[]>();
  for(const {tablename} of tables){const rows=(await pg.query(`SELECT * FROM "${tablename}"`)).rows;before.set(tablename,rows);for(const row of rows)await legacy.query(`INSERT INTO "${tablename}" SELECT (jsonb_populate_record(NULL::"${tablename}",$1::jsonb)).*`,[JSON.stringify(row,(_,v)=>typeof v==="bigint"?v.toString():v)]);}
  await legacy.exec("SET session_replication_role=origin");await legacy.exec(readFileSync("drizzle/0020_clean_franklin_storm.sql","utf8"));for(const [table,rows] of before)expect((await legacy.query(`SELECT * FROM "${table}"`)).rows).toEqual(rows);expect((await legacy.query("SELECT * FROM document_artifacts")).rows).toEqual([]);
  const native=drizzle(runner,{schema});await migrate(native,{migrationsFolder:"drizzle"});const beforeCount=(await runner.query("SELECT * FROM drizzle.__drizzle_migrations")).rows.length;await migrate(native,{migrationsFolder:"drizzle"});expect((await runner.query("SELECT * FROM drizzle.__drizzle_migrations")).rows).toHaveLength(beforeCount);
 }finally{await legacy.close();await runner.close();}
},20000);

async function anotherReading(output:"TEXT"|"PDF",workflow:"ASSISTED"|"MANUAL",tarot=false){
 const id=await editProduct(db,a,productId),draft=(await productData(db,a,productId)).draft!;
 await activateProduct(db,a,productId,id,draft.revision,{name:"New output",configuration:{...draft.configuration,output,workflow,...(tarot?{readingMedia:{mode:"TAROT_CARDS",cardCount:3}}:{})}});
 const nextOrder=await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9902",lines:[{...fixtureOrders[0].lines[0],externalId:"9912",listingId:"101",quantity:1,answers:[{label:"Name",value:"Synthetic",kind:"text"}]}]});
 const nextUnit=(await workspaceData(db,a)).units.find(u=>u.productVersionId===id)!;
 const gateway=new CentralAIGateway(db,{provider:new FakeGenerationProvider(),model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n});
 await new GenerationService(db,gateway).prepare(a,{unitId:nextUnit.id,commandKey:randomUUID()});await openReadingReview(db,a,nextOrder,nextUnit.id);await approveReadingReview(db,a,nextOrder,nextUnit.id,null);
 return {orderId:nextOrder,readingId:nextUnit.id};
}
it("text-only approval requires no design, PDF, object storage or document work",async()=>{
 const command=await anotherReading("TEXT","ASSISTED");expect(await readingOutputStatus(db,a,command.orderId,command.readingId)).toEqual({status:"Approved",deliveryReady:true,artifactId:null});expect(await requestDocumentProduction(db,a,command)).toBeNull();expect(await db.select().from(schema.documentProduction)).toEqual([]);expect(await db.select().from(schema.documentArtifacts)).toEqual([]);
});
it("Manual PDF waits for explicit owner preparation and never auto-delivers",async()=>{
 const d=await design();await setDefaultDocumentDesign(db,a,d.id);const command=await anotherReading("PDF","MANUAL"),storage=new MemoryArtifactStorage(),worker=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage});expect(await worker.runCycle()).toEqual([]);expect((await readingOutputStatus(db,a,command.orderId,command.readingId)).deliveryReady).toBe(false);
 await expect(requestDocumentProduction(db,b,command)).rejects.toThrow();await requestDocumentProduction(db,a,command);expect(await worker.runCycle()).toMatchObject([{status:"COMPLETED"}]);expect((await readingOutputStatus(db,a,command.orderId,command.readingId)).status).toBe("Ready to deliver");
});
it("explicit regeneration reuses exact output or creates another historical artifact without rebinding completed work",async()=>{
 const d=await ready(),storage=new MemoryArtifactStorage(),worker=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage});await worker.runCycle();const [old]=await db.select().from(schema.documentArtifacts);const same=await regenerateDocumentArtifact(db,a,{orderId,readingId},assets,storage);expect(same.id).toBe(old.id);
 const current=await getDocumentDesign(db,a,d.id);await updateDocumentDesign(db,a,d.id,current.revision,{name:"Revision",configuration:{...config(),footerText:"New footer"}});const revised=await regenerateDocumentArtifact(db,a,{orderId,readingId},assets,storage);expect(revised.id).not.toBe(old.id);expect((await readingOutputStatus(db,a,orderId,readingId)).artifactId).toBe(old.id);expect(sha256((await retrieve(old.id,storage)).copyBytes())).toBe(old.sha256);
});
it("bounded retry exhaustion stops after three attempts and preserves explicit recovery evidence",async()=>{
 await ready();const storage=new MemoryArtifactStorage();storage.failBefore=true;const worker=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage});
 for(let i=0;i<3;i++){await worker.runCycle();if(i<2){await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.exec("UPDATE document_production SET available_at=clock_timestamp()-interval '1 second'");await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");}}
 const [work]=await db.select().from(schema.documentProduction);expect(work.attempt).toBe(3);expect(work.state).toBe("ATTENTION");expect(await worker.runCycle()).toEqual([]);expect(await db.select().from(schema.documentArtifacts)).toHaveLength(1);
 await expect(db.delete(schema.documentProduction).where(eq(schema.documentProduction.id,work.id))).rejects.toThrow();await expect(db.update(schema.documentProduction).set({mediaSnapshotId:randomUUID()}).where(eq(schema.documentProduction.id,work.id))).rejects.toThrow();
});
it("late cancellation blocks output production while historical downloads remain independently owned",async()=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage(),old=await produce(f.media.id,storage);await db.update(schema.orders).set({canceled:true}).where(eq(schema.orders.id,orderId));expect(await DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage}).runCycle()).toMatchObject([{status:"ATTENTION",failureCode:"READING_HOLD"}]);await expect(readingOutputStatus(db,a,orderId,readingId)).rejects.toThrow();expect(sha256((await retrieve(old.id,storage)).copyBytes())).toBe(old.sha256);
});
it("invalid source relationship/MIME/hash/size/page rows fail actual database constraints",async()=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage();storage.failBefore=true;await expect(produce(f.media.id,storage)).rejects.toThrow();const [row]=await db.select().from(schema.documentArtifacts);
 for(const change of [{orderId:randomUUID()},{readingId:randomUUID()},{mediaSnapshotId:randomUUID()},{documentSnapshotId:randomUUID()},{organizationId:b.organizationId},{contentType:"image/png"},{sha256:"invalid"},{byteLength:0},{pageCount:1001}])await expect(db.insert(schema.documentArtifacts).values({...row,...change,id:randomUUID()})).rejects.toThrow();
});

import { ProductionTick } from "../src/modules/production/tick";
import { ProductionRecovery } from "../src/modules/production/recovery";
import { ProductionScheduler } from "../src/modules/production/scheduler";
import { ProductionExecutor } from "../src/modules/production/execution";
it("existing production tick executes downstream document stage without another Generation dispatch",async()=>{
 await ready();const storage=new MemoryArtifactStorage(),documents=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage}),provider=new FakeGenerationProvider();
 const gateway=new CentralAIGateway(db,{provider,model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n});
 const tick=ProductionTick.forInternalWorker(db,ProductionRecovery.forInternalWorker(db),ProductionScheduler.forInternalWorker(db),ProductionExecutor.forInternalWorker(db,new GenerationService(db,gateway)),()=>documents.runCycle());
 const result=await tick.runProductionTick();expect(result.status).toBe("FINISHED");expect("documents" in result&&result.documents).toMatchObject([{status:"COMPLETED"}]);expect(provider.calls).toBe(0);expect((await readingOutputStatus(db,a,orderId,readingId)).deliveryReady).toBe(true);
});
import { syntheticImage } from "./render-resources.fixture";
import { assetFixture,deckFixture } from "./media.fixture";
import { platformMediaRegistry } from "../src/modules/media/platform-registry";
import { setStorePreferredTarotDeck } from "../src/modules/media/service";
it("synthetic tarot artifact stays downloadable after preference change/deck retirement, without artwork reads",async()=>{
 const d=await createDocumentDesign(db,a,{name:"Tarot",configuration:{...config(),template:"mystic",display:{...config().display,cardImagery:true}}});await setDefaultDocumentDesign(db,a,d.id);
 const bytes=await syntheticImage(),asset={...assetFixture(),byteSize:bytes.length,contentHash:sha256(bytes),width:60,height:100},registry=platformMediaRegistry(db);
 await registry.registerAsset(asset);for(const key of ["artifact-old","artifact-new"]){await registry.registerDeck({key,name:key,description:"Synthetic rectangles only"});await registry.publishVersion(deckFixture(asset.id,key));}
 await setStorePreferredTarotDeck(db,a,{deckKey:"artifact-old",deckVersion:1,expectedRevision:0});
 const command=await anotherReading("PDF","ASSISTED",true),f=await createDocumentRenderInput(db,a,command),storage=new MemoryArtifactStorage();let reads=0;const platform={async read(){reads++;return bytes;}};
 const first=await produceDocumentArtifact(db,a,f.media.id,platform,storage);expect(reads).toBe(1);
 await setStorePreferredTarotDeck(db,a,{deckKey:"artifact-new",deckVersion:1,expectedRevision:1});await registry.retireVersion({deckKey:"artifact-old",deckVersion:1});
 const retrieved=await retrieveDocumentArtifact(db,a,{readingId:command.readingId,artifactId:first.id},storage);expect(sha256(retrieved.copyBytes())).toBe(first.sha256);expect((await produceDocumentArtifact(db,a,f.media.id,{read:async()=>{throw Error("no historical rendering");}},storage)).id).toBe(first.id);expect(reads).toBe(1);
});

it("late expired worker cannot settle a replacement claim; immutable storage effects converge",async()=>{
 await ready();const storage=new MemoryArtifactStorage();let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const put=storage.putImmutable.bind(storage);let first=true;storage.putImmutable=async value=>{if(first){first=false;entered();await gate;}await put(value);};
 const one=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage}),two=DocumentProductionWorker.forInternalWorker(db,{assets,artifacts:storage});
 const [work]=await db.select().from(schema.documentProduction);const old=one.execute(work.id);await started;
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE document_production SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[work.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");
 try{expect(await two.execute(work.id)).toMatchObject({status:"COMPLETED"});}finally{release();}
 expect(await old).toEqual({status:"SUPERSEDED"});const [done]=await db.select().from(schema.documentProduction);expect(done.state).toBe("COMPLETED");expect(done.attempt).toBe(2);expect(await db.select().from(schema.documentArtifacts)).toHaveLength(1);expect(storage.objects.size).toBe(1);
});
it("pending output evidence mismatch fails closed without overwriting stored intent",async()=>{
 await ready();const f=await input(),storage=new MemoryArtifactStorage();storage.failBefore=true;await expect(produce(f.media.id,storage)).rejects.toThrow("UNAVAILABLE");
 const [pending]=await db.select().from(schema.documentArtifacts);const digest="a".repeat(64),key=pending.objectKey.replace(pending.sha256,digest);
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE document_artifacts SET sha256=$1,object_key=$2 WHERE id=$3",[digest,key,pending.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");storage.failBefore=false;
 const writes=storage.writes;await expect(produce(f.media.id,storage)).rejects.toThrow("ARTIFACT_RENDER_CONFLICT");expect(storage.writes).toBe(writes);expect((await db.select().from(schema.documentArtifacts))[0].state).toBe("PENDING");
});
