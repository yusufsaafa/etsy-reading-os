"use client";
import {useActionState} from "react";
import {prepareReviewPdfAction} from "./actions";
export function ReviewPdfForm({orderId,readingId}:{orderId:string;readingId:string}){
 const [state,action,pending]=useActionState(prepareReviewPdfAction.bind(null,orderId,readingId),{});
 return <form action={action} aria-busy={pending}><button className="button" disabled={pending}>{pending?"Preparing PDF…":"Prepare PDF"}</button><p role={state.error?"alert":"status"} className="small muted">{state.error??(pending?"Preparing your approved reading. Nothing will be sent to the customer.":"Prepare a PDF of the approved reading. Nothing will be sent to the customer.")}</p></form>;
}
