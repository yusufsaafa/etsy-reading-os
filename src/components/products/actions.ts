"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { database } from "@/db/client";
import { currentStoreScope, currentDestination } from "@/modules/identity/session";
import { beginListingDraft, editProduct, saveProductDraft, activateProduct } from "@/modules/products/service";
import { completeProductOnboarding } from "@/modules/onboarding/service";
export type SetupState = { error?:string; saved?:boolean; revision?:number; activated?:boolean };
export async function startProductSetup(form:FormData) {
  const scope=await currentStoreScope(), db=database();
  const listing=z.string().regex(/^[1-9]\d{0,19}$/).parse(form.get("listingId")), variant=z.string().min(1).max(2000).parse(form.get("variantKey"));
  const productId=await beginListingDraft(db,scope,listing,variant); await editProduct(db,scope,productId);
  const destination=await currentDestination();
  redirect(destination.kind==="OPERATIONS_HOME" ? "/products/"+productId+"/setup" : "/onboarding/products/setup?product="+productId);
}
export async function createProductEdit(form:FormData) {
  const id=z.string().uuid().parse(form.get("productId"));await editProduct(database(),await currentStoreScope(),id);revalidatePath("/", "layout");
}
export async function saveConfiguration(_state:SetupState,form:FormData):Promise<SetupState> {
  const scope=await currentStoreScope();
  try {
    const productId=z.string().uuid().parse(form.get("productId")),versionId=z.string().uuid().parse(form.get("versionId")),revision=z.coerce.number().int().nonnegative().parse(form.get("revision"));
    const name=z.string().max(100).parse(form.get("name")), json=z.string().max(80000).parse(form.get("configuration"));
    const db=database(), payload={name,configuration:JSON.parse(json)};
    if(form.get("intent")==="activate") {
      await activateProduct(db,scope,productId,versionId,revision,payload); revalidatePath("/", "layout"); return {activated:true};
    }
    const version=await saveProductDraft(db,scope,productId,versionId,revision,payload);revalidatePath("/", "layout");return {saved:true,revision:version.revision};
  } catch(error) {
    const allowed=["Enter a product name.","Customer field", "Content sections", "Add at least", "Choose an output", "Choose a workflow", "Automatic workflow", "The Etsy listing", "A valid Etsy", "STALE_PRODUCT_DRAFT", "DRAFT_UNAVAILABLE"];
    const message=error instanceof Error ? error.message : "";
    return {error:allowed.some(prefix=>message.startsWith(prefix)) ? message.includes("STALE_")||message==="DRAFT_UNAVAILABLE" ? "This draft has changed. Reload before editing again." : message : "Unable to save this product. Check your fields and access, then try again."};
  }
}
export async function finishProductOnboarding() {
  await completeProductOnboarding(database(),await currentStoreScope());revalidatePath("/", "layout");redirect("/");
}
