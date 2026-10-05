import { z } from "zod";
import { redirect, notFound } from "next/navigation";
import { database } from "@/db/client";
import { currentStoreScope, currentDestination } from "@/modules/identity/session";
import { catalogData } from "@/modules/products/service";
import { AccessDenied } from "@/modules/identity/service";
import { StepHeader } from "@/components/onboarding/shell";
import { Badge } from "@/components/ui";
import { ProductSetup } from "@/components/products/setup";
import { startProductSetup, finishProductOnboarding } from "@/components/products/actions";
export default async function SetupPage({searchParams}:{searchParams:Promise<{product?:string}>}) {
 const scope=await currentStoreScope(),destination=await currentDestination();if(destination.kind!=="PRODUCT_SETUP")redirect(destination.path);
 const {product}=await searchParams;if(product){if(!z.string().uuid().safeParse(product).success)notFound();try{return await ProductSetup({scope,productId:product,onboarding:true});}catch(error){if(error instanceof AccessDenied)notFound();throw error;}}
 const data=await catalogData(database(),scope),selected=data.listings.filter(l=>data.selections.some(s=>s.listingExternalId===l.externalId));
 const hasActive=data.mappings.some(m=>!m.paused&&selected.some(l=>l.externalId===m.listingExternalId)&&data.products.some(p=>p.id===m.productId&&p.activeVersionId));
 return <><StepHeader step={4} title="Set up your products" description="Activate your first product to open your workspace. You can finish the others later."/><div className="product-list">{selected.map(listing=>{
 const mapping=data.mappings.find(m=>m.listingExternalId===listing.externalId&&m.variantKey==="default"),p=data.products.find(p=>p.id===mapping?.productId),draft=data.versions.some(v=>v.productId===p?.id&&v.status==="DRAFT"),status=p?.activeVersionId?"Active":draft?"Draft":"Setup required";
 return <article className="product-record" key={listing.externalId}><div className="product-summary onboarding-summary"><div className="product-title"><h2>{listing.title}</h2><span className="small muted">Active on Etsy</span></div><Badge tone={status==="Active"?"good":"neutral"}>{status}</Badge><form action={startProductSetup}><input type="hidden" name="listingId" value={listing.externalId}/><input type="hidden" name="variantKey" value="default"/><button className="button secondary">{status==="Active"?"Edit product":draft?"Continue setup":"Set up product"}</button></form></div></article>;
 })}</div>{hasActive&&<form action={finishProductOnboarding} style={{marginTop:24}}><button className="button">Continue to Home</button></form>}</>;
}
