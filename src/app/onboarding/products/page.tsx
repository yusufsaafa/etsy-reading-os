import Link from "next/link";
import {redirect} from "next/navigation";
import {database} from "@/db/client";
import {currentStoreScope} from "@/modules/identity/session";
import {onboardingData} from "@/modules/onboarding/service";
import {discoverProducts} from "@/modules/onboarding/discovery";
import {ListingDiscoveryError} from "@/modules/etsy/listing-discovery";
import {vault} from "@/infrastructure/secrets";
import {StepHeader} from "@/components/onboarding/shell";
import {ProductPicker,ActionForm} from "@/components/onboarding/forms";
import {retryImportAction} from "../actions";
import styles from "@/components/onboarding/onboarding.module.css";
export default async function ChooseProducts(){
 const scope=await currentStoreScope(),data=await onboardingData(database(),scope);
 if(data.store.stage==="complete")redirect("/");
 let discovery:Awaited<ReturnType<typeof discoverProducts>>|undefined,connectionProblem=false;
 try{discovery=await discoverProducts(database(),scope,vault());}catch(error){connectionProblem=error instanceof ListingDiscoveryError&&error.kind==="connection";}
 return <><StepHeader step={3} title="Products" description="Choose the Etsy listings you want Reading OS to fulfill."/>
 {discovery ? discovery.products.length ? <ProductPicker products={discovery.products} initialSelection={discovery.selected}/> : <div className={styles.empty}><h2>No listings found</h2><p>No listings are available in your connected shop yet.</p><ActionForm action={retryImportAction} label="Check again" pendingText="Checking products…" secondary/></div> : <div className={styles.empty} role="alert"><h2>{connectionProblem?"Reconnect your Etsy shop":"Products couldn't be loaded"}</h2><p>{connectionProblem?"Your saved Etsy connection needs attention before products can be loaded.":"Your selection hasn't changed. Try loading your products again."}</p>{connectionProblem?<Link className="button secondary" href="/onboarding/etsy">Reconnect Etsy</Link>:<ActionForm action={retryImportAction} label="Try again" pendingText="Loading products…" secondary/>}</div>}
 <Link href="/onboarding/etsy" className="back-link">Back to Etsy connection</Link></>;
}
