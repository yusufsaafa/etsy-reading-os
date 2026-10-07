import { z } from "zod";
export const fontSchema=z.enum(["inter","source-serif-4"]);
export type Font=z.infer<typeof fontSchema>;
export type MeasuredLine=Readonly<{start:number;end:number;width:number}>;
/** Server-owned port. Units are integer milli-points; offsets are UTF-16 code units. */
export interface TextMeasurement {
 readonly id:string; readonly version:number;
 measure(text:string,font:Font,size:number):number;
}
// Explicit provisional advance metrics, NOT production font binary metrics or shaping.
// Unicode categories are fixed ranges, not host/browser/font-dependent measurements.
export const provisionalMetrics:TextMeasurement=Object.freeze({
 id:"controlled-advance",version:1,
 measure(text:string,font:Font,size:number) {
  fontSchema.parse(font);z.number().int().positive().max(64000).parse(size);
  let advance=0;
  for(const c of text) {
   const code=c.codePointAt(0)!;
   const units=/[\r\n]/.test(c)?0:c==="\t"?1120:c===" "?280:
    (code>=0x300&&code<=0x36f)||(code>=0xfe00&&code<=0xfe0f)||code===0x200d?0:
    code>=0x2e80?1000:/[ilI.,'!:;|]/.test(c)?280:/[mwMW@%]/.test(c)?850:/[A-Z]/.test(c)?660:550;
   advance+=units;
  }
  return Math.ceil(advance*size*(font==="source-serif-4"?102:100)/100000);
 }
});
export function checkedMeasure(provider:TextMeasurement,text:string,font:Font,size:number) {
 const width=provider.measure(text,font,size);
 if(!Number.isSafeInteger(width)||width<0||width>100000000)throw new Error("INVALID_TEXT_MEASUREMENT");
 return width;
}
/** Greedy whitespace breaks, then code-point-safe emergency breaks. Never discards bytes. */
export function wrapText(text:string,font:Font,size:number,width:number,provider:TextMeasurement):MeasuredLine[] {
 if(!Number.isSafeInteger(width)||width<=0)throw new Error("INVALID_TEXT_WIDTH");
 const lines:MeasuredLine[]=[];let start=0,end=0,lastBreak=0,advance=0;
 while(end<text.length) {
  const cp=text.codePointAt(end)!,char=String.fromCodePoint(cp),next=end+char.length;
  if(char==="\r"||char==="\n") {
   const finish=char==="\r"&&text[next]==="\n"?next+1:next;
   lines.push({start,end:finish,width:checkedMeasure(provider,text.slice(start,finish),font,size)});start=end=finish;lastBreak=finish;advance=0;continue;
  }
  const delta=checkedMeasure(provider,char,font,size);
  if(advance+delta>width) {
   if(end===start)throw new Error("GLYPH_EXCEEDS_TEXT_BOX");
   const finish=lastBreak>start?lastBreak:end;
   lines.push({start,end:finish,width:checkedMeasure(provider,text.slice(start,finish),font,size)});
   start=end=finish;lastBreak=finish;advance=0;continue;
  }
  advance+=delta;end=next;if(char===" "||char==="\t")lastBreak=end;
 }
 if(start<text.length)lines.push({start,end:text.length,width:checkedMeasure(provider,text.slice(start),font,size)});
 return lines;
}
