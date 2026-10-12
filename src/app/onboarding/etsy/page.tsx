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
  const connected = data.connection.kind === "connected", attention = data.connection.kind === "expired", failed = notice === "authorization_failed";
  return <>
    <StepHeader step={2} title="Connect your Etsy shop" description="Bring your listings and order information into Reading OS. Then set up your products so purchased readings can be prepared."/>
    <section className={styles.etsyCard} aria-labelledby="etsy-connection-title">
      <div className={styles.etsyIdentity}>
        <span className={styles.thumbnail} aria-hidden="true"><Icon name="store"/></span>
        <div><h2 id="etsy-connection-title">{connected ? data.store.name : "Your Etsy connection"}</h2>
          <Badge tone={connected ? "good" : attention || failed ? "warning" : "neutral"}>{connected ? "Etsy connected" : attention ? "Connection needs attention" : failed ? "Connection failed" : "Not connected"}</Badge>
          {connected && data.store.externalShopId && <p className={styles.note}>Etsy shop ID: {data.store.externalShopId}</p>}
        </div>
      </div>
      {failed && <p role="alert" className="error-message">Etsy couldn't be connected. No new connection was saved. Please try again.</p>}
      {connected ? <>
        <p className={styles.etsyDescription}>Your shop is connected. Next, choose the products you want to offer through Reading OS and complete their reading setup.</p>
        <ActionForm action={continueToProductsAction} label="Continue to products" pendingText="Importing your products…"/>
      </> : <>
        <p className={styles.etsyDescription} role={attention ? "status" : undefined}>{attention ? "Reconnect your shop to continue setup. Your connection needs attention." : "Authorize your shop on Etsy to continue store setup."}</p>
        <ActionForm action={connectAction} label={data.store.source === "fixtures" ? "Connect demo shop" : attention ? "Reconnect Etsy" : "Connect Etsy"} pendingText={data.store.source === "fixtures" ? "Connecting your demo shop…" : "Redirecting to Etsy…"}/>
        <p className={styles.note}>You'll authorize access on Etsy and can review the permissions before continuing.</p>
      </>}
      {data.store.source === "fixtures" && <p className={styles.note}>{connected ? "Demo shop · development only" : "Development demo: connects a synthetic shop without contacting Etsy."}</p>}
      <div className={styles.etsyAccess}>
        <h3>What this connection enables</h3>
        <p>Reading OS reads your listings and order details to match purchases to your reading configurations.</p>
        <p>You review the readings and send the finished PDFs through Etsy yourself. This connection does not send readings or edit your listings.</p>
      </div>
      <details className={styles.etsyOptions}>
        <summary>{connected ? "Connection options" : "Access and disconnecting"}</summary>
        <p className={styles.note}>Disconnecting removes saved access from Reading OS and stops pending imports. To revoke authorization on Etsy too, remove Reading OS in your Etsy settings.</p>
        {connected && <ActionForm action={disconnectOnboardingAction} label="Disconnect shop" pendingText="Disconnecting your shop…" secondary/>}
      </details>
    </section>
  </>;
}
