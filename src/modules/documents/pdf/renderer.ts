import { PDFDocument, PDFName, PDFHexString, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import sharp from "sharp";
import { z } from "zod";
import { stableJson } from "../../intake/contracts";
import { immutableLayout, type DocumentLayout } from "../layout/contract";
import { loadControlledFonts, isControlledFont } from "../resources/fonts";
import { productionMeasurement } from "../resources/measurement";
import { immutableResourceManifest, isVerifiedResourceBundle, type DocumentRenderResources } from "../resources/bundle";
import { isVerifiedImage, verifyImageBytes } from "../resources/images";
import { sha256 } from "../resources/bytes";
import { pdfFont, utf16Hex } from "./font";
import { PDF_RENDERER, PDF_LIMITS, DocumentPdfError, validatedPdfResult } from "./contract";

const requestSchema=z.strictObject({layout:z.unknown(),resources:z.custom<DocumentRenderResources>(v=>!!v&&typeof v==="object"&&isVerifiedResourceBundle(v as DocumentRenderResources)),rendererVersion:z.literal(PDF_RENDERER).optional()});
const backgrounds={IVORY:"#F8F4EB",PARCHMENT:"#F5EDD9",WHITE:"#FFFFFF"} as const;
/** Physical boundary only: milli-points / 1000. Layout hashes stay entirely integer-based. */
export const pdfPoints=(milliPoints:number)=>milliPoints/1000;
function n(value:number){if(!Number.isFinite(value))throw new DocumentPdfError("INVALID_PDF_GEOMETRY");return String(Math.round(value*1000000)/1000000);}
function color(value:string){return [1,3,5].map(i=>n(parseInt(value.slice(i,i+2),16)/255)).join(" ");}

/** Pure internal painter. Server ownership is established by renderDocumentPdfForReading. */
export async function renderDocumentPdf(raw:unknown){
 try{
  const request=requestSchema.parse(raw),resources=request.resources;
  const manifest=immutableResourceManifest(resources.manifest);
  const preliminary=z.object({measurement:z.object({id:z.literal("production-font-metrics"),version:z.literal(1),productionReady:z.literal(true)})}).safeParse(request.layout);
  if(!preliminary.success)throw new DocumentPdfError("LAYOUT_NOT_PRODUCTION_READY");
  const measurement=productionMeasurement(await loadControlledFonts());
  const layout=immutableLayout(request.layout,measurement);
  if(layout.layoutHash!==manifest.layoutHash||stableJson(layout.measurement)!==stableJson(manifest.measurement))throw new DocumentPdfError("LAYOUT_RESOURCE_MISMATCH");
  const requiredFonts=new Set(layout.pages.flatMap(p=>p.elements.flatMap(e=>e.kind==="TEXT"||e.kind==="BODY"?[e.typography.font]:[])));
  const visible=layout.pages.flatMap(p=>p.elements.flatMap(e=>e.kind==="CARD"?[e.position]:[]));
  const cards=visible.map(position=>{if(layout.media.mode!=="TAROT_CARDS")throw new DocumentPdfError("IMAGE_RESOURCE_MISMATCH");return layout.media.cards[position];});
  if(stableJson(manifest.cards)!==stableJson(cards.map(c=>({position:c.position,assetId:c.asset.id,orientation:c.orientation})))||
   resources.fonts.length!==requiredFonts.size||manifest.fonts.length!==resources.fonts.length||resources.images.length!==manifest.images.length)
   throw new DocumentPdfError("LAYOUT_RESOURCE_MISMATCH");
  const uniqueImages=new Map(cards.map(c=>[c.asset.id,c.asset]));
  if(stableJson([...uniqueImages.values()])!==stableJson(manifest.images))throw new DocumentPdfError("IMAGE_RESOURCE_MISMATCH");
  const doc=await PDFDocument.create({updateMetadata:false});
  doc.setProducer(`Reading OS ${PDF_RENDERER}; pdf-lib/1.17.1`);
  const identity=sha256(Buffer.from(stableJson({layoutHash:layout.layoutHash,resourceHash:manifest.resourceHash,rendererVersion:PDF_RENDERER})));
  doc.context.trailerInfo.ID=doc.context.obj([PDFHexString.of(identity.slice(0,32)),PDFHexString.of(identity.slice(0,32))]) as PDFArray;
  const fonts=new Map<string,ReturnType<typeof pdfFont>>(),fontBytes=new Map<string,Uint8Array>();
  for(const [i,f] of resources.fonts.entries()){
   if(!isControlledFont(f)||!requiredFonts.has(f.metadata.fontKey))throw new DocumentPdfError("FONT_RESOURCE_MISMATCH");
   const m=manifest.fonts[i],expected=measurement.fonts.find(a=>a.metadata.fontKey===f.metadata.fontKey);
   const bytes=f.copyBytes();
   if(!expected||m.fontKey!==f.metadata.fontKey||m.weight!==400||m.style!=="normal"||m.resourceVersion!==expected.metadata.resourceVersion||m.sha256!==expected.metadata.sha256||
    bytes.length!==m.byteLength||sha256(bytes)!==m.sha256||fonts.has(m.fontKey))throw new DocumentPdfError("FONT_RESOURCE_MISMATCH");
   fonts.set(m.fontKey,pdfFont(doc,f,bytes,i));fontBytes.set(m.fontKey,bytes);
  }
  const images=new Map<string,{ref:ReturnType<typeof doc.context.nextRef>;name:PDFName}>();let convertedBytes=0;
  for(const [i,image] of resources.images.entries()){
   if(!isVerifiedImage(image)||stableJson(image.metadata)!==stableJson(manifest.images[i]))throw new DocumentPdfError("IMAGE_RESOURCE_MISMATCH");
   const bytes=image.copyBytes();await verifyImageBytes(image.metadata,bytes);
   let pdfImage;
   if(image.metadata.mediaType==="image/jpeg")pdfImage=await doc.embedJpg(bytes);
   else{
    const png=image.metadata.mediaType==="image/webp"?await sharp(bytes,{failOn:"warning",limitInputPixels:16000000}).timeout({seconds:10}).png({compressionLevel:9,adaptiveFiltering:false,palette:false}).toBuffer():bytes;
    convertedBytes+=png.length;
    if(convertedBytes>PDF_LIMITS.convertedImageBytes)throw new DocumentPdfError("OUTPUT_RESOURCE_LIMIT");
    pdfImage=await doc.embedPng(png);
   }
   if(pdfImage.width!==image.metadata.width||pdfImage.height!==image.metadata.height)throw new DocumentPdfError("IMAGE_EMBEDDING_FAILURE");
   images.set(image.metadata.id,{ref:pdfImage.ref,name:PDFName.of(`I${i}`)});
  }
  let glyphCount=0,contentBytes=0;
  for(const page of layout.pages){
   const pdfPage=doc.addPage([pdfPoints(layout.pageSize.width),pdfPoints(layout.pageSize.height)]),height=pdfPage.getHeight();
   for(const f of fonts.values())pdfPage.node.setFontDictionary(f.name,f.ref);
   for(const image of images.values())pdfPage.node.setXObject(image.name,image.ref);
   const commands:string[]=[];
   const add=(command:string)=>{contentBytes+=Buffer.byteLength(command)+1;if(contentBytes>PDF_LIMITS.contentBytes)throw new DocumentPdfError("OUTPUT_CONTENT_LIMIT");commands.push(command);};
   const rect=(x:number,y:number,w:number,h:number,c:string,outline=false)=>add(`${color(c)} ${outline?"RG":"rg"} ${n(x)} ${n(height-y-h)} ${n(w)} ${n(h)} re ${outline?"S":"f"}`);
   const rule=(x:number,y:number,x2:number,y2:number,c:string,width=.6)=>add(`${color(c)} RG ${n(width)} w ${n(x)} ${n(height-y)} m ${n(x2)} ${n(height-y2)} l S`);
   rect(0,0,pdfPage.getWidth(),height,backgrounds[page.background]);
   if(page.frame!=="NONE"){
    const inset=pdfPoints(page.contentBox.x)/2;
    add("0.6 w");rect(inset,inset,pdfPage.getWidth()-inset*2,height-inset*2,"#A89060",true);
    if(page.frame==="ANTIQUE")rect(inset+3,inset+3,pdfPage.getWidth()-inset*2-6,height-inset*2-6,"#A89060",true);
   }
   for(const e of page.elements){
    const b=e.box,x=pdfPoints(b.x),y=pdfPoints(b.y),w=pdfPoints(b.width),h=pdfPoints(b.height);
    if(e.kind==="TEXT"||e.kind==="BODY"){
     const f=fonts.get(e.typography.font);if(!f)throw new DocumentPdfError("FONT_MISSING");
     const scale=e.typography.size/f.font.unitsPerEm/1000;
     for(const [lineIndex,line] of e.lines.entries()){
      const text=e.text.slice(line.start,line.end),run=f.font.shape(text);
      if((glyphCount+=run.glyphs.length)>PDF_LIMITS.glyphs)throw new DocumentPdfError("GLYPH_RESOURCE_LIMIT");
      const baseline=height-y-pdfPoints(lineIndex*e.typography.lineHeight)-f.font.ascent*scale;
      add(`/Span << /ActualText <FEFF${utf16Hex(text)}> >> BDC BT ${color(e.typography.color)} rg ${f.name} ${n(pdfPoints(e.typography.size))} Tf`);
      let penX=0,penY=0;
      for(const g of run.glyphs){
       add(`1 0 0 1 ${n(x+(penX+g.xOffset-run.inkLeft)*scale)} ${n(baseline+(penY+g.yOffset)*scale)} Tm <${f.cid(g)}> Tj`);
       penX+=g.xAdvance;penY+=g.yAdvance;
      }
      add("ET EMC");
     }
    }else if(e.kind==="CARD"){
     if(layout.media.mode!=="TAROT_CARDS")throw new DocumentPdfError("IMAGE_RESOURCE_MISMATCH");
     const card=layout.media.cards[e.position],image=images.get(card.asset.id);if(!image)throw new DocumentPdfError("IMAGE_MISSING");
     const a=e.image,ix=pdfPoints(a.x),iy=height-pdfPoints(a.y+a.height),iw=pdfPoints(a.width),ih=pdfPoints(a.height);
     const reversed=card.orientation==="REVERSED";
     add(`q ${n(reversed?-iw:iw)} 0 0 ${n(reversed?-ih:ih)} ${n(reversed?ix+iw:ix)} ${n(reversed?iy+ih:iy)} cm ${image.name} Do Q`);
     if(page.frame==="ANTIQUE"){add("0.6 w");rect(x,y,w,h,"#A89060",true);}
    }else if(e.kind==="DIVIDER")rule(x,y+h/2,x+w,y+h/2,e.color);
    else if(e.kind==="ORNAMENT"){
     const cx=x+w/2,cy=y+h/2,r=Math.min(w,h)*.3;
     if(e.token==="CELESTIAL"){
      // Original geometric star and orbit; no external SVG/art dependency.
      add(`${color(e.color)} RG 0.6 w ${n(cx-r)} ${n(height-cy)} m ${n(cx)} ${n(height-cy-r)} l ${n(cx+r)} ${n(height-cy)} l ${n(cx)} ${n(height-cy+r)} l h S`);
      rule(x,cy,cx-r-2,cy,e.color);rule(cx+r+2,cy,x+w,cy,e.color);
     }else if(e.token==="EDITORIAL"){
      rule(x,cy,x+w,cy,e.color,1.2);rect(cx-2,cy-2,4,4,e.color);
     }else if(e.token==="END_RULE")rule(x+w*.2,cy,x+w*.8,cy,e.color);
     else throw new DocumentPdfError("UNSUPPORTED_PRIMITIVE");
    }else throw new DocumentPdfError("UNSUPPORTED_PRIMITIVE");
   }
   pdfPage.node.addContentStream(doc.context.register(doc.context.flateStream(Buffer.from(commands.join("\n"),"ascii"))));
  }
  for(const f of fonts.values())f.finish();
  const bytes=await doc.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});
  await validatePdfBytes(bytes,layout,fontBytes,images.size);
  return validatedPdfResult(bytes,layout.layoutHash,manifest.resourceHash,layout.pages.length);
 }catch(cause){if(cause instanceof DocumentPdfError)throw cause;throw new DocumentPdfError("PDF_RENDERING_FAILED",cause);}
}

/** Reopen, inspect physical pages and full embedded font bytes, not just a writer success signal. */
export async function validatePdfBytes(bytes:Uint8Array,layout:DocumentLayout,fonts:ReadonlyMap<string,Uint8Array>,imageCount:number){
 try{
  if(bytes.length>PDF_LIMITS.bytes)throw new DocumentPdfError("PDF_OUTPUT_LIMIT");
  if(!Buffer.from(bytes.subarray(0,8)).equals(Buffer.from("%PDF-1.7"))||!Buffer.from(bytes.subarray(-16)).toString("ascii").includes("%%EOF"))throw new Error("header/EOF");
  const parsed=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});
  if(parsed.getPageCount()!==layout.pages.length)throw new DocumentPdfError("PDF_PAGE_COUNT_MISMATCH");
  if(parsed.getCreationDate()||parsed.getModificationDate()||parsed.isEncrypted||parsed.getProducer()!==`Reading OS ${PDF_RENDERER}; pdf-lib/1.17.1`)throw new Error("metadata");
  const embedded=new Set<string>(),verifiedFontRefs=new Set<string>();
  for(const page of parsed.getPages()){
   if(page.getWidth()!==pdfPoints(layout.pageSize.width)||page.getHeight()!==pdfPoints(layout.pageSize.height))throw new DocumentPdfError("PDF_PAGE_DIMENSION_MISMATCH");
   const fd=page.node.Resources()?.lookup(PDFName.of("Font"),PDFDict);
   if(!fd||fd.keys().length!==fonts.size)throw new Error("font count");
   for(const key of fd.keys()){
    const type0=fd.lookup(key,PDFDict),cid=type0.lookup(PDFName.of("DescendantFonts"),PDFArray).lookup(0,PDFDict);
    const descriptor=cid.lookup(PDFName.of("FontDescriptor"),PDFDict),fileRef=descriptor.get(PDFName.of("FontFile2")),file=parsed.context.lookup(fileRef);
    if(!(file instanceof PDFRawStream))throw new Error("font stream");
    if(!verifiedFontRefs.has(String(fileRef))){
     const digest=sha256(decodePDFRawStream(file).decode());
     if(![...fonts.values()].some(b=>sha256(b)===digest))throw new Error("embedded font bytes");
     embedded.add(digest);verifiedFontRefs.add(String(fileRef));
    }
    const unicode=parsed.context.lookup(type0.get(PDFName.of("ToUnicode")));if(!(unicode instanceof PDFRawStream)||!decodePDFRawStream(unicode).decode().length)throw new Error("Unicode CMap");
   }
   const xo=page.node.Resources()?.lookup(PDFName.of("XObject"),PDFDict);
   if((xo?.keys().length??0)!==imageCount)throw new Error("image count");
   for(const key of xo?.keys()??[]){const image=parsed.context.lookup(xo!.get(key));if(!(image instanceof PDFRawStream)||image.dict.get(PDFName.of("Subtype"))?.toString()!=="/Image")throw new Error("image object");}
   if(!page.node.Contents())throw new Error("page content");
  }
  if(embedded.size!==fonts.size)throw new Error("font substitution");
 }catch(cause){if(cause instanceof DocumentPdfError)throw cause;throw new DocumentPdfError("PDF_VALIDATION_FAILED",cause);}
}
