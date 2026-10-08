import {vault} from "@/infrastructure/secrets";
import {getEtsySetupCatalog} from "@/modules/products/etsy-setup";
import {discoverProducts} from "@/modules/onboarding/discovery";
import {SourceSummary} from "@/components/products/source-summary";
import {CatalogChoice} from "@/components/products/catalog-choice";
import Link from "next/link";
import { z } from "zod";
import { redirect, notFound } from "next/navigation";
import { database } from "@/db/client";
import { currentStoreScope, currentDestination } from "@/modules/identity/session";
import { catalogData } from "@/modules/products/service";
import { AccessDenied } from "@/modules/identity/service";
import { StepHeader } from "@/components/onboarding/shell";
import { Badge } from "@/components/ui";
import { ProductSetup } from "@/components/products/setup";
import { finishProductOnboarding } from "@/components/products/actions";
export default async function SetupPage({searchParams}:{searchParams:Promise<{product?:string;listing?:string}>}) {
 const scope=await currentStoreScope(),destination=await currentDestination();if(destination.kind!=="PRODUCT_SETUP")redirect(destination.path);
 const {product,listing:listingId}=await searchParams;
 if(listingId){
  if(!z.string().regex(/^[1-9]\d{0,18}$/).safeParse(listingId).success)notFound();
  try{return <><StepHeader step={4} title="Choose Etsy options" description="Confirm the purchase options before configuring this product."/><CatalogChoice catalog={await getEtsySetupCatalog(database(),scope,listingId,vault())}/></>;}
  catch{return <><StepHeader step={4} title="Product setup" description="Your product selection has not changed."/><p role="alert">Etsy setup information couldn't be loaded. Check your connection and try again.</p><Link className="button secondary" href={"/onboarding/products/setup?listing="+listingId}>Try again</Link><Link className="back-link" href="/onboarding/products/setup">← Back to products</Link></>;}
 }
 if(product){if(!z.string().uuid().safeParse(product).success)notFound();try{return await ProductSetup({scope,productId:product,onboarding:true});}catch(error){if(error instanceof AccessDenied)notFound();return <div role="alert"><h1>Product setup couldn’t load</h1><p>Your saved draft has not changed. Check your Etsy connection and try again.</p><Link className="button secondary" href={"/onboarding/products/setup?product="+product}>Try again</Link><Link className="back-link" href="/onboarding/products/setup">Back to products</Link></div>;}}
 const data=await catalogData(database(),scope),selected=data.listings.filter(l=>data.selections.some(s=>s.listingExternalId===l.externalId));
 let discovery:Awaited<ReturnType<typeof discoverProducts>>|undefined;try{discovery=await discoverProducts(database(),scope,vault());}catch{}
 const hasActive=data.mappings.some(m=>!m.paused&&selected.some(l=>l.externalId===m.listingExternalId)&&data.products.some(p=>p.id===m.productId&&p.activeVersionId));
 return <><Link className="back-link" href="/onboarding/products">← Back to products</Link><StepHeader step={4} title="Set up your products" description="Activate your first product to open your workspace. You can finish the others later."/><div className="product-list">{selected.map(listing=>{
 const mapping=data.mappings.find(m=>m.listingExternalId===listing.externalId&&m.variantKey.startsWith("etsy-selection/1:"))??data.mappings.find(m=>m.listingExternalId===listing.externalId&&m.variantKey==="default"),p=data.products.find(p=>p.id===mapping?.productId),draft=data.versions.some(v=>v.productId===p?.id&&v.status==="DRAFT"),status=p?.activeVersionId?"Active":draft?"Draft":"Setup required";
 return <article className="product-record" key={listing.externalId}><div className="product-summary onboarding-summary"><SourceSummary listing={{id:listing.externalId,title:listing.title,state:discovery?.products.find(l=>l.externalId===listing.externalId)?.state??listing.state,thumbnailUrl:discovery?.products.find(l=>l.externalId===listing.externalId)?.thumbnailUrl}}/><Badge tone={status==="Active"?"good":"neutral"}>{status}</Badge><Link className="button secondary" href={p&&mapping?.variantKey.startsWith("etsy-selection/1:")?"/onboarding/products/setup?product="+p.id:"/onboarding/products/setup?listing="+listing.externalId}>{status==="Active"?"Edit product":draft?"Continue setup":"Set up product"}</Link></div></article>;
 })}</div>{!discovery&&<p className="notice">Etsy images could not be refreshed. Your saved selections are unchanged. Reload this page to try again.</p>}{hasActive&&<form action={finishProductOnboarding} style={{marginTop:24}}><button className="button">Continue to Home</button></form>}</>;
}
