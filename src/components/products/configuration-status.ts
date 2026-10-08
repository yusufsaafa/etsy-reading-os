import type {catalogData} from "@/modules/products/service";
import {selectionKey} from "../../modules/etsy/source-contract";
export type ConfigurationStatus={status:"Not configured"|"Draft"|"Active";productId?:string};
// Input is the existing Store-authorized catalog projection. Labels and SKU never participate.
export function configurationStatuses(data:Pick<Awaited<ReturnType<typeof catalogData>>,"mappings"|"products"|"versions">,listingId:string):Record<string,ConfigurationStatus>{
 const result:Record<string,ConfigurationStatus>={};
 for(const binding of data.mappings.filter(m=>m.listingExternalId===listingId)){
  const product=data.products.find(p=>p.id===binding.productId);if(!product)continue;
  const exact=data.versions.filter(v=>v.productId===product.id&&v.configuration.etsyFulfillment?.listingId===listingId&&selectionKey(v.configuration.etsyFulfillment.purchaseSelections)===binding.variantKey);
  const active=exact.find(v=>v.status==="ACTIVE"&&v.id===product.activeVersionId),draft=exact.find(v=>v.status==="DRAFT");
  if(active||draft)result[binding.variantKey]={status:active?"Active":"Draft",productId:product.id};
 }
 return result;
}
