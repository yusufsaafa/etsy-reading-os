import {z} from "zod";
import {stableJson} from "../intake/contracts";
import type {CanonicalResult} from "../generation/contracts";
export const MAX_DRAFT_BYTES=512000;
export const reviewDraftContent=z.object({sections:z.array(z.object({sectionId:z.string().min(1).max(100),title:z.string().min(1).max(200),content:z.string().min(1).max(40000).refine(text=>text.trim().length>0)}).strict()).min(1).max(20)}).strict();
export class ReviewDraftError extends Error {
 constructor(public readonly kind:"INVALID"|"CONFLICT"|"UNAVAILABLE"|"STALE"){super(kind==="STALE"?"REVIEW_UNAVAILABLE":kind);}
}
export function validateReviewDraft(raw:unknown,base:CanonicalResult):CanonicalResult {
 const parsed=reviewDraftContent.safeParse(raw);
 if(!parsed.success||Buffer.byteLength(stableJson(parsed.data),"utf8")>MAX_DRAFT_BYTES)throw new ReviewDraftError("INVALID");
 if(parsed.data.sections.length!==base.sections.length||parsed.data.sections.some((section,i)=>section.sectionId!==base.sections[i].sectionId||section.title!==base.sections[i].title))throw new ReviewDraftError("INVALID");
 return parsed.data;
}
export function reviewDraftMessage(error:unknown) {
 return error instanceof ReviewDraftError&&error.kind==="STALE"?"This reading is historical. Return to the order to check current customer information and eligible reading production. Your saved history is unchanged.":error instanceof ReviewDraftError&&error.kind==="CONFLICT"?"This reading changed since you opened it. Refresh to review the latest version before saving.":error instanceof ReviewDraftError&&error.kind==="INVALID"?"Check the reading text. Keep every section and enter text within the allowed length.":"This reading could not be saved. Check its status and refresh before continuing.";
}
