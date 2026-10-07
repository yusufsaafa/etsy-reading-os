import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client";
import { platformAssets, tarotDecks, tarotDeckVersions, storeTarotPreferences, stores } from "../../db/schema";
import type { PlatformAssetStorage } from "../../infrastructure/object-storage";
import { verifyScope, tenantWhere } from "../intake/service";
import type { Scope } from "../intake/contracts";
import { cardKeySchema } from "./catalog";
import { deckSchema, deckReferenceSchema, preferenceCommandSchema, deckVersionSchema, validateAsset, validateDeckVersion, usableAsset, detached, MediaUnavailable, resolvedCardSchema, type ResolvedTarotCardAsset, type StoreDeckPreference } from "./contracts";

async function asset(db:DbExecutor,id:string) {
 const [row]=await db.select().from(platformAssets).where(eq(platformAssets.id,id));
 if(!row)throw new MediaUnavailable();
 const value=validateAsset(row.metadata);
 if(value.id!==row.id || value.objectKey!==row.objectKey)throw new MediaUnavailable();
 return value;
}
async function version(db:DbExecutor,key:string,number:number,historical:boolean,lock=false) {
 const query=db.select().from(tarotDeckVersions).where(and(eq(tarotDeckVersions.deckKey,key),eq(tarotDeckVersions.version,number)));
 const [row]=await (lock ? query.for("share") : query);
 if(!row)throw new MediaUnavailable();
 const parsed=deckVersionSchema.safeParse(row.manifest);
 if(!parsed.success || parsed.data.deckKey!==row.deckKey || parsed.data.version!==row.version || parsed.data.status!==row.status)throw new MediaUnavailable();
 const [deck]=await db.select().from(tarotDecks).where(eq(tarotDecks.key,key));
 if(!deck || !deckSchema.safeParse(deck).success)throw new MediaUnavailable();
 const ids=[...new Set(parsed.data.mappings.map(m=>m.assetId))];
 const rows=ids.length ? await db.select().from(platformAssets).where(inArray(platformAssets.id,ids)) : [];
 const assets=rows.map(row=>{const value=validateAsset(row.metadata);if(value.id!==row.id || value.objectKey!==row.objectKey)throw new MediaUnavailable();return value;});
 return {manifest:validateDeckVersion(row.manifest,assets,historical),assets,deck:deckSchema.parse(deck)};
}
/** Exact historical read: retirement does not float to a newer version. */
export async function resolveTarotCardAsset(db:Database,raw:unknown):Promise<ResolvedTarotCardAsset> {
 return db.transaction(tx=>resolveTarotCardAssetInTransaction(tx,raw),{isolationLevel:"repeatable read"});
}
export async function resolveTarotCardAssetInTransaction(tx:DbExecutor,raw:unknown):Promise<ResolvedTarotCardAsset> {
 const input=deckReferenceSchema.extend({cardKey:cardKeySchema}).parse(raw);
 const value=await version(tx,input.deckKey,input.deckVersion,true);
 const mapping=value.manifest.mappings.find(m=>m.cardKey===input.cardKey)!;
 const selected=value.assets.find(a=>a.id===mapping.assetId)!;
 return detached(resolvedCardSchema.parse({contractVersion:"tarot-card-asset/v1",...input,asset:{id:selected.id,contentHash:selected.contentHash,mediaType:selected.mediaType,byteSize:selected.byteSize,width:selected.width,height:selected.height}}));
}
/** Caller holds Store lock; version share lock protects new document selection through commit. */
export async function getStorePreferredTarotDeckInTransaction(tx:DbExecutor,scope:Scope):Promise<StoreDeckPreference> {
 await verifyScope(tx,scope);
 const selected=await preference(tx,scope);
 if(selected.status==="CONFIGURED")await version(tx,selected.deckKey,selected.deckVersion,false,true);
 return selected;
}
/** Seller-safe metadata only; a corrupt claimed-selectable deck fails the whole read. */
export async function listSelectableTarotDecks(db:Database,scope:Scope) {
 return db.transaction(async tx=>{
  await verifyScope(tx,scope);
  const rows=await tx.select().from(tarotDeckVersions).where(eq(tarotDeckVersions.status,"PUBLISHED")).orderBy(asc(tarotDeckVersions.deckKey));
  const result=[];
  for(const row of rows) {const {deck}=await version(tx,row.deckKey,row.version,false);result.push({deckKey:deck.key,displayName:deck.name,deckVersion:row.version,description:deck.description});}
  return detached(result);
 },{isolationLevel:"repeatable read"});
}
async function preference(tx:DbExecutor,scope:Scope):Promise<StoreDeckPreference> {
 const [row]=await tx.select().from(storeTarotPreferences).where(tenantWhere(storeTarotPreferences,scope));
 if(!row)return detached({status:"NOT_CONFIGURED",revision:0} as const);
 if(!z.number().int().positive().max(2147483647).safeParse(row.revision).success || !deckReferenceSchema.safeParse({deckKey:row.deckKey,deckVersion:row.deckVersion}).success)throw new MediaUnavailable();
 // Retired preferences require explicit reselection, never silent fallback or read repair.
 await version(tx,row.deckKey,row.deckVersion,false);
 return detached({status:"CONFIGURED",revision:row.revision,deckKey:row.deckKey,deckVersion:row.deckVersion} as const);
}
export async function getStorePreferredTarotDeck(db:Database,scope:Scope):Promise<StoreDeckPreference> {
 return db.transaction(async tx=>{await verifyScope(tx,scope);return preference(tx,scope);},{isolationLevel:"repeatable read"});
}
export async function setStorePreferredTarotDeck(db:Database,scope:Scope,raw:unknown):Promise<StoreDeckPreference> {
 const input=preferenceCommandSchema.parse(raw);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
  const [old]=await tx.select().from(storeTarotPreferences).where(tenantWhere(storeTarotPreferences,scope));
  // Validate structural state even when replacing a retired preference; no corruption repair.
  if(old) {
   if(!z.number().int().positive().safeParse(old.revision).success)throw new MediaUnavailable();
   await version(tx,old.deckKey,old.deckVersion,true);
  }
  if((old?.revision ?? 0)!==input.expectedRevision)throw new Error("TAROT_PREFERENCE_CONFLICT");
  await version(tx,input.deckKey,input.deckVersion,false,true);
  if(old?.deckKey===input.deckKey && old.deckVersion===input.deckVersion)return preference(tx,scope);
  const values={organizationId:scope.organizationId,storeId:scope.storeId,deckKey:input.deckKey,deckVersion:input.deckVersion,revision:input.expectedRevision+1};
  if(old)await tx.update(storeTarotPreferences).set(values).where(tenantWhere(storeTarotPreferences,scope));
  else await tx.insert(storeTarotPreferences).values(values);
  return preference(tx,scope);
 });
}
/** Trusted server-only byte boundary. Identity is resolved again; caller metadata/keys are never trusted.
 * Storage adapter is injected by trusted composition, never by seller commands. */
export async function readPlatformAssetBytes(db:Database,storage:PlatformAssetStorage,raw:unknown):Promise<Uint8Array> {
 const {assetId}=z.strictObject({assetId:z.uuid()}).parse(raw);
 const value=await asset(db,assetId);usableAsset(value);
 try{return await readExactAssetBytes(storage,value);}catch{throw new MediaUnavailable();}
}
async function readExactAssetBytes(storage:PlatformAssetStorage,value:Awaited<ReturnType<typeof asset>>) {
 let bytes:Uint8Array;
 try{bytes=await storage.read(Object.freeze({objectKey:value.objectKey,maxBytes:value.byteSize}));}
 catch(cause){throw new Error("ASSET_STORAGE_READ_FAILED",{cause});}
 if(!(bytes instanceof Uint8Array)||bytes.byteLength!==value.byteSize)throw new Error("ASSET_LENGTH_MISMATCH");
 const detachedBytes=Uint8Array.from(bytes);
 if(createHash("sha256").update(detachedBytes).digest("hex")!==value.contentHash)throw new Error("ASSET_DIGEST_MISMATCH");
 return detachedBytes;
}
/** Renderer preparation validates frozen evidence against exact server-owned immutable metadata.
 * Never consults Store preference or the latest deck. No storage key crosses this boundary. */
export async function readFrozenPlatformAssetBytes(db:Database,storage:PlatformAssetStorage,raw:unknown):Promise<Uint8Array> {
 const expected=resolvedCardSchema.shape.asset.parse(raw);
 const value=await asset(db,expected.id);usableAsset(value);
 const exact=resolvedCardSchema.shape.asset.parse({id:value.id,contentHash:value.contentHash,mediaType:value.mediaType,byteSize:value.byteSize,width:value.width,height:value.height});
 if(Object.keys(exact).some(k=>exact[k as keyof typeof exact]!==expected[k as keyof typeof expected]))throw new Error("FROZEN_ASSET_METADATA_MISMATCH");
 return readExactAssetBytes(storage,value);
}
// No seller mutation API for assets, decks, versions, mappings or rights. Platform registry
// provisioning is an offline privileged operator responsibility; SQL guards apply there too.
