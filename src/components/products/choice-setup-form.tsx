"use client";
import {useActionState} from "react";
import {createChoiceDraft} from "@/app/(operations)/products/[id]/configure/actions";
export function ChoiceSetupForm({listingId,choice,returnHref}:{listingId:string;choice:string;returnHref:string}){
 const [state,action,pending]=useActionState(createChoiceDraft,{});
 return <form action={action} className="stack"><input type="hidden" name="listingId" value={listingId}/><input type="hidden" name="choice" value={choice}/><input type="hidden" name="returnTo" value={returnHref}/>{state.error&&<p role="alert" className="error-message">{state.error}</p>}<div><button className="button" disabled={pending}>{pending?"Starting setup…":"Create draft configuration"}</button></div><p className="small muted">Creates a draft for this exact purchase choice. Nothing is published or generated.</p></form>;
}
