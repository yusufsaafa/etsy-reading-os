import { z } from "zod";
import { notFound } from "next/navigation";
import { currentScope } from "@/modules/identity/session";
import { ProductSetup } from "@/components/products/setup";
import { AccessDenied } from "@/modules/identity/service";
export default async function SetupPage({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();const scope=await currentScope();
 try{return await ProductSetup({scope,productId:id});}catch(error){if(error instanceof AccessDenied)notFound();throw error;}
}
