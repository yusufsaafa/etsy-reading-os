"use server";
import {z} from "zod";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {saveReadingReviewDraft} from "@/modules/review/service";
import {reviewDraftMessage,ReviewDraftError,MAX_DRAFT_BYTES} from "@/modules/review/draft-contract";
export type ReviewSaveState={error?:string};
export async function saveReviewDraftAction(orderId:string,readingId:string,_state:ReviewSaveState,form:FormData):Promise<ReviewSaveState> {
 try {
  const scope=await currentScope();
  z.string().uuid().parse(orderId);z.string().uuid().parse(readingId);
  const revision=Number(z.string().regex(/^\d+$/).parse(form.get("revision")));
  const structure=z.string().max(12000).parse(form.get("structure"));
  const content=form.getAll("content");
  if(content.length>20||content.some(value=>typeof value!=="string")||content.reduce((n,value)=>n+Buffer.byteLength(String(value),"utf8"),0)>MAX_DRAFT_BYTES)throw new ReviewDraftError("INVALID");
  const sections=z.array(z.object({sectionId:z.string().max(100),title:z.string().max(200)}).strict()).min(1).max(20).parse(JSON.parse(structure));
  if(sections.length!==content.length)throw new ReviewDraftError("INVALID");
  await saveReadingReviewDraft(database(),scope,orderId,readingId,revision,{sections:sections.map((section,i)=>({...section,content:content[i]}))});
 }catch(error){return {error:reviewDraftMessage(error)};}
 const path=`/orders/${orderId}/readings/${readingId}/review`;
 revalidatePath(path);revalidatePath(`/orders/${orderId}`);
 redirect(path+"?saved=1");
}
