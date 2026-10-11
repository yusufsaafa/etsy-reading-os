"use client";
import {useActionState,useEffect,useRef} from "react";
import Link from "next/link";
import type {SyncAccess} from "@/modules/orders/sync";
import type {SyncFeedback} from "@/app/(operations)/orders/actions";
import styles from "./order-sync.module.css";
export function OrderSync({access,commandId,action,historicalHref}:{access:SyncAccess;commandId:string;action:(previous:SyncFeedback,form:FormData)=>Promise<SyncFeedback>;historicalHref?:string}){
 const [feedback,dispatch,pending]=useActionState(action,{message:""});
 const status=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(feedback.message)status.current?.focus();},[feedback]);
 return <section className={styles.panel} aria-label="Controlled Etsy order sync"><h2>Sync Orders</h2><p id="sync-explanation">{access.reason} This action checks one receipt only and does not start AI preparation.</p>
 {access.allowed?<form action={dispatch} aria-busy={pending} className={styles.form}><input type="hidden" name="commandId" value={commandId}/><label htmlFor="etsy-receipt">Etsy receipt ID<input id="etsy-receipt" name="receiptId" inputMode="numeric" pattern="[1-9][0-9]{0,19}" maxLength={20} required aria-describedby="sync-explanation" disabled={pending}/></label><button className="button" type="submit" disabled={pending}>{pending?"Syncing receipt…":"Sync Orders"}</button></form>:<Link className="button secondary" href="/settings">Review Settings</Link>}
 {pending&&<p role="status">Checking the owned receipt. Please wait…</p>}
 {feedback.message&&<div ref={status} tabIndex={-1} role={feedback.error?"alert":"status"} className={styles.result}><p>{feedback.message}</p>{feedback.orderId&&<Link href={`/orders/${feedback.orderId}`}>Open order →</Link>}{feedback.historical&&historicalHref&&<Link href={historicalHref}>Open historical review →</Link>}{feedback.historical&&!historicalHref&&<p>Historical adoption requires the separate authorized historical-review process. Sync Orders does not approve adoption.</p>}</div>}
 </section>;
}
