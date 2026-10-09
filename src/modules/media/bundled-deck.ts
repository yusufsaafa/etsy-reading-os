/** Trusted, checked-in provisioning package; not a second registry or customer upload API. */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {z} from "zod";
import {assetSchema,deckSchema,deckVersionSchema,validateDeckVersion,detached,hashSchema} from "./contracts";
import {cardKeySchema,getCanonicalCard,RANKS} from "./catalog";
import {verifyImageBytes} from "../documents/resources/images";
import type {PlatformAssetStorage} from "../../infrastructure/object-storage";
export const bundledDeckSchema=z.strictObject({deck:deckSchema,version:deckVersionSchema,assets:z.array(assetSchema).length(78),source:z.strictObject({zipName:z.literal("cards.zip"),zipSha256:hashSchema,totalEntries:z.literal(81),ignoredEntries:z.literal(3),images:z.literal(78),mappingReview:z.string().max(200),files:z.array(z.strictObject({cardKey:cardKeySchema,file:z.string().regex(/^\d\d-[a-z-]+\.jpeg$/),assetId:z.uuid()})).length(78)})});
export function validateBundledDeck(raw:unknown){
 const value=bundledDeckSchema.parse(raw);
 if(value.deck.key!==value.version.deckKey || new Set(value.assets.map(a=>a.id)).size!==78 || new Set(value.assets.map(a=>a.objectKey)).size!==78 || new Set(value.assets.map(a=>a.contentHash)).size!==78 || new Set(value.source.files.map(f=>f.cardKey)).size!==78 || new Set(value.source.files.map(f=>f.file)).size!==78)throw Error("DECK_PACKAGE_INVALID");
 const manifest=validateDeckVersion(value.version,value.assets);
 if(new Set(manifest.mappings.map(m=>m.assetId)).size!==78)throw Error("DECK_PACKAGE_INVALID");
 for(const f of value.source.files){
  const card=getCanonicalCard(f.cardKey),index=card.arcana==="MAJOR"?card.order:RANKS.indexOf(card.rank)+1;
  const expected=String(index).padStart(2,"0")+"-"+card.key.toLowerCase().replaceAll("_","-")+".jpeg";
  if(f.file!==expected||!manifest.mappings.some(m=>m.cardKey===f.cardKey&&m.assetId===f.assetId))throw Error("DECK_PACKAGE_INVALID");
 }
 return detached(value);
}
export async function loadBundledDeck(){
 const bytes=await readFile(resolve(process.cwd(),"resources/platform/tarot/rider-waite/manifest.json"));
 if(bytes.length>200000)throw Error("DECK_PACKAGE_INVALID");
 return validateBundledDeck(JSON.parse(bytes.toString("utf8")));
}
export async function verifyBundledArtwork(value:ReturnType<typeof validateBundledDeck>,storage:PlatformAssetStorage){
 for(const a of value.assets)await verifyImageBytes({id:a.id,contentHash:a.contentHash,mediaType:a.mediaType,byteSize:a.byteSize,width:a.width,height:a.height},await storage.read({objectKey:a.objectKey,maxBytes:a.byteSize}));
}
