import {it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
const mocks=vi.hoisted(()=>({status:vi.fn().mockResolvedValue("Ready for review"),available:vi.fn(),data:vi.fn()}));
vi.mock("@/db/client",()=>({database:()=>({})}));
vi.mock("@/modules/identity/session",()=>({currentScope:async()=>({userId:"owner",organizationId:"org",storeId:"store"})}));
vi.mock("@/modules/intake/service",()=>({workspaceData:mocks.data}));
vi.mock("@/modules/review/service",()=>({reviewAvailable:mocks.available,readingReviewStatus:mocks.status}));
vi.mock("@/components/input-editor",()=>({InputEditor:()=>null}));
vi.mock("@/components/customer-information",()=>({CustomerInformation:()=>null}));
vi.mock("@/components/generation/reading-preparation",()=>({ReadingPreparation:({reviewHref,approved}:{reviewHref?:string;approved?:boolean})=>reviewHref?createElement("a",{href:reviewHref},approved?"View reading":"Review reading"):null}));
import OrderDetail from "../src/app/(operations)/orders/[id]/page";
it.each([true,false])("Order reading action follows persisted eligibility %s",async eligible=>{
 mocks.available.mockResolvedValue(eligible);mocks.data.mockResolvedValue({orders:[{id:"order",externalId:"2002",buyerName:"Customer",paid:true,canceled:false,refund:"none",createdAt:new Date()}],lines:[{id:"line",orderId:"order",title:"Love",quantity:2,listingExternalId:"101",variantKey:"default",snapshot:{variations:[],answers:[]}}],units:[{id:"one",lineItemId:"line",unitIndex:1,issues:[],productionStatus:"SUCCEEDED",revision:0,configurationState:"versioned"}],inputs:[],mappings:[],versions:[]});
 const html=renderToStaticMarkup(await OrderDetail({params:Promise.resolve({id:"order"})}));
 expect(html.includes("Review reading")).toBe(eligible);expect(html.includes("Ready for review")).toBe(eligible);expect(html).toContain("Reading 1 of 2");
 expect(html).not.toMatch(/SUCCEEDED|Gemini|AIRequest|canonical/);
});

it("approved Reading uses Approved and View reading",async()=>{
 mocks.status.mockResolvedValue("Approved");mocks.available.mockResolvedValue(true);
 const html=renderToStaticMarkup(await OrderDetail({params:Promise.resolve({id:"order"})}));expect(html).toContain("Approved");expect(html).toContain("View reading");expect(html).not.toContain("Review reading");
});
