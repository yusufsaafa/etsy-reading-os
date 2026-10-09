/** Privileged offline platform composition only. Never expose this factory from seller
 * actions/routes. Unlike seller services, it has no Scope or authenticated seller command.
 * Access to a Database handle is a trusted server capability, not a client credential. */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { platformAssets, tarotDecks, tarotDeckVersions } from "../../db/schema";
import { assetSchema, deckSchema, deckVersionSchema, deckReferenceSchema, validateDeckVersion, validateAsset, MediaUnavailable } from "./contracts";
import { validateBundledDeck } from "./bundled-deck";
import { stableJson } from "../intake/contracts";
export function platformMediaRegistry(db:Database) {
 return Object.freeze({
  /** Offline explicit provisioning only. Atomic and replay-safe; immutable conflicts never repaired. */
  async importApprovedDeck(raw:unknown):Promise<void> {
   const value=validateBundledDeck(raw);
   await db.transaction(async tx=>{
    await tx.insert(tarotDecks).values(value.deck).onConflictDoNothing();
    const [deck]=await tx.select().from(tarotDecks).where(eq(tarotDecks.key,value.deck.key)).for("update");
    if(stableJson(deckSchema.parse(deck))!==stableJson(value.deck))throw new MediaUnavailable();
    for(const a of value.assets){
     await tx.insert(platformAssets).values({id:a.id,objectKey:a.objectKey,metadata:a}).onConflictDoNothing();
     const [row]=await tx.select().from(platformAssets).where(eq(platformAssets.id,a.id));
     if(!row||row.objectKey!==a.objectKey||stableJson(row.metadata)!==stableJson(a))throw new MediaUnavailable();
    }
    const [previous]=await tx.select().from(tarotDeckVersions).where(and(eq(tarotDeckVersions.deckKey,value.deck.key),eq(tarotDeckVersions.version,value.version.version)));
    if(previous){if(previous.status!=="PUBLISHED"||stableJson(previous.manifest)!==stableJson(value.version))throw new MediaUnavailable();return;}
    const manifest=validateDeckVersion(value.version,value.assets);
    await tx.insert(tarotDeckVersions).values({deckKey:value.deck.key,version:manifest.version,status:"PUBLISHED",manifest});
   });
  },
  async registerAsset(raw:unknown):Promise<void> {
   const value=assetSchema.parse(raw);
   await db.insert(platformAssets).values({id:value.id,objectKey:value.objectKey,metadata:value});
  },
  async registerDeck(raw:unknown):Promise<void> {await db.insert(tarotDecks).values(deckSchema.parse(raw));},
  async publishVersion(raw:unknown):Promise<void> {
   const value=deckVersionSchema.parse(raw);
   if(value.status!=="PUBLISHED")throw new MediaUnavailable();
   await db.transaction(async tx=>{
    const [deck]=await tx.select().from(tarotDecks).where(eq(tarotDecks.key,value.deckKey)).for("update");
    if(!deck)throw new MediaUnavailable();deckSchema.parse(deck);
    const ids=[...new Set(value.mappings.map(m=>m.assetId))];
    const rows=ids.length ? await tx.select().from(platformAssets).where(inArray(platformAssets.id,ids)).for("share") : [];
    const assets=rows.map(row=>{const a=validateAsset(row.metadata);if(a.id!==row.id || a.objectKey!==row.objectKey)throw new MediaUnavailable();return a;});
    const manifest=validateDeckVersion(value,assets);
    await tx.insert(tarotDeckVersions).values({deckKey:value.deckKey,version:value.version,status:"PUBLISHED",manifest});
   });
  },
  async retireVersion(raw:unknown):Promise<void> {
   const value=deckReferenceSchema.parse(raw);
   await db.transaction(async tx=>{
    const [row]=await tx.select().from(tarotDeckVersions).where(and(eq(tarotDeckVersions.deckKey,value.deckKey),eq(tarotDeckVersions.version,value.deckVersion))).for("update");
    if(!row)throw new MediaUnavailable();
    const manifest=deckVersionSchema.parse(row.manifest);
    if(row.status!==manifest.status || manifest.deckKey!==row.deckKey || manifest.version!==row.version || !z.enum(["PUBLISHED","RETIRED"]).safeParse(row.status).success)throw new MediaUnavailable();
    const ids=[...new Set(manifest.mappings.map(m=>m.assetId))];
    const rows=await tx.select().from(platformAssets).where(inArray(platformAssets.id,ids));
    validateDeckVersion(manifest,rows.map(r=>r.metadata),true);
    if(row.status==="RETIRED")return;
    await tx.update(tarotDeckVersions).set({status:"RETIRED",manifest:{...manifest,status:"RETIRED"}}).where(and(eq(tarotDeckVersions.deckKey,row.deckKey),eq(tarotDeckVersions.version,row.version)));
   });
  },
 });
}
