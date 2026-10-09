import {it,expect} from "vitest";
import {readingOperations,type OperationEvidence} from "../src/modules/orders/operations";
import {OrderDetailView} from "../src/components/order-detail";
import {sampleOrderDetail} from "../src/modules/orders/sample-preview";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {vi,afterEach} from "vitest";
const evidence=(changes:Partial<OperationEvidence>={}):OperationEvidence=>({id:"reading",orderId:"owned-order",issues:[],canceled:false,paid:true,refund:"none",revision:0,configurationState:"versioned",canOperate:true,eligible:true,providerEnabled:true,profileReady:true,productHref:"/products/owned-product/setup",pdfAccess:true,productVersionId:"v1",...changes});
const generation={id:"g1",status:"SUCCEEDED",customerRevision:0,productVersionId:"v1"};
afterEach(()=>vi.unstubAllEnvs());
it("pending uses only the existing preparation destination",()=>{const o=readingOperations(evidence());expect(o.output).toBe("No generation");expect(o.prepare).toBe("prepare");expect(o.next.action?.href).toBe("#preparation-reading");});
it.each([{canceled:true},{paid:false},{refund:"partial"}])("order hold disables production and retains other issues: %j",hold=>{
 const o=readingOperations(evidence({...hold,issues:["missing_input","unmapped_listing"],generation,review:"Ready for review"}));expect(o.next.priority).toBeLessThan(2);expect(o.prepare).toBeNull();expect(o.next.action).toBeUndefined();expect(o.issues).toHaveLength(3);expect(o.issues.every(i=>!i.action)).toBe(true);
});
it.each(["missing_input","unusable_input","quantity_context"])("%s resolves to the reading's existing editor",code=>{const o=readingOperations(evidence({issues:[code],eligible:false}));expect(o.next.action?.href).toBe("#customer-information-reading");expect(o.prepare).toBeNull();});
it("shows every secondary issue while critical source evidence takes precedence",()=>{const o=readingOperations(evidence({issues:["missing_input","source_changed","unmapped_listing"],eligible:false}));expect(o.next.key).toBe("source_changed");expect(o.issues.map(i=>i.key)).toEqual(["missing_input","source_changed","unmapped_listing"]);expect(o.issues.find(i=>i.key==="missing_input")?.action).toBeDefined();});
it("product setup navigates without implying historical reassignment",()=>{const o=readingOperations(evidence({configurationState:"unconfigured",eligible:false}));expect(o.next.action?.href).toBe("/products/owned-product/setup");expect(o.next.reason).toContain("does not automatically rebind");expect(readingOperations(evidence({configurationState:"legacy",productHref:undefined,eligible:false})).next.action).toBeUndefined();});
it("safe persisted failure reuses existing retry only",()=>{const o=readingOperations(evidence({generation:{...generation,status:"FAILED"},attempt:{ambiguous:false,failureCode:"INVALID_RESULT",attemptNumber:1}}));expect(o.prepare).toBe("retry");expect(o.next.action?.href).toBe("#preparation-reading");expect(o.next.reason).toContain("validation");});
it.each([
 {attempt:{ambiguous:true,failureCode:"TIMEOUT",attemptNumber:1}},
 {attempt:{ambiguous:false,failureCode:"NETWORK",attemptNumber:3}},
 {attempt:undefined},
 {attempt:{ambiguous:false,failureCode:"RAW_SECRET_STACK_TRACE",attemptNumber:1},revision:1},
 {attempt:{ambiguous:false,failureCode:"INVALID_RESULT",attemptNumber:1},productVersionId:"v2"},
])("unsafe or exhausted failure exposes no retry %j",changes=>{const o=readingOperations(evidence({generation:{...generation,status:"FAILED"},...changes}));expect(o.prepare).toBeNull();expect(o.issues.find(i=>i.key==="failure")?.action).toBeUndefined();expect(JSON.stringify(o)).not.toContain("RAW_SECRET_STACK_TRACE");});
it.each(["QUEUED","CLAIMED","EXECUTING","RETRY_WAIT"])("%s blocks duplicate preparation even with a failed generation",queue=>{const o=readingOperations(evidence({generation:{...generation,status:"FAILED"},queue,attempt:{ambiguous:false,failureCode:"RATE_LIMIT",attemptNumber:1}}));expect(o.prepare).toBeNull();expect(o.next.key).toBe("active");expect(o.next.action).toBeUndefined();expect(o.output).toBe(queue==="RETRY_WAIT"?"Retry wait":"Processing");});
it("stale output offers information review without current content access or regeneration",()=>{const o=readingOperations(evidence({generation,revision:1}));expect(o.output).toBe("Stale generation");expect(o.next.key).toBe("stale");expect(o.next.action?.href).toBe("#customer-information-reading");expect(o.prepare).toBeNull();});
it.each(["Ready for review","Approved"])("current %s exposes the exact owned review destination",review=>{const o=readingOperations(evidence({generation,review}));expect(o.next.action).toEqual({label:"View Reading",href:"/orders/owned-order/readings/reading/review"});expect(o.output).toBe(review==="Approved"?"Approved reading":"Current generated reading");});
it("a successful result with failed review validation has no enabled View Reading",()=>{const o=readingOperations(evidence({generation}));expect(o.next.key).toBe("review_unavailable");expect(o.next.action).toBeUndefined();});
it("PDF requires AVAILABLE owned projection and configured access, historical output stays explicit",()=>{
 const artifact={id:"artifact",generationId:"g1",customerRevision:0};
 expect(readingOperations(evidence({generation,artifact})).pdf).toEqual({href:"/api/readings/reading/artifacts/artifact?view=inline",historical:false});
 expect(readingOperations(evidence({generation,artifact,revision:1})).pdf?.historical).toBe(true);
 expect(readingOperations(evidence({generation,artifact,pdfAccess:false})).pdf).toBeUndefined();expect(readingOperations(evidence()).pdf).toBeUndefined();
});
it("membership without owner authority has no preparation but retains authorized input editing",()=>{const o=readingOperations(evidence({canOperate:false,issues:["missing_input"]}));expect(o.prepare).toBeNull();expect(o.next.action?.href).toBe("#customer-information-reading");});
it("provider and profile gates reuse existing limitations",()=>{expect(readingOperations(evidence({providerEnabled:false})).prepare).toBeNull();expect(readingOperations(evidence({profileReady:false})).next.action?.href).toBe("/settings/profile");});
it("Action Center prioritizes affected reading while preserving others and safe PDF navigation",()=>{
 const data={reference:"order",customer:"Customer",date:"2026-10-09T12:00:00Z",status:"Information or setup needed",payment:"Paid",items:[{id:"line",title:"Reading",quantity:2,variations:[],answers:[],readings:[{id:"generated",index:1,status:"Generated",revision:0,answers:[],operations:readingOperations(evidence({id:"generated",generation,review:"Ready for review",artifact:{id:"pdf",generationId:"g1",customerRevision:0}}))},{id:"missing",index:2,status:"Information needed",revision:0,answers:[],operations:readingOperations(evidence({id:"missing",issues:["missing_input"],eligible:false}))}]}]};
 const html=renderToStaticMarkup(createElement(OrderDetailView,{data,backHref:"/orders?page=2"}));expect(html.indexOf("Next step: Customer information missing")).toBeLessThan(html.indexOf("Reading ready for review"));expect(html).toContain("#customer-information-missing");expect(html).toContain("View Reading");expect(html).toContain("View PDF");expect(html).toContain('target="_blank"');expect(html).not.toContain("<details");
});
it("50 sample details reuse mapping, demonstrate all cases and enable no real workflow",()=>{
 vi.stubEnv("NODE_ENV","development");const keys=new Set<string>();
 for(let i=1001;i<=1050;i++){const data=sampleOrderDetail(`DEMO-${i}`)!;for(const reading of data.items.flatMap(i=>i.readings)){keys.add(reading.operations!.next.key);expect(reading.workflow).toBeUndefined();expect(reading.operations?.pdf).toBeUndefined();}
  const html=renderToStaticMarkup(createElement(OrderDetailView,{data,backHref:"/orders?preview=sample"}));expect(html).toContain("SAMPLE DATA");expect(html).not.toMatch(/href="(?:\/products|\/settings|\/api|\/orders\/DEMO)/);expect(html).not.toContain("<form");if(data.items.some(i=>i.readings.some(r=>r.operations?.next.action)))expect(html).toContain("disabled");
 }
 expect(new Set(sampleOrderDetail("DEMO-1004")!.items.flatMap(i=>i.readings).map(r=>r.operations!.next.key)).size).toBeGreaterThan(1);
 for(const key of ["pending","review","missing_input","unmapped_listing","failure","stale","active","canceled","source_changed"])expect(keys.has(key)).toBe(true);
});
