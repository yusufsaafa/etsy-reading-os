import Link from "next/link";
import { redirect } from "next/navigation";
import { database } from "@/db/client";
import { currentStoreScope } from "@/modules/identity/session";
import { onboardingData } from "@/modules/onboarding/service";
import { StepHeader } from "@/components/onboarding/shell";
import { ProductPicker, ImportRefresh, ActionForm } from "@/components/onboarding/forms";
import { retryImportAction, continueToProductsAction } from "../actions";
import styles from "@/components/onboarding/onboarding.module.css";
export default async function ChooseProducts() {
  const data = await onboardingData(database(), await currentStoreScope());
  if (data.store.stage === "complete") redirect("/");
  if (data.connection.kind !== "connected") redirect("/onboarding/etsy");
  const pending = ["queued", "running"].includes(data.importStatus);
  return <><StepHeader step={3} title="Choose your products" description="Select the Etsy listings you want to set up in Reading OS."/>
    {pending ? <><ImportRefresh/><p className={styles.note}>Your products will appear here when the import finishes.</p>{data.store.source === "fixtures" && <details><summary>Development help</summary><p className={styles.note}>Run the background worker with <code>pnpm worker</code> to import the demo shop.</p></details>}</> : data.importStatus === "failed" || data.importStatus === "canceled" ? <div className={styles.empty} role="alert"><h2>Your products couldn't be imported</h2><p>Your selection hasn't changed. Check your connection and try again.</p><ActionForm action={retryImportAction} label="Try import again" pendingText="Requesting your products…" secondary/></div> : data.importStatus === "not_started" ? <div className={styles.empty}><h2>Your products haven't been imported yet</h2><p>Import your Etsy products to choose which ones to set up.</p><ActionForm action={continueToProductsAction} label="Import products" pendingText="Importing your products…"/></div> : data.products.length ? <><p className={styles.note}>We found {data.products.filter(p => p.state === "active").length} active listings in your Etsy shop.</p><ProductPicker products={data.products} initialSelection={data.selected}/></> : <div className={styles.empty}><h2>No Etsy products found</h2><p>Add or activate a listing in Etsy, then try importing again.</p><ActionForm action={retryImportAction} label="Check for products" pendingText="Requesting your products…" secondary/></div>}
    <Link href="/onboarding/etsy" className="back-link">Back to Etsy connection</Link>
  </>;
}
