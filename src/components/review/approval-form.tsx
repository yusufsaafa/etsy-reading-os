"use client";
import {useActionState,useState,useEffect,useRef} from "react";
import {approveReviewAction} from "./actions";
export function ReviewApprovalForm({orderId,readingId,revision}:{orderId:string;readingId:string;revision:number|null}) {
 const [confirming,setConfirming]=useState(false);
 const intent=useRef<HTMLButtonElement>(null),confirm=useRef<HTMLHeadingElement>(null),first=useRef(true);
 useEffect(()=>{if(first.current){first.current=false;return;}if(confirming)confirm.current?.focus();else intent.current?.focus();},[confirming]);
 const [state,action,pending]=useActionState(approveReviewAction.bind(null,orderId,readingId),{});
 if(!confirming)return <button type="button" className="button" ref={intent} onClick={()=>setConfirming(true)}>Approve reading</button>;
 return <form action={action} className="review-approval" aria-labelledby="approval-title" aria-busy={pending}>
  <h2 id="approval-title" ref={confirm} tabIndex={-1}>Approve this reading?</h2>
  <p>Once approved, this reading will be finalized and can no longer be edited.</p>
  <input type="hidden" name="revision" value={revision??"none"}/>
  <div className="review-save-actions"><button className="button" type="submit" disabled={pending}>{pending?"Approving…":"Approve reading"}</button><button type="button" className="button secondary" disabled={pending} onClick={()=>setConfirming(false)}>Cancel</button></div>
  {state.error&&<p role="alert">{state.error}</p>}{pending&&<p role="status">Approving reading…</p>}
 </form>;
}
