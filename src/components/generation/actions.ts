"use server";
import { revalidatePath } from "next/cache";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { generationRuntime } from "@/infrastructure/ai/runtime";
import { AdmissionError } from "@/modules/generation/contracts";
export async function prepareReading(_: {message:string}, form:FormData) {
 try {
  const result=await generationRuntime(database()).prepare(await currentScope(),{unitId:form.get("unitId"),commandKey:form.get("commandKey"),...(form.get("retryGenerationId")?{retryGenerationId:form.get("retryGenerationId")}:{})});
  revalidatePath("/","layout");
  return {message:result.status==="SUCCEEDED"?"Reading is ready for review.":result.status==="FAILED"?"We couldn’t prepare this reading. Review the details and try again.":"This reading is preparing. Refresh to check its progress."};
 }catch(error){
  const messages:Partial<Record<AdmissionError["code"],string>>={
   CUSTOMER_INFORMATION:"Review the customer information before preparing this reading.",PRODUCT_SETUP:"Review the product setup.",
   SELLER_SETUP:"Save your profile name in Settings.",STYLE_SETUP:"Apply a complete style in Settings.",
   READING_HOLD:"Resolve this reading’s holds before preparing it.",ACTIVE_OPERATION:"This reading is already preparing. Refresh to check its progress.",
   COMMAND_CONFLICT:"This reading already has saved work. Refresh to view it.",CONTEXT_CHANGED:"Customer information has changed. Review it before continuing.",
   RETRY_UNCERTAIN:"This preparation needs an operational check before another attempt.",BUDGET_LIMIT:"Preparation is temporarily unavailable. Contact support.",
  };
  return {message:error instanceof AdmissionError?messages[error.code]??"Review this reading before continuing.":"Preparation is unavailable. Check your setup or contact support."};
 }
}
