import { beforeAll,expect,it,vi } from "vitest";
import { readFile,mkdtemp,mkdir,copyFile,symlink,rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadControlledFonts,verifyFontBytes,assertLatinCapability,type FontRegistry } from "../src/modules/documents/resources/fonts";
import { productionMeasurement,type ProductionMeasurement } from "../src/modules/documents/resources/measurement";
import { wrapText,provisionalMetrics } from "../src/modules/documents/layout/measurement";
import { composeDocumentLayout,validateLayoutForInput } from "../src/modules/documents/layout/engine";
import { immutableLayout,layoutHash,layoutSchema } from "../src/modules/documents/layout/contract";
import { verifyImageBytes,validateImageEvidence } from "../src/modules/documents/resources/images";
import { sha256,RESOURCE_LIMITS } from "../src/modules/documents/resources/bytes";
import { prepareLayoutResources,immutableResourceManifest,resourceHash,isVerifiedResourceBundle,renderResourcesSchema } from "../src/modules/documents/resources/bundle";
import { documentMediaHash,immutableRenderInput,renderInputSchema } from "../src/modules/documents/media-contract";
import { configurationHash } from "../src/modules/documents/contracts";
import { documentSnapshotHash } from "../src/modules/documents/snapshot-contract";
import { resourcesFixture,syntheticImage } from "./render-resources.fixture";
import { layoutFixture } from "./layout.fixture";
let registry:FontRegistry,metrics:ProductionMeasurement;
beforeAll(async()=>{registry=await loadControlledFonts();metrics=productionMeasurement(registry);});
it.each([400,600,700] as const)("verifies both retained static TTF resources at weight %s",weight=>{
 for(const font of ["inter","source-serif-4"]) {
  const f=registry.resolve({font,style:"normal",weight});expect(f.copyBytes()).toHaveLength(f.metadata.byteLength);expect(sha256(f.copyBytes())).toBe(f.metadata.sha256);
  expect(Object.isFrozen(f.metadata)).toBe(true);const copy=f.copyBytes();copy[0]=0;expect(sha256(f.copyBytes())).toBe(f.metadata.sha256);expect(f.metadata.format).toBe("STATIC_TTF");
 }
});
it.each([{font:"unknown",style:"normal",weight:400},{font:"inter",style:"italic",weight:400},{font:"inter",style:"normal",weight:500},{font:"../../etc/passwd",style:"normal",weight:400},{font:"inter",style:"normal",weight:400,path:"/etc/passwd"}])("rejects unsupported font/style/weight or path injection %j",raw=>{expect(()=>registry.resolve(raw)).toThrow();});
it("rejects damaged font bytes and mutated metadata",()=>{
 const f=registry.resources[0],bytes=f.copyBytes();expect(()=>verifyFontBytes(f.metadata,bytes.subarray(1))).toThrow("FONT_LENGTH_MISMATCH");bytes[100]^=1;expect(()=>verifyFontBytes(f.metadata,bytes)).toThrow("FONT_DIGEST_MISMATCH");
 expect(()=>verifyFontBytes({...f.metadata,url:"https://example.test/font.ttf"},bytes)).toThrow();
 expect(()=>productionMeasurement({resources:registry.resources,resolve:()=>({...f})})).toThrow("FONT_RESOURCE_UNVERIFIED");
});
it("license texts and package manifests are retained, hash-pinned upstream evidence",async()=>{
 const inter=await readFile("resources/fonts/inter/4.1/LICENSE.txt","utf8"),serif=await readFile("resources/fonts/source-serif-4/4.005/LICENSE.md","utf8");
 expect(inter).toContain("SIL OPEN FONT LICENSE Version 1.1");expect(serif).toContain("SIL OPEN FONT LICENSE Version 1.1");expect(serif).toContain("Reserved Font Name");expect(registry.resources).toHaveLength(6);
});
it("font loading and production composition require no network",async()=>{
 vi.stubGlobal("fetch",()=>{throw Error("network forbidden");});
 try{const local=await loadControlledFonts();expect(composeDocumentLayout(layoutFixture(),productionMeasurement(local)).measurement.productionReady).toBe(true);}
 finally{vi.unstubAllGlobals();}
});
it("fails with bounded missing-resource errors and rejects local symlink traversal",async()=>{
 const source=process.cwd(),temp=await mkdtemp("/tmp/reading-os-font-test-"),cwd=vi.spyOn(process,"cwd").mockReturnValue(temp);
 try {
  await expect(loadControlledFonts()).rejects.toThrow("FONT_RESOURCE_MISSING");
  const folder=resolve(temp,"resources/fonts/inter/4.1");await mkdir(folder,{recursive:true});
  for(const name of ["provenance.json","LICENSE.txt"])await copyFile(resolve(source,"resources/fonts/inter/4.1",name),resolve(folder,name));
  await symlink(resolve(source,"resources/fonts/inter/4.1/Inter-Regular.ttf"),resolve(folder,"Inter-Regular.ttf"));
  await expect(loadControlledFonts()).rejects.toThrow("FONT_PATH_UNAVAILABLE");
 }finally{cwd.mockRestore();await rm(temp,{recursive:true,force:true});}
});
it("uses actual widths, kerning, GSUB ligatures and GPOS mark positions",()=>{
 const font=registry.resolve({font:"source-serif-4",style:"normal",weight:400});
 expect(metrics.measure("WWWW","inter",11000)).toBeGreaterThan(metrics.measure("iiii","inter",11000));
 expect(font.shape("AV").advance).toBeLessThan(font.shape("A").advance+font.shape("V").advance);
 expect(font.shape("office").glyphs.length).toBeLessThan(6);
 const marks=font.shape("a\u0301");expect(marks.glyphs.some(g=>g.xOffset!==0||g.yOffset!==0)).toBe(true);
 expect(font.shape("a\u0301").advance).toBe(font.shape("a").advance);
 expect(metrics.measure("The same text","inter",11000)).not.toBe(metrics.measure("The same text","source-serif-4",11000));
 expect(registry.resolve({font:"inter",style:"normal",weight:700}).shape("Reading").advance).not.toBe(registry.resolve({font:"inter",style:"normal",weight:400}).shape("Reading").advance);
});
it.each(["ğ Ğ ş Ş ı İ ç Ç ö Ö ü Ü", "café naïve résumé à è ô ß", "a\u0301 e\u0308 i\u0307", "Whitespace\t punctuation: ‘yes’ — 2026… €"])("measures supported Latin exactly and deterministically: %s",text=>{
 for(const font of ["inter","source-serif-4"] as const){expect(metrics.measure(text,font,11000)).toBe(metrics.measure(text,font,11000));expect(metrics.measure(text,font,22000)).toBeGreaterThan(metrics.measure(text,font,11000));}
});
it.each(["العربية","漢字","कर्म","🙂","\u202eabc","\ud800","\u0301a"])("fails explicitly for unsupported shaping: %s",text=>{expect(()=>metrics.measure(text,"inter",11000)).toThrow("SHAPING_CAPABILITY_UNAVAILABLE");});
it("wraps shaped whole runs, long words, combining clusters and CRLF without losing text",()=>{
 const text="AV office a\u0301 "+"superlongword".repeat(20)+"\r\n\r\nTurkish: ğ ş ı İ ç ö ü.";
 const lines=wrapText(text,"source-serif-4",11000,90000,metrics);
 expect(lines.map(l=>text.slice(l.start,l.end)).join("")).toBe(text);expect(lines.every(l=>l.width<=90000)).toBe(true);
 for(const l of lines){expect(/^[\u0300-\u036f]/u.test(text.slice(l.start,l.end))).toBe(false);expect(l.width).toBe(metrics.measure(text.slice(l.start,l.end),"source-serif-4",11000));}
 expect(()=>wrapText("W","inter",11000,1,metrics)).toThrow("GLYPH_EXCEEDS_TEXT_BOX");
});
it.each(["mystic","luxury-editorial","minimal","tarot-atelier"])("uses the one pagination engine with verified production metrics: %s",template=>{
 const text="Precise Turkish ğ ş ı İ and café. ".repeat(450)+"\n\nExact final paragraph.",input=layoutFixture(template,template==="minimal"?0:3,[text,"Short next section."]);
 const layout=composeDocumentLayout(input,metrics);expect(layout.measurement).toMatchObject({id:"production-font-metrics",version:1,productionReady:true});
 expect(composeDocumentLayout(input,metrics)).toEqual(layout);expect(validateLayoutForInput(layout,input,metrics)).toEqual(layout);
 expect(layout.pages.flatMap(p=>p.elements).filter(e=>e.kind==="BODY"&&e.sectionId==="section-0").map(e=>e.kind==="BODY"?e.text:"").join("")).toBe(text);
 expect(layout.pages.length).toBeGreaterThan(3);expect(Object.isFrozen(layout.pages[0].elements)).toBe(true);
 expect(layout.layoutHash).not.toBe(composeDocumentLayout(input,provisionalMetrics).layoutHash);
},20000);
it("retains provisional validation and fails closed on provider/descriptor mismatches",()=>{
 const input=layoutFixture(),old=composeDocumentLayout(input);expect(immutableLayout(old)).toEqual(old);expect(old.measurement.productionReady).toBe(false);
 const layout=composeDocumentLayout(input,metrics);expect(()=>immutableLayout(layout)).toThrow("DOCUMENT_LAYOUT_UNAVAILABLE");
 expect(()=>composeDocumentLayout(input,{...metrics})).toThrow("MEASUREMENT_PROVIDER_MISMATCH");
 const corrupt=layoutSchema.parse(layout);if(corrupt.measurement.id==="production-font-metrics")corrupt.measurement.resourceHash="0".repeat(64);corrupt.layoutHash=layoutHash(corrupt);
 expect(()=>immutableLayout(corrupt,metrics)).toThrow();expect(()=>metrics.measure("abc","inter",64001)).toThrow();expect(()=>assertLatinCapability("a".repeat(40001))).toThrow("TEXT_RESOURCE_LIMIT");
});
it.each(["png","jpeg","webp"] as const)("fully decodes supported synthetic %s and returns exact detached bytes",async format=>{
 const bytes=await syntheticImage(format),evidence={id:randomUUID(),mediaType:`image/${format}`,contentHash:sha256(bytes),byteSize:bytes.length,width:60,height:100};
 const image=await verifyImageBytes(evidence,bytes);expect(image.copyBytes()).toEqual(Uint8Array.from(bytes));const copy=image.copyBytes();copy.fill(0);expect(sha256(image.copyBytes())).toBe(evidence.contentHash);expect(Object.isFrozen(image.metadata)).toBe(true);expect(JSON.stringify(image.metadata)).not.toContain("objectKey");
});
it("rejects missing/truncated/extra bytes, wrong digest, MIME spoof, wrong dimensions and malformed pixels",async()=>{
 const {input,bytes}=await resourcesFixture(1);if(input.media.media.mode!=="TAROT_CARDS")throw Error();const e=input.media.media.cards[0].asset;
 for(const wrong of [new Uint8Array(),bytes.subarray(0,bytes.length-1),Buffer.concat([bytes,Buffer.from([0])])])await expect(verifyImageBytes(e,wrong)).rejects.toThrow("ASSET_LENGTH_MISMATCH");
 await expect(verifyImageBytes({...e,contentHash:"0".repeat(64)},bytes)).rejects.toThrow("ASSET_DIGEST_MISMATCH");
 await expect(verifyImageBytes({...e,mediaType:"image/jpeg"},bytes)).rejects.toThrow("IMAGE_MIME_MISMATCH");
 await expect(verifyImageBytes({...e,width:61},bytes)).rejects.toThrow("IMAGE_DIMENSION_MISMATCH");
 const corrupt=Buffer.from(bytes);corrupt[corrupt.length-20]^=255;await expect(verifyImageBytes({...e,contentHash:sha256(corrupt)},corrupt)).rejects.toThrow("IMAGE_DECODE_FAILED");
 const truncated=bytes.subarray(0,40);await expect(verifyImageBytes({...e,byteSize:40,contentHash:sha256(truncated)},truncated)).rejects.toThrow("IMAGE_DECODE_FAILED");
 for(const b of [Buffer.from("<svg></svg>"),Buffer.from("<html>bad</html>"),Buffer.from("GIF89a")])await expect(verifyImageBytes({...e,byteSize:b.length,contentHash:sha256(b)},b)).rejects.toThrow("IMAGE_FORMAT_UNSUPPORTED");
 expect(()=>validateImageEvidence({...e,width:8193})).toThrow("IMAGE_RESOURCE_LIMIT");expect(()=>validateImageEvidence({...e,width:5000,height:5000})).toThrow("IMAGE_RESOURCE_LIMIT");expect(()=>validateImageEvidence({...e,byteSize:RESOURCE_LIMITS.imageBytes+1})).toThrow("IMAGE_RESOURCE_LIMIT");
 await expect(verifyImageBytes({...e,url:"https://example.test/art.png"},bytes)).rejects.toThrow();
});
it("rejects APNG animation even if a decoder would inspect only its first frame",async()=>{
 const bytes=await syntheticImage(),control=Buffer.alloc(20);control.writeUInt32BE(8,0);control.write("acTL",4,"ascii");control.writeUInt32BE(2,8);
 const animated=Buffer.concat([bytes.subarray(0,33),control,bytes.subarray(33)]);
 await expect(verifyImageBytes({id:randomUUID(),mediaType:"image/png",byteSize:animated.length,contentHash:sha256(animated),width:60,height:100},animated)).rejects.toThrow("IMAGE_PRESENTATION_UNSUPPORTED");
});
it.each([1,3,10])("prepares %s frozen card resources deterministically with exact separate orientation",async count=>{
 const {input,bytes}=await resourcesFixture(count,"tarot-atelier"),layout=composeDocumentLayout(input,metrics),read=vi.fn(async()=>bytes);
 const a=await prepareLayoutResources(input,layout,metrics,read),b=await prepareLayoutResources(input,layout,metrics,async()=>bytes);
 expect(a.manifest).toEqual(b.manifest);expect(a.images).toHaveLength(count);expect(read).toHaveBeenCalledTimes(count);expect(a.manifest.cards.map(c=>c.position)).toEqual(Array.from({length:count},(_,i)=>i));expect(a.manifest.cards[0].orientation).toBe("UPRIGHT");if(count>1)expect(a.manifest.cards[1].orientation).toBe("REVERSED");
 expect(a.images[0].copyBytes()).toEqual(a.images.at(-1)!.copyBytes());expect(isVerifiedResourceBundle(a)).toBe(true);expect(Object.isFrozen(a.manifest.images)).toBe(true);expect(JSON.stringify(a.manifest)).not.toMatch(/objectKey|upstreamPath|filename|https:|provider|prompt/);
});
it("deduplicates exact image identity for upright/reversed positions",async()=>{
 const {input,bytes}=await resourcesFixture(2),raw=renderInputSchema.parse(input);if(raw.media.media.mode!=="TAROT_CARDS")throw Error();raw.media.media.cards[1].asset={...raw.media.media.cards[0].asset};raw.media.mediaHash=documentMediaHash(raw.media.media);const exact=immutableRenderInput(raw.snapshot,raw.media),read=vi.fn(async()=>bytes);
 const bundle=await prepareLayoutResources(exact,composeDocumentLayout(exact,metrics),metrics,read);expect(read).toHaveBeenCalledTimes(1);expect(bundle.images).toHaveLength(1);expect(bundle.manifest.cards.map(c=>c.orientation)).toEqual(["UPRIGHT","REVERSED"]);
});
it("imagery OFF and NONE retrieve zero image bytes while retaining semantic media",async()=>{
 for(const count of [0,3]) {
  const {input}=await resourcesFixture(count),raw=renderInputSchema.parse(input);raw.snapshot.design.configuration.display.cardImagery=false;raw.snapshot.design.configurationHash=configurationHash(raw.snapshot.design.configuration);raw.snapshot.snapshotHash=documentSnapshotHash(raw.snapshot);
  const exact=immutableRenderInput(raw.snapshot,raw.media),read=vi.fn(async()=>{throw Error("must not read");});const bundle=await prepareLayoutResources(exact,composeDocumentLayout(exact,metrics),metrics,read);expect(read).not.toHaveBeenCalled();expect(bundle.images).toHaveLength(0);expect(exact.media.media).toEqual(input.media.media);
 }
});
it("validates strict resource hashes and rejects aggregate limits before storage reads",async()=>{
 const {input,bytes}=await resourcesFixture(3),bundle=await prepareLayoutResources(input,composeDocumentLayout(input,metrics),metrics,async()=>bytes);
 expect(()=>immutableResourceManifest({...bundle.manifest,url:"https://example.test"})).toThrow();expect(()=>immutableResourceManifest({...bundle.manifest,resourceHash:"0".repeat(64)})).toThrow();
 const bad=renderResourcesSchema.parse(bundle.manifest);bad.images.forEach(a=>{a.width=4000;a.height=4000;});bad.resourceHash=resourceHash(bad);expect(()=>immutableResourceManifest(bad)).toThrow("AGGREGATE_RESOURCE_LIMIT");
 const raw=renderInputSchema.parse(input);if(raw.media.media.mode!=="TAROT_CARDS")throw Error();raw.media.media.cards.forEach(c=>Object.assign(c.asset,{byteSize:25*1024*1024}));raw.media.mediaHash=documentMediaHash(raw.media.media);const exact=immutableRenderInput(raw.snapshot,raw.media),read=vi.fn(async()=>bytes);
 await expect(prepareLayoutResources(exact,composeDocumentLayout(exact,metrics),metrics,read)).rejects.toThrow("AGGREGATE_RESOURCE_LIMIT");expect(read).not.toHaveBeenCalled();
});
