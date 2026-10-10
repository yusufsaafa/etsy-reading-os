"use server";
import {redirect,unstable_rethrow} from "next/navigation";
import {revalidatePath} from "next/cache";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {beginCatalogChoiceDraft} from "@/modules/products/catalog-setup";
import {configurationHref} from "@/modules/products/workspace-navigation";
export type ChoiceSetupState={error?:string};
export async function createChoiceDraft(_previous:ChoiceSetupState,form:FormData):Promise<ChoiceSetupState>{
 try{
  const scope=await currentScope(),listingId=String(form.get("listingId")??""),choice=String(form.get("choice")??"");
  const id=await beginCatalogChoiceDraft(database(),scope,{listingId,choice});revalidatePath("/products");
  redirect(configurationHref(id,{listingId,choice,returnTo:typeof form.get("returnTo")==="string"?String(form.get("returnTo")):undefined,tab:"setup"}));
 }catch(error){unstable_rethrow(error);return {error:"Setup could not be started. Your saved configuration is unchanged. Review catalog verification, listing availability and your access before trying again."};}
}
