import {z} from "zod";
import {notFound} from "next/navigation";
import {currentScope} from "@/modules/identity/session";
import {AccessDenied} from "@/modules/identity/service";
import {ProductConfiguration} from "@/components/products/configuration";
import type {ProductsParams} from "@/modules/catalog/query";
export default async function ConfigurationPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<ProductsParams>}){
 const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();const scope=await currentScope();
 try{return await ProductConfiguration({scope,productId:id,query:await searchParams});}catch(error){if(error instanceof AccessDenied)notFound();throw error;}
}
