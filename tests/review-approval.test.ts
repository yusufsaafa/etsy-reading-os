import {it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("../src/components/review/actions",()=>({approveReviewAction:vi.fn()}));
import {ReviewReading} from "../src/components/review-reading";
import {ReviewApprovalForm} from "../src/components/review/approval-form";
import {reviewContentHash} from "../src/modules/review/service";
it("approved reading displays escaped ordered bodies without internal metadata",()=>{
 const html=renderToStaticMarkup(createElement(ReviewReading,{reading:{approved:true,customer:"Customer",product:"Love",orderReference:"2002",index:1,quantity:2,details:[],sections:[{title:"First",content:"<script>attack</script>"},{title:"Second",content:"Saved text"}]}}));
 expect(html).toContain("Approved");expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));expect(html).not.toMatch(/Edit reading|snapshot|revision|Gemini|provider|contentHash/);
});
it("approval starts with a semantic intent button and no editable or arbitrary submitted content",()=>{
 const html=renderToStaticMarkup(createElement(ReviewApprovalForm,{orderId:"order",readingId:"reading",revision:2}));expect(html).toContain('type="button"');expect(html).toContain("Approve reading");expect(html).not.toMatch(/textarea|contentHash|generationId/);
});
it("approved hash is deterministic over ordered section identities titles and exact body text",()=>{
 const a={sections:[{sectionId:"one",title:"One",content:"Body"},{sectionId:"two",title:"Two",content:"Other"}]};
 expect(reviewContentHash(a)).toBe(reviewContentHash(structuredClone(a)));
 for(const altered of [{sections:[...a.sections].reverse()},{sections:a.sections.map(s=>({...s,title:s.title+"!"}))},{sections:a.sections.map(s=>({...s,content:s.content+"\n"}))},{sections:a.sections.map(s=>({...s,sectionId:s.sectionId+"x"}))}])expect(reviewContentHash(altered)).not.toBe(reviewContentHash(a));
});
