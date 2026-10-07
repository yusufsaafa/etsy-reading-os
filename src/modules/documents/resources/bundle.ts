import { z } from "zod";
import { stableJson } from "../../intake/contracts";
import { detached, hashSchema, resolvedCardSchema } from "../../media/contracts";
import type { DocumentRenderInput } from "../media-contract";
import { validateLayoutForInput } from "../layout/engine";
import { fontSchema } from "../layout/measurement";
import { sha256, RESOURCE_LIMITS, RenderResourceError } from "./bytes";
import { measurementDescriptorSchema, type ProductionMeasurement } from "./measurement";
import { isControlledFont, type ControlledFont } from "./fonts";
import { validateImageEvidence, verifyImageBytes, type FrozenAsset, type VerifiedImage } from "./images";

export const renderResourcesSchema=z.strictObject({
 contractVersion:z.literal("document-render-resources/v1"),layoutHash:hashSchema,measurement:measurementDescriptorSchema,
 fonts:z.array(z.strictObject({fontKey:fontSchema,resourceVersion:z.enum(["4.1","4.005"]),style:z.literal("normal"),weight:z.literal(400),byteLength:z.number().int().positive().max(RESOURCE_LIMITS.fontBytes),sha256:hashSchema})).min(1).max(2),
 images:z.array(resolvedCardSchema.shape.asset).max(RESOURCE_LIMITS.images),
 cards:z.array(z.strictObject({position:z.number().int().min(0).max(9),assetId:z.uuid(),orientation:z.enum(["UPRIGHT","REVERSED"])})).max(10),
 resourceHash:hashSchema,
});
type ResourcesValue=z.infer<typeof renderResourcesSchema>;
export function resourceHash(raw:Omit<ResourcesValue,"resourceHash">|ResourcesValue){const {resourceHash:ignored,...value}=raw as ResourcesValue;return sha256(Buffer.from(stableJson(value)));}
export function immutableResourceManifest(raw:unknown) {
 const value=renderResourcesSchema.parse(raw);
 if(value.measurement.id!=="production-font-metrics" || resourceHash(value)!==value.resourceHash ||
  new Set(value.fonts.map(f=>f.fontKey)).size!==value.fonts.length || new Set(value.images.map(a=>a.id)).size!==value.images.length ||
  value.cards.some((c,i)=>c.position!==i))throw new RenderResourceError("RESOURCE_MANIFEST_INVALID");
 let bytes=value.fonts.reduce((n,f)=>n+f.byteLength,0),pixels=0;
 for(const a of value.images){validateImageEvidence(a);bytes+=a.byteSize;pixels+=a.width*a.height;}
 if(bytes>RESOURCE_LIMITS.aggregateBytes||pixels>RESOURCE_LIMITS.aggregatePixels)throw new RenderResourceError("AGGREGATE_RESOURCE_LIMIT");
 if(value.cards.some(c=>!value.images.some(a=>a.id===c.assetId))||value.images.some(a=>!value.cards.some(c=>c.assetId===a.id)))throw new RenderResourceError("RESOURCE_MANIFEST_INVALID");
 return detached(value);
}
/** Ephemeral verified resources. Byte getters return copies; manifest is deeply frozen. */
export type DocumentRenderResources=Readonly<{manifest:ReturnType<typeof immutableResourceManifest>;fonts:readonly ControlledFont[];images:readonly VerifiedImage[]}>;
const verifiedBundles=new WeakSet<object>();
export function isVerifiedResourceBundle(value:DocumentRenderResources){return verifiedBundles.has(value);}
/** Trusted internal composition, not a seller/client API. An owned service supplies the reader. */
export async function prepareLayoutResources(input:DocumentRenderInput,rawLayout:unknown,measurement:ProductionMeasurement,readAsset:(asset:Readonly<FrozenAsset>)=>Promise<Uint8Array>):Promise<DocumentRenderResources> {
 const layout=validateLayoutForInput(rawLayout,input,measurement);
 const keys=new Set(layout.pages.flatMap(p=>p.elements.flatMap(e=>e.kind==="TEXT"||e.kind==="BODY"?[e.typography.font]:[])));
 const fonts=measurement.fonts.filter(f=>keys.has(f.metadata.fontKey));
 if(fonts.length!==keys.size||fonts.some(f=>!isControlledFont(f)))throw new RenderResourceError("FONT_RESOURCE_UNAVAILABLE");
 const visible=layout.pages.flatMap(p=>p.elements.flatMap(e=>e.kind==="CARD"?[e.position]:[]));
 const cards=visible.map(position=>{
  if(layout.media.mode!=="TAROT_CARDS")throw new RenderResourceError("LAYOUT_RESOURCE_UNKNOWN");
  const c=layout.media.cards[position];if(!c)throw new RenderResourceError("LAYOUT_RESOURCE_UNKNOWN");return c;
 });
 const unique=new Map<string,FrozenAsset>();
 for(const c of cards){const a=validateImageEvidence(c.asset),old=unique.get(a.id);if(old&&stableJson(old)!==stableJson(a))throw new RenderResourceError("FROZEN_ASSET_METADATA_MISMATCH");unique.set(a.id,a);}
 const value:Omit<ResourcesValue,"resourceHash">={contractVersion:"document-render-resources/v1",layoutHash:layout.layoutHash,measurement:layout.measurement,
  fonts:fonts.map(f=>({fontKey:f.metadata.fontKey,resourceVersion:f.metadata.resourceVersion,style:"normal",weight:400,byteLength:f.metadata.byteLength,sha256:f.metadata.sha256})),
  images:[...unique.values()],cards:cards.map(c=>({position:c.position,assetId:c.asset.id,orientation:c.orientation}))};
 // Apply aggregate bounds before any storage/decode allocation; read/decode sequentially.
 const manifest=immutableResourceManifest({...value,resourceHash:resourceHash(value)});
 const images:VerifiedImage[]=[];
 for(const a of unique.values())images.push(await verifyImageBytes(a,await readAsset(detached(a))));
 const result=Object.freeze({manifest,fonts:Object.freeze(fonts),images:Object.freeze(images)});verifiedBundles.add(result);return result;
}
