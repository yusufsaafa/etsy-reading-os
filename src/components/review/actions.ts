"use server";
import {z} from "zod";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {saveReadingReviewDraft,approveReadingReview} from "@/modules/review/service";
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

export async function approveReviewAction(orderId:string,readingId:string,_state:ReviewSaveState,form:FormData):Promise<ReviewSaveState> {
 try {
  const scope=await currentScope();
  z.string().uuid().parse(orderId);z.string().uuid().parse(readingId);
  if([...form.keys()].some(key=>key!=="revision"&&!key.startsWith("$ACTION_")))throw new ReviewDraftError("INVALID");
  const token=z.string().regex(/^(none|\d+)$/).parse(form.get("revision"));
  await approveReadingReview(database(),scope,orderId,readingId,token==="none"?null:Number(token));
 }catch(error){return {error:error instanceof ReviewDraftError&&error.kind==="STALE"?reviewDraftMessage(error):error instanceof ReviewDraftError&&error.kind==="CONFLICT"?"This reading changed since you opened it. Review the latest version before approving.":"This reading could not be approved. Refresh and check its status before continuing."};}
 const path=`/orders/${orderId}/readings/${readingId}/review`;
 revalidatePath(path);revalidatePath(`/orders/${orderId}`);revalidatePath("/orders");redirect(path);
}

/** Explicit exact-Reading PDF preparation; never scans a queue or invokes AI. */
export async function prepareReviewPdfAction(orderId:string,readingId:string,_state:ReviewSaveState,form:FormData):Promise<ReviewSaveState>{
 try{
  const scope=await currentScope();z.uuid().parse(orderId);z.uuid().parse(readingId);
  if([...form.keys()].some(key=>!key.startsWith("$ACTION_")))throw new Error("INVALID_COMMAND");
  const {configuredDocumentPorts}=await import("@/infrastructure/document-runtime");
  const ports=configuredDocumentPorts();if(!ports)return {error:"PDF storage is unavailable. Contact your workspace administrator."};
  const {requestDocumentProduction,DocumentProductionWorker,readingOutputStatus}=await import("@/modules/production/documents");
  const db=database(),workId=await requestDocumentProduction(db,scope,{orderId,readingId});
  if(!workId)return {error:"This reading does not have PDF output configured."};
  await DocumentProductionWorker.forInternalWorker(db,ports).execute(workId);
  const result=await readingOutputStatus(db,scope,orderId,readingId);
  if(!result.artifactId)return {error:"The PDF is not ready. Check document setup and storage, then try again."};
 }catch{return {error:"The PDF could not be prepared. Check the approved reading, document setup and storage before retrying."};}
 revalidatePath(`/orders/${orderId}/readings/${readingId}/review`);revalidatePath(`/orders/${orderId}`);
 return {};
}
