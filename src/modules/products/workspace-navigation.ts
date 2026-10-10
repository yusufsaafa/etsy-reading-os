import {productsReturnHref} from "../catalog/query";
export const productTabs=["overview","setup","generation","pdf","readiness"] as const;
export type ProductTab=typeof productTabs[number];
export function productTab(value:unknown):ProductTab{return productTabs.includes(value as ProductTab)?value as ProductTab:"overview";}
export function configurationHref(productId:string,context:{listingId?:string;choice?:string;returnTo?:string;tab?:ProductTab}={}){
 const p=new URLSearchParams();if(context.tab&&context.tab!=="overview")p.set("tab",context.tab);
 if(context.listingId&&/^[1-9]\d{0,19}$/.test(context.listingId))p.set("listing",context.listingId);
 if(context.choice&&context.choice.length<=2000&&context.choice.startsWith("etsy-selection/1:"))p.set("choice",context.choice);
 const back=productsReturnHref(context.returnTo);if(back!=="/products")p.set("returnTo",back);
 return `/products/${encodeURIComponent(productId)}/configuration${p.size?"?"+p.toString():""}`;
}

/** Assignment feedback stays inside the owned Product workspace; never accepts an arbitrary redirect. */
export function configurationReturnHref(value:unknown,productId:string){
 if(typeof value!=="string"||value.length>6000)return null;
 try{const url=new URL(value,"https://reading-os.invalid");if(url.origin!=="https://reading-os.invalid"||url.pathname!==`/products/${productId}/configuration`||!value.startsWith("/products/")||url.hash)return null;
 return configurationHref(productId,{listingId:url.searchParams.get("listing")??undefined,choice:url.searchParams.get("choice")??undefined,returnTo:url.searchParams.get("returnTo")??undefined,tab:"pdf"});}catch{return null;}
}
