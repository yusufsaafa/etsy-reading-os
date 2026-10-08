import {SetupNavigation} from "./setup-navigation";
import {configurationStatuses} from "./configuration-status";
import Link from "next/link";
import styles from "./setup.module.css";
import {getEtsySetupCatalog} from "@/modules/products/etsy-setup";
import {SourceSummary} from "./source-summary";
import {selectionKey} from "@/modules/etsy/source-contract";
import {vault} from "@/infrastructure/secrets";
import { database } from "@/db/client";
import type { Scope } from "@/modules/intake/contracts";
import { productData, catalogData } from "@/modules/products/service";
import { StepHeader } from "../onboarding/shell";
import { Heading, Badge } from "../ui";
import { ProductEditor } from "./editor";
import { createProductEdit, finishProductOnboarding } from "./actions";
export async function ProductSetup({scope,productId,onboarding=false}:{scope:Scope;productId:string;onboarding?:boolean}) {
 const data=await productData(database(),scope,productId),catalog=await catalogData(database(),scope);
 const policy=data.draft?.configuration.etsyFulfillment??data.active?.configuration.etsyFulfillment;
 const setupCatalog=policy?await getEtsySetupCatalog(database(),scope,policy.listingId,vault()):undefined;
 if(setupCatalog&&(!data.bindings.some(b=>b.listingExternalId===policy!.listingId&&b.variantKey===selectionKey(policy!.purchaseSelections))||!setupCatalog.configurations.some(c=>c.key===selectionKey(policy!.purchaseSelections))))throw new Error("SETUP_SOURCE_CHANGED");
 if(!data.draft&&!data.active)return <div role="alert"><h1>Product setup is unavailable</h1><p>Your saved work has not changed.</p><Link href="/onboarding/products/setup">Back to products</Link></div>;
 const listing=catalog.listings.find(l=>l.externalId===data.bindings[0]?.listingExternalId);
 return <div className={styles.setupPage}><SetupNavigation current="Reading setup" href={onboarding?"/onboarding/products/setup":"/products"}/>{onboarding?<StepHeader step={4} title={data.product.name||"Product setup"} description={listing?"Etsy · "+listing.title:"Configure your personalized product."}/>:<Heading title={data.product.name||"Product setup"} description={listing?"Etsy · "+listing.title:"Configure your personalized product."}/>}
 {setupCatalog&&<SourceSummary listing={setupCatalog.listing}/>}
 {data.active&&<p className="notice"><Badge tone="good">Active · v{data.active.versionNumber}</Badge> New orders use this version. Existing readings keep their original configuration.</p>}
 {data.draft?<ProductEditor key={data.draft.id} productId={productId} versionId={data.draft.id} revision={data.draft.revision} initialName={data.product.name} initial={data.draft.configuration} catalog={setupCatalog} configurationStatuses={policy?configurationStatuses(catalog,policy.listingId):undefined}/>:data.active&&<section className="card stack"><h2>Published configuration</h2><p>{data.active.configuration.inputs.map(f=>f.label+(f.required?" (required)":" (optional)")).join(" · ")||"No customer fields required."}</p><p>Content: {data.active.configuration.sections.map(s=>s.title).join(" → ")}</p><p>Output: {data.active.configuration.output==="PDF"?"PDF":"Text"} · Workflow: {data.active.configuration.workflow==="ASSISTED"?"Assisted":"Manual"}</p><p className="small muted">Published setup applies to new purchases. Preparation and seller review are separate from Etsy delivery.</p><form action={createProductEdit}><input type="hidden" name="productId" value={productId}/><button className="button secondary">Edit product</button></form></section>}
 {onboarding&&data.active&&data.bindings.some(b=>!b.paused)&&<form action={finishProductOnboarding}><button className="button">Continue to Home</button><p className="small muted">You can set up your other products later.</p></form>}</div>;
}
