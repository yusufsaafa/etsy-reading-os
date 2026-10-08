import {and,eq} from "drizzle-orm";
import {z} from "zod";
import type {Database,DbExecutor} from "../../db/client";
import {etsyCandidateReviews,productVersions,stores} from "../../db/schema";
import {tenantWhere,verifyScope} from "../intake/service";
import {validateInputs,type Scope} from "../intake/contracts";
import {configurationSchema,inputPolicy} from "../products/contracts";
import {resolveConfiguration} from "../products/runtime";
import {normalizeEtsyReceipt,parseEtsyJson} from "./raw-normalizer";
import {assessEtsySource,etsyId,selectionKey} from "./source-contract";
import {sourceFingerprint} from "./source-fingerprint";
import {readOwnedReceipt,readOwnedReceiptSample} from "./owned-receipt";

/** Private projection: deliberately excludes buyer content, purchaser identity and raw JSON. */
export async function reviewCandidates(tx:DbExecutor,scope:Scope,body:string){
 await verifyScope(tx,scope,true);
 const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 if(!store?.externalShopId)throw new Error("REVIEW_UNAVAILABLE");
 const sources=normalizeEtsyReceipt(body,{verifiedShopId:store.externalShopId,observedAt:Math.floor(Date.now()/1000)});
 const raw=parseEtsyJson(body) as {transactions?:Record<string,unknown>[]};
 return Promise.all(sources.map(async source=>{
  const listingId=source.transaction.listingId.presence==="value"?source.transaction.listingId.value:undefined;
  const key=selectionKey(source.purchaseSelections.map(s=>({propertyId:s.propertyId,valueIds:s.valueIds.presence==="value"?s.valueIds.value:[]})));
  const resolved=listingId?await resolveConfiguration(tx,scope,listingId,key):undefined;
  const [version]=resolved?.version?await tx.select().from(productVersions).where(and(tenantWhere(productVersions,scope),eq(productVersions.id,resolved.version.id))):[];
  const configuration=version?configurationSchema.parse(version.configuration):undefined;
  const assessment=assessEtsySource(source,configuration?.etsyFulfillment);
  const reasons:string[]=[...assessment.issues];
  if(configuration)reasons.push(...validateInputs(assessment.answers,inputPolicy(configuration)));
  if(resolved?.mapping?.paused)reasons.push("paused_product");
  if(source.transaction.quantity!==1)reasons.push("quantity_context");
  const historical=!!version?.activatedAt&&source.receipt.createdTimestamp.presence==="value"&&source.receipt.createdTimestamp.value<Math.ceil(version.activatedAt.getTime()/1000);
  if(!historical)reasons.push("not_historical_candidate");
  const purchased=raw.transactions?.find(t=>String(t.transaction_id)===source.transaction.transactionId);
  const title=typeof purchased?.title==="string"?purchased.title.slice(0,500):"Etsy purchase";
  return {receiptId:source.receipt.receiptId,transactionId:source.transaction.transactionId,shopId:source.receipt.shopId,listingId,key,
   fingerprint:sourceFingerprint(source),title,purchasedAt:source.receipt.createdTimestamp.presence==="value"?source.receipt.createdTimestamp.value:null,
   quantity:source.transaction.quantity,selections:source.purchaseSelections.map(s=>({name:s.formattedName.presence==="value"?s.formattedName.value:"Purchase option",values:s.formattedValues.presence==="value"?s.formattedValues.value:[]})),
   versionId:version?.id,versionNumber:version?.versionNumber,configuration,historical,reasons:[...new Set(reasons)]};
 }));
}
export async function discoverReviewCandidates(db:Database,scope:Scope){
 const sample=await readOwnedReceiptSample(db,scope);
 return (await Promise.all(sample.details.map(d=>reviewCandidates(db,scope,d.body)))).flat();
}
const selection=z.object({receiptId:etsyId,transactionId:etsyId,productVersionId:z.uuid()}).strict();
export async function recordCandidateReview(db:Database,scope:Scope,raw:unknown,reader=readOwnedReceipt){
 await verifyScope(db,scope,true);const command=selection.parse(raw);
 const detail=await reader(db,scope,command.receiptId);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  const candidate=(await reviewCandidates(tx,scope,detail.body)).find(c=>c.transactionId===command.transactionId);
  if(candidate?.shopId!==detail.shopId)throw new Error("CONNECTION_CHANGED");
  if(!candidate||candidate.receiptId!==command.receiptId||candidate.versionId!==command.productVersionId||candidate.reasons.length||!candidate.listingId)throw new Error("CANDIDATE_REVIEW_BLOCKED");
  const desired={organizationId:scope.organizationId,storeId:scope.storeId,reviewedBy:scope.userId,shopId:candidate.shopId,receiptId:candidate.receiptId,transactionId:candidate.transactionId,listingId:candidate.listingId,selectionKey:candidate.key,productVersionId:candidate.versionId,sourceFingerprint:candidate.fingerprint};
  const [prior]=await tx.select().from(etsyCandidateReviews).where(and(tenantWhere(etsyCandidateReviews,scope),eq(etsyCandidateReviews.reviewedBy,scope.userId),eq(etsyCandidateReviews.receiptId,desired.receiptId),eq(etsyCandidateReviews.transactionId,desired.transactionId),eq(etsyCandidateReviews.productVersionId,desired.productVersionId),eq(etsyCandidateReviews.sourceFingerprint,desired.sourceFingerprint)));
  if(prior&&!prior.invalidatedAt)return prior.id;
  if(prior)throw new Error("REVIEW_INVALIDATED");
  const [review]=await tx.insert(etsyCandidateReviews).values(desired).returning();return review.id;
 });
}
export async function loadCandidateReview(db:DbExecutor,scope:Scope,id:string){
 await verifyScope(db,scope,true);z.uuid().parse(id);
 const [review]=await db.select().from(etsyCandidateReviews).where(and(tenantWhere(etsyCandidateReviews,scope),eq(etsyCandidateReviews.id,id),eq(etsyCandidateReviews.reviewedBy,scope.userId)));
 if(!review)throw new Error("REVIEW_UNAVAILABLE");return review;
}
/** Explicit confirmation pins review only. NEVER calls adoption or ingestion. Fresh GET on every confirmation/replay. */
export async function confirmCandidateReview(db:Database,scope:Scope,id:string,reader=readOwnedReceipt){
 const review=await loadCandidateReview(db,scope,id);
 const detail=await reader(db,scope,review.receiptId);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  const current=await loadCandidateReview(tx,scope,id);
  let candidate:Awaited<ReturnType<typeof reviewCandidates>>[number]|undefined;
  try{candidate=(await reviewCandidates(tx,scope,detail.body)).find(c=>c.transactionId===review.transactionId);}catch{/* Malformed/changed purchased evidence invalidates this review; no source content is logged. */}
  if(current.invalidatedAt)return {confirmed:false};
  if(!candidate||candidate.receiptId!==review.receiptId||candidate.fingerprint!==review.sourceFingerprint||candidate.versionId!==review.productVersionId||candidate.shopId!==detail.shopId||candidate.shopId!==review.shopId||candidate.key!==review.selectionKey||candidate.reasons.length){
   await tx.update(etsyCandidateReviews).set({invalidatedAt:new Date()}).where(eq(etsyCandidateReviews.id,id));return {confirmed:false};
  }
  if(!current.confirmedAt)await tx.update(etsyCandidateReviews).set({confirmedAt:new Date()}).where(eq(etsyCandidateReviews.id,id));
  return {confirmed:true};
 });
}
/** Future explicit adoption callers must use this fresh check and the returned exact pin.
 * This returns review provenance only; the existing adoption command must still run all its gates.
 */
export async function revalidateConfirmedReview(db:Database,scope:Scope,id:string,reader=readOwnedReceipt){
 const review=await loadCandidateReview(db,scope,id);
 if(!review.confirmedAt||review.invalidatedAt)throw new Error("CONFIRMED_REVIEW_REQUIRED");
 if(!(await confirmCandidateReview(db,scope,id,reader)).confirmed)throw new Error("REVIEW_INVALIDATED");
 const current=await loadCandidateReview(db,scope,id);
 if(!current.confirmedAt||current.invalidatedAt)throw new Error("REVIEW_INVALIDATED");
 return current;
}
