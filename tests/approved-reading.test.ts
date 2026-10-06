import {it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {immutableApprovedReading} from "../src/modules/review/approved-reading";
import {approvedReviewContent,reviewContentHash} from "../src/modules/review/service";
import {reviewDraftMessage} from "../src/modules/review/draft-contract";
import type {readingReviews} from "../src/db/schema";
const content={sections:[{sectionId:"one",title:"One",content:"Body"}]};
function dto(){return {contractVersion:"approved-reading/v1",organizationId:randomUUID(),storeId:randomUUID(),readingId:randomUUID(),order:{id:randomUUID(),reference:"2002",customerName:"Customer"},product:{name:"Love"},readingNumber:1,quantity:2,sections:content.sections,contentHash:reviewContentHash(content),approvedAt:new Date().toISOString(),provenance:{reviewId:randomUUID(),generationId:randomUUID()}};}
it("document contract is strict, bounded, detached and deeply immutable",()=>{
 const raw=dto(),value=immutableApprovedReading(raw);raw.sections[0].content="Changed original object";expect(value.sections[0].content).toBe("Body");expect(Object.isFrozen(value.order)).toBe(true);
 for(const altered of [{...dto(),draft:{}},{...dto(),contentHash:"bad"},{...dto(),sections:[{...content.sections[0],content:"x".repeat(40001)}]},{...dto(),sections:Array(21).fill(content.sections[0])}])expect(()=>immutableApprovedReading(altered)).toThrow();content.sections[0].content="Body";
});
it("approved validation rejects incomplete fields and impossible canonical-only provenance",()=>{
 const base={sections:[{sectionId:"one",title:"One",content:"Original"}]},row={state:"APPROVED",approvedAt:new Date(),approvedByUserId:"owner",approvedDraftRevision:null,approvedContent:base,approvedContentHash:reviewContentHash(base)} as typeof readingReviews.$inferSelect;
 expect(approvedReviewContent(row,base)).toEqual(base);
 for(const change of [{approvedAt:null},{approvedAt:new Date("invalid")},{approvedByUserId:null},{approvedContent:null},{approvedDraftRevision:-1},{approvedContent:content,approvedContentHash:reviewContentHash(content)}])expect(()=>approvedReviewContent({...row,...change},base)).toThrow("REVIEW_UNAVAILABLE");
});
it("seller error copy never reflects infrastructure exception details",()=>{
 expect(reviewDraftMessage(new Error("SQL Zod constraint review_id 123 hash provider queue"))).not.toMatch(/SQL|Zod|constraint|review_id|123|hash|provider|queue/);
});
