import { InformationPopover } from "@/components/information-popover";
import {notFound} from "next/navigation";
import {internalOperatorAllowed} from "@/modules/identity/internal-access";
import Link from "next/link";
import {and,eq} from "drizzle-orm";
import {productVersions} from "@/db/schema";
import {tenantWhere} from "@/modules/intake/service";
import {database} from "@/db/client";
import {currentStoreScope} from "@/modules/identity/session";
import {discoverReviewCandidates,loadCandidateReview} from "@/modules/etsy/candidate-review";
import {verifyScope} from "@/modules/intake/service";
import {selectHistoricalCandidate,confirmHistoricalReview} from "./actions";
export const dynamic="force-dynamic";
export const metadata={title:"Private Etsy purchase review",robots:{index:false,follow:false}};
export default async function HistoricalReview({searchParams}:{searchParams:Promise<{review?:string;error?:string}>}){
 const scope=await currentStoreScope();if(!internalOperatorAllowed(scope.userId))notFound();await verifyScope(database(),scope,true);
 const query=await searchParams;
 let content;
 try{
 if(query.review){
  const review=await loadCandidateReview(database(),scope,query.review);
  const [version]=await database().select().from(productVersions).where(and(tenantWhere(productVersions,scope),eq(productVersions.id,review.productVersionId)));
  if(!version)throw new Error("REVIEW_UNAVAILABLE");
  content=<section><h2>{review.invalidatedAt?"Review expired":review.confirmedAt?"Candidate review confirmed":"Confirm this exact purchase"}</h2><dl><dt>Receipt</dt><dd>{review.receiptId}</dd><dt>Transaction</dt><dd>{review.transactionId}</dd><dt>Selected Product version</dt><dd>{review.productVersionId}</dd></dl><h3>Approved Product configuration · version {version.versionNumber}</h3><p>Reading topics: {version.configuration.sections.map(s=>s.title).join(", ")}</p><p>Customer fields: {version.configuration.inputs.map(i=>i.label).join(", ")}</p><p>Output: {version.configuration.output} · Preparation target: {version.configuration.fulfillment?.targetCompletionMinutes ?? "Not set"} minutes</p><p>This review pins one transaction and its purchased evidence. It does not approve historical adoption or import an order.</p>{!review.invalidatedAt&&!review.confirmedAt&&<form action={confirmHistoricalReview}><input type="hidden" name="review" value={review.id}/><label><input type="checkbox" name="confirmation" value="review-only" required/> I reviewed this exact purchase and its Product configuration.</label><button className="button">Confirm review only</button></form>}{review.confirmedAt&&!review.invalidatedAt&&<p role="status">Review recorded. Historical adoption and ingestion still require a separate explicitly authorized operation and fresh evidence validation.</p>}<Link href="/etsy/historical-review">Review recent purchases</Link></section>;
 }else{
  const candidates=await discoverReviewCandidates(database(),scope);
  content=<div>{!candidates.length&&<p>No recent paid purchases found.</p>}{candidates.map(c=><article className="product-record" key={c.receiptId+":"+c.transactionId}><h2>{c.title}</h2><p>{c.purchasedAt?new Date(c.purchasedAt*1000).toLocaleString("en-GB"):"Purchase date unavailable"} · Quantity {c.quantity}</p><p>Receipt {c.receiptId} · Transaction {c.transactionId}</p><ul>{c.selections.map((s,i)=><li key={i}>{s.name}: {s.values.join(", ")}</li>)}</ul><p>{c.versionId?`Matching Product version ${c.versionNumber}`:"No exact active Product configuration"}</p>{c.configuration&&<InformationPopover label="Review approved configuration" dialog><p>Preparation: {c.configuration.workflow==="MANUAL"?"Manual preparation":"Automatic draft preparation"} · {c.configuration.fulfillment?.targetCompletionMinutes} minutes</p><p>Reading topics: {c.configuration.sections.map(s=>s.title).join(", ")}</p><p>Customer fields: {c.configuration.inputs.map(i=>i.label).join(", ")}</p></InformationPopover>}<p>{c.historical?"Explicit historical adoption required":"Historical adoption is not applicable"}</p>{c.reasons.length>0?<p>Held: {c.reasons.join(", ")}</p>:<form action={selectHistoricalCandidate}><input type="hidden" name="receipt" value={c.receiptId}/><input type="hidden" name="transaction" value={c.transactionId}/><input type="hidden" name="version" value={c.versionId}/><button className="button secondary">Select this purchase for review</button></form>}</article>)}</div>;
 }
 }catch{content=<div role="alert"><p>Private purchase review could not load. Your Products and saved purchases have not changed.</p><Link href="/etsy/historical-review">Try again</Link></div>;}
 return <main className="page-content"><Link href="/">← Back to workspace</Link><h1>Private Etsy purchase review</h1><p>Review up to three recent paid receipts. Selecting and confirming a review never adopts or imports a purchase.</p>{query.error&&<p role="alert">{query.error==="stale"?"The purchased evidence or Product configuration changed. Select and review the purchase again.":"Review could not be completed. Refresh and check the purchase again."}</p>}{content}</main>;
}
