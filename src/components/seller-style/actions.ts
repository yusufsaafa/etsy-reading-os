"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { saveSellerProfile, editStyle, saveStyleDraft, applyStyle, addPreviousWork, removePreviousWork } from "@/modules/seller-style/service";
import { styleAnalysisRuntime } from "@/infrastructure/ai/runtime";
import { sellerStyleData } from "@/modules/seller-style/service";
import { failureCopy } from "@/modules/seller-style/workflow";
export type FormState={error?:string;saved?:boolean;applied?:boolean;revision?:number;sourceAdded?:boolean;learned?:boolean};
function failure(error:unknown):FormState {
  const message=error instanceof Error?error.message:"";
  if(message==="STYLE_SOURCE_RETAINED")return {error:"This example is part of your writing style history and can’t be removed yet."};
  if(message==="STALE_STYLE_DRAFT")return {error:"These changes are out of date. Reload before editing again."};
  if(["Choose a tone.","Choose a level of detail.","Choose a writing approach.","Describe your custom style", "Save your profile name"].some(s=>message.startsWith(s)))return {error:message};
  return {error:"Unable to save. Check your fields and access, then try again."};
}
function refresh(){revalidatePath("/settings");revalidatePath("/settings/profile");}
export async function saveProfile(_state:FormState,form:FormData):Promise<FormState> {
  const scope=await currentScope();
  try{await saveSellerProfile(database(),scope,{displayName:form.get("displayName"),shortBio:form.get("shortBio")});refresh();return {saved:true};}catch(e){return failure(e);}
}
export async function beginStyle(){await editStyle(database(),await currentScope());refresh();}
export async function saveStyle(_state:FormState,form:FormData):Promise<FormState> {
  const scope=await currentScope();
  try{
    const id=z.string().uuid().parse(form.get("versionId")),revision=z.coerce.number().int().nonnegative().parse(form.get("revision")),json=z.string().max(26000).parse(form.get("configuration"));
    if(form.get("intent")==="apply"){await applyStyle(database(),scope,id,revision,JSON.parse(json));refresh();return {applied:true};}
    const saved=await saveStyleDraft(database(),scope,id,revision,JSON.parse(json));refresh();return {saved:true,revision:saved.revision};
  }catch(e){return failure(e);}
}
export async function pasteWork(_state:FormState,form:FormData):Promise<FormState> {
  const scope=await currentScope();
  try{await addPreviousWork(database(),scope,{title:form.get("title"),text:form.get("text"),commandKey:form.get("commandKey")});refresh();return {sourceAdded:true};}catch(e){return failure(e);}
}
export async function deleteWork(_state:FormState,form:FormData):Promise<FormState> {
  const scope=await currentScope();
  try{await removePreviousWork(database(),scope,z.string().uuid().parse(form.get("sourceId")));refresh();return {saved:true};}catch(e){return failure(e);}
}

export async function learnWritingStyle(_state:FormState,form:FormData):Promise<FormState> {
 try {
  const scope=await currentScope(),db=database(),data=await sellerStyleData(db,scope);
  if([...form.keys()].some(k=>k!=="commandKey"&&!k.startsWith("$ACTION_"))||form.getAll("commandKey").length!==1)throw new Error("INVALID_STYLE_COMMAND");
  const key=z.string().uuid().parse(form.get("commandKey"));
  if(!data.sources.length)return {error:"Add an example of your previous work first."};
  const profileId=data.profile?.id??(await editStyle(db,scope)).styleProfileId;
  const result=await styleAnalysisRuntime(db).executeForSeller(scope,{styleProfileId:profileId,commandKey:key});
  refresh();return result.status==="READY"?{learned:true}:result.status==="FAILED"?{error:failureCopy(result.failureCode,result.aiRequestId!==null)}:{error:"Your writing style update is still in progress. Check back later."};
 }catch(error){refresh();return {error:error instanceof Error&&error.message==="STYLE_UPDATE_UNSAFE"?"This update needs attention before another update can be requested.":"We couldn't update your writing style right now. Check its status before trying again."};}
}
