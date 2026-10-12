"use client";
import Link from "next/link";
import {useActionState,useEffect,useState} from "react";
import {assignReadingAction} from "@/app/(operations)/orders/actions";
import {Button} from "./ui";
export type RecoveryCandidate={id:string;title:string;number:number;status:string;sections:string[];fields:string[];output:string|null;historical:boolean};
export function ReadingRecovery({unitId,revision,candidates,reason}:{unitId:string;revision:number;candidates:RecoveryCandidate[];reason?:string}){
 const [selected,setSelected]=useState(""),[commandId,setCommandId]=useState("");
 useEffect(()=>setCommandId(crypto.randomUUID()),[]);
 const [feedback,action,pending]=useActionState(assignReadingAction,{message:""});
 const candidate=candidates.find(c=>c.id===selected);
 return <details className="information-editor"><summary>Assign first reading configuration</summary>
 <p>Review the purchased title, options and original customer information in Purchase Information before confirming.</p>
 {!candidates.length?<><p>{reason}</p><Link className="button secondary" href="/products">Prepare product configuration</Link></>:<form action={action} className="stack">
 <input type="hidden" name="unitId" value={unitId}/><input type="hidden" name="revision" value={revision}/><input type="hidden" name="commandId" value={commandId}/>
 <label>Published configuration<select name="versionId" required value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select a configuration</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.title} · version {c.number}{c.status==="ARCHIVED"?" · archived":""}</option>)}</select></label>
 {candidate&&<div><p>Reading sections: {candidate.sections.join(", ")}</p><p>Customer fields: {candidate.fields.join(", ")||"None"} · Output: {candidate.output}</p>{candidate.historical&&<p>This purchase predates publication. Your confirmation explicitly approves this configuration for this historical purchase.</p>}</div>}
 <label className="check"><input type="checkbox" name="confirmed" value="yes" required/>I reviewed this exact saved purchase and approve its first configuration assignment. The binding cannot be changed afterward.</label>
 <p className="small muted">Customer information and purchased history are kept. Assignment does not start generation.</p>
 <Button disabled={pending||!candidate||!commandId}>{pending?"Assigning…":"Confirm first assignment"}</Button>
 </form>}
 {feedback.message&&<p role="status" className="small muted">{feedback.message}</p>}
 </details>;
}
