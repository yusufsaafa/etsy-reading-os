import { describe,it,expect } from "vitest";
import { PDFDocument, PDFArray, PDFRawStream, PDFName, PDFDict, decodePDFRawStream } from "pdf-lib";
import { pdfFixture } from "./pdf.fixture";
import { renderDocumentPdf, validatePdfBytes, pdfPoints } from "../src/modules/documents/pdf/renderer";
import { pdfResultSchema } from "../src/modules/documents/pdf/contract";
import { composeDocumentLayout } from "../src/modules/documents/layout/engine";
import { sha256 } from "../src/modules/documents/resources/bytes";
import { layoutHash, layoutSchema } from "../src/modules/documents/layout/contract";

async function opened(f:Awaited<ReturnType<typeof pdfFixture>>){const result=await renderDocumentPdf({layout:f.layout,resources:f.resources});return {result,doc:await PDFDocument.load(result.copyBytes(),{updateMetadata:false})};}
function streams(doc:PDFDocument){return doc.getPages().map(p=>{
 const contents=p.node.Contents();if(!(contents instanceof PDFArray))throw new Error("contents");
 return contents.asArray().map(ref=>{const s=doc.context.lookup(ref);if(!(s instanceof PDFRawStream))throw new Error("stream");return Buffer.from(decodePDFRawStream(s).decode()).toString("ascii");}).join("\n");
});}
function actualTexts(commands:string){return [...commands.matchAll(/\/ActualText <FEFF([A-F0-9]*)>/g)].map(m=>{const b=Buffer.from(m[1],"hex");b.swap16();return b.toString("utf16le");});}

describe("deterministic PDF painter",()=>{
 it("strict result, header, reopen, physical geometry and private detached bytes",async()=>{
  const f=await pdfFixture(0),{result,doc}=await opened(f);
  expect(pdfResultSchema.parse(result.metadata)).toEqual(result.metadata);
  expect(()=>pdfResultSchema.parse({...result.metadata,url:"https://evil.invalid"})).toThrow();
  expect(doc.getPageCount()).toBe(f.layout.pages.length);
  for(const p of doc.getPages()){expect(p.getWidth()).toBe(pdfPoints(f.layout.pageSize.width));expect(p.getHeight()).toBe(pdfPoints(f.layout.pageSize.height));}
  const b=result.copyBytes();expect(Buffer.from(b.subarray(0,8)).toString()).toBe("%PDF-1.7");b.fill(0);
  expect(sha256(result.copyBytes())).toBe(result.metadata.sha256);expect(Object.isFrozen(result.metadata)).toBe(true);
 });
 it("same verified input repeats identical bytes and deterministic metadata/ID without time",async()=>{
  const f=await pdfFixture(3),a=await renderDocumentPdf({layout:f.layout,resources:f.resources}),b=await renderDocumentPdf({layout:f.layout,resources:f.resources}),c=await renderDocumentPdf({layout:f.layout,resources:f.resources});
  expect(a.metadata.sha256).toBe(b.metadata.sha256);expect(b.copyBytes()).toEqual(c.copyBytes());
  const doc=await PDFDocument.load(a.copyBytes(),{updateMetadata:false});expect(doc.getCreationDate()).toBeUndefined();expect(doc.getModificationDate()).toBeUndefined();expect(doc.context.trailerInfo.ID).toBeDefined();
 });
 it("rejects provisional metrics, unknown fields, renderer version and forged resource instances",async()=>{
  const f=await pdfFixture(0);
  await expect(renderDocumentPdf({layout:composeDocumentLayout(f.input),resources:f.resources})).rejects.toThrow("LAYOUT_NOT_PRODUCTION_READY");
  for(const payload of [{layout:f.layout,resources:f.resources,url:"x"},{layout:f.layout,resources:f.resources,rendererVersion:"other/1"},{layout:f.layout,resources:{...f.resources}}])await expect(renderDocumentPdf(payload)).rejects.toThrow();
 });
 it("rejects layout hash/measurement/geometry/font/primitive corruption and resource substitution",async()=>{
  const f=await pdfFixture(1);
  for(const mutate of [(v:any)=>{v.layoutHash="0".repeat(64);},(v:any)=>{v.measurement.resourceHash="0".repeat(64);},(v:any)=>{v.pages[0].elements[0].box.x=-1;},(v:any)=>{v.pages[0].elements[0].kind="SVG";},(v:any)=>{v.pages[0].elements[0].typography.font="host-font";}]){
   const v=structuredClone(f.layout);mutate(v);await expect(renderDocumentPdf({layout:v,resources:f.resources})).rejects.toThrow();
  }
  const other=await pdfFixture(1,"mystic","jpeg");await expect(renderDocumentPdf({layout:f.layout,resources:other.resources})).rejects.toThrow("LAYOUT_RESOURCE_MISMATCH");
  const v=layoutSchema.parse(f.layout);v.pages[0].elements.find(e=>e.kind==="TEXT")!.text="forged";v.layoutHash=layoutHash(v);await expect(renderDocumentPdf({layout:v,resources:f.resources})).rejects.toThrow();
 });
 it("embeds exact retained full TTF bytes, normal/400 only, and Unicode CMaps",async()=>{
  const f=await pdfFixture(0),{doc}=await opened(f),fonts=doc.getPages()[0].node.Resources()!.lookup(PDFName.of("Font"),PDFDict);
  for(const [i,font] of f.resources.fonts.entries()){
   const type0=fonts.lookup(PDFName.of(`F${i}`),PDFDict),cid=type0.lookup(PDFName.of("DescendantFonts"),PDFArray).lookup(0,PDFDict),descriptor=cid.lookup(PDFName.of("FontDescriptor"),PDFDict);
   const file=doc.context.lookup(descriptor.get(PDFName.of("FontFile2"))) as PDFRawStream;
   expect(sha256(decodePDFRawStream(file).decode())).toBe(font.metadata.sha256);expect(font.metadata.weight).toBe(400);
   expect(type0.get(PDFName.of("ToUnicode"))).toBeDefined();expect(cid.get(PDFName.of("CIDToGIDMap"))).toBeDefined();
   const unicode=doc.context.lookup(type0.get(PDFName.of("ToUnicode"))) as PDFRawStream;
   expect(Buffer.from(decodePDFRawStream(unicode).decode()).toString("ascii")).not.toContain("> <FFFD>");
  }
 });
 it("preserves exact line source/order, Turkish/accented Latin/ligatures/marks/tabs and long continuation",async()=>{
  const body=("ğ Ğ ş Ş ı İ ç Ç ö Ö ü Ü café naïve office affine e\u0301\tAV. ").repeat(160)+"\n\nExact final paragraph.";
  const f=await pdfFixture(0,"luxury-editorial","png",[body,"Short second section."]),{doc}=await opened(f);
  const commands=streams(doc);expect(commands).toHaveLength(f.layout.pages.length);
  for(const [i,p] of f.layout.pages.entries()){
   const expected=p.elements.flatMap(e=>e.kind==="TEXT"||e.kind==="BODY"?e.lines.map(l=>e.text.slice(l.start,l.end)):[]);
   expect(actualTexts(commands[i])).toEqual(expected);
   expect(commands[i].match(/ Tm </g)?.length??0).toBe(p.elements.reduce((sum,e)=>sum+(e.kind==="TEXT"||e.kind==="BODY"?e.lines.reduce((n,l)=>n+f.resources.fonts.find(font=>font.metadata.fontKey===e.typography.font)!.shape(e.text.slice(l.start,l.end)).glyphs.length,0):0),0));
  }
  expect(f.layout.pages.some(p=>p.archetype==="CONTINUATION")).toBe(true);
  expect(f.layout.pages.flatMap(p=>p.elements.flatMap(e=>e.kind==="BODY"&&e.sectionId==="section-0"?[e.text]:[])).join("")).toBe(body);
 });
 it("glyph matrices exactly follow advances, baseline, offsets and inkLeft",async()=>{
  const f=await pdfFixture(0,"classic","png",["AV office e\u0301 ğ Ÿ punctuation?!"]),{doc}=await opened(f),commands=streams(doc);
  for(const [i,p] of f.layout.pages.entries()){
   const matrices=[...commands[i].matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)].map(m=>[+m[1],+m[2]]);let index=0;
   for(const e of p.elements)if(e.kind==="TEXT"||e.kind==="BODY"){
    const font=f.resources.fonts.find(a=>a.metadata.fontKey===e.typography.font)!,scale=e.typography.size/font.unitsPerEm/1000;
    for(const [li,line] of e.lines.entries()){
     const run=font.shape(e.text.slice(line.start,line.end)),base=pdfPoints(f.layout.pageSize.height-e.box.y-li*e.typography.lineHeight)-font.ascent*scale;let x=0,y=0;
     for(const g of run.glyphs){expect(matrices[index][0]).toBeCloseTo(pdfPoints(e.box.x)+(x+g.xOffset-run.inkLeft)*scale,5);expect(matrices[index++][1]).toBeCloseTo(base+(y+g.yOffset)*scale,5);x+=g.xAdvance;y+=g.yAdvance;}
    }
   }
   expect(index).toBe(matrices.length);
  }
 });
 it("packs short sections and paints long footer exactly in its reserved geometry",async()=>{
  const footer="Synthetic approved footer. ".repeat(7),f=await pdfFixture(0,"classic","png",["First short approved section.","Second short approved section."],true,footer),{doc}=await opened(f);
  expect(f.layout.pages.some(p=>p.elements.filter(e=>e.kind==="BODY").length===2)).toBe(true);
  for(const [i,p] of f.layout.pages.entries()){
   const e=p.elements.find(e=>e.kind==="TEXT"&&e.role==="FOOTER");expect(e?.kind).toBe("TEXT");
   if(e?.kind==="TEXT"){expect(e.text).toBe(footer);expect(e.box.y+e.box.height).toBeLessThanOrEqual(p.footerBox.y+p.footerBox.height);for(const line of e.lines)expect(actualTexts(streams(doc)[i])).toContain(e.text.slice(line.start,line.end));}
  }
 });
 it("PDF commands/URLs are hex text only; unsupported scripts cannot acquire production layout",async()=>{
  const body="/JavaScript /JS (not a command) https://synthetic.invalid <script> exact approved text",f=await pdfFixture(0,"classic","png",[body]),{doc}=await opened(f);
  expect(streams(doc).join("")).not.toContain(body);expect(actualTexts(streams(doc).join("\n")).join("")).toContain(body);
  await expect(pdfFixture(0,"classic","png",["مرحبا"])).rejects.toThrow();await expect(pdfFixture(0,"classic","png",["😀"])).rejects.toThrow();
 });
 it.each([1,2,3,4,5,6,7,8,9,10])("renders %i cards without extra pages or changes to card geometry",async count=>{
  const f=await pdfFixture(count),{doc}=await opened(f),commands=streams(doc);
  expect(doc.getPageCount()).toBe(f.layout.pages.length);
  for(const [i,p] of f.layout.pages.entries()){
   const painted=[...commands[i].matchAll(/q (-?[\d.]+) 0 0 (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm \/I\d+ Do Q/g)];
   const slots=p.elements.filter(e=>e.kind==="CARD");expect(painted.length).toBe(slots.length);
   for(const [j,slot] of slots.entries()){
    const reversed=slot.position%2===1,a=slot.image;
    expect(painted[j].slice(1).map(Number)).toEqual([pdfPoints(a.width)*(reversed?-1:1),pdfPoints(a.height)*(reversed?-1:1),pdfPoints(a.x+(reversed?a.width:0)),pdfPoints(f.layout.pageSize.height-a.y-(reversed?0:a.height))]);
   }
  }
  if(count===10)expect(f.layout.pages.filter(p=>p.archetype==="MEDIA").length).toBeGreaterThan(1);
 });
 it.each(["png","jpeg","webp"] as const)("embeds verified %s at frozen dimensions",async format=>{
  const f=await pdfFixture(2,"tarot-atelier",format),{doc}=await opened(f);expect(doc.getPageCount()).toBe(f.layout.pages.length);
 });
 it("imagery OFF has no image reads/resources/operators while semantic cards remain",async()=>{
  const f=await pdfFixture(3,"mystic","png",undefined,false),{doc}=await opened(f);
  expect(f.reads).toBe(0);expect(f.layout.media.mode).toBe("TAROT_CARDS");expect(f.resources.images).toHaveLength(0);expect(streams(doc).join("")).not.toMatch(/ Do /);
 });
 it.each(["mystic","luxury-editorial","minimal","tarot-atelier","classic","modern"])("paints all %s template primitives with one engine",async template=>{
  const f=await pdfFixture(0,template),{doc}=await opened(f),s=streams(doc).join("\n");expect(s).toContain(" re f");
  expect(s).toContain("/ActualText");if(f.layout.pages[0].frame!=="NONE")expect(s).toContain(" re S");
 });
 it("rejects malformed/oversized/reopened page count and dimensions",async()=>{
  const f=await pdfFixture(0),{result,doc}=await opened(f),fonts=new Map(f.resources.fonts.map(a=>[a.metadata.fontKey,a.copyBytes()]));
  await expect(validatePdfBytes(new Uint8Array([1,2,3]),f.layout,fonts,0)).rejects.toThrow("PDF_VALIDATION_FAILED");
  doc.addPage();await expect(validatePdfBytes(await doc.save({useObjectStreams:false}),f.layout,fonts,0)).rejects.toThrow("PDF_PAGE_COUNT_MISMATCH");
  doc.removePage(doc.getPageCount()-1);doc.getPages()[0].setSize(10,20);await expect(validatePdfBytes(await doc.save({useObjectStreams:false}),f.layout,fonts,0)).rejects.toThrow("PDF_PAGE_DIMENSION_MISMATCH");
 });
});
