import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client";
import { sellerProfiles, styleProfiles, styleVersions, styleSources, stores, auditLogs } from "../../db/schema";
import { tenantWhere, verifyScope } from "../intake/service";
import { stableJson, type Scope } from "../intake/contracts";
import { AccessDenied } from "../identity/service";
import { sellerIdentity, styleConfiguration, emptyStyle, publishErrors, previousWork } from "./contracts";
async function lock(tx:DbExecutor,scope:Scope) {
  await verifyScope(tx,scope,true);
  await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
}
async function audit(tx:DbExecutor,scope:Scope,action:string,resourceId:string) {
  await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action,resourceId});
}
export async function sellerStyleData(db:DbExecutor,scope:Scope) {
  await verifyScope(db,scope);
  const [seller]=await db.select().from(sellerProfiles).where(tenantWhere(sellerProfiles,scope));
  const [profile]=await db.select().from(styleProfiles).where(tenantWhere(styleProfiles,scope));
  const versions=profile ? await db.select().from(styleVersions).where(and(tenantWhere(styleVersions,scope),eq(styleVersions.styleProfileId,profile.id))).orderBy(desc(styleVersions.versionNumber)):[];
  const sources=await db.select({id:styleSources.id,title:styleSources.title,sourceType:styleSources.sourceType,contentHash:styleSources.contentHash,createdAt:styleSources.createdAt}).from(styleSources).where(tenantWhere(styleSources,scope)).orderBy(desc(styleSources.createdAt),desc(styleSources.id));
  return {seller,profile,versions,active:versions.find(v=>v.id===profile?.activeVersionId),draft:versions.find(v=>v.status==="DRAFT"),sources};
}
export async function saveSellerProfile(db:Database,scope:Scope,raw:unknown) {
  const payload=sellerIdentity.parse(raw);
  return db.transaction(async tx=>{
    await lock(tx,scope);
    const [old]=await tx.select().from(sellerProfiles).where(tenantWhere(sellerProfiles,scope));
    if(old && old.displayName===payload.displayName && old.shortBio===payload.shortBio) return old;
    const [saved]=await tx.insert(sellerProfiles).values({organizationId:scope.organizationId,storeId:scope.storeId,...payload}).onConflictDoUpdate({target:[sellerProfiles.organizationId,sellerProfiles.storeId],set:{...payload,updatedAt:new Date()}}).returning();
    await audit(tx,scope,old ? "seller_profile_updated":"seller_profile_created",saved.id);return saved;
  });
}
// Mutation only: opening a page never creates database records.
export async function editStyle(db:Database,scope:Scope) {
  return db.transaction(async tx=>{
    await lock(tx,scope);let data=await sellerStyleData(tx,scope);
    if(data.draft) return data.draft;
    if(!data.profile){await tx.insert(styleProfiles).values({organizationId:scope.organizationId,storeId:scope.storeId});data=await sellerStyleData(tx,scope);}
    const [draft]=await tx.insert(styleVersions).values({organizationId:scope.organizationId,storeId:scope.storeId,styleProfileId:data.profile!.id,versionNumber:(data.versions[0]?.versionNumber??0)+1,configuration:data.active?.configuration??emptyStyle}).returning();
    await audit(tx,scope,"style_draft_created",draft.id);return draft;
  });
}
export async function saveStyleDraft(db:Database,scope:Scope,versionId:string,expectedRevision:number,raw:unknown) {
  const configuration=styleConfiguration.parse(raw);z.string().uuid().parse(versionId);z.number().int().nonnegative().parse(expectedRevision);
  return db.transaction(async tx=>{
    await lock(tx,scope);const data=await sellerStyleData(tx,scope),draft=data.draft;
    if(!draft || draft.id!==versionId) throw new AccessDenied();
    if(stableJson(draft.configuration)===stableJson(configuration))return draft;
    if(draft.revision!==expectedRevision)throw new Error("STALE_STYLE_DRAFT");
    const [saved]=await tx.update(styleVersions).set({configuration,revision:draft.revision+1}).where(and(tenantWhere(styleVersions,scope),eq(styleVersions.id,versionId))).returning();
    await audit(tx,scope,"style_draft_saved",draft.id);return saved;
  });
}
export async function applyStyle(db:Database,scope:Scope,versionId:string,expectedRevision:number,raw?:unknown) {
  const supplied=raw===undefined ? undefined:styleConfiguration.parse(raw);z.string().uuid().parse(versionId);z.number().int().nonnegative().parse(expectedRevision);
  return db.transaction(async tx=>{
    await lock(tx,scope);const data=await sellerStyleData(tx,scope),version=data.versions.find(v=>v.id===versionId);
    if(!version)throw new AccessDenied();
    if(version.status==="ACTIVE"&&data.profile?.activeVersionId===versionId){if(supplied&&stableJson(supplied)!==stableJson(version.configuration))throw new Error("STALE_STYLE_DRAFT");return version;}
    if(version.status!=="DRAFT"||version.revision!==expectedRevision)throw new Error("STALE_STYLE_DRAFT");
    if(!data.seller?.displayName.trim())throw new Error("Save your profile name before applying a style.");
    const configuration=supplied??version.configuration,errors=publishErrors(configuration);
    if(errors.length)throw new Error(errors.join(" "));
    if(data.active)await tx.update(styleVersions).set({status:"ARCHIVED"}).where(and(tenantWhere(styleVersions,scope),eq(styleVersions.id,data.active.id)));
    const [active]=await tx.update(styleVersions).set({status:"ACTIVE",activatedAt:new Date(),configuration,revision:version.revision+(supplied?1:0)}).where(and(tenantWhere(styleVersions,scope),eq(styleVersions.id,versionId))).returning();
    await tx.update(styleProfiles).set({activeVersionId:versionId}).where(and(tenantWhere(styleProfiles,scope),eq(styleProfiles.id,version.styleProfileId)));
    await audit(tx,scope,"style_applied",versionId);return active;
  });
}
export async function addPreviousWork(db:Database,scope:Scope,raw:unknown) {
  const payload=previousWork.parse(raw),contentHash=createHash("sha256").update(payload.text).digest("hex");
  return db.transaction(async tx=>{
    await lock(tx,scope);
    const [old]=await tx.select().from(styleSources).where(and(tenantWhere(styleSources,scope),eq(styleSources.commandKey,payload.commandKey)));
    if(old){if(old.title!==payload.title||old.contentHash!==contentHash)throw new Error("SOURCE_COMMAND_CONFLICT");return old.id;}
    const [saved]=await tx.insert(styleSources).values({organizationId:scope.organizationId,storeId:scope.storeId,...payload,contentHash}).returning();
    await audit(tx,scope,"style_source_created",saved.id);return saved.id;
  });
}
export async function previousWorkContent(db:DbExecutor,scope:Scope,sourceId:string) {
  await verifyScope(db,scope);z.string().uuid().parse(sourceId);
  const [source]=await db.select().from(styleSources).where(and(tenantWhere(styleSources,scope),eq(styleSources.id,sourceId)));
  if(!source)throw new AccessDenied();return source;
}
export async function removePreviousWork(db:Database,scope:Scope,sourceId:string) {
  z.string().uuid().parse(sourceId);
  return db.transaction(async tx=>{
    await lock(tx,scope);
    // A repeat removal is a scoped no-op; it never reads another store's source.
    const [source]=await tx.delete(styleSources).where(and(tenantWhere(styleSources,scope),eq(styleSources.id,sourceId))).returning({id:styleSources.id});
    if(source)await audit(tx,scope,"style_source_deleted",source.id);
  });
}
