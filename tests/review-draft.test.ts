import {it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {validateReviewDraft,reviewDraftMessage,ReviewDraftError} from "../src/modules/review/draft-contract";
import {ReviewReading} from "../src/components/review-reading";
vi.mock("../src/components/review/actions",()=>({saveReviewDraftAction:vi.fn()}));
import {ReviewDraftForm} from "../src/components/review/draft-form";
const base={sections:[{sectionId:"first",title:"First",content:"First text"},{sectionId:"second",title:"Second",content:"Second text"}]};
it("bounded draft retains exact seller whitespace and fixed identity/order/title",()=>{
 const changed=structuredClone(base);changed.sections[0].content="\n Seller text \n\nSecond paragraph ";expect(validateReviewDraft(changed,base)).toEqual(changed);
 for(const raw of [{sections:base.sections.slice(1)},{sections:[...base.sections,base.sections[0]]},{sections:[...base.sections].reverse()},{sections:base.sections.map((s,i)=>i?s:{...s,sectionId:"other"})},{sections:base.sections.map((s,i)=>i?s:{...s,title:"other"})},{sections:base.sections.map((s,i)=>i?s:{...s,content:" "})},{sections:base.sections.map((s,i)=>i?s:{...s,content:42})},{...base,customer:"injected"}])expect(()=>validateReviewDraft(raw,base)).toThrow("INVALID");
});
it("section and UTF-8 aggregate limits remain bounded",()=>{
 expect(()=>validateReviewDraft({sections:base.sections.map(s=>({...s,content:"x".repeat(40001)}))},base)).toThrow("INVALID");
 const many={sections:Array.from({length:20},(_,i)=>({sectionId:String(i),title:String(i),content:"text"}))};
 expect(()=>validateReviewDraft({sections:many.sections.map(s=>({...s,content:"x".repeat(30000)}))},many)).toThrow("INVALID");
 const utf8={sections:Array.from({length:5},(_,i)=>({sectionId:String(i),title:String(i),content:"text"}))};
 expect(()=>validateReviewDraft({sections:utf8.sections.map(s=>({...s,content:"界".repeat(39000)}))},utf8)).toThrow("INVALID");
});
it("seller-safe conflict and validation messages reveal no implementation error",()=>{
 expect(reviewDraftMessage(new ReviewDraftError("CONFLICT"))).toContain("Refresh");expect(reviewDraftMessage(new ReviewDraftError("INVALID"))).toContain("reading text");expect(reviewDraftMessage(new Error("secret sql details"))).not.toContain("secret");
});
it("editor uses labelled native body fields, read-only titles, reachable actions and announced errors",()=>{
 const html=renderToStaticMarkup(createElement(ReviewDraftForm,{orderId:"order",readingId:"reading",draft:{revision:3,content:base}}));
 expect(html).toContain('for="reading-text-0"');expect(html).toContain('name="content"');expect(html).toMatch(/maxlength="40000"/i);expect(html).toContain("Save changes");expect(html).toContain("Cancel");expect(html).toContain('href="/orders/order/readings/reading/review"');expect(html).toContain('aria-describedby="review-save-feedback"');
 expect(html).not.toMatch(/Approve|PDF|Gemini|Draft v3|name="customer/);
 const source=readFileSync("src/components/review/draft-form.tsx","utf8");expect(source).toContain('"beforeunload"');expect(source).toContain("Discard unsaved changes?");expect(source).toContain("value={contents[i]}");expect(source).toContain("value={loadedDraft.revision}");expect(source).toContain("useState(()=>draft)");
 const css=readFileSync("src/app/globals.css","utf8");expect(css).toContain("max-width:100%");expect(css).toContain("flex-wrap:wrap");
});
it("saved seller script-like text renders escaped in read mode with paragraphs retained",()=>{
 const html=renderToStaticMarkup(createElement(ReviewReading,{reading:{customer:"Customer",product:"Product",orderReference:"2002",index:1,quantity:1,details:[],sections:[{title:"First",content:"<script>alert(1)</script>\n\nSaved text"}]}}));
 expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");expect(html).toContain("Saved text");expect(html).not.toContain("<textarea");
});
