import {randomUUID} from "node:crypto";
import {notFound} from "next/navigation";
import Link from "next/link";
import {database} from "@/db/client";
import {currentStoreScope} from "@/modules/identity/session";
import {internalOperatorAllowed} from "@/modules/identity/internal-access";
import {verifyScope} from "@/modules/intake/service";
import {orderSyncAccess} from "@/modules/orders/sync";
import {OrderSync} from "@/components/order-sync";
import {syncOrdersAction} from "@/app/(operations)/orders/actions";
import {intakeDiagnostics} from "@/modules/etsy/automatic-intake";
import {retryIntakeAction} from "./actions";
export const dynamic="force-dynamic";
export const metadata={title:"Private intake diagnostics",robots:{index:false,follow:false}};
export default async function IntakeDiagnostics({searchParams}:{searchParams:Promise<{retry?:string}>}){
 const scope=await currentStoreScope();if(!internalOperatorAllowed(scope.userId))notFound();await verifyScope(database(),scope,true);
 const {state,receipts}=await intakeDiagnostics(database(),scope),query=await searchParams;
 const retry=(id:string,kind:string)=><form action={retryIntakeAction}><input type="hidden" name="id" value={id}/><input type="hidden" name="kind" value={kind}/><input type="hidden" name="commandId" value={randomUUID()}/><button className="button secondary">Retry {kind}</button></form>;
 return <main className="workspace"><h1>Developer intake diagnostics</h1><p>Restricted manual recovery. Receipt identifiers are not required for normal seller operation. This command retains historical approval and the 100-reading safety bound.</p>{query.retry&&<p role="status">{query.retry==="pending"?"Retry requested; no generation or delivery was started.":"Retry unavailable. Refresh and check the connection and receipt state."}</p>}{state?.errorCode&&<section><p>Discovery: {state.errorCode.replaceAll("_"," ")}</p>{!state.claim&&retry(state.id,"discovery")}</section>}<section aria-label="Receipt intake history">{receipts.map(r=><article key={r.id}><p>Receipt {r.receiptId}: {r.status.toLowerCase()} · Attempts {r.attempts} · {(r.result??r.errorCode??"pending").replaceAll("_"," ")}</p>{r.status==="ATTENTION"&&retry(r.id,"receipt")}</article>)}</section><OrderSync access={await orderSyncAccess(database(),scope)} commandId={randomUUID()} action={syncOrdersAction} historicalHref="/etsy/historical-review"/><Link href="/orders">Back to Orders</Link></main>;
}
