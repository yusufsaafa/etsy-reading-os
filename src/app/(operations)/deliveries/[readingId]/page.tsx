import Link from "next/link";
import {notFound} from "next/navigation";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {configuredDocumentPorts} from "@/infrastructure/document-runtime";
import {inspectDelivery,DeliveryError,deliveryLabels} from "@/modules/deliveries/service";
import {Heading,Badge} from "@/components/ui";
import {DeliveryConfirmation} from "@/components/delivery-confirmation";
const displayDate=(date:string)=>new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(date))+" UTC";
export default async function DeliveryDetail({params}:{params:Promise<{readingId:string}>}){
 const {readingId}=await params,scope=await currentScope();let storage;try{storage=configuredDocumentPorts()?.artifacts;}catch{}
 let view;try{view=await inspectDelivery(database(),scope,readingId,storage);}catch(e){if(e instanceof DeliveryError&&e.code==="UNAVAILABLE")notFound();throw e;}
 const reviewHref=`/orders/${view.orderId}/readings/${readingId}/review`;
 return <><Link className="back-link" href="/deliveries">← Deliveries</Link><Heading eyebrow={`Order #${view.orderReference} · Reading ${view.index} of ${view.quantity}`} title={view.customer} description={view.product}/><Badge tone={view.status==="NEEDS_ATTENTION"?"warning":view.status==="DELIVERED"?"good":"neutral"}>{deliveryLabels[view.status]}</Badge><p>{view.reason}</p>
  <section className="review-customer"><h2>Purchase information</h2>{view.options.length>0&&<ul>{view.options.map((s,i)=><li key={i}>{s}</li>)}</ul>}<dl>{view.customerDetails.map((a,i)=><div key={i}><dt>{a.label}</dt><dd dir="auto">{a.value}</dd></div>)}</dl><p>Reading: {view.generationStatus==="SUCCEEDED"?"Generated":view.generationStatus==="PROCESSING"?"Preparing":view.generationStatus==="FAILED"?"Needs attention":"Not generated"} · {view.approval}</p>{view.approvedAt&&<p>Approved <time dateTime={view.approvedAt}>{displayDate(view.approvedAt)}</time></p>}<p>PDF: {view.pdf}</p><Link href={`/orders/${view.orderId}`}>Open order</Link> · {view.generationStatus==="SUCCEEDED"&&<Link href={reviewHref}>Open Review Workspace</Link>}</section>
  {view.artifactId&&<div className="review-save-actions"><a className="button" target="_blank" rel="noopener noreferrer" href={`/api/readings/${readingId}/artifacts/${view.artifactId}?view=inline`}>Preview PDF · opens new tab</a><a className="button secondary" href={`/api/readings/${readingId}/artifacts/${view.artifactId}`}>Download PDF</a></div>}
  {view.status==="AWAITING_DELIVERY"&&view.artifactId&&<DeliveryConfirmation key={`confirm-${view.sequence}`} readingId={readingId} artifactId={view.artifactId} sequence={view.sequence}/>}
  {view.confirmed&&view.confirmedArtifactId&&<DeliveryConfirmation key={`correct-${view.sequence}`} readingId={readingId} artifactId={view.confirmedArtifactId} sequence={view.sequence} correction/>}
  <section className="review-customer"><h2>Delivery history</h2>{view.history.length?<ol>{view.history.map(event=><li key={event.id}><strong>{event.action==="CONFIRMED"?"Manually confirmed delivered":"Confirmation corrected"}</strong> · <time dateTime={event.createdAt}>{displayDate(event.createdAt)}</time><p className="small muted">{event.actorId===scope.userId?"Recorded by you":`Recorded by ${event.actorName}`} · PDF reference {event.artifactId.slice(0,8)}</p>{event.note&&<p dir="auto">{event.note}</p>}</li>)}</ol>:<p className="muted">No manual delivery has been recorded. Downloading a PDF does not confirm delivery.</p>}</section>
 </>;
}
