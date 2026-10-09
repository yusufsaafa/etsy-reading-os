"use server";
import { z } from "zod";
import { database } from "@/db/client";
import { currentStoreScope } from "@/modules/identity/session";
import { createDocumentDesign,updateDocumentDesign } from "@/modules/documents/service";
import { designWriteSchema } from "@/modules/documents/contracts";
export type StudioSaveResult={ok:true;id:string;revision:number}|{ok:false;message:string};
export async function saveStudioDesign(form:FormData):Promise<StudioSaveResult> {
 try {
  const scope=await currentStoreScope();
  const raw=form.get("configuration");if(typeof raw!=="string"||Buffer.byteLength(raw)>8192)throw new Error("INVALID");
  const value=designWriteSchema.parse({name:form.get("name"),configuration:JSON.parse(raw)});
  const intent=z.enum(["save","copy"]).parse(form.get("intent"));
  const db=database(),id=form.get("id");
  const row=intent==="save"&&id?await updateDocumentDesign(db,scope,z.uuid().parse(id),z.coerce.number().int().nonnegative().parse(form.get("revision")),value):await createDocumentDesign(db,scope,value);
  return {ok:true,id:row.id,revision:row.revision};
 }catch(error){
  // Preserve unsaved controls and never include the exception, payload or private identity.
  return {ok:false,message:error instanceof Error&&error.message==="DOCUMENT_DESIGN_CONFLICT"?"This design changed in another window. Reload its saved revision before saving again.":"The design could not be saved. Check the settings and your Store access. If the response was interrupted, inspect saved designs before repeating creation."};
 }
}
