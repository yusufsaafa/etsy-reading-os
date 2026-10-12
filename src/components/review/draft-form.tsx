"use client";
import Link from "next/link";
import {useActionState,useEffect,useState} from "react";
import {Button} from "../ui";
import {saveReviewDraftAction} from "./actions";
export type EditableDraft={revision:number;content:{sections:{sectionId:string;title:string;content:string}[]}};
export function ReviewDraftForm({orderId,readingId,draft}:{orderId:string;readingId:string;draft:EditableDraft}) {
 const [state,action,pending]=useActionState(saveReviewDraftAction.bind(null,orderId,readingId),{});
 // A refreshed server prop must not silently advance the revision of unsaved text.
 const [loadedDraft]=useState(()=>draft);
 const [contents,setContents]=useState(()=>loadedDraft.content.sections.map(section=>section.content));
 const dirty=contents.some((text,i)=>text!==loadedDraft.content.sections[i].content);
 useEffect(()=>{
  if(!dirty)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
  const guard=(event:MouseEvent)=>{
   const link=event.target instanceof Element?event.target.closest("a"):null;
   if(!link||link.closest(".review-draft-form")||link.getAttribute("href")?.startsWith("#"))return;
   if(!window.confirm("Discard unsaved changes?")){event.preventDefault();event.stopPropagation();}
  };
  window.addEventListener("beforeunload",warn);document.addEventListener("click",guard,true);
  return()=>{window.removeEventListener("beforeunload",warn);document.removeEventListener("click",guard,true);};
 },[dirty]);
 return <form action={action} className="review-draft-form">
  <input type="hidden" name="revision" value={loadedDraft.revision}/><input type="hidden" name="structure" value={JSON.stringify(loadedDraft.content.sections.map(({sectionId,title})=>({sectionId,title})))}/>
  <p className="small muted">Edit the reading text. Customer details and section titles stay unchanged.</p>
  {loadedDraft.content.sections.map((section,i)=><section key={section.sectionId}><h3><label htmlFor={`reading-text-${i}`}>{section.title}</label></h3><textarea id={`reading-text-${i}`} name="content" value={contents[i]} onChange={event=>setContents(current=>current.map((text,index)=>index===i?event.target.value:text))} disabled={pending} maxLength={40000} required rows={12} aria-describedby="review-save-feedback"/></section>)}
  <div className="review-save-actions"><Button disabled={pending||!dirty}>{pending?"Saving…":"Save changes"}</Button><Link className="button secondary" href={`/orders/${orderId}/readings/${readingId}/review`} prefetch={false} onClick={event=>{if(pending||dirty&&!window.confirm("Discard unsaved changes?"))event.preventDefault();}}>Cancel</Link></div>
  <p id="review-save-feedback" role={state.error?"alert":"status"} className="small muted">{state.error??(pending?"Saving changes…":dirty?"You have unsaved changes.":"Changes are saved only when you choose Save changes.")}</p>
 </form>;
}
