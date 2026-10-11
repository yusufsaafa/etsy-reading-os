import {it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
const mocks=vi.hoisted(()=>({open:vi.fn()}));
vi.mock("@/db/client",()=>({database:()=>({})}));
vi.mock("@/modules/identity/session",()=>({currentScope:async()=>({userId:"owner",organizationId:"org",storeId:"store"})}));
vi.mock("@/modules/review/service",()=>({openReadingReview:mocks.open,ReviewUnavailable:class extends Error{}}));
vi.mock("@/components/review/draft-form",()=>({ReviewDraftForm:()=>createElement("textarea",{"aria-label":"Saved body"})}));
vi.mock("@/components/review/approval-form",()=>({ReviewApprovalForm:()=>createElement("button",{},"Approve reading")}));
import ReviewPage from "../src/app/(operations)/orders/[id]/readings/[readingId]/review/page";
const view={customer:"Customer",product:"Love",orderReference:"2002",index:1,quantity:1,details:[],sections:[{title:"One",content:"Visible saved body"}],draft:{revision:3,content:{sections:[]},modified:true}};
it.each([false,true])("readable review controls follow durable approval %s",async approved=>{
 mocks.open.mockResolvedValue({...view,approved});const html=renderToStaticMarkup(await ReviewPage({params:Promise.resolve({id:"order",readingId:"reading"}),searchParams:Promise.resolve({})}));
 expect(html.includes("Edit reading")).toBe(!approved);expect(html.includes("Approve reading")).toBe(!approved);expect(html).toContain("Visible saved body");if(approved)expect(html).toContain("Approved");
 expect(html).not.toMatch(/snapshot|revision|Generation|canonical|Gemini|provider/);
});
it("active edit mode has no approval action or visible saved-content approval shortcut",async()=>{
 mocks.open.mockResolvedValue({...view,approved:false});const html=renderToStaticMarkup(await ReviewPage({params:Promise.resolve({id:"order",readingId:"reading"}),searchParams:Promise.resolve({edit:"1"})}));
 expect(html).toContain("textarea");expect(html).not.toContain("Approve reading");expect(html).not.toContain("Edit reading");
});
it.each([false,true])("historical review preserves body and removes operational controls (approved %s)",async approved=>{
 mocks.open.mockResolvedValue({...view,approved,outdated:true});const html=renderToStaticMarkup(await ReviewPage({params:Promise.resolve({id:"order",readingId:"reading"}),searchParams:Promise.resolve({edit:"1"})}));
 expect(html).toContain("Historical / Outdated");expect(html).toContain("Visible saved body");expect(html).toContain("Updated information requires eligible current reading production");expect(html).not.toContain("Approve reading");expect(html).not.toContain("Edit reading");expect(html).not.toContain("textarea");expect(html).not.toContain("ready for the next step");
});
