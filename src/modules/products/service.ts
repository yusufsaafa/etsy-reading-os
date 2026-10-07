import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client";
import { products, productVersions, mappings, listings, listingSelections, lineItems, stores, auditLogs, units, generations } from "../../db/schema";
import { tenantWhere, verifyScope } from "../intake/service";
import { AccessDenied } from "../identity/service";
import { stableJson, type Scope } from "../intake/contracts";
import { activationErrors, emptyConfiguration, orderedConfiguration } from "./contracts";
import { etsyProductPolicySchema, selectionKey, type EtsyProductPolicy } from "../etsy/source-contract";
async function lockedStore(tx: DbExecutor, scope: Scope) {
  await verifyScope(tx,scope,true);
  return (await tx.select().from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update"))[0];
}
export async function productData(db: DbExecutor, scope: Scope, productId: string) {
  await verifyScope(db,scope);
  const [product] = await db.select().from(products).where(and(tenantWhere(products,scope),eq(products.id,productId)));
  if (!product) throw new AccessDenied();
  const versions = await db.select().from(productVersions).where(and(tenantWhere(productVersions,scope),eq(productVersions.productId,productId))).orderBy(desc(productVersions.versionNumber));
  const bindings = await db.select().from(mappings).where(and(tenantWhere(mappings,scope),eq(mappings.productId,productId)));
  return { product, versions, bindings, draft: versions.find(v=>v.status==="DRAFT"), active: versions.find(v=>v.id===product.activeVersionId) };
}
export async function catalogData(db: DbExecutor, scope: Scope) {
  await verifyScope(db,scope);
  const [listingRows,mappingRows,productRows,versionRows,selectionRows,lines] = await Promise.all([
    db.select().from(listings).where(tenantWhere(listings,scope)).orderBy(asc(listings.title)),
    db.select().from(mappings).where(tenantWhere(mappings,scope)), db.select().from(products).where(tenantWhere(products,scope)),
    db.select().from(productVersions).where(tenantWhere(productVersions,scope)), db.select().from(listingSelections).where(tenantWhere(listingSelections,scope)),
    db.select().from(lineItems).where(tenantWhere(lineItems,scope)),
  ]);
  return { listings:listingRows, mappings:mappingRows, products:productRows, versions:versionRows, selections:selectionRows, lines };
}
export async function beginListingDraft(db: Database, scope: Scope, listingId: string, variantKey = "default") {
  return beginProductDraft(db,scope,listingId,variantKey);
}
/** Backend owner command; no route/catalog inference or label-based suggestions. */
export async function beginEtsyProductDraft(db: Database, scope: Scope, rawPolicy: unknown) {
  const policy=etsyProductPolicySchema.parse(rawPolicy);
  return beginProductDraft(db,scope,policy.listingId,selectionKey(policy.purchaseSelections),policy);
}
async function beginProductDraft(db: Database, scope: Scope, listingId: string, variantKey: string, policy?: EtsyProductPolicy) {
  z.string().regex(/^[1-9]\d{0,19}$/).parse(listingId); z.string().min(1).max(2000).parse(variantKey);
  return db.transaction(async tx=>{
    const store = await lockedStore(tx,scope);
    const [listing] = await tx.select().from(listings).where(and(tenantWhere(listings,scope),eq(listings.externalId,listingId)));
    if (!listing || listing.state!=="active") throw new Error("PRODUCT_UNAVAILABLE");
    const [selected] = await tx.select().from(listingSelections).where(and(tenantWhere(listingSelections,scope),eq(listingSelections.listingExternalId,listingId)));
    if (!selected && store.onboardingStage!=="complete") throw new Error("SELECT_PRODUCT_FIRST");
    if (variantKey!=="default" && !policy) {
      const [observed] = await tx.select({id:lineItems.id}).from(lineItems).where(and(tenantWhere(lineItems,scope),eq(lineItems.listingExternalId,listingId),eq(lineItems.variantKey,variantKey))).limit(1);
      if (!observed) throw new Error("VARIANT_UNAVAILABLE");
    }
    if (!selected) await tx.insert(listingSelections).values({organizationId:scope.organizationId,storeId:scope.storeId,listingExternalId:listingId,selectedBy:scope.userId}).onConflictDoNothing();
    const [mapping] = await tx.select().from(mappings).where(and(tenantWhere(mappings,scope),eq(mappings.listingExternalId,listingId),eq(mappings.variantKey,variantKey)));
    let productId = mapping?.productId;
    if (!productId) {
      const [product] = await tx.insert(products).values({organizationId:scope.organizationId,storeId:scope.storeId,name:listing.title.slice(0,100)}).returning();
      productId=product.id;
      await tx.insert(mappings).values({organizationId:scope.organizationId,storeId:scope.storeId,listingExternalId:listingId,variantKey,label:listing.title,required:[],paused:false,productId}).onConflictDoUpdate({target:[mappings.organizationId,mappings.storeId,mappings.listingExternalId,mappings.variantKey],set:{productId}});
      await tx.insert(productVersions).values({organizationId:scope.organizationId,storeId:scope.storeId,productId,versionNumber:1,configuration:policy?{...emptyConfiguration,etsyFulfillment:policy}:emptyConfiguration});
      await audit(tx,scope,"product_draft_created",productId);
    }
    return productId;
  });
}
async function audit(tx: DbExecutor,scope: Scope,action:string,resourceId:string) {
  await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action,resourceId});
}
export async function editProduct(db: Database,scope: Scope,productId:string) {
  return db.transaction(async tx=>{
    await lockedStore(tx,scope); const data=await productData(tx,scope,productId);
    if(data.draft) return data.draft.id;
    const [draft]=await tx.insert(productVersions).values({organizationId:scope.organizationId,storeId:scope.storeId,productId,versionNumber:(data.versions[0]?.versionNumber??0)+1,configuration:data.active?.configuration??emptyConfiguration}).returning();
    await audit(tx,scope,"product_draft_created",draft.id); return draft.id;
  });
}
export type DraftPayload = { name:string; configuration:unknown };
function draftPayload(raw:DraftPayload) { return {name:z.string().trim().max(100).parse(raw.name),configuration:orderedConfiguration(raw.configuration)}; }
export async function saveProductDraft(db: Database,scope: Scope,productId:string,versionId:string,expectedRevision:number,raw:DraftPayload) {
  const payload=draftPayload(raw);
  return db.transaction(async tx=>{
    await lockedStore(tx,scope); const data=await productData(tx,scope,productId), version=data.versions.find(v=>v.id===versionId);
    if(!version || version.status!=="DRAFT") throw new Error("DRAFT_UNAVAILABLE");
    // Retry of the same save is a no-op even if its first response was lost.
    if(stableJson(version.configuration)===stableJson(payload.configuration) && data.product.name===payload.name) return version;
    if(version.revision!==expectedRevision) throw new Error("STALE_PRODUCT_DRAFT");
    await tx.update(products).set({name:payload.name,updatedAt:new Date()}).where(and(tenantWhere(products,scope),eq(products.id,productId)));
    const [saved]=await tx.update(productVersions).set({configuration:payload.configuration,revision:version.revision+1}).where(and(tenantWhere(productVersions,scope),eq(productVersions.id,versionId))).returning();
    await audit(tx,scope,"product_draft_saved",versionId); return saved;
  });
}
export async function activateProduct(db: Database,scope: Scope,productId:string,versionId:string,expectedRevision:number,raw?:DraftPayload) {
  const payload=raw ? draftPayload(raw) : undefined;
  return db.transaction(async tx=>{
    await lockedStore(tx,scope); const data=await productData(tx,scope,productId), version=data.versions.find(v=>v.id===versionId);
    if(!version) throw new AccessDenied();
    if(version.status==="ACTIVE" && data.product.activeVersionId===versionId) {
      if(payload && (stableJson(payload.configuration)!==stableJson(version.configuration) || payload.name!==data.product.name)) throw new Error("STALE_PRODUCT_DRAFT");
      return versionId;
    }
    if(version.status!=="DRAFT" || version.revision!==expectedRevision) throw new Error("STALE_PRODUCT_DRAFT");
    const configuration=payload?.configuration??version.configuration, name=payload?.name??data.product.name;
    const errors=activationErrors(name,configuration); if(errors.length) throw new Error(errors.join(" "));
    if(!data.bindings.length) throw new Error("A valid Etsy product connection is required.");
    if(configuration.etsyFulfillment && !data.bindings.some(b=>b.listingExternalId===configuration.etsyFulfillment!.listingId && b.variantKey===selectionKey(configuration.etsyFulfillment!.purchaseSelections)))
      throw new Error("ETSY_SOURCE_BINDING_MISMATCH");
    // A canonical source binding cannot silently become a different combination on edit.
    if(data.bindings.some(b=>b.variantKey.startsWith("etsy-selection/1:")) && (!configuration.etsyFulfillment || data.bindings.some(b=>b.listingExternalId!==configuration.etsyFulfillment!.listingId||b.variantKey!==selectionKey(configuration.etsyFulfillment!.purchaseSelections))))
      throw new Error("ETSY_SOURCE_BINDING_MISMATCH");
    for(const binding of data.bindings){
      const [listing]=await tx.select({state:listings.state}).from(listings).where(and(tenantWhere(listings,scope),eq(listings.externalId,binding.listingExternalId)));
      if(listing?.state!=="active") throw new Error("The Etsy listing is no longer active.");
    }
    if(data.active) await tx.update(productVersions).set({status:"ARCHIVED"}).where(and(tenantWhere(productVersions,scope),eq(productVersions.id,data.active.id)));
    await tx.update(productVersions).set({status:"ACTIVE",activatedAt:new Date(),configuration,revision:version.revision+(payload?1:0)}).where(and(tenantWhere(productVersions,scope),eq(productVersions.id,versionId)));
    await tx.update(products).set({name,status:"active",activeVersionId:versionId,updatedAt:new Date()}).where(and(tenantWhere(products,scope),eq(products.id,productId)));
    await audit(tx,scope,"product_version_activated",versionId);
    return versionId;
  });
}

/** Product identity for an exact owned Reading provenance; never reads generated body content. */
export async function productIdentityForReading(db: DbExecutor, scope: Scope, readingId: string, generationId: string) {
  await verifyScope(db,scope);
  z.uuid().parse(readingId); z.uuid().parse(generationId);
  const [row] = await db.select({productId:productVersions.productId}).from(units)
    .innerJoin(generations,and(tenantWhere(generations,scope),eq(generations.unitId,units.id),eq(generations.id,generationId),eq(generations.productVersionId,units.productVersionId)))
    .innerJoin(productVersions,and(tenantWhere(productVersions,scope),eq(productVersions.id,generations.productVersionId)))
    .innerJoin(products,and(tenantWhere(products,scope),eq(products.id,productVersions.productId)))
    .where(and(tenantWhere(units,scope),eq(units.id,readingId)));
  if (!row) throw new AccessDenied();
  return row.productId;
}
