/** Offline synthetic QA only. No DB, AI, storage, delivery or production artifact writes. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pdfFixture } from "../tests/pdf.fixture";
import { renderDocumentPdf } from "../src/modules/documents/pdf/renderer";
const output=process.argv[2];if(!output)throw new Error("Pass an explicit synthetic QA output directory");
await mkdir(output,{recursive:true});
const cases=[
 {name:"mystic",template:"mystic",count:3},
 {name:"luxury-editorial",template:"luxury-editorial",count:0},
 {name:"minimal",template:"minimal",count:0},
 {name:"tarot-atelier",template:"tarot-atelier",count:10},
 {name:"classic",template:"classic",count:1},
 {name:"modern",template:"modern",count:0},
];
const body="ğ Ğ ş Ş ı İ ç Ç ö Ö ü Ü — café naïve office affine e\u0301. Exact approved synthetic reading. ";
for(const c of cases){
 const f=await pdfFixture(c.count,c.template,"png",[body.repeat(120),"Short final approved section."]);
 const result=await renderDocumentPdf({layout:f.layout,resources:f.resources});
 const glyphs=[];
 for(const [pi,p] of f.layout.pages.entries())for(const e of p.elements)if(e.kind==="TEXT"||e.kind==="BODY"){
  const font=f.resources.fonts.find(a=>a.metadata.fontKey===e.typography.font)!,scale=e.typography.size/font.unitsPerEm/1000;
  for(const [li,line] of e.lines.entries()){
   const run=font.shape(e.text.slice(line.start,line.end));let x=0,y=0;
   for(const g of run.glyphs){glyphs.push({page:pi,font:font.metadata.filename.slice(0,-4),size:e.typography.size/1000,gid:g.id,
    x:e.box.x/1000+(x+g.xOffset-run.inkLeft)*scale,y:(e.box.y+li*e.typography.lineHeight)/1000+font.ascent*scale-(y+g.yOffset)*scale});x+=g.xAdvance;y+=g.yAdvance;}
  }
 }
 await writeFile(resolve(output,c.name+".pdf"),result.copyBytes());
 await writeFile(resolve(output,c.name+".json"),JSON.stringify({metadata:result.metadata,layout:f.layout,glyphs},null,2));
 console.log(c.name,result.metadata.pageCount,result.metadata.sha256);
}
