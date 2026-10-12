"use server";
import {revalidatePath} from "next/cache";
import {currentScope} from "@/modules/identity/session";
import {database} from "@/db/client";
import {configuredDocumentPorts} from "@/infrastructure/document-runtime";
import {recordManualDelivery,DeliveryError} from "@/modules/deliveries/service";
export type DeliveryActionState={error?:string;success?:string};
export async function manualDeliveryAction(readingId:string,_state:DeliveryActionState,form:FormData):Promise<DeliveryActionState>{
 try{
  const allowed=["artifactId","commandId","expectedSequence","action","confirmed","note"];
  if([...form.keys()].some(k=>!allowed.includes(k)&&!k.startsWith("$ACTION_")))throw new DeliveryError("CONFIRMATION_REQUIRED");
  const scope=await currentScope();
  let storage;try{storage=configuredDocumentPorts()?.artifacts;}catch{}
  await recordManualDelivery(database(),scope,{readingId,artifactId:form.get("artifactId"),commandId:form.get("commandId"),expectedSequence:Number(form.get("expectedSequence")),action:form.get("action"),confirmed:form.get("confirmed")==="yes",note:form.get("note")??""},storage);
 }catch(error){return {error:error instanceof DeliveryError&&error.code==="CONFLICT"?"Delivery history changed. Refresh before confirming or correcting it.":error instanceof DeliveryError&&error.code==="CONFIRMATION_REQUIRED"?"Confirm the action and provide a reason when correcting delivery.":"Delivery could not be recorded. Check the approved PDF and refresh before trying again."};}
 revalidatePath("/deliveries");revalidatePath(`/deliveries/${readingId}`);
 return {success:"Delivery history updated. No message or file was sent by Reading OS."};
}
