import { createHash } from "node:crypto";
import { z } from "zod";
import { stableJson } from "../../intake/contracts";
import { detached,hashSchema } from "../../media/contracts";
import { documentMediaHash,documentMediaSchema } from "../media-contract";
import { semanticCardsSchema } from "../../media/reading-contract";
import { getCanonicalCard } from "../../media/catalog";
import { fontSchema,wrapText,provisionalMetrics,type TextMeasurement } from "./measurement";
import { A4,layoutTemplate,templateDefinitionSchema } from "./templates";
import { measurementDescriptorSchema,requireMeasurement } from "../resources/measurement";
const unit=z.number().int().nonnegative().max(1000000);
export const boxSchema=z.strictObject({x:unit,y:unit,width:unit.refine(n=>n>0),height:unit.refine(n=>n>0)});
const typography=z.strictObject({font:fontSchema,size:z.number().int().min(7500).max(64000),lineHeight:z.number().int().min(7500).max(100000),color:z.string().regex(/^#[A-F0-9]{6}$/)});
const line=z.strictObject({start:z.number().int().nonnegative(),end:z.number().int().positive(),width:unit});
const textBase={box:boxSchema,text:z.string().max(40000),lines:z.array(line).min(1).max(10000),typography};
export const elementSchema=z.discriminatedUnion("kind",[
 z.strictObject({kind:z.literal("TEXT"),...textBase,role:z.enum(["DISPLAY","BRAND","METADATA","HEADING","CONTINUATION","CAPTION","FOOTER","PAGE_NUMBER"]),sectionId:z.string().max(100).optional()}),
 z.strictObject({kind:z.literal("BODY"),...textBase,sectionId:z.string().min(1).max(100),start:z.number().int().nonnegative(),end:z.number().int().positive()}),
 z.strictObject({kind:z.literal("CARD"),box:boxSchema,image:boxSchema,position:z.number().int().min(0).max(9),label:z.string().max(100)}),
 z.strictObject({kind:z.literal("DIVIDER"),box:boxSchema,color:z.string().regex(/^#[A-F0-9]{6}$/)}),
 z.strictObject({kind:z.literal("ORNAMENT"),box:boxSchema,token:z.enum(["CELESTIAL","EDITORIAL","END_RULE"]),color:z.string().regex(/^#[A-F0-9]{6}$/)}),
]);
export const layoutSchema=z.strictObject({
 contractVersion:z.literal("document-layout/v1"),source:z.strictObject({renderInputHash:hashSchema,snapshotHash:hashSchema,mediaHash:hashSchema}),
 engineVersion:z.literal("reading-layout/1"),measurement:measurementDescriptorSchema,
 template:templateDefinitionSchema,pageSize:z.strictObject({unit:z.literal("MILLI_POINT"),width:z.literal(A4.width),height:z.literal(A4.height)}),
 sections:z.array(z.strictObject({sectionId:z.string().min(1).max(100),title:z.string().min(1).max(200),length:z.number().int().positive().max(40000),bodyHash:hashSchema})).min(1).max(20),
 media:documentMediaSchema,footerHeight:z.number().int().min(34016).max(100000),
 pages:z.array(z.strictObject({number:z.number().int().positive(),archetype:z.enum(["COVER","MEDIA","READING","CONTINUATION","MULTI_SECTION"]),contentBox:boxSchema,footerBox:boxSchema,background:z.enum(["IVORY","PARCHMENT","WHITE"]),frame:z.enum(["NONE","ANTIQUE","RULE"]),elements:z.array(elementSchema).min(1).max(1000)})).min(2).max(1000),layoutHash:hashSchema,
});
export type LayoutValue=z.infer<typeof layoutSchema>;
export type LayoutElement=z.infer<typeof elementSchema>;
export function digest(value:string) {return createHash("sha256").update(value).digest("hex");}
/** Exact resolved pages/styles/lines/content + source hashes + versions. No IDs or clock. */
export function layoutHash(value:Omit<LayoutValue,"layoutHash">|LayoutValue) {const {layoutHash:ignored,...semantic}=value as LayoutValue;return digest(stableJson(semantic));}
function inside(a:z.infer<typeof boxSchema>,b:z.infer<typeof boxSchema>) {return a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;}
function overlaps(a:z.infer<typeof boxSchema>,b:z.infer<typeof boxSchema>) {return a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;}
export function immutableLayout(raw:unknown,measurement:TextMeasurement=provisionalMetrics) {
 try {
  if(Buffer.byteLength(stableJson(raw))>5000000)throw new Error("LAYOUT_SIZE_BOUND");
  const v=layoutSchema.parse(raw),t=layoutTemplate(v.template.key,v.template.version);
  requireMeasurement(v.measurement,measurement);
  if(stableJson(t)!==stableJson(v.template)||layoutHash(v)!==v.layoutHash)throw new Error("LAYOUT_TEMPLATE_OR_HASH");
  if(digest(stableJson({snapshotHash:v.source.snapshotHash,mediaHash:v.source.mediaHash}))!==v.source.renderInputHash)throw new Error("LAYOUT_SOURCE_HASH");
  if(documentMediaHash(v.media)!==v.source.mediaHash)throw new Error("LAYOUT_MEDIA_HASH");
  if(v.media.mode==="TAROT_CARDS")semanticCardsSchema.parse(v.media.cards.map(({cardKey,orientation,position})=>({cardKey,orientation,position})));
  if(new Set(v.sections.map(s=>s.sectionId)).size!==v.sections.length)throw new Error("LAYOUT_DUPLICATE_SECTION");
  const bodies=new Map(v.sections.map(s=>[s.sectionId,{text:"",heading:false}]));let sectionIndex=0;
  const positions:number[]=[];
  for(const [index,page] of v.pages.entries()) {
   if(page.number!==index+1||page.background!==t.background||page.frame!==t.frame)throw new Error("LAYOUT_PAGE_ORDER_STYLE");
   const expected={x:t.margin,y:t.margin,width:A4.width-t.margin*2,height:A4.height-t.margin*2-v.footerHeight};
   const footer={x:t.margin,y:A4.height-t.margin-v.footerHeight,width:expected.width,height:v.footerHeight};
   if(stableJson(page.contentBox)!==stableJson(expected)||stableJson(page.footerBox)!==stableJson(footer)||overlaps(page.contentBox,page.footerBox))throw new Error("LAYOUT_RESERVED_ZONES");
   const substantive:LayoutElement[]=[];
   for(const e of page.elements) {
    const isFooter=e.kind==="TEXT"&&(e.role==="FOOTER"||e.role==="PAGE_NUMBER");
    if(!inside(e.box,isFooter?footer:expected))throw new Error("LAYOUT_ELEMENT_BOUNDS");
    if(substantive.some(other=>overlaps(e.box,other.box)))throw new Error("LAYOUT_ELEMENT_OVERLAP");substantive.push(e);
    if(e.kind==="TEXT"||e.kind==="BODY") {
     if(v.measurement.id==="controlled-advance" && e.typography.lineHeight>80000)throw new Error("LAYOUT_LINE_HEIGHT");
     if(measurement.lineHeight && e.typography.lineHeight<measurement.lineHeight(e.typography.font,e.typography.size))throw new Error("LAYOUT_FONT_LINE_HEIGHT");
     if(e.box.height!==e.lines.length*e.typography.lineHeight||e.typography.lineHeight<e.typography.size)throw new Error("LAYOUT_LINE_HEIGHT");
     let offset=0;for(const l of e.lines){if(l.start!==offset||l.end<=l.start||l.end>e.text.length||l.width>e.box.width)throw new Error("LAYOUT_LINE_RANGE");offset=l.end;}if(offset!==e.text.length)throw new Error("LAYOUT_TEXT_COVERAGE");
     if(stableJson(wrapText(e.text,e.typography.font,e.typography.size,e.box.width,measurement))!==stableJson(e.lines))throw new Error("LAYOUT_LINE_MEASUREMENT");
     if(e.kind==="TEXT"&&(e.role==="HEADING"||e.role==="CONTINUATION")) {
      const s=v.sections.find(s=>s.sectionId===e.sectionId);if(!s)throw new Error("LAYOUT_SECTION_REFERENCE");
      if(e.role==="HEADING"){if(e.text!==s.title||bodies.get(s.sectionId)!.heading)throw new Error("LAYOUT_SECTION_HEADING");bodies.get(s.sectionId)!.heading=true;}
      const next=page.elements.slice(page.elements.indexOf(e)+1).find(x=>x.kind==="BODY");if(!next||next.kind!=="BODY"||next.sectionId!==s.sectionId||next.lines.length<1)throw new Error("LAYOUT_HEADING_BODY");
     }
    }
    if(e.kind==="BODY") {
     while(sectionIndex<v.sections.length&&v.sections[sectionIndex].sectionId!==e.sectionId) {
      const prior=v.sections[sectionIndex];if(bodies.get(prior.sectionId)!.text.length!==prior.length)throw new Error("LAYOUT_SECTION_ORDER");sectionIndex++;
     }
     const body=bodies.get(e.sectionId);if(!body||!body.heading||e.start!==body.text.length||e.end-e.start!==e.text.length)throw new Error("LAYOUT_BODY_RANGE");body.text+=e.text;
    }
    if(e.kind==="CARD") {
     if(v.media.mode!=="TAROT_CARDS"||!inside(e.image,e.box))throw new Error("LAYOUT_CARD_BOUNDS");
     const card=v.media.cards[e.position];if(!card||getCanonicalCard(card.cardKey).label!==e.label)throw new Error("LAYOUT_CARD_IDENTITY");positions.push(e.position);
    }
   }
  }
  for(const s of v.sections){const b=bodies.get(s.sectionId)!;if(!b.heading||b.text.length!==s.length||digest(b.text)!==s.bodyHash)throw new Error("LAYOUT_BODY_INTEGRITY");}
  if(positions.length&& (v.media.mode!=="TAROT_CARDS"||positions.length!==v.media.cards.length||positions.some((p,i)=>p!==i)))throw new Error("LAYOUT_CARD_ORDER");
  return detached(v);
 }catch(cause){throw new Error("DOCUMENT_LAYOUT_UNAVAILABLE",{cause});}
}
export type DocumentLayout=ReturnType<typeof immutableLayout>;
