"use client";
import {useActionState} from "react";
import {SourceSummary} from "./source-summary";
import Link from "next/link";
import type {SetupCatalog} from "@/modules/etsy/setup-catalog";
import {startProductSetupState} from "./actions";
// Complete source identity choices precede creation; labels are presentation only.
export function CatalogChoice({catalog}:{catalog:SetupCatalog}){
 const [state,action,pending]=useActionState(startProductSetupState,{});
 return <section className="stack"><Link className="back-link" href="/onboarding/products/setup">← Back to products</Link>
 <SourceSummary listing={catalog.listing}/>
 {catalog.state==="BLOCKED"?<p role="alert" className="notice">This listing’s Etsy options or buyer questions need supported setup evidence before a draft can be created. No product has been created.</p>:<>
 <p>Choose the Etsy purchase options this product will prepare. You will configure the reading and completion target afterward.</p>
 <form action={action} className="stack"><input type="hidden" name="listingId" value={catalog.listing.id}/>
 <fieldset className="stack"><legend>Etsy purchase options</legend>{catalog.configurations.map(choice=><label className="check" key={choice.key}><input type="radio" name="configurationKey" value={choice.key} required/>{choice.displaySelections.map(p=>`${p.label??"Etsy option"}: ${p.values.map(v=>v.label).join(", ")}`).join(" · ")||"No purchase options"}</label>)}</fieldset>
 <div><h3>Buyer questions on Etsy</h3>{catalog.questions.length?<ul>{catalog.questions.map(q=><li key={q.questionId}>{q.label} · Text · {q.required?"Required":"Optional"}</li>)}</ul>:<p>No buyer questions configured.</p>}<p className="small muted">Questions still need an explicit customer-field mapping before activation. Current listing definitions do not reinterpret historical purchases.</p></div>
 {state.error&&<p role="alert" className="error-message">{state.error}</p>}<button className="button" disabled={pending}>{pending?"Opening setup…":"Create or continue draft"}</button><p className="small muted">This saves setup intent only. Nothing is activated, prepared or sent.</p></form></>}
 </section>;
}
