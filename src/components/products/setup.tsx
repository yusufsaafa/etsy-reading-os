import Link from "next/link";
import { database } from "@/db/client";
import type { Scope } from "@/modules/intake/contracts";
import { productData, catalogData } from "@/modules/products/service";
import { StepHeader } from "../onboarding/shell";
import { Heading, Badge } from "../ui";
import { ProductEditor } from "./editor";
import { createProductEdit, finishProductOnboarding } from "./actions";
export async function ProductSetup({scope,productId,onboarding=false}:{scope:Scope;productId:string;onboarding?:boolean}) {
 const data=await productData(database(),scope,productId),catalog=await catalogData(database(),scope);
 const listing=catalog.listings.find(l=>l.externalId===data.bindings[0]?.listingExternalId);
 return <div className="stack"><Link className="back-link" href={onboarding?"/onboarding/products/setup":"/products"}>← Products</Link>{onboarding?<StepHeader step={4} title={data.product.name||"Product setup"} description={listing?"Etsy · "+listing.title:"Configure your personalized product."}/>:<Heading title={data.product.name||"Product setup"} description={listing?"Etsy · "+listing.title:"Configure your personalized product."}/>}
 {data.active&&<p className="notice"><Badge tone="good">Active · v{data.active.versionNumber}</Badge> New orders use this version. Existing readings keep their original configuration.</p>}
 {data.draft?<ProductEditor key={data.draft.id} productId={productId} versionId={data.draft.id} revision={data.draft.revision} initialName={data.product.name} initial={data.draft.configuration}/>:data.active&&<section className="card stack"><h2>Published configuration</h2><p>{data.active.configuration.inputs.map(f=>f.label+(f.required?" (required)":" (optional)")).join(" · ")||"No customer fields required."}</p><p>Content: {data.active.configuration.sections.map(s=>s.title).join(" → ")}</p><p>Output: {data.active.configuration.output==="PDF"?"PDF":"Text"} · Workflow: {data.active.configuration.workflow==="ASSISTED"?"Assisted":"Manual"}</p><p className="small muted">Configuration only. Content creation, documents and sending remain unavailable.</p><form action={createProductEdit}><input type="hidden" name="productId" value={productId}/><button className="button secondary">Edit product</button></form></section>}
 {onboarding&&data.active&&data.bindings.some(b=>!b.paused)&&<form action={finishProductOnboarding}><button className="button">Continue to Home</button><p className="small muted">You can set up your other products later.</p></form>}</div>;
}
