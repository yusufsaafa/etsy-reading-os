import {pinnedProductTitle} from "../products/contracts";
import { admitDocumentProductionInTransaction } from "../production/documents";
import { readingMediaRequirement, readingMediaHash } from "../media/reading-contract";
import { detached } from "../media/contracts";
import { immutableApprovedReadingMedia, type ApprovedReadingMedia } from "./approved-media";
import {createHash} from "node:crypto";
import {and,desc,eq,inArray} from "drizzle-orm";
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
 const [queue]=await tx.select().from(productionQueue).where(and(tenantWhere(productionQueue,scope),eq(productionQueue.unitId,unit.id)));
 const [latest]=await tx.select().from(generations).where(and(tenantWhere(generations,scope),eq(generations.unitId,unit.id))).orderBy(desc(generations.createdAt),desc(generations.id)).limit(1);
 const [review]=await tx.select().from(readingReviews).where(and(tenantWhere(readingReviews,scope),eq(readingReviews.unitId,unit.id)));
 const [generation]=await tx.select().from(generations).where(and(tenantWhere(generations,scope),eq(generations.unitId,unit.id),...(review?[eq(generations.id,review.generationId)]:[]))).orderBy(desc(generations.createdAt),desc(generations.id)).limit(1);
 return validatedCandidate(unit,line,order,queue,latest,review,generation);
}
function validatedCandidate(unit:typeof units.$inferSelect,line:typeof lineItems.$inferSelect|undefined,order:typeof orders.$inferSelect|undefined,queue:{state:string}|undefined,latest:typeof generations.$inferSelect|undefined,review:typeof readingReviews.$inferSelect|undefined,generation:typeof generations.$inferSelect|undefined){
 if(!line||!order||!Array.isArray(unit.issues)||unit.issues.length||unit.sourceChanged||!order.paid||order.canceled||order.refund!=="none")throw new ReviewUnavailable();
 if(queue&&["ATTENTION","EXECUTING","CLAIMED","RETRY_WAIT"].includes(queue.state))throw new ReviewUnavailable();
 if(!latest||latest.status!=="SUCCEEDED")throw new ReviewUnavailable();
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
  if(editing&&!draft)[draft]=await tx.insert(readingReviewDrafts).values({organizationId:scope.organizationId,storeId:scope.storeId,reviewId:review.id,content:{sections:base.sections}}).returning();
  let content={sections:base.sections};
  try{if(draft&&review.state!=="APPROVED")content=validateReviewDraft(draft.content,base);}catch{throw new ReviewUnavailable();}
  if(review.state==="APPROVED"){content=approvedReviewContent(review,base);approvedMediaForReview(review,data.generation);}
  return {approved:review.state==="APPROVED",customer:data.order.buyerName||"Customer",product:data.line.title,orderReference:data.order.externalId,index:data.unit.unitIndex,quantity:data.line.quantity,...data.content,
   readingMedia:detached(base.readingMedia ?? {mode:"NONE" as const}),
   sections:content.sections.map(({title,content})=>({title,content})),
   draft:draft&&review.state!=="APPROVED"?{revision:draft.revision,content,modified:stableJson(content)!==stableJson({sections:base.sections})}:null};
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
  return {revision:saved.revision,modified:stableJson(content)!==stableJson({sections:base.sections})};
 });
}

export function reviewContentHash(content:import("../generation/contracts").CanonicalResult) {
 return createHash("sha256").update(stableJson({sections:content.sections})).digest("hex");
}
export function approvedReviewContent(review:typeof readingReviews.$inferSelect,base:import("../generation/contracts").CanonicalResult) {
 try {
  if(review.state!=="APPROVED"||!(review.approvedAt instanceof Date)||!Number.isFinite(review.approvedAt.getTime())||!review.approvedContentHash||!review.approvedByUserId||(review.approvedDraftRevision!==null&&(!Number.isSafeInteger(review.approvedDraftRevision)||review.approvedDraftRevision<0)))throw new Error();
  const content=validateReviewDraft(review.approvedContent,base);
  if(review.approvedDraftRevision===null&&stableJson(content)!==stableJson({sections:base.sections}))throw new Error();
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
  if(review.state==="APPROVED"){approvedReviewContent(review,base);approvedMediaForReview(review,data.generation);await admitDocumentProductionInTransaction(tx,scope,review.id,orderId);return review;}
  if(review.state!=="PENDING")throw new ReviewUnavailable();
  const [draft]=await tx.select().from(readingReviewDrafts).where(and(tenantWhere(readingReviewDrafts,scope),eq(readingReviewDrafts.reviewId,review.id))).for("update");
  if((draft?.revision??null)!==expectedRevision)throw new ReviewDraftError("CONFLICT");
  const content=validateReviewDraft(draft?.content??{sections:base.sections},base);
  const approvedAt=new Date();
  const approvedMedia=createApprovedMedia(data.review!,data.generation,approvedAt);
  const [approved]=await tx.update(readingReviews).set({state:"APPROVED",approvedByUserId:scope.userId,approvedContent:content,approvedDraftRevision:draft?.revision??null,approvedContentHash:reviewContentHash(content),approvedAt,approvedMedia}).where(and(tenantWhere(readingReviews,scope),eq(readingReviews.id,review.id),eq(readingReviews.state,"PENDING"))).returning();
  if(!approved)throw new ReviewUnavailable();
  await admitDocumentProductionInTransaction(tx,scope,approved.id,orderId);
  return approved;
 });
}
export async function readingReviewStatus(db:Database,scope:Scope,orderId:string,readingId:string) {
 try{return await db.transaction(async tx=>{
  const data=await candidate(tx,scope,orderId,readingId);
  if(data.review?.state==="APPROVED"){
   approvedReviewContent(data.review,validateCanonical(JSON.stringify(data.generation.result),data.generation.context));
   approvedMediaForReview(data.review,data.generation);
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

/** Order-bounded read only projection. Same candidate/content/approval rules as individual review. */
export async function orderReadingReviewStatuses(db:Database,scope:Scope,orderId:string){
 return db.transaction(async tx=>{
  await verifyScope(tx,scope);
  if(!identity.safeParse(orderId).success)return new Map<string,string>();
  const rows=await tx.select({unit:units,line:lineItems,order:orders,queue:productionQueue}).from(units)
   .innerJoin(lineItems,and(tenantWhere(lineItems,scope),eq(lineItems.id,units.lineItemId),eq(lineItems.orderId,orderId)))
   .innerJoin(orders,and(tenantWhere(orders,scope),eq(orders.id,lineItems.orderId)))
   .leftJoin(productionQueue,and(tenantWhere(productionQueue,scope),eq(productionQueue.unitId,units.id))).where(tenantWhere(units,scope));
  const ids=rows.map(r=>r.unit.id);if(!ids.length)return new Map<string,string>();
  const [latest,reviews]=await Promise.all([
   tx.selectDistinctOn([generations.unitId]).from(generations).where(and(tenantWhere(generations,scope),inArray(generations.unitId,ids))).orderBy(generations.unitId,desc(generations.createdAt),desc(generations.id)),
   tx.select().from(readingReviews).where(and(tenantWhere(readingReviews,scope),inArray(readingReviews.unitId,ids))),
  ]);
  const [retained,drafts]=await Promise.all([
   reviews.length?tx.select().from(generations).where(and(tenantWhere(generations,scope),inArray(generations.id,reviews.map(r=>r.generationId)))):[],
   reviews.length?tx.select().from(readingReviewDrafts).where(and(tenantWhere(readingReviewDrafts,scope),inArray(readingReviewDrafts.reviewId,reviews.map(r=>r.id)))):[],
  ]);
  const result=new Map<string,string>();
  const latestByUnit=new Map(latest.map(g=>[g.unitId,g])),reviewByUnit=new Map(reviews.map(r=>[r.unitId,r])),generationById=new Map(retained.map(g=>[g.id,g])),draftByReview=new Map(drafts.map(d=>[d.reviewId,d]));
  for(const row of rows){try{
   const review=reviewByUnit.get(row.unit.id),current=latestByUnit.get(row.unit.id);
   const data=validatedCandidate(row.unit,row.line,row.order,row.queue??undefined,current,review,review?generationById.get(review.generationId):current);
   // Existing historical reviews remain accessible through their own route, but Order operations
   // never advertise them as a current result after customer information or generation changes.
   if(data.generation.customerRevision!==row.unit.revision||data.generation.id!==current?.id)continue;
   const base=validateCanonical(JSON.stringify(data.generation.result),data.generation.context);
   if(review?.state==="APPROVED"){approvedReviewContent(review,base);approvedMediaForReview(review,data.generation);result.set(row.unit.id,"Approved");}
   else {const draft=review?draftByReview.get(review.id):undefined;try{if(draft)validateReviewDraft(draft.content,base);}catch{throw new ReviewUnavailable();}result.set(row.unit.id,"Ready for review");}
  }catch(error){if(!(error instanceof ReviewUnavailable)){
   // Draft validation errors fail closed just as readingReviewStatus does.
   if(!(error instanceof ReviewDraftError))throw error;
  }}}
  return result;
 },{isolationLevel:"repeatable read"});
}

/** Local repeatable-read boundary; no admission, editing, approval or provider side effect. */
export async function getApprovedReadingForDocument(db:Database,scope:Scope,orderId:string,readingId:string):Promise<ApprovedReadingForDocument> {
 return db.transaction(tx=>getApprovedReadingForDocumentInTransaction(tx,scope,orderId,readingId),{isolationLevel:"repeatable read"});
}
/** Composition boundary: caller owns the transaction; same validation as the public handoff. */
export async function getApprovedReadingForDocumentInTransaction(tx:DbExecutor,scope:Scope,orderId:string,readingId:string):Promise<ApprovedReadingForDocument> {
  const data=await candidate(tx,scope,orderId,readingId),review=data.review;
  if(!review||review.state!=="APPROVED")throw new ReviewUnavailable();
  const base=validateCanonical(JSON.stringify(data.generation.result),data.generation.context);
  const content=approvedReviewContent(review,base);
  approvedMediaForReview(review,data.generation);
  try{return immutableApprovedReading({contractVersion:"approved-reading/v1",organizationId:scope.organizationId,storeId:scope.storeId,readingId:data.unit.id,
   order:{id:data.order.id,reference:data.order.externalId,customerName:data.order.buyerName||"Customer"},product:{name:pinnedProductTitle(data.generation.context.product.configuration).title,titleSource:pinnedProductTitle(data.generation.context.product.configuration).source},reader:{displayName:data.generation.context.seller.displayName,source:data.generation.context.seller.source??"SELLER_PROFILE"},readingNumber:data.unit.unitIndex,quantity:data.line.quantity,
   sections:content.sections,contentHash:review.approvedContentHash,approvedAt:review.approvedAt!.toISOString(),provenance:{reviewId:review.id,generationId:review.generationId}});}catch{throw new ReviewUnavailable();}

}

function createApprovedMedia(review:typeof readingReviews.$inferSelect,generation:typeof generations.$inferSelect,approvedAt:Date):ApprovedReadingMedia {
 const base=validateCanonical(JSON.stringify(generation.result),generation.context);
 const requirement=readingMediaRequirement(generation.context.product.configuration),media=base.readingMedia ?? {mode:"NONE" as const};
 return immutableApprovedReadingMedia({contractVersion:"approved-reading-media/v1",organizationId:review.organizationId,storeId:review.storeId,readingId:review.unitId,provenance:{reviewId:review.id,generationId:review.generationId},requirement,media,mediaHash:readingMediaHash(requirement,media),approvedAt:approvedAt.toISOString()});
}
function approvedMediaForReview(review:typeof readingReviews.$inferSelect,generation:typeof generations.$inferSelect):ApprovedReadingMedia {
 try {
  if(review.state!=="APPROVED" || !review.approvedAt)throw new Error();
  const expected=createApprovedMedia(review,generation,review.approvedAt);
  if(review.approvedMedia===null) {if(expected.requirement.mode!=="NONE")throw new Error();return expected;}
  const value=immutableApprovedReadingMedia(review.approvedMedia);
  if(stableJson(value)!==stableJson(expected))throw new Error();
  return value;
 }catch{throw new ReviewUnavailable();}
}
export async function getApprovedReadingMedia(db:Database,scope:Scope,orderId:string,readingId:string):Promise<ApprovedReadingMedia> {
 return db.transaction(tx=>getApprovedReadingMediaInTransaction(tx,scope,orderId,readingId),{isolationLevel:"repeatable read"});
}
export async function getApprovedReadingMediaInTransaction(tx:DbExecutor,scope:Scope,orderId:string,readingId:string):Promise<ApprovedReadingMedia> {
 const data=await candidate(tx,scope,orderId,readingId);
 if(!data.review || data.review.state!=="APPROVED")throw new ReviewUnavailable();
 approvedReviewContent(data.review,validateCanonical(JSON.stringify(data.generation.result),data.generation.context));
 return approvedMediaForReview(data.review,data.generation);
}
