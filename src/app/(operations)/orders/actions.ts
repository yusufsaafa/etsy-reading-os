"use server";
import {revalidatePath} from "next/cache";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {syncOrderReceipt,syncFailure} from "@/modules/orders/sync";
export type SyncFeedback={message:string;error?:boolean;orderId?:string;historical?:boolean};
export async function syncOrdersAction(_previous:SyncFeedback,form:FormData):Promise<SyncFeedback>{
 const scope=await currentScope();
 try{
  const result=await syncOrderReceipt(database(),scope,{receiptId:form.get("receiptId"),commandId:form.get("commandId")});
  if(result.orderId){revalidatePath("/orders");revalidatePath(`/orders/${result.orderId}`);}
  const labels={IMPORTED:"Receipt imported",ALREADY_IMPORTED:"Receipt already imported; readings preserved",PARTIAL:"Receipt recorded with attention required",HISTORICAL:"Historical approval required. Nothing imported",INELIGIBLE:"Receipt is held. Nothing imported",UNRESOLVED:"Source evidence could not be safely resolved. No new readings imported"};
  const holds=result.holds.length?` Holds: ${result.holds.map(h=>h.replaceAll("_"," ")).join(", ")}.`:"";
  return {message:`${labels[result.kind]}.${result.orderId?` ${result.lines} purchased items, ${result.readings} readings.`:""}${holds}${result.finance==="FAILED"?" Financial projection failed; operational intake is recorded.":""} No generation or delivery was started.`,orderId:result.orderId,historical:result.kind==="HISTORICAL"};
 }catch(error){return {message:syncFailure(error),error:true};}
}
