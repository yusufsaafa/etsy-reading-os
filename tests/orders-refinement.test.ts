import {it,expect,vi,afterEach} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {OrderDetailView,orderSummary,compactReadingStatus,type DetailView,type DetailReading} from "../src/components/order-detail";
import {OrderList,shortOrderStatus} from "../src/components/order-list";
import {readingOperations,type OperationEvidence} from "../src/modules/orders/operations";
import {sampleOrderDetail} from "../src/modules/orders/sample-preview";
const evidence=(changes:Partial<OperationEvidence>={}):OperationEvidence=>({id:"u",orderId:"order",issues:[],canceled:false,paid:true,refund:"none",revision:0,configurationState:"versioned",canOperate:true,eligible:true,providerEnabled:true,profileReady:true,pdfAccess:true,...changes});
const reading=(changes:Partial<DetailReading>={}):DetailReading=>({id:"u",index:1,status:"Pending",revision:0,answers:[{label:"Question",kind:"text",value:"Edited answer"}],operations:readingOperations(evidence()),...changes});
const view=(readings=[reading()]):DetailView=>({reference:"retained",customer:"Buyer",date:"2026-10-09",status:"Pending",payment:"Paid",items:[{id:"line-1",title:"Same title",quantity:readings.length,variations:["Detail: Standard"],answers:[{label:"Question",kind:"text",value:"Original answer"}],readings}]});
const html=(data=view())=>renderToStaticMarkup(createElement(OrderDetailView,{data,backHref:"/orders?q=Love&page=2"}));
afterEach(()=>vi.unstubAllEnvs());
it("counts independent readings, validated current output and affected units rather than issues",()=>{
 const generated=reading({id:"g",operations:readingOperations(evidence({id:"g",generation:{id:"gen",status:"SUCCEEDED",customerRevision:0},review:"Ready for review"}))});
 const missing=reading({id:"m",operations:readingOperations(evidence({id:"m",eligible:false,issues:["missing_input","source_changed"]}))});
 expect(orderSummary(view([generated,missing,reading()]))).toEqual({readings:3,generated:1,attention:1});
 expect(orderSummary(view([reading({operations:readingOperations(evidence({generation:{id:"gen",status:"SUCCEEDED",customerRevision:1},review:"Ready for review"}))})]))).toEqual({readings:1,generated:0,attention:1});
});
it("contains both dialogs in Summary, preserves original/current evidence and partial recorded activity",()=>{
 const markup=html();const summary=markup.slice(markup.indexOf('aria-labelledby="order-summary"'),markup.indexOf('aria-labelledby="purchased-readings"'));
 expect(summary).toContain('aria-label="View Purchase Information"');expect(summary).toContain('aria-label="View Activity"');expect(summary.match(/<dialog/g)).toHaveLength(2);expect(summary).toContain("Original answer");expect(markup).toContain("Edited answer");expect(summary).toContain("Partial activity");expect(summary).toContain("Paid");expect(markup).not.toContain("Order Total");expect(markup).not.toContain("Action Center");expect(markup).toContain("q=Love&amp;page=2");
});
it("shows no exceptions for ordinary pending, processing or current generated readings",()=>{
 for(const operations of [readingOperations(evidence()),readingOperations(evidence({queue:"EXECUTING"})),readingOperations(evidence({generation:{id:"g",status:"SUCCEEDED",customerRevision:0},review:"Ready for review"}))])expect(html(view([reading({operations})]))).not.toContain('id="action-required"');
});
it("keeps all exceptions and resolves secondary controls inside reading details",()=>{
 const markup=html(view([reading({operations:readingOperations(evidence({issues:["missing_input","source_changed","unmapped_listing"],eligible:false,productHref:"/products/p/setup"}))})]));
 for(const title of ["Customer information missing","Purchase details changed","Product setup required"])expect(markup).toContain(title);
 expect(markup).toContain('href="/products/p/setup"');expect(markup).toContain('href="#reading-u"');expect(markup).toContain("View Details");
});
it("never merges equal titles, differing variations or purchase snapshots",()=>{
 const data=view();data.items.push({...data.items[0],id:"line-2",quantity:2,variations:["Detail: Extended"],answers:[{label:"Question",kind:"text",value:"Different original answer"}],readings:[reading({id:"second"}),reading({id:"third",index:2})]});
 const markup=html(data);expect(markup).toContain('data-purchased-line="line-1"');expect(markup).toContain('data-purchased-line="line-2"');expect(markup).toContain("Quantity 2");expect(orderSummary(data).readings).toBe(3);expect(markup).toContain("Different original answer");
});
it("puts actual current review and authorized PDF beside the reading; PDF absence has no button",()=>{
 const operations=readingOperations(evidence({generation:{id:"g",status:"SUCCEEDED",customerRevision:0},review:"Ready for review",artifact:{id:"pdf",generationId:"g",customerRevision:0}}));
 const markup=html(view([reading({operations})]));expect(markup).toContain('href="/orders/order/readings/u/review"');expect(markup).toContain('href="/api/readings/u/artifacts/pdf?view=inline"');expect(markup).toContain('target="_blank"');expect(html()).not.toContain('>View PDF<');
});
it.each([[{queue:"EXECUTING"},"Processing"],[{issues:["missing_input"],eligible:false},"Needs Information"],[{configurationState:"legacy",eligible:false},"Needs Setup"],[{generation:{id:"g",status:"FAILED",customerRevision:0}},"Failed"],[{canceled:true},"Canceled"]])("uses concise lifecycle display %j",(changes,label)=>{expect(compactReadingStatus(reading({operations:readingOperations(evidence(changes))}))).toBe(label);});
it("uses an accessible SVG chevron and short labels without changing destinations",()=>{
 const markup=renderToStaticMarkup(createElement(OrderList,{rows:[{id:"id",externalId:"123",customer:"Buyer",products:"Very long title",count:1,status:"Information or setup needed",priority:3,date:"2026-10-09"}],returnQuery:"?q=Love&page=2"}));
 expect(markup).toContain('data-order-destination');expect(markup).toContain('aria-label="Open order 123"');expect(markup).toContain('href="/orders/id?q=Love&amp;page=2"');expect(markup).toContain("Needs Attention");expect(markup).not.toContain('>Open<');expect(markup).toContain("<svg");expect(shortOrderStatus("Review updated information")).toBe("Needs Attention");
});
it("keeps 50 stable deterministic fictional IDs with varied answer lengths, fields and safe dialogs",()=>{
 vi.stubEnv("NODE_ENV","development");const data=Array.from({length:50},(_,i)=>sampleOrderDetail(`DEMO-${1001+i}`)!);
 expect(data).toEqual(Array.from({length:50},(_,i)=>sampleOrderDetail(`DEMO-${1001+i}`)!));
 const answers=data.flatMap(d=>d.items.flatMap(i=>i.answers));expect(answers.some(a=>String(a.value).length>180)).toBe(true);expect(answers.some(a=>String(a.value).length<40)).toBe(true);expect(data.some(d=>d.items.some(i=>i.answers.length>1))).toBe(true);expect(data.some(d=>d.items.length>1)).toBe(true);
 for(const d of data){const markup=html(d);expect(markup).toContain("SAMPLE DATA");expect(markup).not.toContain("<form");expect(markup).not.toMatch(/href="\/(api|products|settings|orders\/DEMO)/);}
});
it("retains wrapping, touch, focus, modal scrolling and reduced motion contracts with no emoji",()=>{
 const css=readFileSync("src/components/order-detail.module.css","utf8");for(const token of ["overflow-wrap:anywhere","flex-basis:100%","min-height:44px","prefers-reduced-motion"])expect(css).toContain(token);
 const modal=readFileSync("src/components/information-popover.module.css","utf8");expect(modal).toContain("overflow:auto");expect(modal).toContain("max-height:calc(100dvh - 32px)");expect(modal).toContain("focus-visible");
 for(const file of ["order-detail.tsx","order-list.tsx","icon.tsx"])expect(readFileSync(`src/components/${file}`,"utf8")).not.toMatch(/\p{Extended_Pictographic}/u);
});
it("groups repeated attention reasons once while preserving affected reading references",()=>{
 const operations=readingOperations(evidence({issues:["missing_input"],eligible:false}));
 const markup=html(view([reading({operations}),reading({id:"second",index:2,operations})]));
 const section=markup.slice(markup.indexOf('id="action-required"'),markup.indexOf('aria-labelledby="purchased-readings"'));
 expect(section.match(/Customer information missing/g)).toHaveLength(1);expect(section).toContain('href="#reading-u"');expect(section).toContain('href="#reading-second"');expect(orderSummary(view([reading({operations}),reading({id:"second",operations})])).attention).toBe(2);
});
