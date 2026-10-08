"use client";
import {useActionState} from "react";
import Link from "next/link";
import type {SetupCatalog} from "@/modules/etsy/setup-catalog";
import type {ConfigurationStatus} from "./configuration-status";
import {startProductSetupState} from "./actions";
import styles from "./setup.module.css";
export function PurchaseCoverage({catalog,statuses}:{catalog:SetupCatalog;statuses:Record<string,ConfigurationStatus>}){
 const [state,action,pending]=useActionState(startProductSetupState,{});
 const active=catalog.configurations.filter(c=>statuses[c.key]?.status==="Active").length;
 return <section className={styles.coverage} aria-label="Etsy purchase configuration coverage"><h2>Purchase options</h2><p><strong>{active} of {catalog.configurations.length} purchase options active</strong></p><p className={styles.caption}>This listing is configured for {active} of {catalog.configurations.length} Etsy purchase options. Orders containing other purchase options cannot be automatically prepared until those options are configured. Drafts are not active.</p><div className="stack">{catalog.configurations.map(c=>{const saved=statuses[c.key];return <div className={styles.configurationRow} key={c.key}><strong>{c.displaySelections.map(p=>p.values.map(v=>v.label).join(", ")).join(" + ")||"No purchase options"}</strong><span className={styles.configurationState}>{saved?.status??"Not configured"}</span>{saved?.productId?<Link className="button secondary" href={"/onboarding/products/setup?product="+saved.productId}>{saved.status==="Active"?"View setup":"Continue setup"}</Link>:catalog.state==="READY"?<form action={action}><input type="hidden" name="listingId" value={catalog.listing.id}/><input type="hidden" name="configurationKey" value={c.key}/><button className="button secondary" disabled={pending}>Set up</button></form>:<span>Setup unavailable</span>}</div>;})}</div>{state.error&&<p role="alert">{state.error}</p>}<p className={styles.caption}>Activation covers one complete purchase choice. Review, approval and Etsy delivery stay separate.</p></section>;
}
