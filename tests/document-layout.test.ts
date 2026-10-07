import { it,expect } from "vitest";
import { composeDocumentLayout,validateLayoutForInput } from "../src/modules/documents/layout/engine";
import { immutableLayout,layoutHash } from "../src/modules/documents/layout/contract";
import { provisionalMetrics,wrapText } from "../src/modules/documents/layout/measurement";
import { configurationHash } from "../src/modules/documents/contracts";
import { documentSnapshotHash } from "../src/modules/documents/snapshot-contract";
import { documentMediaHash,renderInputHash } from "../src/modules/documents/media-contract";
import { layoutFixture } from "./layout.fixture";
function hashInput(v:any) {v.snapshot.design.configurationHash=configurationHash(v.snapshot.design.configuration);v.snapshot.snapshotHash=documentSnapshotHash(v.snapshot);v.media.mediaHash=documentMediaHash(v.media.media);v.renderInputHash=renderInputHash(v.snapshot.snapshotHash,v.media.mediaHash);return v;}
function body(layout:ReturnType<typeof composeDocumentLayout>,id:string) {return layout.pages.flatMap(p=>p.elements).filter(e=>e.kind==="BODY"&&e.sectionId===id).map(e=>e.kind==="BODY"?e.text:"").join("");}
it("same immutable input gives exact stable frozen layout without clocks, IDs or mutable settings",()=>{
 const input=layoutFixture(),a=composeDocumentLayout(input);expect(composeDocumentLayout(input)).toEqual(a);expect(Object.isFrozen(a.pages[0].elements)).toBe(true);const other=structuredClone(input);other.snapshot.createdAt="2026-10-08T00:00:00.000Z";other.media.createdAt=other.snapshot.createdAt;expect(composeDocumentLayout(other)).toEqual(a);expect(a.pageSize).toEqual({unit:"MILLI_POINT",width:595276,height:841890});expect(a.measurement.productionReady).toBe(false);expect(validateLayoutForInput(a,input)).toEqual(a);
});
it.each(["classic","mystic","minimal","modern","luxury-editorial","tarot-atelier"])("retained/additive template %s uses shared engine and exact text",template=>{
 const input=layoutFixture(template),l=composeDocumentLayout(input);expect(l.template.key).toBe(template);input.snapshot.reading.sections.forEach(s=>expect(body(l,s.sectionId)).toBe(s.content));expect(l.pages.some(p=>p.archetype==="MULTI_SECTION")).toBe(true);
});
it("representative definitions give intentionally different geometry/art direction",()=>{
 const layouts=["mystic","luxury-editorial","minimal","tarot-atelier"].map(k=>composeDocumentLayout(layoutFixture(k)));
 expect(new Set(layouts.map(l=>JSON.stringify(l.template))).size).toBe(4);expect(new Set(layouts.map(l=>l.engineVersion)).size).toBe(1);expect(layouts[0].pages[0].frame).toBe("ANTIQUE");expect(layouts[1].template.inset).toBeGreaterThan(0);expect(layouts[2].pages[0].frame).toBe("NONE");expect(layouts[3].template.columns).toBe(2);
});
it.each([150,500,1500,5000])("paginates %s-word section with exact reconstruction and safe headings/continuations",words=>{
 const text=Array.from({length:words},(_,i)=>i%57===0?"\n\nUnicode 猫 🐾 e\u0301 ":"word ").join("")+"\r\nFinal exact line.";
 const input=layoutFixture("minimal",0,[text,"Short second section"]),l=composeDocumentLayout(input);expect(body(l,"section-0")).toBe(text);if(words>=1500)expect(l.pages.filter(p=>p.archetype==="CONTINUATION").length).toBeGreaterThan(0);expect(immutableLayout(l)).toEqual(l);
 for(const p of l.pages)for(const e of p.elements)if(e.kind==="BODY"){expect(e.box.y+e.box.height).toBeLessThanOrEqual(p.contentBox.y+p.contentBox.height);if(e.sectionId==="section-0")expect(e.lines.length).toBeGreaterThanOrEqual(2);}
});
it.each([1,2,3,4,5,6,7,8,9,10])("adaptive %s-card arrangement preserves exact frozen evidence",count=>{
 const input=layoutFixture("tarot-atelier",count),l=composeDocumentLayout(input);expect(l.media).toEqual(input.media.media);const slots=l.pages.flatMap(p=>p.elements).filter(e=>e.kind==="CARD");expect(slots.map(e=>e.kind==="CARD"?e.position:-1)).toEqual(Array.from({length:count},(_,i)=>i));if(count>=5)expect(l.pages.filter(p=>p.archetype==="MEDIA").length).toBeGreaterThan(1);expect(immutableLayout(l)).toEqual(l);
});
it("NONE has no fabricated media page; imagery OFF preserves semantic cards and hashes",()=>{
 expect(composeDocumentLayout(layoutFixture()).pages.some(p=>p.archetype==="MEDIA")).toBe(false);
 const input=structuredClone(layoutFixture("mystic",3));input.snapshot.design.configuration.display.cardImagery=false;hashInput(input);const l=composeDocumentLayout(input);expect(l.media).toEqual(input.media.media);expect(l.pages.flatMap(p=>p.elements).some(e=>e.kind==="CARD")).toBe(false);
});
it("measurement uses font advances, respects explicit newlines and preserves Unicode/long tokens",()=>{
 expect(provisionalMetrics.measure("WWW","inter",11000)).toBeGreaterThan(provisionalMetrics.measure("iii","inter",11000));for(const text of ["a  b\r\n\n猫🐾e\u0301", "X".repeat(1000)]) {const lines=wrapText(text,"inter",11000,80000,provisionalMetrics);expect(lines.map(l=>text.slice(l.start,l.end)).join("")).toBe(text);expect(lines.every(l=>l.width<=80000)).toBe(true);}
});
it("long footer expands reservation rather than clipping body, and long cover metadata flows",()=>{
 const input=structuredClone(layoutFixture());input.snapshot.design.configuration.footerText="W".repeat(500);input.snapshot.reading.order.customerName="Long synthetic name ".repeat(45);input.snapshot.reading.product.name="Long synthetic product ".repeat(40);hashInput(input);const l=composeDocumentLayout(input);expect(l.footerHeight).toBeGreaterThan(34016);expect(l.pages.filter(p=>p.archetype==="COVER").length).toBeGreaterThan(1);expect(l.pages.every(p=>p.elements.some(e=>e.kind==="TEXT"&&e.role==="FOOTER"&&e.text===input.snapshot.design.configuration.footerText))).toBe(true);
});
it.each(["unknown","geometry","font","template","version","measurement","hash","overlap","missing","media"])("corrupt layout %s fails closed even with recomputed hash",kind=>{
 const input=layoutFixture("mystic",3),v=structuredClone(composeDocumentLayout(input)) as any;
 if(kind==="unknown")v.html="<b>unsafe</b>";if(kind==="geometry")v.pages[0].elements[0].box.x=-1;if(kind==="font")v.pages[0].elements[0].typography.font="Bodoni";if(kind==="template")v.template.key="fake";if(kind==="version")v.template.version=99;if(kind==="measurement")v.measurement.version=2;if(kind==="hash")v.layoutHash="0".repeat(64);if(kind==="overlap")v.pages[0].elements[1].box.y=v.pages[0].elements[0].box.y;if(kind==="missing")v.pages=v.pages.filter((p:any)=>p.archetype!=="READING"&&p.archetype!=="MULTI_SECTION");if(kind==="media")v.media.cards[0].orientation="SIDEWAYS";
 if(kind!=="hash")v.layoutHash=layoutHash(v);expect(()=>immutableLayout(v)).toThrow("DOCUMENT_LAYOUT_UNAVAILABLE");
});
it("forged parent/hash/input fields and mismatched metric implementations fail",()=>{
 const input=layoutFixture();for(const changed of [{...input,provider:"google"},{...input,renderInputHash:"0".repeat(64)},{...input,media:{...input.media,storeId:input.snapshot.id}}])expect(()=>composeDocumentLayout(changed)).toThrow();expect(()=>composeDocumentLayout(input,{...provisionalMetrics,version:2})).toThrow("MEASUREMENT");expect(()=>composeDocumentLayout(input,{...provisionalMetrics,measure:()=>0})).toThrow("MEASUREMENT");
 const thin=layoutFixture("mystic",1);if(thin.media.media.mode==="TAROT_CARDS"){thin.media.media.cards[0].asset.width=1;thin.media.media.cards[0].asset.height=1000;}hashInput(thin);expect(()=>composeDocumentLayout(thin)).toThrow("IMPOSSIBLE_CARD_ASPECT_RATIO");
 const l=composeDocumentLayout(input),other=hashInput({...structuredClone(input),snapshot:{...structuredClone(input.snapshot),reading:{...structuredClone(input.snapshot.reading),product:{...input.snapshot.reading.product,name:"Different"}}}});expect(()=>validateLayoutForInput(l,other)).toThrow("SOURCE_MISMATCH");
});
