import {z} from "zod";
import {notFound,redirect} from "next/navigation";
import {currentScope} from "@/modules/identity/session";
import {configurationHref} from "@/modules/products/workspace-navigation";
import type {ProductsParams} from "@/modules/catalog/query";
/** Legacy deep link lands on the canonical Product workspace before any editing. */
export default async function SetupPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<ProductsParams>}){
 const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();await currentScope();const q=await searchParams;
 redirect(configurationHref(id,{tab:"setup",listingId:typeof q.listing==="string"?q.listing:undefined,choice:typeof q.choice==="string"?q.choice:undefined,returnTo:typeof q.returnTo==="string"?q.returnTo:undefined}));
}
