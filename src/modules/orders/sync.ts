import {and,eq,inArray} from "drizzle-orm";
import {z} from "zod";
import type {Database,DbExecutor} from "../../db/client";
import {connections,stores,orders,lineItems,memberships,units} from "../../db/schema";
import type {Scope} from "../intake/contracts";
import {verifyScope,tenantWhere,ingestOrderInTransaction} from "../intake/service";
import {AccessDenied} from "../identity/service";
import {etsyId} from "../etsy/source-contract";
import {readOwnedReceipt} from "../etsy/owned-receipt";
import {assessReceiptForIntake,ingestControlledReceipt} from "../etsy/controlled-intake";
import {ReceiptPilotError} from "../etsy/receipt-read";
export const syncOrderCommand=z.object({receiptId:etsyId,commandId:z.uuid()}).strict();
export const MAX_SYNC_READINGS=100;
export type SyncAccess={allowed:boolean;reason:string};
export async function orderSyncAccess(db:DbExecutor,scope:Scope):Promise<SyncAccess>{
 await verifyScope(db,scope);
 const [member]=await db.select().from(memberships).where(and(eq(memberships.organizationId,scope.organizationId),eq(memberships.userId,scope.userId)));
 if(member?.role!=="owner")return {allowed:false,reason:"Only the Store owner can sync orders."};
 const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 const [grant]=await db.select().from(connections).where(tenantWhere(connections,scope));
 if(store?.source!=="etsy"||!store.externalShopId||grant?.status!=="connected"||!grant.encryptedTokens)return {allowed:false,reason:"Connect Etsy in Settings before syncing orders."};
 if(!grant.scopes.includes("transactions_r"))return {allowed:false,reason:"Etsy order access is missing. Reauthorize Etsy in Settings."};
 return {allowed:true,reason:"Sync one Etsy receipt, up to 100 readings. Historical adoption remains a separate approval."};
}
export type SyncResult={kind:"IMPORTED"|"ALREADY_IMPORTED"|"PARTIAL"|"HISTORICAL"|"INELIGIBLE"|"UNRESOLVED";orderId?:string;lines:number;readings:number;holds:string[];finance?:string};
type OwnedReader=typeof readOwnedReceipt;
async function persistedReceiptSummary(tx:DbExecutor,scope:Scope,orderId:string){
 const rows=await tx.select({issues:units.issues}).from(units).innerJoin(lineItems,and(tenantWhere(lineItems,scope),eq(lineItems.id,units.lineItemId),eq(lineItems.orderId,orderId))).where(tenantWhere(units,scope));
 return {readings:rows.length,holds:[...new Set(rows.flatMap(r=>r.issues))]};
}
/** One bounded owned HTTP read, then Store-first receipt-atomic intake. No discovery or AI. */
export async function syncOrderReceipt(db:Database,scope:Scope,raw:unknown,reader:OwnedReader=readOwnedReceipt):Promise<SyncResult>{
 const command=syncOrderCommand.parse(raw);
 await verifyScope(db,scope,true);
 const access=await orderSyncAccess(db,scope);if(!access.allowed)throw new Error("SYNC_CONNECTION_REQUIRED");
 const detail=await reader(db,scope,command.receiptId);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  await verifyScope(tx,scope,true);
  const [grant]=await tx.select().from(connections).where(tenantWhere(connections,scope));
  if(store?.source!=="etsy"||store.externalShopId!==detail.shopId||grant?.status!=="connected"||!grant.encryptedTokens||!grant.scopes.includes("transactions_r")||grant.epoch!==detail.epoch)throw new Error("CONNECTION_CHANGED");
  const observedAt=Math.floor(Date.now()/1000),a=await assessReceiptForIntake(tx,scope,detail.body,observedAt);
  if(a.sources.some(s=>s.receipt.receiptId!==command.receiptId))throw new Error("SOURCE_SELECTION_MISMATCH");
  const [existing]=await tx.select().from(orders).where(and(tenantWhere(orders,scope),eq(orders.externalId,command.receiptId)));
  const summary={lines:a.report.lines,readings:a.sources.reduce((n,s)=>n+s.transaction.quantity,0),holds:Object.keys(a.report.holdReasons)};
  if(summary.readings>MAX_SYNC_READINGS)throw new Error("SYNC_RECEIPT_BOUND");
  if(!a.order)return {kind:"UNRESOLVED",...summary};
  // Existing-only reconciliation cannot add lines, expand quantity, or bind versions.
  // The intake service conservatively records source drift and payment/refund holds,
  // retaining purchased snapshots, customer corrections and all original pins.
  if(existing&&(a.report.holdReasons.source_changed||!a.report.exactResolved)){
   const retained=await tx.select().from(lineItems).where(and(tenantWhere(lineItems,scope),eq(lineItems.orderId,existing.id)));
   if(retained.length!==a.order.lines.length||a.order.lines.some(l=>!retained.some(p=>p.externalId===l.externalId&&p.quantity===l.quantity&&p.listingExternalId===l.listingId&&p.variantKey===l.variantKey)))return {kind:"UNRESOLVED",orderId:existing.id,...summary};
   const retainedUnits=await tx.select().from(units).where(and(tenantWhere(units,scope),inArray(units.lineItemId,retained.map(l=>l.id))));
   if(retained.some(line=>{const siblings=retainedUnits.filter(u=>u.lineItemId===line.id);return siblings.length!==line.quantity||Array.from({length:line.quantity},(_,i)=>i+1).some(index=>!siblings.some(u=>u.unitIndex===index));}))return {kind:"UNRESOLVED",orderId:existing.id,...summary};
   const id=await ingestOrderInTransaction(tx,scope,a.order,{controlled:{commandId:command.commandId,versions:{}},suppressProductionAdmission:true,epoch:detail.epoch});
   const persisted=await persistedReceiptSummary(tx,scope,id);
   return {kind:persisted.holds.length?"PARTIAL":"ALREADY_IMPORTED",orderId:id,...summary,...persisted};
  }
  if(a.report.historicalAdoptionRequired)return {kind:"HISTORICAL",...summary};
  if(a.report.historicalOrMappingAmbiguity)return {kind:"UNRESOLVED",...summary};
  if(!a.report.exactResolved)return {kind:"INELIGIBLE",...summary};
  // Nested transaction is a savepoint on this same Store lock, never a second connection.
  const result=await ingestControlledReceipt(tx as unknown as Database,scope,detail.body,observedAt,{...command,approvedVersions:a.resolvedVersions},{epoch:detail.epoch,verifiedShopId:detail.shopId});
  const persisted=await persistedReceiptSummary(tx,scope,result.orderId);
  return {kind:persisted.holds.length||result.finance==="FAILED"?"PARTIAL":existing?"ALREADY_IMPORTED":"IMPORTED",orderId:result.orderId,...summary,...persisted,finance:result.finance};
 });
}
/** Safe seller feedback only: never serialize transport bodies, tokens or database errors. */
export function syncFailure(error:unknown):string{
 if(error instanceof AccessDenied)return "Only the Store owner can sync orders in this Store.";
 if(error instanceof ReceiptPilotError){
  if(error.httpStatus===429)return `Etsy rate limited this request. Try again${error.retryAfterSeconds?` after ${error.retryAfterSeconds} seconds`:" later"}. No receipt was imported.`;
  if(error.httpStatus===401||error.httpStatus===403)return "Etsy authorization was rejected. Reauthorize Etsy in Settings.";
  return "Etsy could not return a verified receipt. No receipt was imported. Try again later.";
 }
 if(error instanceof Error){
  if(["TimeoutError","AbortError"].includes(error.name))return "The Etsy request timed out. No receipt was imported. Try again.";
  if(["ETSY_REAUTHORIZE","SYNC_CONNECTION_REQUIRED"].includes(error.message))return "Connect or reauthorize Etsy with order access in Settings.";
  if(["LIVE_OAUTH_DISABLED","ETSY_CONFIGURATION_REQUIRED"].includes(error.message))return "Live Etsy receipt reading is not configured for this environment. No receipt was imported.";
  if(error.message==="SYNC_RECEIPT_BOUND")return "This receipt exceeds the limit of 100 readings per sync. No receipt was imported. It requires a separately supported intake operation.";
  if(error.message==="CONNECTION_CHANGED")return "The Etsy connection changed. Refresh Orders and try again.";
  if(["SHOP_OWNER_MISMATCH","SOURCE_SELECTION_MISMATCH"].includes(error.message))return "Receipt ownership or identity could not be verified. No receipt was imported.";
 }
 return "Order sync did not complete normally. Check Orders and the receipt identifier before retrying; replay does not duplicate readings.";
}
