"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {database} from "@/db/client";
import {currentStoreScope} from "@/modules/identity/session";
import {retryAutomaticIntake} from "@/modules/etsy/automatic-intake";
import {retryWebhookEvent} from "@/modules/etsy/webhook-intake";
export async function retryIntakeAction(form:FormData){
 const scope=await currentStoreScope();
 try{await retryAutomaticIntake(database(),scope,{id:form.get("id"),kind:form.get("kind"),commandId:form.get("commandId")});}catch{redirect("/etsy/diagnostics?retry=unavailable");}
 revalidatePath("/etsy/diagnostics");revalidatePath("/orders");redirect("/etsy/diagnostics?retry=pending");
}
export async function retryWebhookAction(form:FormData){
 const scope=await currentStoreScope();
 try{await retryWebhookEvent(database(),scope,{id:form.get("id"),commandId:form.get("commandId")});}catch{redirect("/etsy/diagnostics?retry=unavailable");}
 revalidatePath("/etsy/diagnostics");revalidatePath("/orders");redirect("/etsy/diagnostics?retry=pending");
}
