"use server";
import {z} from "zod";
import {redirect} from "next/navigation";
import {database} from "@/db/client";
import {currentStoreScope} from "@/modules/identity/session";
import {assignDocumentDesignToProduct} from "@/modules/documents/service";
export async function assignProductDocumentDesign(form:FormData){
 const scope=await currentStoreScope();const product=z.uuid().parse(form.get("product"));
 const raw=form.get("design");const design=raw==="store-default"?null:z.uuid().parse(raw);
 try{await assignDocumentDesignToProduct(database(),scope,product,design);}
 catch{redirect(`/products/${product}/document-design?error=assignment`);}
 redirect(`/products/${product}/document-design?saved=1`);
}
