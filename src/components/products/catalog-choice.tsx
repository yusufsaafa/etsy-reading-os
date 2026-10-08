"use client";
import {useActionState} from "react";
import {SourceSummary} from "./source-summary";
import Link from "next/link";
import type {SetupCatalog} from "@/modules/etsy/setup-catalog";
import type {ConfigurationStatus} from "./configuration-status";
import {SetupNavigation} from "./setup-navigation";
import styles from "./setup.module.css";
import {startProductSetupState} from "./actions";
// Every row is one complete source identity choice; labels are presentation only.
export function CatalogChoice({catalog,statuses={},navigation=true}:{catalog:SetupCatalog;statuses?:Record<string,ConfigurationStatus>;navigation?:boolean}){
 const [state,action,pending]=useActionState(startProductSetupState,{});
 return <section className="stack">{navigation&&<SetupNavigation current="Etsy options"/>}<SourceSummary listing={catalog.listing}/>
 {catalog.state==="BLOCKED"?<p role="alert" className="notice">This listing’s Etsy options or buyer questions need supported setup evidence before a draft can be created. No product has been created.</p>:<>
 <div className={styles.setupExplanation}><h2>How product setup works</h2><ol><li>Choose an Etsy purchase option.</li><li>Set up how Reading OS prepares the reading.</li><li>Save your setup and configure other options.</li></ol><p className="small muted">Different complete purchase choices can have different preparation settings.</p></div>
 <h2>Etsy purchase options</h2><div className="stack">{catalog.configurations.map(choice=>{const saved=statuses[choice.key];return <div className={styles.configurationRow} key={choice.key}><strong>{choice.displaySelections.map(p=>`${p.label??"Etsy option"}: ${p.values.map(v=>v.label).join(", ")}`).join(" · ")||"No purchase options"}</strong><span className={styles.configurationState}>{saved?.status??"Not configured"}</span>{saved?.productId?<Link className="button secondary" href={"/onboarding/products/setup?product="+saved.productId}>{saved.status==="Active"?"View setup":"Continue setup"}</Link>:<form action={action}><input type="hidden" name="listingId" value={catalog.listing.id}/><input type="hidden" name="configurationKey" value={choice.key}/><button className="button secondary" disabled={pending}>{pending?"Opening setup…":"Set up"}</button></form>}</div>;})}</div>
 <div><h3>Buyer questions on Etsy</h3>{catalog.questions.length?<ul>{catalog.questions.map(q=><li key={q.questionId}>{q.label} · Text · {q.required?"Required":"Optional"}</li>)}</ul>:<p>No buyer questions configured.</p>}<p className="small muted">Questions still need an explicit customer-field mapping before activation. Current listing definitions do not reinterpret historical purchases.</p></div>
 {state.error&&<p role="alert" className="error-message">{state.error}</p>}<p className="small muted">This saves setup intent only. Nothing is activated, prepared or sent.</p></>}
 </section>;
}
