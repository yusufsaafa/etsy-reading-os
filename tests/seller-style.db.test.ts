import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { authorizeStore, createWorkspace } from "../src/modules/identity/service";
import { tenantWhere } from "../src/modules/intake/service";
import type { Scope } from "../src/modules/intake/contracts";
import { sellerStyleData, saveSellerProfile, editStyle, saveStyleDraft, applyStyle, addPreviousWork, previousWorkContent, removePreviousWork } from "../src/modules/seller-style/service";
import { sellerProductionContext } from "../src/modules/seller-style/context";
import { emptyStyle, type StyleConfiguration } from "../src/modules/seller-style/contracts";
import { resolveSellerDestination } from "../src/modules/onboarding/destination";
let pg:PGlite,db:Database,a:Scope,b:Scope;
const valid=():StyleConfiguration=>({tone:"WARM",detail:"DETAILED",approach:"CONVERSATIONAL",preferredExpressions:["Take your time"],avoidExpressions:["Guaranteed"],instructions:"Leave space for the recipient's perspective."});
const identity={displayName:"Sarah",shortBio:"Personalized writer"};
beforeEach(async()=>{
 pg=new PGlite();for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;
 for(const userId of ["style-a","style-b"])await db.insert(schema.users).values({id:userId,name:userId});
 a=await authorizeStore(db,"style-a",await createWorkspace(db,"style-a","Sarah's Store","fixtures"));b=await authorizeStore(db,"style-b",await createWorkspace(db,"style-b","Emily's Store","fixtures"));
},20000);
afterEach(async()=>{vi.restoreAllMocks();await pg.close();});
async function publish(configuration=valid()){await saveSellerProfile(db,a,identity);const draft=await editStyle(db,a);return applyStyle(db,a,draft.id,draft.revision,configuration);}
it("one seller per store is reused, saves/reloads, and differs from store identity",async()=>{
 const first=await saveSellerProfile(db,a,identity);const second=await saveSellerProfile(db,a,identity);expect(second.id).toBe(first.id);
 await saveSellerProfile(db,a,{displayName:"Çağla 山田",shortBio:""});const data=await sellerStyleData(db,a);expect(data.seller?.displayName).toBe("Çağla 山田");expect(data.seller?.shortBio).toBe("");
 expect((await db.select().from(schema.stores).where(eq(schema.stores.id,a.storeId)))[0].name).toBe("Sarah's Store");
 await expect(db.insert(schema.sellerProfiles).values({organizationId:a.organizationId,storeId:a.storeId,displayName:"Second seller"})).rejects.toThrow();
});
it("profile reads/writes reject forged scopes and composite foreign keys reject another tenant's store",async()=>{
 await saveSellerProfile(db,a,identity);expect((await sellerStyleData(db,b)).seller).toBeUndefined();
 await expect(sellerStyleData(db,{...a,userId:b.userId})).rejects.toThrow();await expect(saveSellerProfile(db,{...a,userId:b.userId},identity)).rejects.toThrow();
 await expect(db.insert(schema.sellerProfiles).values({organizationId:b.organizationId,storeId:a.storeId,displayName:"Forged"})).rejects.toThrow();
});
it("operators can read authorized configuration but cannot change identity, style or sources",async()=>{
 await db.insert(schema.users).values({id:"operator",name:"Operator"});await db.insert(schema.memberships).values({organizationId:a.organizationId,userId:"operator",role:"operator"});const operator={...a,userId:"operator"};
 await sellerStyleData(db,operator);await expect(saveSellerProfile(db,operator,identity)).rejects.toThrow();await expect(editStyle(db,operator)).rejects.toThrow();await expect(addPreviousWork(db,operator,{title:"Reference",text:"Private",commandKey:randomUUID()})).rejects.toThrow();
});
it("GET reads create no records; draft creation replay yields one style identity and one draft",async()=>{
 expect((await sellerStyleData(db,a)).profile).toBeUndefined();const draft=await editStyle(db,a);expect((await editStyle(db,a)).id).toBe(draft.id);
 const data=await sellerStyleData(db,a);expect(data.versions).toHaveLength(1);expect(data.active).toBeUndefined();expect(data.draft?.configuration).toEqual(emptyStyle);
 await expect(db.insert(schema.styleProfiles).values({organizationId:a.organizationId,storeId:a.storeId})).rejects.toThrow();
});
it("incomplete drafts persist and exact saves replay; stale different payloads are rejected",async()=>{
 const draft=await editStyle(db,a),configuration={...emptyStyle,instructions:"Still working on this"};const saved=await saveStyleDraft(db,a,draft.id,0,configuration);
 expect((await saveStyleDraft(db,a,draft.id,0,configuration)).revision).toBe(saved.revision);expect((await sellerStyleData(db,a)).draft?.configuration).toEqual(configuration);
 await expect(saveStyleDraft(db,a,draft.id,0,valid())).rejects.toThrow("STALE_STYLE_DRAFT");expect((await sellerStyleData(db,a)).draft?.revision).toBe(1);
});
it("activation requires identity and valid style but previous work, photo and bio are optional",async()=>{
 const draft=await editStyle(db,a);await expect(applyStyle(db,a,draft.id,0,valid())).rejects.toThrow("Save your profile name");await saveSellerProfile(db,a,{displayName:"Emily",shortBio:""});
 await expect(applyStyle(db,a,draft.id,0)).rejects.toThrow("Choose a tone");await expect(applyStyle(db,a,draft.id,0,{...valid(),tone:"CUSTOM",instructions:""})).rejects.toThrow("Describe your custom style");
 await applyStyle(db,a,draft.id,0,valid());const context=await sellerProductionContext(db,a);expect(context.ready).toBe(true);if(context.ready){expect(context.sources).toEqual([]);expect(context.seller.shortBio).toBe("");}
});
it("valid publish and replay yield one active version and one publication audit",async()=>{
 const active=await publish();expect((await applyStyle(db,a,active.id,0,valid())).id).toBe(active.id);const data=await sellerStyleData(db,a);expect(data.profile?.activeVersionId).toBe(active.id);expect(data.versions).toHaveLength(1);
 expect((await db.select().from(schema.auditLogs).where(tenantWhere(schema.auditLogs,a))).filter(e=>e.action==="style_applied")).toHaveLength(1);
 await expect(applyStyle(db,a,active.id,0,{...valid(),tone:"DIRECT"})).rejects.toThrow("STALE_STYLE_DRAFT");
});
it("active style cannot mutate or delete; editing safely clones one draft",async()=>{
 const v1=await publish();await expect(db.update(schema.styleVersions).set({configuration:{...valid(),tone:"DIRECT"}}).where(eq(schema.styleVersions.id,v1.id))).rejects.toThrow();
 await expect(db.delete(schema.styleVersions).where(eq(schema.styleVersions.id,v1.id))).rejects.toThrow();await expect(saveStyleDraft(db,a,v1.id,1,valid())).rejects.toThrow();
 const draft=await editStyle(db,a);expect((await editStyle(db,a)).id).toBe(draft.id);await saveStyleDraft(db,a,draft.id,0,{...valid(),tone:"DIRECT"});expect((await sellerProductionContext(db,a)).ready).toBe(true);expect((await sellerStyleData(db,a)).active?.configuration.tone).toBe("WARM");
});
it("applying a new style archives history while exact historical versions remain server-readable",async()=>{
 const v1=await publish(),draft=await editStyle(db,a);await applyStyle(db,a,draft.id,0,{...valid(),tone:"DIRECT"});const data=await sellerStyleData(db,a);expect(data.versions.map(v=>v.status)).toEqual(["ACTIVE","ARCHIVED"]);
 const current=await sellerProductionContext(db,a),old=await sellerProductionContext(db,a,v1.id);expect(current.ready&&current.style.id).toBe(draft.id);expect(old.ready&&old.style.configuration.tone).toBe("WARM");
 await expect(db.update(schema.styleVersions).set({configuration:{...valid(),instructions:"Changed historical guidance"}}).where(eq(schema.styleVersions.id,v1.id))).rejects.toThrow();
});
it("invalid activation rolls back and preserves the active pointer, draft and audit history",async()=>{
 const active=await publish(),draft=await editStyle(db,a);await expect(applyStyle(db,a,draft.id,0,{...valid(),detail:null})).rejects.toThrow("Choose a level of detail");
 const data=await sellerStyleData(db,a);expect(data.active?.id).toBe(active.id);expect(data.draft?.revision).toBe(0);expect(data.draft?.configuration).toEqual(valid());
 expect((await db.select().from(schema.auditLogs).where(tenantWhere(schema.auditLogs,a))).filter(e=>e.action==="style_applied")).toHaveLength(1);
});
it("database publication guards enforce one active style, owned references and pointer consistency",async()=>{
 const active=await publish(),draft=await editStyle(db,a);await expect(db.update(schema.styleVersions).set({status:"ACTIVE",activatedAt:new Date()}).where(eq(schema.styleVersions.id,draft.id))).rejects.toThrow();
 await expect(db.update(schema.styleProfiles).set({activeVersionId:null}).where(eq(schema.styleProfiles.storeId,a.storeId))).rejects.toThrow();
 const other=await editStyle(db,b);await expect(db.update(schema.styleProfiles).set({activeVersionId:active.id}).where(eq(schema.styleProfiles.storeId,b.storeId))).rejects.toThrow();
 await expect(db.insert(schema.styleVersions).values({organizationId:b.organizationId,storeId:b.storeId,styleProfileId:draft.styleProfileId,versionNumber:3,configuration:valid()})).rejects.toThrow();
 await expect(db.insert(schema.styleVersions).values({organizationId:b.organizationId,storeId:b.storeId,styleProfileId:other.styleProfileId,versionNumber:2,status:"ACTIVE",activatedAt:new Date(),configuration:valid()})).rejects.toThrow();
 expect((await sellerStyleData(db,a)).active?.id).toBe(active.id);
});
it("cross-tenant style versions are inaccessible, including future production history reads",async()=>{
 const active=await publish();await expect(sellerProductionContext(db,b,active.id)).rejects.toThrow();await expect(applyStyle(db,b,active.id,0)).rejects.toThrow();await expect(saveStyleDraft(db,b,active.id,0,valid())).rejects.toThrow();
});
it("pasted Unicode previous work persists, escaped data remains original, replay is idempotent",async()=>{
 const payload={title:"Keepsake example",text:"Çağla 山田 مرحباً <script>untrusted()</script>",commandKey:randomUUID()};const id=await addPreviousWork(db,a,payload);expect(await addPreviousWork(db,a,payload)).toBe(id);
 const data=await sellerStyleData(db,a);expect(data.sources).toHaveLength(1);expect(data.sources[0]).not.toHaveProperty("text");expect((await previousWorkContent(db,a,id)).text).toBe(payload.text);
 await expect(addPreviousWork(db,a,{...payload,text:"different"})).rejects.toThrow("SOURCE_COMMAND_CONFLICT");await expect(db.update(schema.styleSources).set({text:"mutate"}).where(eq(schema.styleSources.id,id))).rejects.toThrow();
});
it("source reads and deletion cannot cross tenants; authorized deletion replay is safe",async()=>{
 const id=await addPreviousWork(db,a,{title:"Reference",text:"Private work",commandKey:randomUUID()});await expect(previousWorkContent(db,b,id)).rejects.toThrow();await expect(previousWorkContent(db,{...a,userId:b.userId},id)).rejects.toThrow();
 await removePreviousWork(db,b,id);expect((await sellerStyleData(db,a)).sources).toHaveLength(1);await removePreviousWork(db,a,id);await removePreviousWork(db,a,id);expect((await sellerStyleData(db,a)).sources).toHaveLength(0);await expect(previousWorkContent(db,a,id)).rejects.toThrow();
 expect((await db.select().from(schema.auditLogs).where(tenantWhere(schema.auditLogs,a))).filter(e=>e.action==="style_source_deleted")).toHaveLength(1);
});
it("sources are bounded text only; arbitrary file payloads and oversized pasted content fail",async()=>{
 await expect(addPreviousWork(db,a,{title:"File",text:"",commandKey:randomUUID(),filename:"evil.exe"})).rejects.toThrow();await expect(addPreviousWork(db,a,{title:"Large",text:"x".repeat(50001),commandKey:randomUUID()})).rejects.toThrow();
 expect((await sellerStyleData(db,a)).sources).toHaveLength(0);
});
it("audits contain mutation metadata only, never names, style instructions or previous-work text",async()=>{
 await publish();const secret="Private previous work never goes into audits";const id=await addPreviousWork(db,a,{title:"Sensitive title",text:secret,commandKey:randomUUID()});await removePreviousWork(db,a,id);
 const audits=await db.select().from(schema.auditLogs).where(tenantWhere(schema.auditLogs,a)),json=JSON.stringify(audits);expect(json).not.toContain(secret);expect(json).not.toContain("Sensitive title");expect(json).not.toContain(identity.shortBio);expect(json).not.toContain(valid().instructions);
 expect(audits.map(e=>e.action)).toEqual(expect.arrayContaining(["seller_profile_created","style_draft_created","style_applied","style_source_created","style_source_deleted"]));
});
it("style completeness is independent of existing onboarding; no outbound/model calls occur",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch");expect((await sellerProductionContext(db,a)).ready).toBe(false);expect((await resolveSellerDestination(db,a.userId)).kind).toBe("OPERATIONS_HOME");
 await publish();expect((await sellerProductionContext(db,a)).ready).toBe(true);expect((await resolveSellerDestination(db,a.userId)).kind).toBe("OPERATIONS_HOME");expect(fetch).not.toHaveBeenCalled();
});
it("a late audit write failure rolls back archival, activation and pointer changes together",async()=>{
 const active=await publish(),draft=await editStyle(db,a);
 await pg.exec("CREATE FUNCTION fail_style_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='style_applied' THEN RAISE EXCEPTION 'TEST_STYLE_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_style_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_style_audit();");
 await expect(applyStyle(db,a,draft.id,0,{...valid(),tone:"DIRECT"})).rejects.toThrow();
 const data=await sellerStyleData(db,a);expect(data.profile?.activeVersionId).toBe(active.id);expect(data.active?.status).toBe("ACTIVE");expect(data.draft?.status).toBe("DRAFT");expect(data.draft?.configuration.tone).toBe("WARM");
});
