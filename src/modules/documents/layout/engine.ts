import { z } from "zod";
import { stableJson } from "../../intake/contracts";
import { getCanonicalCard } from "../../media/catalog";
import { documentMediaSchema,renderInputSchema,immutableRenderInput, type DocumentRenderInput } from "../media-contract";
import { layoutTemplate,A4 } from "./templates";
import { wrapText,provisionalMetrics,type TextMeasurement,type Font } from "./measurement";
import { digest,layoutHash,immutableLayout,type LayoutValue,type LayoutElement,type DocumentLayout } from "./contract";
/** Server-only deterministic pure composition. Not an authorization boundary. */
export function composeDocumentLayout(raw:unknown,measurement:TextMeasurement=provisionalMetrics):DocumentLayout {
 const parsed=renderInputSchema.parse(raw),input=immutableRenderInput(parsed.snapshot,parsed.media);
 if(input.renderInputHash!==parsed.renderInputHash)throw new Error("RENDER_INPUT_HASH_MISMATCH");
 if(measurement.id!==provisionalMetrics.id||measurement.version!==1)throw new Error("MEASUREMENT_VERSION_UNAVAILABLE");
 // A retained id/version has one implementation; arbitrary injected metrics cannot masquerade as it.
 if(measurement!==provisionalMetrics)throw new Error("MEASUREMENT_PROVIDER_MISMATCH");
 const config=input.snapshot.design.configuration,t=layoutTemplate(input.snapshot.design.template.key,input.snapshot.design.template.version),width=A4.width-t.margin*2;
 const footerLines=config.display.footer&&config.footerText?wrapText(config.footerText,config.typography.body,7500,width-48000,measurement):[];
 const footerHeight=Math.max(t.footerZone,footerLines.length*9000+6000);
 z.number().int().max(100000).parse(footerHeight);
 const contentBox={x:t.margin,y:t.margin,width,height:A4.height-t.margin*2-footerHeight};
 const footerBox={x:t.margin,y:A4.height-t.margin-footerHeight,width,height:footerHeight};
 const pages:LayoutValue["pages"]=[];let y=t.margin;
 function page(archetype:LayoutValue["pages"][number]["archetype"]) {
  const value:LayoutValue["pages"][number]={number:pages.length+1,archetype,contentBox:{...contentBox},footerBox:{...footerBox},background:t.background,frame:t.frame,elements:[]};pages.push(value);y=t.margin;return value;
 }
 let current=page("COVER");
 const bottom=contentBox.y+contentBox.height;
 function textElement(text:string,role:Extract<LayoutElement,{kind:"TEXT"}>["role"],font:Font,size:number,lineHeight:number,x:number,w:number,sectionId?:string):Extract<LayoutElement,{kind:"TEXT"}> {
  const lines=wrapText(text,font,size,w,measurement);if(!lines.length)throw new Error("EMPTY_LAYOUT_TEXT");
  return {kind:"TEXT",role,text,lines,box:{x,y,width:w,height:lines.length*lineHeight},typography:{font,size,lineHeight,color:config.brand.primaryColor},...(sectionId?{sectionId}:{})};
 }
 function flowingText(text:string,role:Extract<LayoutElement,{kind:"TEXT"}>["role"],font:Font,size:number,lineHeight:number) {
  if(!text)return;
  const w=width-t.inset,lines=wrapText(text,font,size,w,measurement);let offset=0;
  while(offset<lines.length) {
   let capacity=Math.floor((bottom-y)/lineHeight);if(capacity<1){current=page("COVER");capacity=Math.floor(contentBox.height/lineHeight);}
   const taken=lines.slice(offset,offset+capacity),start=taken[0].start,end=taken.at(-1)!.end;
   const e=textElement(text.slice(start,end),role,font,size,lineHeight,t.margin+t.inset,w);current.elements.push(e);y+=e.box.height+t.gap;offset+=taken.length;
  }
 }
 if(config.cover==="BRAND")flowingText(config.brand.name,"BRAND",config.typography.heading,14000,18000);
 flowingText(input.snapshot.reading.product.name,"DISPLAY",config.typography.heading,t.displaySize,t.displaySize+6000);
 if(config.display.customerName)flowingText("Prepared for: "+input.snapshot.reading.order.customerName,"METADATA",config.typography.body,10000,14000);
 if(config.display.readingDate)flowingText("Approved: "+input.snapshot.reading.approvedAt.slice(0,10),"METADATA",config.typography.body,9000,12000);
 if(t.ornament!=="NONE"&&y+18000<=bottom){current.elements.push({kind:"ORNAMENT",box:{x:t.margin,y,width:width-t.inset,height:18000},token:t.ornament,color:config.brand.accentColor});y+=18000+t.gap;}
 const media=input.media.media;
 if(media.mode==="TAROT_CARDS"&&config.display.cardImagery) {
  current=page("MEDIA");const count=media.cards.length,cols=count===1?1:count===2?2:count===3?3:count===4?2:t.columns;
  const cellWidth=Math.floor((width-(cols-1)*t.gap)/cols),rowHeight=t.cardHeight+44000;
  if(rowHeight>contentBox.height||cellWidth<100000)throw new Error("IMPOSSIBLE_CARD_GRID");
  for(let row=0;row<count;row+=cols) {
   if(y+rowHeight>bottom)current=page("MEDIA");
   const rowCards=media.cards.slice(row,row+cols),rowWidth=rowCards.length*cellWidth+(rowCards.length-1)*t.gap;
   for(const [column,card] of rowCards.entries()) {
    const x=t.margin+Math.floor((width-rowWidth)/2)+column*(cellWidth+t.gap);
    const imageWidth=Math.min(cellWidth,Math.floor(t.cardHeight*card.asset.width/card.asset.height));
    const imageHeight=Math.min(t.cardHeight,Math.floor(cellWidth*card.asset.height/card.asset.width));
    if(imageWidth<50000||imageHeight<80000)throw new Error("IMPOSSIBLE_CARD_ASPECT_RATIO");
    const box={x,y,width:cellWidth,height:t.cardHeight};
    current.elements.push({kind:"CARD",position:card.position,label:getCanonicalCard(card.cardKey).label,box,image:{x:x+Math.floor((cellWidth-imageWidth)/2),y:y+Math.floor((t.cardHeight-imageHeight)/2),width:imageWidth,height:imageHeight}});
    const caption=getCanonicalCard(card.cardKey).label+" · "+card.orientation;
    const e=textElement(caption,"CAPTION",config.typography.body,8500,11000,x,cellWidth);e.box.y=y+t.cardHeight+6000;
    if(e.box.height>38000)throw new Error("CARD_CAPTION_OVERFLOW");current.elements.push(e);
   }
   y+=rowHeight+t.gap;
  }
 }
 current=page("READING");
 for(const section of input.snapshot.reading.sections) {
  const w=width-t.inset,lines=wrapText(section.content,config.typography.body,t.bodySize,w,measurement);
  const heading=textElement(section.title,"HEADING",config.typography.heading,t.headingSize,t.headingSize+5000,t.margin+t.inset,w,section.sectionId);
  const minimum=heading.box.height+t.gap+Math.min(2,lines.length)*t.lineHeight+(config.display.sectionDividers?5000:0);
  if(minimum>contentBox.height)throw new Error("HEADING_EXCEEDS_PAGE");
  if(y+minimum>bottom)current=page("READING");
  heading.box.y=y;current.elements.push(heading);y+=heading.box.height+t.gap;
  if(config.display.sectionDividers){current.elements.push({kind:"DIVIDER",box:{x:t.margin+t.inset,y,width:w,height:1000},color:config.brand.accentColor});y+=5000;}
  let offset=0;
  while(offset<lines.length) {
   let capacity=Math.floor((bottom-y)/t.lineHeight),remaining=lines.length-offset;
   if(capacity<Math.min(2,remaining)) {
    current=page("CONTINUATION");
    if(t.continuation){const e=textElement(section.title+" — continued","CONTINUATION",config.typography.heading,14000,18000,t.margin+t.inset,w,section.sectionId);current.elements.push(e);y+=e.box.height+t.gap;}
    capacity=Math.floor((bottom-y)/t.lineHeight);
   }
   let take=Math.min(capacity,remaining);
   // Prefer the last complete paragraph on this page, but never strand a single line.
   if(take<remaining) {
    for(let n=take;n>=2;n--) {if(/(?:\r?\n){2}$/.test(section.content.slice(0,lines[offset+n-1].end))&&remaining-n>=2){take=n;break;}}
    if(remaining-take===1&&take>2)take--;
   }
   if(take<1)throw new Error("PAGINATION_NO_PROGRESS");
   const part=lines.slice(offset,offset+take),start=part[0].start,end=part.at(-1)!.end;
   current.elements.push({kind:"BODY",sectionId:section.sectionId,start,end,text:section.content.slice(start,end),lines:part.map(l=>({start:l.start-start,end:l.end-start,width:l.width})),box:{x:t.margin+t.inset,y,width:w,height:take*t.lineHeight},typography:{font:config.typography.body,size:t.bodySize,lineHeight:t.lineHeight,color:config.brand.primaryColor}});
   y+=take*t.lineHeight;offset+=take;
   if(offset<lines.length)y=bottom; // Commit the selected paragraph/line break; never refill its remaining whitespace.
  }
  y+=t.gap;
 }
 if(y+8000<=bottom)current.elements.push({kind:"ORNAMENT",box:{x:t.margin+t.inset,y,width:width-t.inset,height:8000},token:"END_RULE",color:config.brand.accentColor});
 for(const p of pages) {
  const sections=new Set(p.elements.filter(e=>e.kind==="BODY").map(e=>e.kind==="BODY"?e.sectionId:""));if(sections.size>1)p.archetype="MULTI_SECTION";
  if(footerLines.length)p.elements.push({kind:"TEXT",role:"FOOTER",text:config.footerText,lines:footerLines,box:{x:t.margin,y:footerBox.y+3000,width:width-48000,height:footerLines.length*9000},typography:{font:config.typography.body,size:7500,lineHeight:9000,color:config.brand.primaryColor}});
  const number=String(p.number),lines=wrapText(number,config.typography.body,7500,36000,measurement);
  p.elements.push({kind:"TEXT",role:"PAGE_NUMBER",text:number,lines,box:{x:A4.width-t.margin-36000,y:footerBox.y+3000,width:36000,height:9000},typography:{font:config.typography.body,size:7500,lineHeight:9000,color:config.brand.primaryColor}});
 }
 const value:Omit<LayoutValue,"layoutHash">={contractVersion:"document-layout/v1",source:{renderInputHash:input.renderInputHash,snapshotHash:input.snapshot.snapshotHash,mediaHash:input.media.mediaHash},engineVersion:"reading-layout/1",measurement:{id:"controlled-advance",version:1,productionReady:false},template:{...t},pageSize:{unit:"MILLI_POINT",...A4},footerHeight,sections:input.snapshot.reading.sections.map(s=>({sectionId:s.sectionId,title:s.title,length:s.content.length,bodyHash:digest(s.content)})),media:documentMediaSchema.parse(media), pages};
 return immutableLayout({...value,layoutHash:layoutHash(value)});
}
/** Use when accepting a cached/untrusted layout: validate and compare full deterministic recreation. */
export function validateLayoutForInput(raw:unknown,input:DocumentRenderInput):DocumentLayout {
 const layout=immutableLayout(raw),expected=composeDocumentLayout(input);
 if(stableJson(layout)!==stableJson(expected))throw new Error("LAYOUT_SOURCE_MISMATCH");return layout;
}
