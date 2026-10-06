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
import { beginListingDraft,activateProduct,productData } from "../src/modules/products/service";
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
 await activateProduct(db,a,productId,product.draft!.id,0,{name:"Personal guidance",configuration:{inputs:[{id:"name",key:"name",label:"Name",type:"TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"intro",title:"Introduction",instruction:"Welcome",sortOrder:0},{id:"guidance",title:"Guidance",instruction:"Offer guidance",sortOrder:1}],output:"TEXT",workflow:"ASSISTED"}});
 await saveSellerProfile(db,a,{displayName:"Synthetic seller",shortBio:"Synthetic"});const style=await editStyle(db,a);await applyStyle(db,a,style.id,0,{tone:"WARM",detail:"DETAILED",approach:"CONVERSATIONAL",preferredExpressions:[],avoidExpressions:[],instructions:"Clear"});
 orderId=await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9901",lines:[{...fixtureOrders[0].lines[0],externalId:"9911",listingId:"101",quantity:1,answers:[{label:"Name",value:"Synthetic recipient",kind:"text"}]}]});readingId=(await workspaceData(db,a)).units[0].id;
 const gateway=new CentralAIGateway(db,{provider:new FakeGenerationProvider(),model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:1000000000n,attemptBudgetNanos:1000000000n});
 const generated=await new GenerationService(db,gateway).prepare(a,{unitId:readingId,commandKey:randomUUID()});generationId=generated.id;
 await openReadingReview(db,a,orderId,readingId);
},20000);
afterEach(async()=>{await pg.close();});
async function approve(edited=false) {
 if(edited){const view=await openReadingReview(db,a,orderId,readingId,true),content=structuredClone(view.draft!.content);content.sections[0].content="Exact seller edit — 猫 🐾\n\n<script>plain</script>";await saveReadingReviewDraft(db,a,orderId,readingId,0,content);}
 return approveReadingReview(db,a,orderId,readingId,edited?1:null);
}
async function corrupt(id:string,payload:unknown){await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");try{await pg.query("UPDATE document_snapshots SET payload=$1 WHERE id=$2",[JSON.stringify(payload),id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");}catch(error){await pg.exec("ROLLBACK");throw error;}}
it.each([false,true])("approved content creates exact immutable snapshot through both boundaries (edited=%s)",async edited=>{
 const d=await design();await setDefaultDocumentDesign(db,a,d.id);if(edited)await assignDocumentDesignToProduct(db,a,productId,d.id);
 await expect(create()).rejects.toThrow("REVIEW_UNAVAILABLE");if(edited){await openReadingReview(db,a,orderId,readingId,true);await expect(create()).rejects.toThrow("REVIEW_UNAVAILABLE");}
 const approval=await approve(edited),beforeGeneration=await db.select().from(schema.generations),beforeProductVersions=await db.select().from(schema.productVersions),snapshot=await create();
 expect(snapshot.reading.sections).toEqual(approval.approvedContent!.sections);expect(snapshot.reading.contentHash).toBe(approval.approvedContentHash);expect(snapshot.provenance).toEqual({reviewId:approval.id,generationId});expect(snapshot.reading.product.id).toBe(productId);expect(snapshot.reading.order.reference).toBe("9901");expect(snapshot.design.configuration.brand.primaryColor).toBe("#112233");expect(snapshot.design.source).toBe(edited?"PRODUCT":"STORE_DEFAULT");expect(snapshot.design.template).toEqual({key:"classic",contractVersion:"document-template/v1",version:1});
 expect(await getDocumentSnapshotForRender(db,a,snapshot.id)).toEqual(snapshot);expect(Object.isFrozen(snapshot.reading.sections[0])).toBe(true);
 expect(JSON.stringify(snapshot)).not.toMatch(/AIRequest|UsageEvent|provider|model|styleIntelligence|customerRevision|answers/);
 expect(await db.select().from(schema.generations)).toEqual(beforeGeneration);expect(await db.select().from(schema.productVersions)).toEqual(beforeProductVersions);
});
it("duplicate and concurrent creation reuse one snapshot; SQL update/delete are blocked",async()=>{
 const d=await design();await setDefaultDocumentDesign(db,a,d.id);await approve();const snapshots=await Promise.all([create(),create(),create()]);expect(new Set(snapshots.map(s=>s.id)).size).toBe(1);expect(await db.select().from(schema.documentSnapshots)).toHaveLength(1);
 await expect(db.update(schema.documentSnapshots).set({snapshotHash:"0".repeat(64)}).where(eq(schema.documentSnapshots.id,snapshots[0].id))).rejects.toThrow();await expect(db.delete(schema.documentSnapshots).where(eq(schema.documentSnapshots.id,snapshots[0].id))).rejects.toThrow();
});
it("design edits, reassignment, default changes and archive preserve historical snapshots",async()=>{
 const first=await design(),second=await design("Second");await setDefaultDocumentDesign(db,a,first.id);await approve();const s1=await create();
 const current=await getDocumentDesign(db,a,first.id);await updateDocumentDesign(db,a,first.id,current.revision,{name:"Changed",configuration:{...config(),brand:{...config().brand,primaryColor:"#AA0000"}}});const s2=await create();expect(s2.id).not.toBe(s1.id);expect(s2.snapshotHash).not.toBe(s1.snapshotHash);expect(s1.design.configuration.brand.primaryColor).toBe("#112233");
 await assignDocumentDesignToProduct(db,a,productId,second.id);const s3=await create();expect(s3.design.id).toBe(second.id);await setDefaultDocumentDesign(db,a,second.id);await archiveDocumentDesign(db,a,first.id);
 expect(await getDocumentSnapshotForRender(db,a,s1.id)).toEqual(s1);expect(await getDocumentSnapshotForRender(db,a,s2.id)).toEqual(s2);expect(await getDocumentSnapshotForRender(db,a,s3.id)).toEqual(s3);
});
it("snapshot creation rejects missing design, foreign scope, forged intent and snapshot identifiers",async()=>{
 await approve();await expect(create()).rejects.toThrow("SETUP_REQUIRED");const d=await design();await setDefaultDocumentDesign(db,a,d.id);const snapshot=await create();
 for(const foreign of [b,sibling]) {await expect(createDocumentSnapshot(db,foreign,{orderId,readingId})).rejects.toThrow();await expect(getDocumentSnapshotForRender(db,foreign,snapshot.id)).rejects.toThrow("UNAVAILABLE");}
 await expect(createDocumentSnapshot(db,a,{orderId:randomUUID(),readingId})).rejects.toThrow();await expect(createDocumentSnapshot(db,a,{orderId,readingId:randomUUID()})).rejects.toThrow();await expect(createDocumentSnapshot(db,a,{orderId,readingId,productId})).rejects.toThrow();await expect(getDocumentSnapshotForRender(db,a,randomUUID())).rejects.toThrow("UNAVAILABLE");await expect(getDocumentSnapshotForRender(db,a,"bad")).rejects.toThrow("UNAVAILABLE");
});
it("corrupt stored content, hashes, template and provenance fail read without repair",async()=>{
 const d=await design();await setDefaultDocumentDesign(db,a,d.id);await approve();const snapshot=await create();
 const changes=[(v:any)=>v.snapshotHash="0".repeat(64),(v:any)=>v.reading.contentHash="0".repeat(64),(v:any)=>v.design.configurationHash="0".repeat(64),(v:any)=>v.reading.sections.reverse(),(v:any)=>v.design.template.version=99,(v:any)=>v.provenance.reviewId=randomUUID(),(v:any)=>v.reading.product.id=randomUUID(),(v:any)=>v.design.id=randomUUID(),(v:any)=>v.reading.sections=[]];
 for(const change of changes){const payload=structuredClone(snapshot);change(payload);await corrupt(snapshot.id,payload);await expect(getDocumentSnapshotForRender(db,a,snapshot.id)).rejects.toThrow("UNAVAILABLE");}
 await corrupt(snapshot.id,snapshot);expect(await getDocumentSnapshotForRender(db,a,snapshot.id)).toEqual(snapshot);
});
it("corrupt upstream design and approval fail creation with no partial snapshot",async()=>{
 const d=await design();await setDefaultDocumentDesign(db,a,d.id);const approval=await approve();
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE reading_reviews SET approved_content_hash=$1 WHERE id=$2",["0".repeat(64),approval.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");await expect(create()).rejects.toThrow("REVIEW_UNAVAILABLE");expect(await db.select().from(schema.documentSnapshots)).toHaveLength(0);
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE reading_reviews SET approved_content_hash=$1 WHERE id=$2",[approval.approvedContentHash,approval.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");const current=await getDocumentDesign(db,a,d.id);
 await db.update(schema.documentDesigns).set({configuration:{...config(),template:"unsupported"} as never,revision:current.revision+1}).where(eq(schema.documentDesigns.id,d.id));await expect(create()).rejects.toThrow("UNAVAILABLE");expect(await db.select().from(schema.documentSnapshots)).toHaveLength(0);
});
it("creation racing design updates, default/assignment changes and archive has coherent frozen results",async()=>{
 const first=await design(),second=await design("Second");await setDefaultDocumentDesign(db,a,first.id);await approve();const current=await getDocumentDesign(db,a,first.id);
 const [snapshot]=await Promise.all([create(),updateDocumentDesign(db,a,first.id,current.revision,{name:"New",configuration:{...config(),brand:{...config().brand,primaryColor:"#AA0000"}}})]);
 expect(snapshot.design.configuration.brand.primaryColor).toBe(snapshot.design.revision===current.revision?"#112233":"#AA0000");
 const [other]=await Promise.all([create(),assignDocumentDesignToProduct(db,a,productId,second.id),setDefaultDocumentDesign(db,a,second.id)]);expect([first.id,second.id]).toContain(other.design.id);
 await assignDocumentDesignToProduct(db,a,productId,null);await setDefaultDocumentDesign(db,a,null);const outcomes=await Promise.allSettled([create(),archiveDocumentDesign(db,a,second.id)]);expect(outcomes[0].status).toBe("rejected");expect(await getDocumentSnapshotForRender(db,a,snapshot.id)).toEqual(snapshot);
});
it("historical read does not source mutable draft, current design, or later/latest generation",async()=>{
 const d=await design();await setDefaultDocumentDesign(db,a,d.id);const approval=await approve(true),snapshot=await create();
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE reading_review_drafts SET content=$1 WHERE review_id=$2",[JSON.stringify({sections:[]}),approval.id]);await pg.query("UPDATE generations SET result=$1 WHERE id=$2",[JSON.stringify({sections:[]}),generationId]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");
 expect(await getDocumentSnapshotForRender(db,a,snapshot.id)).toEqual(snapshot);await expect(create()).rejects.toThrow("REVIEW_UNAVAILABLE");
});
it("read rejects forged foreign design provenance even when payload and columns agree",async()=>{
 const d=await design();await setDefaultDocumentDesign(db,a,d.id);await approve();const snapshot=await create();
 const foreign=await createDocumentDesign(db,b,{name:"Foreign",configuration:config()});const payload={...snapshot,design:{...snapshot.design,id:foreign.id,revision:foreign.revision}};
 await pg.exec("BEGIN; SET LOCAL session_replication_role=replica");await pg.query("UPDATE document_snapshots SET design_id=$1,design_revision=$2,payload=$3 WHERE id=$4",[foreign.id,foreign.revision,JSON.stringify(payload),snapshot.id]);await pg.exec("SET LOCAL session_replication_role=origin; COMMIT");
 await expect(getDocumentSnapshotForRender(db,a,snapshot.id)).rejects.toThrow("UNAVAILABLE");
});
