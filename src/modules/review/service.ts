import {createHash} from "node:crypto";
import {and,desc,eq} from "drizzle-orm";
import {z} from "zod";
import type {Database,DbExecutor} from "../../db/client";
import {readingReviews,readingReviewDrafts,units,lineItems,orders,generations,stores,productionQueue} from "../../db/schema";
import {tenantWhere,verifyScope} from "../intake/service";
import {answerSchema,stableJson,type Scope} from "../intake/contracts";
import {configurationSchema} from "../products/contracts";
import {ENGINE_VERSION,validateCanonical} from "../generation/contracts";
import {validateReviewDraft,ReviewDraftError} from "./draft-contract";
import {immutableApprovedReading,type ApprovedReadingForDocument} from "./approved-reading";
export class ReviewUnavailable extends Error {constructor(){super("REVIEW_UNAVAILABLE");}}
const identity=z.string().uuid();
export function reviewContent(generation:typeof generations.$inferSelect) {
 try {
  const c=generation.context;
  if(generation.status!=="SUCCEEDED"||!generation.result||!generation.completedAt||c.version!==ENGINE_VERSION||c.unitId!==generation.unitId||c.product.id!==generation.productVersionId||c.customer.revision!==generation.customerRevision||c.style.id!==generation.styleVersionId||c.seller.id!==generation.sellerProfileId||createHash("sha256").update(stableJson(c)).digest("hex")!==generation.contextHash)throw new Error();
  const configuration=configurationSchema.parse(c.product.configuration),answers=z.array(answerSchema).max(1000).parse(c.customer.answers);
  const result=validateCanonical(JSON.stringify(generation.result),c);
  const used=new Set<number>();
  const details=[...configuration.inputs].sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)).map(input=>{
   const index=answers.findIndex(a=>[input.label,input.key].some(label=>label.toLowerCase()===a.label.toLowerCase()));
   if(index>=0)used.add(index);
   return {label:input.label||"Customer information",value:index>=0?answers[index].value:"Not provided"};
  });
  answers.forEach((answer,i)=>{if(!used.has(i))details.push({label:answer.label||"Customer information",value:answer.value||"Not provided"});});
  return {sections:result.sections.map(({title,content})=>({title,content})),details,revision:c.customer.revision};
 }catch{throw new ReviewUnavailable();}
}
async function candidate(tx:DbExecutor,scope:Scope,orderId:string,readingId:string) {
 await verifyScope(tx,scope);
 if(!identity.safeParse(orderId).success||!identity.safeParse(readingId).success)throw new ReviewUnavailable();
 const [unit]=await tx.select().from(units).where(and(tenantWhere(units,scope),eq(units.id,readingId)));
 if(!unit)throw new ReviewUnavailable();
 const [line]=await tx.select().from(lineItems).where(and(tenantWhere(lineItems,scope),eq(lineItems.id,unit.lineItemId),eq(lineItems.orderId,orderId)));
 const [order]=await tx.select().from(orders).where(and(tenantWhere(orders,scope),eq(orders.id,orderId)));
 if(!line||!order||!Array.isArray(unit.issues)||unit.issues.length||unit.sourceChanged||!order.paid||order.canceled||order.refund!=="none")throw new ReviewUnavailable();
 const [queue]=await tx.select().from(productionQueue).where(and(tenantWhere(productionQueue,scope),eq(productionQueue.unitId,unit.id)));
 if(queue&&["ATTENTION","EXECUTING","CLAIMED","RETRY_WAIT"].includes(queue.state))throw new ReviewUnavailable();
 const [latest]=await tx.select().from(generations).where(and(tenantWhere(generations,scope),eq(generations.unitId,unit.id))).orderBy(desc(generations.createdAt),desc(generations.id)).limit(1);
 if(!latest||latest.status!=="SUCCEEDED")throw new ReviewUnavailable();
 const [review]=await tx.select().from(readingReviews).where(and(tenantWhere(readingReviews,scope),eq(readingReviews.unitId,unit.id)));
 const [generation]=await tx.select().from(generations).where(and(tenantWhere(generations,scope),eq(generations.unitId,unit.id),...(review?[eq(generations.id,review.generationId)]:[]))).orderBy(desc(generations.createdAt),desc(generations.id)).limit(1);
 if(!generation||(!review&&generation.customerRevision!==unit.revision)||generation.context?.orderId!==order.id||generation.context?.lineItemId!==line.id)throw new ReviewUnavailable();
 const content=reviewContent(generation);
 return {unit,line,order,generation,review,content};
}
export async function reviewAvailable(db:Database,scope:Scope,orderId:string,readingId:string) {
 return (await readingReviewStatus(db,scope,orderId,readingId))!==null;
}
export async function openReadingReview(db:Database,scope:Scope,orderId:string,readingId:string,editing=false) {
 return db.transaction(async tx=>{
  await verifyScope(tx,scope);
  await tx.select({id:stores.id}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  const data=await candidate(tx,scope,orderId,readingId);
  let review=data.review;
  if(!review)[review]=await tx.insert(readingReviews).values({organizationId:scope.organizationId,storeId:scope.storeId,unitId:readingId,generationId:data.generation.id}).returning();
  const base=validateCanonical(JSON.stringify(data.generation.result),data.generation.context);
  let [draft]=await tx.select().from(readingReviewDrafts).where(and(tenantWhere(readingReviewDrafts,scope),eq(readingReviewDrafts.reviewId,review.id)));
  if(editing&&review.state!=="PENDING")throw new ReviewUnavailable();
  if(editing&&!draft)[draft]=await tx.insert(readingReviewDrafts).values({organizationId:scope.organizationId,storeId:scope.storeId,reviewId:review.id,content:base}).returning();
  let content=base;
  try{if(draft&&review.state!=="APPROVED")content=validateReviewDraft(draft.content,base);}catch{throw new ReviewUnavailable();}
  if(review.state==="APPROVED")content=approvedReviewContent(review,base);
  return {approved:review.state==="APPROVED",customer:data.order.buyerName||"Customer",product:data.line.title,orderReference:data.order.externalId,index:data.unit.unitIndex,quantity:data.line.quantity,...data.content,
   sections:content.sections.map(({title,content})=>({title,content})),
   draft:draft&&review.state!=="APPROVED"?{revision:draft.revision,content,modified:stableJson(content)!==stableJson(base)}:null};
 });
}

export async function saveReadingReviewDraft(db:Database,scope:Scope,orderId:string,readingId:string,expectedRevision:number,raw:unknown) {
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new ReviewDraftError("INVALID");
 return db.transaction(async tx=>{
  await verifyScope(tx,scope);
  await tx.select({id:stores.id}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  const data=await candidate(tx,scope,orderId,readingId);
  if(!data.review||data.review.state!=="PENDING")throw new ReviewDraftError("UNAVAILABLE");
  const [draft]=await tx.select().from(readingReviewDrafts).where(and(tenantWhere(readingReviewDrafts,scope),eq(readingReviewDrafts.reviewId,data.review.id))).for("update");
  if(!draft)throw new ReviewDraftError("UNAVAILABLE");
  if(draft.revision!==expectedRevision)throw new ReviewDraftError("CONFLICT");
  const base=validateCanonical(JSON.stringify(data.generation.result),data.generation.context),content=validateReviewDraft(raw,base);
  const [saved]=await tx.update(readingReviewDrafts).set({content,revision:draft.revision+1,updatedAt:new Date()}).where(and(tenantWhere(readingReviewDrafts,scope),eq(readingReviewDrafts.reviewId,draft.reviewId),eq(readingReviewDrafts.revision,expectedRevision))).returning();
  if(!saved)throw new ReviewDraftError("CONFLICT");
  return {revision:saved.revision,modified:stableJson(content)!==stableJson(base)};
 });
}

export function reviewContentHash(content:import("../generation/contracts").CanonicalResult) {
 return createHash("sha256").update(stableJson(content)).digest("hex");
}
export function approvedReviewContent(review:typeof readingReviews.$inferSelect,base:import("../generation/contracts").CanonicalResult) {
 try {
  if(review.state!=="APPROVED"||!(review.approvedAt instanceof Date)||!Number.isFinite(review.approvedAt.getTime())||!review.approvedContentHash||!review.approvedByUserId||(review.approvedDraftRevision!==null&&(!Number.isSafeInteger(review.approvedDraftRevision)||review.approvedDraftRevision<0)))throw new Error();
  const content=validateReviewDraft(review.approvedContent,base);
  if(review.approvedDraftRevision===null&&stableJson(content)!==stableJson(base))throw new Error();
  if(reviewContentHash(content)!==review.approvedContentHash)throw new Error();
  return content;
 }catch{throw new ReviewUnavailable();}
}
export async function approveReadingReview(db:Database,scope:Scope,orderId:string,readingId:string,expectedRevision:number|null) {
 if(expectedRevision!==null&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0))throw new ReviewDraftError("INVALID");
 return db.transaction(async tx=>{
  await verifyScope(tx,scope);
  await tx.select({id:stores.id}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  const data=await candidate(tx,scope,orderId,readingId),review=data.review;
  if(!review)throw new ReviewUnavailable();
  const base=validateCanonical(JSON.stringify(data.generation.result),data.generation.context);
  if(review.state==="APPROVED"){approvedReviewContent(review,base);return review;}
  if(review.state!=="PENDING")throw new ReviewUnavailable();
  const [draft]=await tx.select().from(readingReviewDrafts).where(and(tenantWhere(readingReviewDrafts,scope),eq(readingReviewDrafts.reviewId,review.id))).for("update");
  if((draft?.revision??null)!==expectedRevision)throw new ReviewDraftError("CONFLICT");
  const content=validateReviewDraft(draft?.content??base,base);
  const [approved]=await tx.update(readingReviews).set({state:"APPROVED",approvedByUserId:scope.userId,approvedContent:content,approvedDraftRevision:draft?.revision??null,approvedContentHash:reviewContentHash(content),approvedAt:new Date()}).where(and(tenantWhere(readingReviews,scope),eq(readingReviews.id,review.id),eq(readingReviews.state,"PENDING"))).returning();
  if(!approved)throw new ReviewUnavailable();
  return approved;
 });
}
export async function readingReviewStatus(db:Database,scope:Scope,orderId:string,readingId:string) {
 try{return await db.transaction(async tx=>{
  const data=await candidate(tx,scope,orderId,readingId);
  if(data.review?.state==="APPROVED"){
   approvedReviewContent(data.review,validateCanonical(JSON.stringify(data.generation.result),data.generation.context));
   return "Approved";
  }
  if(data.review){
   const base=validateCanonical(JSON.stringify(data.generation.result),data.generation.context);
   const [draft]=await tx.select().from(readingReviewDrafts).where(and(tenantWhere(readingReviewDrafts,scope),eq(readingReviewDrafts.reviewId,data.review.id)));
   try{if(draft)validateReviewDraft(draft.content,base);}catch{throw new ReviewUnavailable();}
  }
  return "Ready for review";
 },{isolationLevel:"repeatable read"});}catch(error){if(error instanceof ReviewUnavailable)return null;throw error;}
}

/** Local repeatable-read boundary; no admission, editing, approval or provider side effect. */
export async function getApprovedReadingForDocument(db:Database,scope:Scope,orderId:string,readingId:string):Promise<ApprovedReadingForDocument> {
 return db.transaction(async tx=>{
  const data=await candidate(tx,scope,orderId,readingId),review=data.review;
  if(!review||review.state!=="APPROVED")throw new ReviewUnavailable();
  const base=validateCanonical(JSON.stringify(data.generation.result),data.generation.context);
  const content=approvedReviewContent(review,base);
  try{return immutableApprovedReading({contractVersion:"approved-reading/v1",organizationId:scope.organizationId,storeId:scope.storeId,readingId:data.unit.id,
   order:{id:data.order.id,reference:data.order.externalId,customerName:data.order.buyerName||"Customer"},product:{name:data.line.title},readingNumber:data.unit.unitIndex,quantity:data.line.quantity,
   sections:content.sections,contentHash:review.approvedContentHash,approvedAt:review.approvedAt!.toISOString(),provenance:{reviewId:review.id,generationId:review.generationId}});}catch{throw new ReviewUnavailable();}
 },{isolationLevel:"repeatable read"});
}
