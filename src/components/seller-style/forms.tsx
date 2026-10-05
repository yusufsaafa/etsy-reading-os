"use client";
import { useActionState, useEffect, useState, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { StyleConfiguration } from "@/modules/seller-style/contracts";
import { Button } from "../ui";
import { saveProfile, saveStyle, pasteWork, deleteWork, type FormState } from "./actions";
import styles from "./profile.module.css";
function Feedback({state,message}:{state:FormState;message:string}) {return <>{state.error&&<p className="error-message" role="alert">{state.error}</p>}{state.saved&&<p className="notice" role="status">{message}</p>}</>;}
function Submit({children,secondary=false}:{children:React.ReactNode;secondary?:boolean}){const {pending}=useFormStatus();return <Button disabled={pending} className={secondary?"secondary":""}>{pending?"Saving…":children}</Button>;}
export function ProfileForm({displayName,shortBio}:{displayName:string;shortBio:string}) {
  const [state,action]=useActionState(saveProfile,{});
  return <form action={action} className={styles.form}><label htmlFor="seller-name">Name<input id="seller-name" name="displayName" autoComplete="name" defaultValue={displayName} maxLength={100} required placeholder="Sarah"/></label><label htmlFor="seller-bio">Short bio <span className="muted small">Optional</span><textarea id="seller-bio" name="shortBio" defaultValue={shortBio} maxLength={1000} rows={3} placeholder="A little about the person behind your work."/></label><Feedback state={state} message="Profile saved."/><div><Submit>Save profile</Submit></div></form>;
}
function StyleControls(){const{pending}=useFormStatus();return <div className={styles.controls}><Button className="secondary" disabled={pending} name="intent" value="save">Save changes</Button><Button disabled={pending} name="intent" value="apply">{pending?"Saving…":"Apply style"}</Button></div>;}
export function StyleForm({versionId,revision,initial}:{versionId:string;revision:number;initial:StyleConfiguration}) {
  const [configuration,setConfiguration]=useState(initial),[currentRevision,setRevision]=useState(revision),[state,action]=useActionState(saveStyle,{});
  const [preferred,setPreferred]=useState(initial.preferredExpressions.join("\n")),[avoid,setAvoid]=useState(initial.avoidExpressions.join("\n"));
  useEffect(()=>{if(state.revision!==undefined)setRevision(state.revision);},[state]);
  const value={...configuration,preferredExpressions:preferred.split("\n").map(s=>s.trim()).filter(Boolean),avoidExpressions:avoid.split("\n").map(s=>s.trim()).filter(Boolean)};
  return <form action={action} className={styles.form}><input type="hidden" name="versionId" value={versionId}/><input type="hidden" name="revision" value={currentRevision}/><input type="hidden" name="configuration" value={JSON.stringify(value)}/><div className={styles.fields}>
    <label htmlFor="style-tone">Tone<select id="style-tone" value={configuration.tone??""} onChange={e=>setConfiguration(c=>({...c,tone:(e.target.value||null) as StyleConfiguration["tone"]}))}><option value="">Choose tone</option><option value="WARM">Warm & supportive</option><option value="DIRECT">Direct</option><option value="REASSURING">Reassuring</option><option value="NEUTRAL">Neutral</option><option value="CUSTOM">Custom</option></select></label>
    <label htmlFor="style-detail">Detail<select id="style-detail" value={configuration.detail??""} onChange={e=>setConfiguration(c=>({...c,detail:(e.target.value||null) as StyleConfiguration["detail"]}))}><option value="">Choose detail</option><option value="CONCISE">Concise</option><option value="BALANCED">Balanced</option><option value="DETAILED">Detailed</option></select></label>
    <label htmlFor="style-approach">Writing style<select id="style-approach" value={configuration.approach??""} onChange={e=>setConfiguration(c=>({...c,approach:(e.target.value||null) as StyleConfiguration["approach"]}))}><option value="">Choose approach</option><option value="CONVERSATIONAL">Conversational</option><option value="STRUCTURED">Structured</option><option value="REFLECTIVE">Reflective</option><option value="CUSTOM">Custom</option></select></label></div>
    <div className={styles.fields}><label htmlFor="style-preferred">Preferred expressions <span className="small muted">Optional · one per line</span><textarea id="style-preferred" value={preferred} maxLength={10000} rows={4} onChange={e=>setPreferred(e.target.value)}/></label><label htmlFor="style-avoid">Avoid <span className="small muted">Optional · one per line</span><textarea id="style-avoid" value={avoid} maxLength={10000} rows={4} onChange={e=>setAvoid(e.target.value)}/></label></div>
    <label htmlFor="style-guidance">Additional guidance <span className="small muted">Optional unless you choose Custom</span><textarea id="style-guidance" value={configuration.instructions} maxLength={4000} rows={3} onChange={e=>setConfiguration(c=>({...c,instructions:e.target.value}))}/></label>
    <Feedback state={state} message="Draft changes saved. Your current style stays in use until you apply these changes."/>{state.applied?<p className="notice" role="status">Style applied. Previous styles remain safely recorded.</p>:<StyleControls/>}
  </form>;
}
export function PasteForm({commandKey}:{commandKey:string}) {
  const [state,action]=useActionState(pasteWork,{}),[key,setKey]=useState(commandKey);const form=useRef<HTMLFormElement>(null);
  useEffect(()=>{if(state.sourceAdded){form.current?.reset();setKey(crypto.randomUUID());}},[state]);
  return <details className={styles.paste}><summary>Paste previous work</summary><form ref={form} action={action} className={styles.form}><input type="hidden" name="commandKey" value={key}/><label htmlFor="work-title">Title<input id="work-title" name="title" maxLength={150} required placeholder="Personalized message example"/></label><label htmlFor="work-text">Previous work<textarea id="work-text" name="text" maxLength={50000} rows={7} required aria-describedby="work-privacy"/></label><p id="work-privacy" className="small muted">Use work you have permission to share. Remove customer names and other private details before adding it.</p><Feedback state={state} message="Previous work added."/>{state.sourceAdded&&<p role="status" className="notice">Previous work added to your library.</p>}<div><Submit>Add previous work</Submit></div></form></details>;
}
export function DeleteSource({sourceId}:{sourceId:string}){const[state,action]=useActionState(deleteWork,{});return <details className={styles.remove}><summary>Remove</summary><p className="small muted">Remove this reference from your library?</p><form action={action}><input type="hidden" name="sourceId" value={sourceId}/><Submit secondary>Remove previous work</Submit></form><Feedback state={state} message="Previous work removed."/></details>;}
