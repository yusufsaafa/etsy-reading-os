import { z } from "zod";
import { stableJson } from "../../intake/contracts";
import { detached, hashSchema } from "../../media/contracts";
import { fontSchema, provisionalMetrics, type Font, type MeasuredLine, type TextMeasurement } from "../layout/measurement";
import { assertLatinCapability, isControlledFont, type FontRegistry, type ControlledFont } from "./fonts";
import { RenderResourceError, sha256 } from "./bytes";

export const measurementDescriptorSchema=z.discriminatedUnion("id",[
 z.strictObject({id:z.literal("controlled-advance"),version:z.literal(1),productionReady:z.literal(false)}),
 z.strictObject({id:z.literal("production-font-metrics"),version:z.literal(1),productionReady:z.literal(true),
  implementation:z.literal("fontkit/2.0.4"),capability:z.literal("latin-ltr/1"),resourceHash:hashSchema}),
]);
export type MeasurementDescriptor=z.infer<typeof measurementDescriptorSchema>;
export type ProductionMeasurement=TextMeasurement & Readonly<{descriptor:MeasurementDescriptor;fonts:readonly ControlledFont[]}>;
const trusted=new WeakSet<object>();
// Retained v1 font set. A future registry addition must not silently replace its metrics.
export const PRODUCTION_FONT_RESOURCE_HASH_V1="83c0bd3b0e49b608625975d982b9cfc77cdf119a87dd4695cfb2afc5964de66e";
export function measurementDescriptor(provider:TextMeasurement):MeasurementDescriptor {
 if(provider===provisionalMetrics)return Object.freeze({id:"controlled-advance",version:1,productionReady:false});
 if(provider.id!=="production-font-metrics"||provider.version!==1)throw new RenderResourceError("MEASUREMENT_VERSION_UNAVAILABLE");
 if(!trusted.has(provider))throw new RenderResourceError("MEASUREMENT_PROVIDER_MISMATCH");
 return (provider as ProductionMeasurement).descriptor;
}
export function requireMeasurement(descriptor:MeasurementDescriptor,provider:TextMeasurement) {
 if(stableJson(descriptor)!==stableJson(measurementDescriptor(provider)))throw new RenderResourceError("MEASUREMENT_PROVIDER_MISMATCH");
}
/** Version 1 fixes normal/400, latn/dflt/ltr, kern/liga/clig/mark/mkmk and exact pinned bytes.
 * Other retained weights are additive resources; no implicit role/weight/optical-size substitution. */
export function productionMeasurement(registry:FontRegistry):ProductionMeasurement {
 const fonts=[registry.resolve({font:"inter",style:"normal",weight:400}),registry.resolve({font:"source-serif-4",style:"normal",weight:400})];
 if(fonts.some(f=>!isControlledFont(f)))throw new RenderResourceError("FONT_RESOURCE_UNVERIFIED");
 const descriptor=detached(measurementDescriptorSchema.parse({id:"production-font-metrics",version:1,productionReady:true,implementation:"fontkit/2.0.4",capability:"latin-ltr/1",resourceHash:sha256(Buffer.from(stableJson(fonts.map(f=>f.metadata))))}));
 if(descriptor.id!=="production-font-metrics"||descriptor.resourceHash!==PRODUCTION_FONT_RESOURCE_HASH_V1)throw new RenderResourceError("FONT_MEASUREMENT_VERSION_MISMATCH");
 const select=(key:Font)=>fonts.find(f=>f.metadata.fontKey===fontSchema.parse(key))!;
 const sizeCheck=(size:number)=>z.number().int().min(7500).max(64000).parse(size);
 const widths=new Map<string,number>();let cachedCharacters=0;
 const provider:ProductionMeasurement=Object.freeze({id:"production-font-metrics",version:1,descriptor,fonts:Object.freeze(fonts),
  measure(text:string,key:Font,size:number) {
   sizeCheck(size);fontSchema.parse(key);
   const cacheKey=key+":"+size+":"+text,cached=widths.get(cacheKey);if(cached!==undefined)return cached;
   const run=select(key).shape(text),width=Math.ceil((run.inkRight-run.inkLeft)*size/run.unitsPerEm);
   if(text.length<=1024){while(widths.size>=1024||cachedCharacters+cacheKey.length>100000){const oldest=widths.keys().next().value!;cachedCharacters-=oldest.length;widths.delete(oldest);}widths.set(cacheKey,width);cachedCharacters+=cacheKey.length;}
   return width;
  },
  lineHeight(key:Font,size:number) {const f=select(key);return Math.ceil((f.ascent-f.descent)*sizeCheck(size)/f.unitsPerEm);},
  wrap(text:string,key:Font,size:number,width:number):MeasuredLine[] {
   assertLatinCapability(text);sizeCheck(size);
   if(!Number.isSafeInteger(width)||width<=0)throw new RenderResourceError("INVALID_TEXT_WIDTH");
   const lines:MeasuredLine[]=[];
   const push=(start:number,end:number)=>{const w=provider.measure(text.slice(start,end),key,size);if(w>width)throw new RenderResourceError("GLYPH_EXCEEDS_TEXT_BOX");lines.push({start,end,width:w});};
   let start=0,end=0;
   // Measure complete shaped candidates, not sums of individual character advances.
   for(const match of text.matchAll(/[^\r\n \t]+[ \t]*|[ \t]+|\r\n|\r|\n/g)) {
    const finish=match.index+match[0].length;
    if(/^[\r\n]/.test(match[0])){push(start,finish);start=end=finish;continue;}
    if(provider.measure(text.slice(start,finish),key,size)<=width){end=finish;continue;}
    if(end>start){push(start,end);start=end;}
    // Emergency wrapping keeps combining sequences intact. No Unicode normalization.
    for(const cluster of match[0].matchAll(/[^\u0300-\u036f][\u0300-\u036f]*/gu)) {
     const next=match.index+cluster.index+cluster[0].length;
     if(provider.measure(text.slice(start,next),key,size)>width) {
      if(end===start)throw new RenderResourceError("GLYPH_EXCEEDS_TEXT_BOX");
      push(start,end);start=end;
     }
     end=next;
    }
   }
   if(start<text.length)push(start,text.length);
   return lines;
  },
 });
 trusted.add(provider);return provider;
}
