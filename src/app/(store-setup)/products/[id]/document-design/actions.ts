"use server";
import {z} from "zod";
import {redirect} from "next/navigation";
import {database} from "@/db/client";
import {currentStoreScope} from "@/modules/identity/session";
import {createDocumentDesign,assignDocumentDesignToProduct} from "@/modules/documents/service";
export async function assignProductDocumentDesign(form:FormData){
 const scope=await currentStoreScope();const product=z.uuid().parse(form.get("product"));
 const raw=form.get("design");const design=raw==="store-default"?null:z.uuid().parse(raw);
 try{await assignDocumentDesignToProduct(database(),scope,product,design);}
 catch{redirect(`/products/${product}/document-design?error=assignment`);}
 redirect(`/products/${product}/document-design?saved=1`);
}

export async function createOwnerDocumentDesign(form:FormData){
 const scope=await currentStoreScope(),product=z.uuid().parse(form.get("product")),db=database();
 const {productData}=await import("@/modules/products/service");
 const {approvedOwnerDesign}=await import("@/modules/documents/owner-design");
 // Verify the target belongs to this Store before permitting creation from this page.
 await productData(db,scope,product);
 try{
  const value=approvedOwnerDesign({name:form.get("name"),brandName:form.get("brandName"),template:form.get("template"),heading:form.get("heading"),body:form.get("body"),footerText:form.get("footerText"),approved:form.get("approved")==="on"});
  await createDocumentDesign(db,scope,value);
 }catch{redirect(`/products/${product}/document-design?error=creation`);}
 redirect(`/products/${product}/document-design?created=1`);
}
