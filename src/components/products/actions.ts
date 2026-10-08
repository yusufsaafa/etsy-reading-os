"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { database } from "@/db/client";
import { currentStoreScope, currentDestination } from "@/modules/identity/session";
import { beginListingDraft, editProduct, saveProductDraft, activateProduct } from "@/modules/products/service";
import {stores} from "@/db/schema";
import {and,eq} from "drizzle-orm";
import {vault} from "@/infrastructure/secrets";
import {beginSelectedEtsyDraft,getEtsySetupCatalog,assertSetupPolicy} from "@/modules/products/etsy-setup";
import {withTargetPriority} from "@/modules/products/target-priority";
import {setupReadiness} from "./setup-model";
import {configurationSchema} from "@/modules/products/contracts";
import { completeProductOnboarding } from "@/modules/onboarding/service";
export type SetupState = { error?:string; saved?:boolean; revision?:number; activated?:boolean };
export async function startProductSetup(form:FormData) {
  const scope=await currentStoreScope(), db=database();
  const listing=z.string().regex(/^[1-9]\d{0,18}$/).parse(form.get("listingId"));
  const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
  if(store.source==="etsy"&&!form.has("configurationKey"))redirect("/onboarding/products/setup?listing="+listing);
  const productId=store.source==="etsy"?await beginSelectedEtsyDraft(db,scope,{listingId:listing,configurationKey:form.get("configurationKey")},vault()):await beginListingDraft(db,scope,listing,z.string().min(1).max(2000).parse(form.get("variantKey")));
  await editProduct(db,scope,productId);
  const destination=await currentDestination();
  redirect(destination.kind==="OPERATIONS_HOME" ? "/products/"+productId+"/setup" : "/onboarding/products/setup?product="+productId);
}
export async function startProductSetupState(_previous:SetupState,form:FormData):Promise<SetupState> {
 try {await startProductSetup(form);return {};} catch(error){unstable_rethrow(error);return {error:"Product setup couldn’t be opened. Your saved draft is unchanged. Check your Etsy connection and try again."};}
}
export async function createProductEdit(form:FormData) {
  const id=z.string().uuid().parse(form.get("productId"));await editProduct(database(),await currentStoreScope(),id);revalidatePath("/", "layout");
}
export async function saveConfiguration(_state:SetupState,form:FormData):Promise<SetupState> {
  const scope=await currentStoreScope();
  try {
    const productId=z.string().uuid().parse(form.get("productId")),versionId=z.string().uuid().parse(form.get("versionId")),revision=z.coerce.number().int().nonnegative().parse(form.get("revision"));
    const name=z.string().max(100).parse(form.get("name")), json=z.string().max(80000).parse(form.get("configuration"));
    const db=database(), payload={name,configuration:withTargetPriority(configurationSchema.parse(JSON.parse(json)))};
    if(form.get("intent")==="activate") {
      const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
      if(store.source==="etsy"){
        const configuration=configurationSchema.parse(payload.configuration);
        if(!configuration.etsyFulfillment)return {error:"Choose this product’s Etsy options before activation."};
        try{const catalog=await getEtsySetupCatalog(db,scope,configuration.etsyFulfillment.listingId,vault());assertSetupPolicy(catalog,configuration.etsyFulfillment);const errors=setupReadiness(name,configuration,catalog);if(errors.length)return {error:errors.join(" ")};}catch{return {error:"Review the Etsy options and map each supported buyer question before activation."};}
      }
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
