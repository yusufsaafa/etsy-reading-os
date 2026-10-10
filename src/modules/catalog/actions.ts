"use server";
import {revalidatePath} from "next/cache";
import {database} from "../../db/client";
import {currentStoreScope} from "../identity/session";
import {syncCatalog} from "./sync";
export async function syncCatalogAction(_previous:{error?:string},_form:FormData):Promise<{error?:string}>{
 const scope=await currentStoreScope();
 try{const result=await syncCatalog(database(),scope);revalidatePath("/products");revalidatePath("/onboarding","layout");
 if(result.issues.length)return {error:"Catalog synchronization is incomplete. Saved catalog and product settings are preserved. Try again after checking your Etsy connection."};
 if(result.hasMore)return {error:"Catalog batch saved. Select Sync Etsy catalog again to continue; remaining purchase options are not yet verified."};return {};
 }catch{return {error:"Catalog synchronization could not start. Check your access or wait for the current synchronization to finish."};}
}
