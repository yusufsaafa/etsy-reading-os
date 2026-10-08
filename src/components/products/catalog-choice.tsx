"use client";
import {PurchaseCoverage} from "./purchase-coverage";
import {SourceSummary} from "./source-summary";
import type {SetupCatalog} from "@/modules/etsy/setup-catalog";
import type {ConfigurationStatus} from "./configuration-status";
import {SetupNavigation} from "./setup-navigation";
import styles from "./setup.module.css";
// Every row is one complete source identity choice; labels are presentation only.
export function CatalogChoice({catalog,statuses={},navigation=true}:{catalog:SetupCatalog;statuses?:Record<string,ConfigurationStatus>;navigation?:boolean}){
 return <section className="stack">{navigation&&<SetupNavigation current="Etsy options"/>}<SourceSummary listing={catalog.listing}/>
 {catalog.state==="BLOCKED"?<p role="alert" className="notice">This listing’s Etsy options or buyer questions need supported setup evidence before a draft can be created. No product has been created.</p>:<>
 <div className={styles.setupExplanation}><h2>How product setup works</h2><ol><li>Choose an Etsy purchase option.</li><li>Set up how Reading OS prepares the reading.</li><li>Save your setup and configure other options.</li></ol><p className="small muted">Different complete purchase choices can have different preparation settings.</p></div>
 <PurchaseCoverage catalog={catalog} statuses={statuses}/>
 <div><h3>Buyer questions on Etsy</h3>{catalog.questions.length?<ul>{catalog.questions.map(q=><li key={q.questionId}>{q.label} · Text · {q.required?"Required":"Optional"}</li>)}</ul>:<p>No buyer questions configured.</p>}<p className="small muted">Questions still need an explicit customer-field mapping before activation. Current listing definitions do not reinterpret historical purchases.</p></div>
 <p className="small muted">This saves setup intent only. Nothing is activated, prepared or sent.</p></>}
 </section>;
}
