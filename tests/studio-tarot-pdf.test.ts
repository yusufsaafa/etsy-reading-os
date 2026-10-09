import {it,expect} from "vitest";
import {PDFDocument,PDFName,PDFRawStream} from "pdf-lib";
import {loadBundledDeck} from "../src/modules/media/bundled-deck";
import {configuredPlatformAssets} from "../src/infrastructure/document-runtime";
import {STUDIO_SAMPLE_CARDS} from "../src/modules/documents/studio-media";
import {studioPreset} from "../src/modules/documents/studio-templates";
import {renderStudioPreview,studioPreviewInput} from "../src/modules/documents/studio-preview";
async function ports(){const p=await loadBundledDeck(),storage=configuredPlatformAssets();return {media:{mode:"TAROT_CARDS" as const,deck:{deckKey:p.deck.key,deckVersion:1},cards:STUDIO_SAMPLE_CARDS.map((cardKey,position)=>{const m=p.version.mappings.find(m=>m.cardKey===cardKey)!,a=p.assets.find(a=>a.id===m.assetId)!;return {cardKey,position,orientation:"UPRIGHT" as const,asset:{id:a.id,contentHash:a.contentHash,mediaType:a.mediaType,byteSize:a.byteSize,width:a.width,height:a.height}};})},readAsset:async(a:{id:string})=>{const asset=p.assets.find(x=>x.id===a.id)!;return storage.read({objectKey:asset.objectKey,maxBytes:asset.byteSize});}};}
async function images(bytes:Uint8Array){const doc=await PDFDocument.load(bytes);return doc.context.enumerateIndirectObjects().map(([,v])=>v).filter((v):v is PDFRawStream=>v instanceof PDFRawStream&&v.dict.get(PDFName.of("Subtype"))?.toString()==="/Image");}
it.each(["classic","mystic","luxury-editorial","tarot-atelier"] as const)("%s embeds three exact original approved JPEGs, with aspect-safe gallery placement",async template=>{
 const config=studioPreset(template);config.display.cardImagery=true;const p=await ports(),result=await renderStudioPreview(config,p),embedded=await images(result.pdf.copyBytes());expect(embedded).toHaveLength(3);
 for(const [i,image] of embedded.entries()){expect(image.dict.get(PDFName.of("Filter"))?.toString()).toBe("/DCTDecode");expect(image.contents).toEqual(await p.readAsset(p.media.cards[i].asset));}
 const cards=result.layout.pages.flatMap(page=>page.elements).filter(e=>e.kind==="CARD");expect(cards).toHaveLength(3);for(const e of cards){const a=p.media.cards[e.position].asset;expect(Math.abs(e.image.width/e.image.height-a.width/a.height)).toBeLessThan(0.001);expect(e.label).toBeTruthy();}
},20000);
it("identical approved input produces identical bytes and fixed samples; OFF embeds no images or empty frames",async()=>{
 const c=studioPreset("classic");c.display.cardImagery=true;const p=await ports(),a=await renderStudioPreview(c,p),b=await renderStudioPreview(c,p);expect(a.pdf.copyBytes()).toEqual(b.pdf.copyBytes());expect(p.media.cards.map(c=>c.cardKey)).toEqual(["THE_FOOL","THE_LOVERS","THE_STAR"]);
 const off=await renderStudioPreview({...c,display:{...c.display,cardImagery:false}});expect(await images(off.pdf.copyBytes())).toHaveLength(0);expect(off.layout.pages.flatMap(p=>p.elements).some(e=>e.kind==="CARD")).toBe(false);expect(off.layout.media.mode).toBe("NONE");expect(studioPreviewInput(c).media.media.mode).toBe("NONE");
},20000);
it.each(["minimal","modern"] as const)("%s retains its text-only renderer contract",async template=>{const c=studioPreset(template);const result=await renderStudioPreview(c,await ports());expect(await images(result.pdf.copyBytes())).toHaveLength(0);});
it("unavailable/corrupt resource fails rather than embedding substitute artwork",async()=>{const c=studioPreset("classic");c.display.cardImagery=true;const p=await ports();await expect(renderStudioPreview(c,{...p,readAsset:async()=>new Uint8Array([0])})).rejects.toThrow();await expect(renderStudioPreview(c,{...p,readAsset:async()=>{throw Error("missing");}})).rejects.toThrow();});
