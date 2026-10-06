import { createHash } from "node:crypto";
import { z } from "zod";
import { stableJson } from "../intake/contracts";
import { CANONICAL_CARDS, cardKeySchema } from "./catalog";
export type DeepReadonly<T> = T extends object ? {readonly [K in keyof T]:DeepReadonly<T[K]>} : T;
export function detached<T>(value:T):DeepReadonly<T> {
 const copy=structuredClone(value);
 function freeze(v:unknown) { if(v && typeof v==="object") { Object.values(v).forEach(freeze);Object.freeze(v); } }
 freeze(copy);return copy as DeepReadonly<T>;
}
const plain=(max:number)=>z.string().min(1).max(max).refine(v=>v.trim()===v && !/[<>\u0000-\u001f\u007f]/.test(v));
export const deckKeySchema=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const versionSchema=z.number().int().min(1).max(2147483647);
export const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const mimeSchema=z.enum(["image/png","image/jpeg","image/webp"]);
export const rightsSchema=z.strictObject({state:z.enum(["UNVERIFIED","APPROVED","RESTRICTED"]),classification:z.enum(["UNVERIFIED","PLATFORM_ORIGINAL","LICENSED","PUBLIC_DOMAIN"]),source:plain(200),evidenceReference:plain(300).nullable(),notes:z.string().max(2000).refine(v=>!/[<>\u0000-\u0008]/.test(v))}).refine(v=>v.state!=="APPROVED" || (v.classification!=="UNVERIFIED" && v.evidenceReference!==null),"Approved rights require classification and evidence");
export const objectKeySchema=z.string().min(1).max(512).regex(/^platform\/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp)$/).refine(v=>!v.includes("//") && v.split("/").every(s=>s!=="." && s!==".."));
export const assetSchema=z.strictObject({id:z.uuid(),kind:z.literal("TAROT_CARD_IMAGE"),objectKey:objectKeySchema,mediaType:mimeSchema,byteSize:z.number().int().min(1).max(25*1024*1024),contentHash:hashSchema,width:z.number().int().min(1).max(16384),height:z.number().int().min(1).max(16384),status:z.enum(["READY","UNAVAILABLE"]),rights:rightsSchema,createdAt:z.iso.datetime()}).refine(v=>v.width*v.height<=100_000_000 && v.width/v.height>=0.1 && v.width/v.height<=10,"Invalid image dimensions");
export type PlatformAsset=DeepReadonly<z.infer<typeof assetSchema>>;
export const mappingSchema=z.strictObject({cardKey:cardKeySchema,assetId:z.uuid()});
export const deckVersionSchema=z.strictObject({deckKey:deckKeySchema,version:versionSchema,status:z.enum(["DRAFT","PUBLISHED","RETIRED"]),rights:rightsSchema,mappings:z.array(mappingSchema).max(78),mappingHash:hashSchema,createdAt:z.iso.datetime()});
export const deckSchema=z.strictObject({key:deckKeySchema,name:plain(100),description:z.string().max(300).refine(v=>!/[<>\u0000-\u001f]/.test(v))});
export const deckReferenceSchema=z.strictObject({deckKey:deckKeySchema,deckVersion:versionSchema});
export const preferenceCommandSchema=deckReferenceSchema.extend({expectedRevision:z.number().int().min(0).max(2147483646)});
export class MediaUnavailable extends Error { constructor(){super("MEDIA_UNAVAILABLE");} }
export function mappingHash(mappings:readonly {cardKey:string;assetId:string}[]) { return createHash("sha256").update(stableJson(mappings)).digest("hex"); }
export function validateAsset(raw:unknown):PlatformAsset { try{return detached(assetSchema.parse(raw));}catch{throw new MediaUnavailable();} }
export function usableAsset(asset:PlatformAsset) { if(asset.status!=="READY" || asset.rights.state!=="APPROVED")throw new MediaUnavailable(); }
/** Validates every mapping, not just the requested card. Reads never repair corruption. */
export function validateDeckVersion(raw:unknown,rawAssets:readonly unknown[],historical=false) {
 try {
  const version=deckVersionSchema.parse(raw);
  if(!["PUBLISHED",...(historical ? ["RETIRED"] : [])].includes(version.status) || version.rights.state!=="APPROVED" || version.mappings.length!==78 || mappingHash(version.mappings)!==version.mappingHash)throw new Error();
  const assets=new Map<string,PlatformAsset>();
  for(const raw of rawAssets) {const asset=validateAsset(raw);if(assets.has(asset.id))throw new Error();assets.set(asset.id,asset);}
  const keys=new Set(version.mappings.map(m=>m.cardKey));
  if(keys.size!==78 || CANONICAL_CARDS.some(c=>!keys.has(c.key)))throw new Error();
  for(const mapping of version.mappings) {const asset=assets.get(mapping.assetId);if(!asset)throw new Error();usableAsset(asset);}
  return detached(version);
 }catch{throw new MediaUnavailable();}
}
export const resolvedCardSchema=z.strictObject({contractVersion:z.literal("tarot-card-asset/v1"),deckKey:deckKeySchema,deckVersion:versionSchema,cardKey:cardKeySchema,asset:z.strictObject({id:z.uuid(),contentHash:hashSchema,mediaType:mimeSchema,byteSize:z.number().int().positive(),width:z.number().int().positive(),height:z.number().int().positive()})});
export type ResolvedTarotCardAsset=DeepReadonly<z.infer<typeof resolvedCardSchema>>;
export type StoreDeckPreference=Readonly<{status:"NOT_CONFIGURED";revision:0}> | Readonly<{status:"CONFIGURED";revision:number;deckKey:string;deckVersion:number}>;
