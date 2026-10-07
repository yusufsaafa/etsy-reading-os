import { create } from "fontkit";
import { PDFDocument, PDFName, PDFRef, PDFString } from "pdf-lib";
import type { ControlledFont, ShapedRun } from "../resources/fonts";
import { DocumentPdfError, PDF_LIMITS } from "./contract";

/** A CID is allocated per glyph + Unicode sequence, not per character. GSUB/marks remain exact. */
export function pdfFont(doc:PDFDocument,font:ControlledFont,bytes:Uint8Array,index:number) {
 const resource=create(Buffer.from(bytes));
 if(!("layout" in resource))throw new DocumentPdfError("FONT_EMBEDDING_FAILURE");
 const parsed=resource;
 const ref=doc.context.nextRef(),name=PDFName.of(`F${index}`);
 const entries:{id:number;codePoints:readonly number[]}[]=[],ids=new Map<string,number>();
 // Fontkit can cache a composite component glyph before assigning its code points.
 // Recover only mappings present in the exact retained font's own cmap, never replacement text.
 const cmap=new Map<number,readonly number[]>();
 for(const cp of parsed.characterSet){const id=parsed.glyphForCodePoint(cp).id;if(!cmap.has(id))cmap.set(id,[cp]);}
 function cid(g:ShapedRun["glyphs"][number]){
  const codePoints=g.codePoints.length?g.codePoints:cmap.get(g.id)??[];
  const key=`${g.id}:${codePoints.join(",")}`;
  let value=ids.get(key);
  if(value===undefined){
   if(entries.length>=PDF_LIMITS.cidsPerFont)throw new DocumentPdfError("GLYPH_RESOURCE_LIMIT");
   entries.push({id:g.id,codePoints});value=entries.length;ids.set(key,value);
  }
  return value.toString(16).padStart(4,"0");
 }
 function finish(){
  const ctx=doc.context,scale=1000/font.unitsPerEm;
  const file=ctx.register(ctx.flateStream(bytes,{Length1:bytes.length}));
  const descriptor=ctx.register(ctx.obj({Type:"FontDescriptor",FontName:parsed.postscriptName,
   Flags:font.metadata.fontKey==="source-serif-4"?34:32,FontBBox:[parsed.bbox.minX,parsed.bbox.minY,parsed.bbox.maxX,parsed.bbox.maxY].map(n=>n*scale),
   ItalicAngle:0,Ascent:font.ascent*scale,Descent:font.descent*scale,CapHeight:parsed.capHeight*scale,StemV:80,FontFile2:file}));
  const mapping=Buffer.alloc((entries.length+1)*2);
  entries.forEach((g,i)=>mapping.writeUInt16BE(g.id,(i+1)*2));
  const gidMap=ctx.register(ctx.flateStream(mapping));
  const widths=entries.map(g=>parsed.getGlyph(g.id).advanceWidth*scale);
  const descendant=ctx.register(ctx.obj({Type:"Font",Subtype:"CIDFontType2",BaseFont:parsed.postscriptName,
   CIDSystemInfo:{Registry:PDFString.of("Adobe"),Ordering:PDFString.of("Identity"),Supplement:0},FontDescriptor:descriptor,CIDToGIDMap:gidMap,DW:0,W:[1,widths]}));
  // Contextual glyphs without a Unicode mapping still paint exactly. ActualText is authoritative
  // for the logical source; do not invent U+FFFD or a character for an unmapped glyph.
  const mappings=entries.flatMap((g,i)=>g.codePoints.length?[`<${(i+1).toString(16).padStart(4,"0")}> <${utf16Hex(String.fromCodePoint(...g.codePoints))}>`]:[]);
  let cmap="/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /ReadingOSUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
  for(let i=0;i<mappings.length;i+=100){const batch=mappings.slice(i,i+100);cmap+=`${batch.length} beginbfchar\n${batch.join("\n")}\nendbfchar\n`;}
  cmap+="endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
  const unicode=ctx.register(ctx.flateStream(Buffer.from(cmap,"ascii")));
  ctx.assign(ref,ctx.obj({Type:"Font",Subtype:"Type0",BaseFont:parsed.postscriptName,Encoding:"Identity-H",DescendantFonts:[descendant],ToUnicode:unicode}));
 }
 return {ref:ref as PDFRef,name,font,cid,finish};
}
export function utf16Hex(text:string){
 const bytes=Buffer.from(text,"utf16le");bytes.swap16();return bytes.toString("hex").toUpperCase();
}
