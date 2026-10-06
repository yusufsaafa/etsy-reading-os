import {it,expect} from "vitest";
import {createHash} from "node:crypto";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {reviewContent} from "../src/modules/review/service";
import {ReviewReading} from "../src/components/review-reading";
import {stableJson} from "../src/modules/intake/contracts";
import type {generations} from "../src/db/schema";
function evidence(){
 const context={version:"personalized-content-v1",unitId:"reading",orderId:"order",lineItemId:"line",seller:{id:"seller"},style:{id:"style"},product:{id:"product",configuration:{inputs:[{id:"name",key:"name",label:"Customer name",required:true,type:"TEXT",sortOrder:0,helpText:""},{id:"optional",key:"optional",label:"Additional details",required:false,type:"LONG_TEXT",sortOrder:1,helpText:""}],sections:[{id:"first",title:"First",instruction:"",sortOrder:0},{id:"second",title:"Second",instruction:"",sortOrder:1}],output:"TEXT",workflow:"ASSISTED"}},customer:{revision:2,answers:[{label:"name",value:"<script>bad</script>"+"x".repeat(9900),kind:"text"}]}};
 return {status:"SUCCEEDED",completedAt:new Date(),unitId:"reading",productVersionId:"product",styleVersionId:"style",sellerProfileId:"seller",customerRevision:2,context,contextHash:createHash("sha256").update(stableJson(context)).digest("hex"),result:{sections:[{sectionId:"second",title:"Second",content:"Paragraph one\n\nParagraph two"},{sectionId:"first",title:"First",content:"First body"}]}} as unknown as typeof generations.$inferSelect;
}
it("review validates canonical order, labels, long and missing optional answers",()=>{
 const result=reviewContent(evidence());expect(result.sections.map(s=>s.title)).toEqual(["First","Second"]);expect(result.details[0].label).toBe("Customer name");expect(result.details[1]).toEqual({label:"Additional details",value:"Not provided"});expect(result.details[0].value.length).toBe(9920);
});
it.each(["PROCESSING","FAILED"])("%s is not reviewable",status=>{expect(()=>reviewContent({...evidence(),status})).toThrow("REVIEW_UNAVAILABLE");});
it("missing/corrupt canonical and mismatched hashes/bindings fail closed",()=>{
 for(const changed of [{result:null},{result:{sections:[]}},{contextHash:"0".repeat(64)},{unitId:"foreign"},{customerRevision:3},{completedAt:null}])expect(()=>reviewContent({...evidence(),...changed} as typeof generations.$inferSelect)).toThrow("REVIEW_UNAVAILABLE");
});
it("read-only document renders escaped customer content, exact sections, semantic headings and no infrastructure",()=>{
 const content=reviewContent(evidence()),html=renderToStaticMarkup(createElement(ReviewReading,{reading:{customer:"Customer",product:"Love",orderReference:"2002",index:2,quantity:2,...content}}));
 expect(html).toContain("Reading 2 of 2");expect(html).toContain("Ready for review");expect(html).toContain("Customer details");expect(html).toContain("&lt;script&gt;");expect(html.indexOf("First body")).toBeLessThan(html.indexOf("Paragraph one"));expect(html).toContain('aria-labelledby="reading-title"');
 expect(html).not.toMatch(/sectionId|generationId|provider|Gemini|token|canonical|<textarea|<button|<script>/);
 const css=readFileSync("src/app/globals.css","utf8");expect(css).toContain("max-width:72ch");expect(css).toContain("minmax(min(100%,16rem),1fr)");expect(css).toContain("overflow-wrap:anywhere");
});
it("long Unicode customer data and near-bound reading text stay complete escaped plain text",()=>{
 const generation=evidence(),question="O'Neil asks: \"猫 🐾\"\nhttps://example.invalid/"+"x".repeat(9000);
 generation.context.customer.answers[0].value=question;
 const body="Opening — 猫 🐾\n\n"+"x".repeat(39000)+"\nhttps://example.invalid/<script>text only</script>";
 generation.result!.sections[0].content=body;generation.contextHash=createHash("sha256").update(stableJson(generation.context)).digest("hex");
 const result=reviewContent(generation),html=renderToStaticMarkup(createElement(ReviewReading,{reading:{approved:true,customer:"Customer",product:"Reading",orderReference:"2002",index:1,quantity:2,...result}}));
 expect(result.details[0].value).toBe(question);expect(result.sections[1].content).toBe(body);expect(html).toContain("x".repeat(39000));expect(html).toContain("猫 🐾");expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");expect(html).not.toContain("href=\"https://example.invalid/");
});
