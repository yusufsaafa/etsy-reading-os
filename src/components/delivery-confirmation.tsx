"use client";
import {useActionState,useState} from "react";
import {manualDeliveryAction} from "@/app/(operations)/deliveries/actions";
export function DeliveryConfirmation({readingId,artifactId,sequence,correction=false}:{readingId:string;artifactId:string;sequence:number;correction?:boolean}){
 const [commandId]=useState(()=>crypto.randomUUID());
 const [state,action,pending]=useActionState(manualDeliveryAction.bind(null,readingId),{});
 const [confirmed,setConfirmed]=useState(false);
 return <form action={action} className="review-approval" aria-busy={pending}>
  <h2>{correction?"Correct delivery confirmation":"Mark as Delivered"}</h2>
  <p>{correction?"This adds a correction to the delivery history. It does not recall a file or message sent through Etsy.":"This only records your confirmation inside Reading OS. You must send the PDF to the customer through Etsy yourself."}</p>
  <input type="hidden" name="artifactId" value={artifactId}/><input type="hidden" name="commandId" value={commandId}/><input type="hidden" name="expectedSequence" value={sequence}/><input type="hidden" name="action" value={correction?"CORRECTED":"CONFIRMED"}/>
  <label>{correction?"Reason for correction":"Seller note (optional)"}<textarea name="note" required={correction} maxLength={1000} rows={3} disabled={pending}/></label>
  <label className="check delivery-consent"><input type="checkbox" name="confirmed" value="yes" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required disabled={pending}/>{correction?"I confirm this delivery was marked accidentally and should be corrected.":"I have sent this Reading’s PDF to the customer through Etsy."}</label>
  <button className={`button${correction?" secondary":""}`} disabled={!confirmed||pending||!!state.success}>{pending?"Recording…":correction?"Record correction":"Mark as Delivered"}</button>
  {(state.error||state.success)&&<p role={state.error?"alert":"status"}>{state.error??state.success}</p>}
 </form>;
}
