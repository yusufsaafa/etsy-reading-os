import Link from "next/link";
import {notFound} from "next/navigation";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {orderDetailData} from "@/modules/orders/detail";
import {OrderDetailView,type DetailView} from "@/components/order-detail";
import {InputEditor} from "@/components/input-editor";
import {ReadingPreparation} from "@/components/generation/reading-preparation";
import {readingStatus} from "@/components/seller-status";
import {readingReviewStatus} from "@/modules/review/service";
import {ordersQuery,ordersHref} from "@/modules/orders/query";
import {InformationPopover} from "@/components/information-popover";
import {issueLabels} from "@/components/ui";
export default async function OrderDetail({params,searchParams}:{params:Promise<{id:string}>;searchParams?:Promise<Record<string,unknown>>}){
 const scope=await currentScope(),{id}=await params,data=await orderDetailData(database(),scope,id);if(!data)notFound();
 const {order}=data;
 const items=await Promise.all(data.lines.map(async line=>({id:line.id,title:line.title,quantity:line.quantity,variations:line.snapshot.variations.map(v=>`${v.label}: ${v.value}`),answers:line.snapshot.answers,readings:await Promise.all(data.units.filter(u=>u.lineItemId===line.id).map(async unit=>{
 const generation=data.history.find(g=>g.unitId===unit.id),queue=data.queue.find(q=>q.unitId===unit.id),context=data.inputs.find(c=>c.unitId===unit.id),review=await readingReviewStatus(database(),scope,id,unit.id);
 const active=queue&&["QUEUED","CLAIMED","EXECUTING","RETRY_WAIT"].includes(queue.state);
 const productionStatus=generation?.status==="SUCCEEDED"?(generation.customerRevision!==unit.revision?"STALE":"SUCCEEDED"):active?(queue.state==="EXECUTING"?"PROCESSING":"WAITING"):queue?.state==="ATTENTION"?"FAILED":generation?.status;
 const status=review??readingStatus(unit.issues,productionStatus==="SUCCEEDED"?"FAILED":productionStatus),setup=unit.issues.includes("unmapped_listing"),ready=!unit.issues.length;
 return {id:unit.id,index:unit.unitIndex,status,revision:unit.revision,answers:context?.answers??[],queue:queue?.state.replaceAll("_"," "),generation:generation?{status:generation.status,revision:generation.customerRevision,date:generation.createdAt.toISOString()}:undefined,workflow:<>
 {unit.issues.length>0&&<ul>{unit.issues.map(issue=><li key={issue}>{issueLabels[issue]||"Review this reading before continuing"}</li>)}</ul>}
 {setup&&<Link className="button" href={`/products#product-${line.listingExternalId}`}>Set up product</Link>}
 <ReadingPreparation approved={review==="Approved"} reviewHref={review?`/orders/${id}/readings/${unit.id}/review`:undefined} scope={scope} productionStatus={productionStatus} unitId={unit.id} currentRevision={unit.revision} eligible={ready&&unit.configurationState==="versioned"}/>
 <details className="information-editor"><summary>Review customer information</summary><InputEditor unitId={unit.id} revision={unit.revision} initial={context?.answers??[]} allocated={unit.contextAllocated} needsAllocation={line.quantity>1} inputLabel={data.mappings.find(m=>m.listingExternalId===line.listingExternalId&&m.variantKey===line.variantKey)?.required[0]?.label??"Customer information"} definitions={data.versions.find(v=>v.id===unit.productVersionId)?.configuration.inputs}/></details>
 <InformationPopover label="Purchase reference"><p>Listing {line.listingExternalId} · Variant {line.variantKey} · SKU {line.sku||"Not supplied"} · Transaction {line.externalId}. {unit.productVersionId&&`Retained configuration v${data.versions.find(v=>v.id===unit.productVersionId)?.versionNumber??"unavailable"}.`}</p></InformationPopover></>};
 }))})));
 const priority=data.units.some(u=>u.issues.length)||!order.paid||order.refund!=="none";
 const active=data.queue.some(q=>["QUEUED","CLAIMED","EXECUTING","RETRY_WAIT"].includes(q.state))||data.history.some(g=>g.status==="PROCESSING");
 const failed=data.queue.some(q=>q.state==="ATTENTION")||data.history.some(g=>g.status==="FAILED"&&!data.queue.some(q=>q.unitId===g.unitId&&["QUEUED","CLAIMED","EXECUTING","RETRY_WAIT"].includes(q.state)));
 const stale=data.history.some(g=>g.status==="SUCCEEDED"&&g.customerRevision!==data.units.find(u=>u.id===g.unitId)?.revision);
 const generated=data.units.length>0&&data.units.every(u=>data.history.some(g=>g.unitId===u.id&&g.status==="SUCCEEDED"&&g.customerRevision===u.revision)&&!u.issues.length);
 const status=order.canceled?"Canceled":!order.paid?"Awaiting payment":order.refund!=="none"?"Review refund":failed?"Production needs attention":stale?"Review updated information":priority?"Information or setup needed":active?"In production":generated?"Generated":"Pending";
 const view:DetailView={reference:order.externalId,customer:order.buyerName,date:order.createdAt.toISOString(),status,payment:order.canceled?"Canceled":order.paid?"Paid":"Awaiting payment",items};
 return <OrderDetailView data={view} backHref={ordersHref(ordersQuery(await searchParams??{}))}/>;
}
