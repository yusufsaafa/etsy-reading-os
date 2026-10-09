import {it,expect,vi,beforeEach,afterEach} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {readFileSync} from "node:fs";
const mocks=vi.hoisted(()=>({scope:vi.fn(),verify:vi.fn(),data:vi.fn(),review:vi.fn(),db:{insert:vi.fn(),update:vi.fn(),delete:vi.fn(),execute:vi.fn()}}));
vi.mock("@/db/client",()=>({database:()=>mocks.db}));
vi.mock("@/modules/identity/session",()=>({currentScope:mocks.scope}));
vi.mock("@/modules/intake/service",()=>({verifyScope:mocks.verify}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
vi.mock("@/modules/orders/detail",()=>({orderDetailData:mocks.data}));
vi.mock("@/modules/review/service",()=>({orderReadingReviewStatuses:async()=>new Map([["unit",await mocks.review()]])}));
vi.mock("@/components/input-editor",()=>({InputEditor:()=>null}));
vi.mock("@/components/generation/reading-preparation",()=>({ReadingPreparation:()=>null}));
vi.mock("@/modules/documents/artifact-service",()=>({orderAvailableDocumentArtifacts:async()=>[]}));
vi.mock("@/modules/seller-style/service",()=>({sellerStyleData:async()=>({})}));
vi.mock("@/infrastructure/document-runtime",()=>({configuredDocumentPorts:()=>undefined}));
vi.mock("@/modules/orders-finance/service",()=>({orderFinanceView:async()=>({state:"UNAVAILABLE"})}));
import RealPage from "../src/app/(operations)/orders/[id]/page";
import SamplePage from "../src/app/(operations)/orders/preview/[id]/page";
import {sampleOrderDetail} from "../src/modules/orders/sample-preview";
import {customerIdentity} from "../src/modules/orders/customer";
import {OrderDetailView} from "../src/components/order-detail";
import {OrderList} from "../src/components/order-list";
const scope={userId:"u",organizationId:"o",storeId:"s"};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("NODE_ENV","development");mocks.scope.mockResolvedValue(scope);mocks.verify.mockResolvedValue(undefined);});
afterEach(()=>vi.unstubAllEnvs());
const page=(id="DEMO-1001",searchParams:Record<string,unknown>={})=>SamplePage({params:Promise.resolve({id}),searchParams:Promise.resolve(searchParams)});
it("uses only persisted names or neutral fallback",()=>{expect(customerIdentity(" Emily ")).toBe("Emily");for(const value of [null,undefined," "])expect(customerIdentity(value)).toBe("Customer unavailable");});
it.each(["production","test"])("rejects sample detail before fixture access in %s",async env=>{vi.stubEnv("NODE_ENV",env);await expect(page()).rejects.toThrow("NOT_FOUND");expect(mocks.scope).not.toHaveBeenCalled();expect(()=>sampleOrderDetail("DEMO-1001")).toThrow("unavailable");});
it.each(["sign-in","onboarding","scope denied"])("requires existing access checks: %s",async reason=>{if(reason==="scope denied")mocks.verify.mockRejectedValueOnce(new Error(reason));else mocks.scope.mockRejectedValueOnce(new Error(reason));await expect(page()).rejects.toThrow(reason);});
it.each(["DEMO-9999","DEMO-1051","real-uuid","DEMO-1001-extra"])("rejects invalid or missing fixture %s",async id=>{await expect(page(id)).rejects.toThrow("NOT_FOUND");});
it("renders the shared interface with no workflow controls and preserves validated return state",async()=>{
 const result=await page("DEMO-1003",{q:"DEMO",filter:"generated",sort:"oldest",page:"2",returnTo:"https://evil.example"});expect(result.type).toBe(OrderDetailView);
 const html=renderToStaticMarkup(result);for(const text of ["SAMPLE DATA","Purchased Readings","Customer Information","Order Summary","View Purchase Information","View Activity","Sophia Miller","Back to Sample Orders","Exit Preview"])expect(html).toContain(text);
 expect(html).toContain("preview=sample");expect(html).toContain("page=2");expect(html).not.toContain("evil.example");expect(html).not.toContain("<form");expect(html).not.toContain("<details");for(const op of Object.values(mocks.db))expect(op).not.toHaveBeenCalled();expect(mocks.verify).toHaveBeenCalledWith(mocks.db,scope);
});
it("supports consistent generated, active, attention, canceled and multiple-reading scenarios",()=>{
 const generated=sampleOrderDetail("DEMO-1003")!;expect(generated.items.flatMap(i=>i.readings).every(r=>r.generation?.status==="SUCCEEDED")).toBe(true);
 expect(sampleOrderDetail("DEMO-1002")!.items[0].readings[0].queue).toBe("Queued");expect(sampleOrderDetail("DEMO-1004")!.items).toHaveLength(2);expect(sampleOrderDetail("DEMO-1004")!.items.every(i=>!i.answers.length)).toBe(true);
 expect(sampleOrderDetail("DEMO-1005")!.status).toBe("Canceled");expect(sampleOrderDetail("DEMO-1001")!.items[0].readings[0].generation).toBeUndefined();
 for(let id=1001;id<=1050;id++){const detail=sampleOrderDetail(`DEMO-${id}`)!;expect(detail.items.every(item=>item.quantity===item.readings.length)).toBe(true);expect(detail.items.flatMap(item=>item.readings).length).toBeGreaterThan(0);if(detail.status==="Generated")expect(detail.items.flatMap(item=>item.readings).every(r=>r.generation?.revision===r.revision)).toBe(true);}
});
it("presents stale results and retry wait without implying delivery",()=>{
 const data=sampleOrderDetail("DEMO-1003")!;data.items[0].readings[0].revision=1;data.items[0].readings[0].queue="RETRY WAIT";
 const html=renderToStaticMarkup(createElement(OrderDetailView,{data,backHref:"/orders"}));expect(html).toContain("result is stale");expect(html).toContain("RETRY WAIT");expect(html).toContain("do not indicate approval, PDF completion or delivery");
});
it("shows customer identity with safe separated detail links",()=>{
 const row={id:"DEMO-1001",externalId:"DEMO-1001",customer:"Emily Carter",products:"Reading",count:1,status:"Pending",priority:4,date:"2026-10-09T12:00:00Z"};
 const html=renderToStaticMarkup(createElement(OrderList,{rows:[row],preview:true,returnQuery:"?page=2"}));expect(html).toContain("Customer</th>");expect(html).toContain("Emily Carter");expect(html).toContain("/orders/preview/DEMO-1001?page=2");expect(html).not.toContain('href="/orders/DEMO');
});
it("keeps responsive structure, headings and read-only preview isolation",()=>{
 const css=readFileSync("src/components/order-detail.module.css","utf8");expect(css).toContain(".readingActions");expect(css).toContain("flex-basis:100%");expect(css).toContain("@media(max-width:900px)");expect(css).toContain("overflow-wrap:anywhere");
 const route=readFileSync("src/app/(operations)/orders/preview/[id]/page.tsx","utf8");expect(route).not.toContain("ReadingPreparation");expect(route).not.toContain("InputEditor");
});

it.each([
 ["FAILED","RETRY_WAIT",0,0,"In production"],
 ["FAILED","ATTENTION",0,0,"Production needs attention"],
 ["SUCCEEDED",undefined,1,0,"Review updated information"],
 ["SUCCEEDED",undefined,0,0,"Generated"],
 [undefined,undefined,0,0,"Pending"],
])("preserves real lifecycle %s / %s",async(status,queue,revision,generationRevision,label)=>{
 mocks.review.mockResolvedValue(null);mocks.data.mockResolvedValue({attempts:[],canOperate:true,order:{externalId:"123",buyerName:"Persisted Buyer",createdAt:new Date("2026-10-09"),paid:true,canceled:false,refund:"none"},lines:[{id:"line",title:"Historical title",quantity:1,listingExternalId:"101",variantKey:"default",snapshot:{variations:[{label:"Detail",value:"Standard"}],answers:[]}}],units:[{id:"unit",lineItemId:"line",unitIndex:1,issues:[],revision,configurationState:"legacy"}],inputs:[],mappings:[],versions:[],history:status?[{unitId:"unit",status,customerRevision:generationRevision,createdAt:new Date("2026-10-09")}]:[],queue:queue?[{unitId:"unit",state:queue}]:[]});
 const result=await RealPage({params:Promise.resolve({id:"owned-id"}),searchParams:Promise.resolve({filter:"attention",page:"2",returnTo:"https://evil.example"})});expect(result.props.data.status).toBe(label);expect(result.props.data.customer).toBe("Persisted Buyer");expect(result.props.data.items[0].title).toBe("Historical title");expect(result.props.data.items[0].variations).toEqual(["Detail: Standard"]);expect(result.props.backHref).toContain("filter=attention");expect(result.props.backHref).not.toContain("evil");expect(mocks.data).toHaveBeenCalledWith(mocks.db,scope,"owned-id");
});
it("keeps real authorization denial and unavailable reads inaccessible",async()=>{
 mocks.data.mockRejectedValueOnce(new Error("Resource unavailable"));await expect(RealPage({params:Promise.resolve({id:"other-store"})})).rejects.toThrow("Resource unavailable");
 mocks.data.mockResolvedValueOnce(null);await expect(RealPage({params:Promise.resolve({id:"missing"})})).rejects.toThrow("NOT_FOUND");
});
