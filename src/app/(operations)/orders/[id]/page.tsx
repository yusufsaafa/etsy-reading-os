import {orderFinanceView} from "@/modules/orders-finance/service";
import Link from "next/link";
import {notFound} from "next/navigation";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {orderDetailData} from "@/modules/orders/detail";
import {OrderDetailView,type DetailView} from "@/components/order-detail";
import {InputEditor} from "@/components/input-editor";
import {ReadingPreparation} from "@/components/generation/reading-preparation";
import {readingStatus} from "@/components/seller-status";
import {orderReadingReviewStatuses} from "@/modules/review/service";
import {orderAvailableDocumentArtifacts} from "@/modules/documents/artifact-service";
import {configuredDocumentPorts} from "@/infrastructure/document-runtime";
import {sellerStyleData} from "@/modules/seller-style/service";
import {styleConfiguration,publishErrors} from "@/modules/seller-style/contracts";
import {configurationSchema,activationErrors,inputPolicy} from "@/modules/products/contracts";
import {triage} from "@/modules/intake/contracts";
import {readingOperations} from "@/modules/orders/operations";
import {ordersQuery,ordersHref} from "@/modules/orders/query";
import {InformationPopover} from "@/components/information-popover";

export default async function OrderDetail({params,searchParams}:{params:Promise<{id:string}>;searchParams?:Promise<Record<string,unknown>>}){
 const scope=await currentScope(),{id}=await params,data=await orderDetailData(database(),scope,id);if(!data)notFound();
 const {order}=data;
 const [reviews,artifacts,profile,finance]=await Promise.all([
  orderReadingReviewStatuses(database(),scope,id),
  orderAvailableDocumentArtifacts(database(),scope,id),
  data.units.some(u=>!data.history.some(g=>g.unitId===u.id))?sellerStyleData(database(),scope):null,
  orderFinanceView(database(),scope,id),
 ]);
 const style=styleConfiguration.safeParse(profile?.active?.configuration);
 const profileReady=!!profile?.seller&&style.success&&!publishErrors(style.data).length;
 const providerEnabled=["fake","google"].includes(process.env.AI_PROVIDER??"");
 let pdfAccess=false;try{pdfAccess=!!configuredDocumentPorts();}catch{/* No raw configuration details in seller UI. */}
 const historyByUnit=new Map(data.history.map(g=>[g.unitId,g])),queueByUnit=new Map(data.queue.map(q=>[q.unitId,q])),inputByUnit=new Map(data.inputs.map(c=>[c.unitId,c])),versionById=new Map(data.versions.map(v=>[v.id,v])),attemptByGeneration=new Map(data.attempts.map(a=>[a.generationId,a])),artifactByUnit=new Map(artifacts.map(a=>[a.readingId,a]));
 const items=await Promise.all(data.lines.map(async line=>({id:line.id,title:line.title,quantity:line.quantity,variations:line.snapshot.variations.map(v=>`${v.label}: ${v.value}`),answers:line.snapshot.answers,readings:await Promise.all(data.units.filter(u=>u.lineItemId===line.id).map(async unit=>{
 const generation=historyByUnit.get(unit.id),queue=queueByUnit.get(unit.id),context=inputByUnit.get(unit.id),review=reviews.get(unit.id);
 const mapping=data.mappings.find(m=>m.listingExternalId===line.listingExternalId&&m.variantKey===line.variantKey),version=unit.productVersionId?versionById.get(unit.productVersionId):undefined;
 const parsed=configurationSchema.safeParse(version?.configuration);
 const eligible=unit.configurationState==="versioned"&&version?.status!=="DRAFT"&&parsed.success&&!activationErrors("Retained configuration",parsed.data).length&&context?.revision===unit.revision&&!unit.issues.length&&!!order.latestSnapshot&&!triage(order.latestSnapshot,line.snapshot,{required:inputPolicy(parsed.data),paused:mapping?.paused??false,etsyFulfillment:parsed.data.etsyFulfillment},context.answers,unit.contextAllocated,unit.sourceChanged).length;
 const productHref=mapping?.productId?`/products/${mapping.productId}/setup`:`/products#product-${encodeURIComponent(line.listingExternalId)}`;
 const operations=readingOperations({id:unit.id,orderId:id,issues:unit.issues,canceled:order.canceled,paid:order.paid,refund:order.refund,revision:unit.revision,configurationState:unit.configurationState,canOperate:data.canOperate,eligible:!!eligible,providerEnabled,profileReady,productHref,queue:queue?.state,review,generation,productVersionId:unit.productVersionId,attempt:generation?attemptByGeneration.get(generation.id):undefined,artifact:artifactByUnit.get(unit.id),pdfAccess});
 const active=queue&&["QUEUED","CLAIMED","EXECUTING","RETRY_WAIT"].includes(queue.state);
 const productionStatus=generation?.status==="SUCCEEDED"?(generation.customerRevision!==unit.revision?"STALE":"SUCCEEDED"):active?(queue.state==="EXECUTING"?"PROCESSING":"WAITING"):queue?.state==="ATTENTION"?"FAILED":generation?.status;
 const status=review??readingStatus(unit.issues,productionStatus==="SUCCEEDED"?"FAILED":productionStatus);
 return {id:unit.id,index:unit.unitIndex,status,operations,revision:unit.revision,answers:context?.answers??[],queue:queue?.state.replaceAll("_"," "),generation:generation?{status:generation.status,revision:generation.customerRevision,date:generation.createdAt.toISOString()}:undefined,workflow:<>
 <div id={`preparation-${unit.id}`}>
 <ReadingPreparation approved={review==="Approved"} reviewHref={undefined} scope={scope} productionStatus={productionStatus} unitId={unit.id} currentRevision={unit.revision} eligible={!!eligible} evidence={{mode:operations.prepare,generationId:generation?.id,message:""}}/>
 </div>
 {<details id={`customer-information-${unit.id}`} open={unit.issues.some(i=>["missing_input","unusable_input","quantity_context"].includes(i))||!!generation&&generation.customerRevision!==unit.revision} className="information-editor"><summary>Review customer information</summary><InputEditor unitId={unit.id} revision={unit.revision} initial={context?.answers??[]} allocated={unit.contextAllocated} needsAllocation={line.quantity>1} inputLabel={mapping?.required[0]?.label??"Customer information"} definitions={version?.configuration.inputs}/></details>}
 <InformationPopover label="Purchase reference"><p>Listing {line.listingExternalId} · Variant {line.variantKey} · SKU {line.sku||"Not supplied"} · Transaction {line.externalId}. {unit.productVersionId&&`Retained configuration v${data.versions.find(v=>v.id===unit.productVersionId)?.versionNumber??"unavailable"}.`}</p></InformationPopover></>};
 }))})));
 const priority=data.units.some(u=>u.issues.length)||!order.paid||order.refund!=="none";
 const active=data.queue.some(q=>["QUEUED","CLAIMED","EXECUTING","RETRY_WAIT"].includes(q.state))||data.history.some(g=>g.status==="PROCESSING");
 const failed=data.queue.some(q=>q.state==="ATTENTION")||data.history.some(g=>g.status==="FAILED"&&!data.queue.some(q=>q.unitId===g.unitId&&["QUEUED","CLAIMED","EXECUTING","RETRY_WAIT"].includes(q.state)));
 const stale=data.history.some(g=>g.status==="SUCCEEDED"&&g.customerRevision!==data.units.find(u=>u.id===g.unitId)?.revision);
 const generated=data.units.length>0&&data.units.every(u=>data.history.some(g=>g.unitId===u.id&&g.status==="SUCCEEDED"&&g.customerRevision===u.revision)&&!u.issues.length);
 const status=order.canceled?"Canceled":!order.paid?"Awaiting payment":order.refund!=="none"?"Review refund":failed?"Production needs attention":stale?"Review updated information":priority?"Information or setup needed":active?"In production":generated?"Generated":"Pending";
 const view:DetailView={finance,reference:order.externalId,customer:order.buyerName,date:order.createdAt.toISOString(),status,payment:order.canceled?"Canceled":order.paid?"Paid":"Awaiting payment",items};
 return <OrderDetailView data={view} backHref={ordersHref(ordersQuery(await searchParams??{}))}/>;
}
