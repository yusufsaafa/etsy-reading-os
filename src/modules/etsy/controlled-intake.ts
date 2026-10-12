import {z} from "zod";
import {and,eq} from "drizzle-orm";
import type {Database,DbExecutor} from "../../db/client";
import {stores,lineItems,units,orders} from "../../db/schema";
import {AccessDenied} from "../identity/service";
import {verifyScope,tenantWhere,ingestOrderInTransaction} from "../intake/service";
import {orderSchema,type Scope,type ExternalOrder} from "../intake/contracts";
import {resolveConfiguration,resolveEtsySourceConfiguration} from "../products/runtime";
import {normalizeEtsyReceipt} from "./raw-normalizer";
import {etsyId,selectionKey} from "./source-contract";
import {sourceFingerprint} from "./source-fingerprint";

export const controlledIntakeCommand=z.object({commandId:z.uuid(),receiptId:etsyId,approvedVersions:z.record(etsyId,z.uuid())}).strict();
/** Private server result contains customer evidence; only report may be logged. No HTTP or writes. */
export async function assessReceiptForIntake(tx:DbExecutor,scope:Scope,body:string,observedAt:number){
 await verifyScope(tx,scope,true);
 const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 if(!store?.externalShopId)throw new AccessDenied();
 const sources=normalizeEtsyReceipt(body,{verifiedShopId:store.externalShopId,observedAt});
 const report={receipts:1,lines:sources.length,exactResolved:0,normalEligible:0,historicalAdoptionRequired:0,historicalOrMappingAmbiguity:0,held:0,quantityContextRequired:0,intendedOrders:0,intendedLines:0,intendedReadings:0,purchaserIdentityPresent:0,holdReasons:{} as Record<string,number>};
 const resolvedVersions:Record<string,string>={};const lines:ExternalOrder["lines"]=[];
 let projectable=sources.length>0,newLines=0,newReadings=0;
 for(const source of sources){
  const [prior]=await tx.select().from(lineItems).where(and(tenantWhere(lineItems,scope),eq(lineItems.externalId,source.transaction.transactionId)));
  const retained=prior?await tx.select().from(units).where(and(tenantWhere(units,scope),eq(units.lineItemId,prior.id))):[];
  if(!prior)newLines++;
  newReadings+=Array.from({length:source.transaction.quantity},(_,i)=>i+1).filter(i=>!retained.some(u=>u.unitIndex===i)).length;
  const history=retained.length?{productVersionId:retained[0].productVersionId}:undefined;
  const resolution=await resolveEtsySourceConfiguration(tx,scope,source,history,{lineAdoptionOnly:true});
  const reasons=[...resolution.issues];
  if(prior&&(!prior.snapshot.etsySource||sourceFingerprint(prior.snapshot.etsySource)!==sourceFingerprint(source)))reasons.push("source_changed");
  if(retained.some(u=>u.productVersionId!==history?.productVersionId))reasons.push("source_changed");
  if(source.transaction.quantity>1){reasons.push("quantity_context");report.quantityContextRequired++;}
  if(reasons.includes("ambiguous_historical_mapping"))report.historicalOrMappingAmbiguity++;
  if(source.receipt.purchaserAccountId?.presence==="value")report.purchaserIdentityPresent++;
  if(resolution.version&&!resolution.issues.length&&!reasons.includes("source_changed")){
   report.exactResolved++;resolvedVersions[source.transaction.transactionId]=resolution.version.id;
   if(!history&&!reasons.length)report.normalEligible++;
  }
  let key:string|undefined;
  try{key=selectionKey(source.purchaseSelections.map(s=>({propertyId:s.propertyId,valueIds:s.valueIds.presence==="value"?s.valueIds.value:[]})));}catch{reasons.push("unmapped_purchase_selection");}
  if(key&&source.transaction.listingId.presence==="value"&&!history&&reasons.includes("ambiguous_historical_mapping")){
   const exact=await resolveConfiguration(tx,scope,source.transaction.listingId.value,key);
   if(exact.version&&source.receipt.createdTimestamp.presence==="value"){
    const {productVersions}=await import("../../db/schema");
    const [v]=await tx.select().from(productVersions).where(and(tenantWhere(productVersions,scope),eq(productVersions.id,exact.version.id)));
    if(v.activatedAt&&source.receipt.createdTimestamp.value<Math.ceil(v.activatedAt.getTime()/1000))report.historicalAdoptionRequired++;
   }
  }
  if(!key||source.transaction.listingId.presence!=="value"||source.transaction.isDigital.presence!=="value"||source.transaction.quantity<1){projectable=false;reasons.push("source_evidence_incomplete");}
  else lines.push({externalId:source.transaction.transactionId,listingId:source.transaction.listingId.value,title:prior?.title??(source.transaction.purchasedTitle?.presence==="value"?source.transaction.purchasedTitle.value:"Purchased title unavailable"),quantity:source.transaction.quantity,sku:source.transaction.sku.presence==="value"?source.transaction.sku.value:null,variantKey:key,variations:[],answers:resolution.answers,digital:source.transaction.isDigital.value,etsySource:source});
  if(reasons.length)report.held++;
  for(const reason of new Set(reasons))report.holdReasons[reason]=(report.holdReasons[reason]??0)+1;
 }
 const first=sources[0];let order:ExternalOrder|undefined;
 if(projectable&&first?.receipt.createdTimestamp.presence==="value"&&first.receipt.updatedTimestamp.presence==="value"){
  const r=first.receipt;
  order=orderSchema.parse({externalId:r.receiptId,buyerName:"",purchaser:{source:"etsy",role:"PURCHASER",accountId:r.purchaserAccountId?.presence==="value"?r.purchaserAccountId.value:null},createdAt:first.receipt.createdTimestamp.value,updatedAt:first.receipt.updatedTimestamp.value,paid:r.isPaid.presence==="value"&&r.isPaid.value,canceled:r.cancellation.state!=="NOT_CANCELED",refund:r.refundAssessment==="NONE_REPORTED"?"none":r.refundAssessment==="FULL"?"full":r.refundAssessment==="PARTIAL"?"partial":"unknown",lines});
  if(report.exactResolved){
   const [existing]=await tx.select({id:orders.id}).from(orders).where(and(tenantWhere(orders,scope),eq(orders.externalId,r.receiptId)));
   report.intendedOrders=existing?0:1;report.intendedLines=newLines;report.intendedReadings=newReadings;
  }
 }else if(sources.length){report.holdReasons.source_evidence_incomplete=(report.holdReasons.source_evidence_incomplete??0)+1;}
 return {report,order,sources,resolvedVersions};
}
/** Explicit owner command. Receipt-atomic existing intake; never schedules preparation. */
export async function ingestControlledReceipt(db:Database,scope:Scope,body:string,observedAt:number,rawCommand:unknown,options:{failAfterLines?:number;epoch?:number;verifiedShopId?:string;captureUnconfigured?:boolean}={}){
 const command=controlledIntakeCommand.parse(rawCommand);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  const [ownedStore]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  if(options.verifiedShopId){
   const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
   if(store?.externalShopId!==options.verifiedShopId)throw new AccessDenied();
  }
  const assessment=await assessReceiptForIntake(tx,scope,body,observedAt);
  if(!assessment.order||assessment.order.externalId!==command.receiptId)throw new Error("SOURCE_SELECTION_MISMATCH");
  const entries=Object.entries(assessment.resolvedVersions);
  // Capture is independent of preparation. This internal option is used only by
  // owned operational sync; explicit historical intake retains its original gate.
  if(options.captureUnconfigured){
   if(options.epoch===undefined||!options.verifiedShopId)throw new Error("CAPTURE_CONNECTION_REQUIRED");
   if(!assessment.order.paid||assessment.order.canceled||assessment.order.refund!=="none"||assessment.report.holdReasons.source_evidence_incomplete)throw new Error("CAPTURE_SOURCE_HOLD");
  }else if(!entries.length)throw new Error("NO_ELIGIBLE_LINES");
  if(entries.some(([id,version])=>command.approvedVersions[id]!==version)||Object.keys(command.approvedVersions).some(id=>assessment.resolvedVersions[id]!==command.approvedVersions[id]))throw new Error("PRODUCT_VERSION_MISMATCH");
  if(assessment.report.holdReasons.source_changed)throw new Error("SOURCE_CHANGED");
  const id=await ingestOrderInTransaction(tx,scope,assessment.order,{controlled:{commandId:command.commandId,versions:command.approvedVersions},suppressProductionAdmission:true,epoch:options.epoch,failAfterLines:options.failAfterLines});
  // Finance-only projection is not part of the purchased snapshot/fingerprint.
  // Savepoint failure cannot roll back successfully validated operational intake.
  let finance: string="UNAVAILABLE";
  try{if(ownedStore?.source==="etsy")finance=await tx.transaction(async financeTx=>{const {captureReceiptFinanceInTransaction}=await import("../orders-finance/service");return (await captureReceiptFinanceInTransaction(financeTx,scope,id,body,assessment.sources[0].receipt.shopId,options.epoch)).state;});}
  catch(error){if(error instanceof AccessDenied||error instanceof Error&&error.message==="CONNECTION_CHANGED")throw error;finance="FAILED";}
  return {orderId:id,report:assessment.report,finance};
 });
}
