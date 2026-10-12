"use server";
import {revalidatePath} from "next/cache";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {syncOrderReceipt,syncFailure} from "@/modules/orders/sync";
import {assertInternalOperator} from "@/modules/identity/internal-access";
export type SyncFeedback={message:string;error?:boolean;orderId?:string;historical?:boolean};
export async function syncOrdersAction(_previous:SyncFeedback,form:FormData):Promise<SyncFeedback>{
 const scope=await currentScope();
 try{
  assertInternalOperator(scope.userId);
  const result=await syncOrderReceipt(database(),scope,{receiptId:form.get("receiptId"),commandId:form.get("commandId")});
  if(result.orderId){revalidatePath("/orders");revalidatePath(`/orders/${result.orderId}`);}
  const labels={IMPORTED:"Receipt imported",ALREADY_IMPORTED:"Receipt already imported; readings preserved",PARTIAL:"Receipt recorded with attention required",HISTORICAL:"Historical approval required. Nothing imported",INELIGIBLE:"Receipt is held. Nothing imported",UNRESOLVED:"Source evidence could not be safely resolved. No new readings imported"};
  const holds=result.holds.length?` Holds: ${result.holds.map(h=>h.replaceAll("_"," ")).join(", ")}.`:"";
  return {message:`${labels[result.kind]}.${result.orderId?` ${result.lines} purchased items, ${result.readings} readings.`:""}${holds}${result.finance==="FAILED"?" Financial projection failed; operational intake is recorded.":""} No generation or delivery was started.`,orderId:result.orderId,historical:result.kind==="HISTORICAL"};
 }catch(error){return {message:syncFailure(error),error:true};}
}

export async function assignReadingAction(_previous:{message:string},form:FormData):Promise<{message:string}>{
 const scope=await currentScope();
 const {assignReadingConfiguration,AssignmentError,assignmentReason}=await import("@/modules/orders/assignment");
 try{
  const result=await assignReadingConfiguration(database(),scope,{unitId:form.get("unitId"),versionId:form.get("versionId"),commandId:form.get("commandId"),expectedRevision:Number(form.get("revision")),confirmed:form.get("confirmed")==="yes"});
  revalidatePath("/orders");revalidatePath(`/orders/${result.orderId}`);revalidatePath("/");
  return {message:result.kind==="ASSIGNED"?"Configuration assigned. Review customer information, then use Prepare reading when eligible. No generation was started.":"This configuration is already assigned. No generation was started."};
 }catch(error){return {message:error instanceof AssignmentError?assignmentReason(error.code):"Assignment unavailable. Refresh and check ownership, purchase evidence and the selected configuration."};}
}
