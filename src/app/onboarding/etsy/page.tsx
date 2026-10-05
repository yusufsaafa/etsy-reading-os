import { redirect } from "next/navigation";
import { database } from "@/db/client";
import { currentStoreScope } from "@/modules/identity/session";
import { onboardingData } from "@/modules/onboarding/service";
import { StepHeader } from "@/components/onboarding/shell";
import { ActionForm } from "@/components/onboarding/forms";
import { connectAction, continueToProductsAction, disconnectOnboardingAction } from "../actions";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import styles from "@/components/onboarding/onboarding.module.css";
export default async function Connect({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const scope = await currentStoreScope(), data = await onboardingData(database(), scope), { notice } = await searchParams;
  if (data.store.stage === "complete") redirect("/");
  const connected = data.connection.kind === "connected";
  return <><StepHeader step={2} title="Connect your Etsy shop" description="Connect Etsy so Reading OS can securely import your listings and relevant orders."/>
    {notice === "authorization_failed" && <p role="alert" className="error-message">Etsy couldn't be connected. No new connection was saved. Please try again.</p>}
    {connected ? <><div className={styles.connected}><span className={styles.thumbnail}><Icon name="store"/></span><div><Badge tone="good">Etsy connected</Badge><strong>{data.store.name}</strong>{data.store.externalShopId && <small>Etsy shop ID: {data.store.externalShopId}</small>}{data.store.source === "fixtures" && <small>Demo shop · development only</small>}</div></div><ActionForm action={continueToProductsAction} label="Continue to products" pendingText="Importing your products…"/><details><summary>Connection options</summary><p className={styles.note}>Disconnect removes saved access and stops pending imports. To revoke authorization on Etsy too, remove Reading OS in your Etsy settings.</p><ActionForm action={disconnectOnboardingAction} label="Disconnect shop" pendingText="Disconnecting your shop…" secondary/></details></> : <>
      {data.connection.kind === "expired" && <p className="notice" role="status">Your Etsy connection needs attention. Reconnect to continue securely.</p>}
      <div className={styles.permission}><section className={styles.permissionSection}><h2>Reading OS can</h2><ul>{["Read your shop information", "Import your listings", "Import relevant order information"].map(text => <li key={text}><span aria-hidden="true">✓</span><span>{text}</span></li>)}</ul></section><section className={styles.permissionSection}><h2>This read-only connection cannot</h2><ul>{["Edit or delete your Etsy listings", "Issue refunds", "Change your Etsy shop settings"].map(text => <li key={text}><span aria-hidden="true">×</span><span>{text}</span></li>)}</ul></section></div>
      <div className={styles.trust}><span>Secure Etsy connection</span><span>Clear permissions</span><span>Disconnect anytime</span></div><p className={styles.note}>You'll authorize access on Etsy. Reading OS never asks for your Etsy password. Disconnect removes access from Reading OS; remove the authorization in Etsy settings to revoke it there too.</p>
      {data.store.source === "fixtures" && <p className={styles.note}>Development demo: connects a synthetic shop without contacting Etsy.</p>}<ActionForm action={connectAction} label={data.store.source === "fixtures" ? "Connect demo shop" : data.connection.kind === "expired" ? "Reconnect Etsy" : "Connect Etsy"} pendingText={data.store.source === "fixtures" ? "Connecting your demo shop…" : "Redirecting to Etsy…"}/>
    </>}
  </>;
}
