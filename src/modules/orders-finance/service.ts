import {createHash} from "node:crypto";
import {and,eq,asc,gt} from "drizzle-orm";
import {z} from "zod";
import type {Database,DbExecutor} from "../../db/client";
import {orders,orderFinances,stores,connections} from "../../db/schema";
import {tenantWhere,verifyScope} from "../intake/service";
import {AccessDenied} from "../identity/service";
import {stableJson,type Scope} from "../intake/contracts";
import {readOwnedReceipt} from "../etsy/owned-receipt";
import {ReceiptPilotError} from "../etsy/receipt-read";
import {receiptFinance} from "./source";
import {receiptMoneySchema,type OrderFinanceView} from "./money";
export type FinanceResult={state:"VERIFIED"|"MISSING"|"INVALID"|"UNCERTAIN";result:"UPDATED"|"UNCHANGED"|"STALE"|"RETAINED_ORIGINAL"};
/** Trusted receipt transport/controlled-intake boundary. Writes only order_finances. */
export async function captureReceiptFinanceInTransaction(tx:DbExecutor,scope:Scope,orderId:string,body:string,shopId:string,epoch?:number):Promise<FinanceResult>{
 await verifyScope(tx,scope,true);
 const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
 if(store?.source!=="etsy"||store.externalShopId!==shopId)throw new AccessDenied();
 if(epoch!==undefined){const [grant]=await tx.select({epoch:connections.epoch,status:connections.status}).from(connections).where(tenantWhere(connections,scope)).for("update");if(grant?.epoch!==epoch||grant.status!=="connected")throw new Error("CONNECTION_CHANGED");}
 const [order]=await tx.select({externalId:orders.externalId}).from(orders).where(and(tenantWhere(orders,scope),eq(orders.id,z.uuid().parse(orderId))));
 if(!order)throw new AccessDenied();
 const evidence=receiptFinance(body,shopId,order.externalId),where=and(tenantWhere(orderFinances,scope),eq(orderFinances.orderId,orderId));
 const [prior]=await tx.select().from(orderFinances).where(where);
 if(prior&&prior.shopId!==shopId)throw new AccessDenied();
 const now=new Date();
 // Missing refund timestamps cannot license a later replacement of proven pre-refund money.
 const currentRefund=evidence.refundPresent&&(evidence.sourceUpdatedAt===null||prior?.sourceUpdatedAt==null||evidence.sourceUpdatedAt>=prior.sourceUpdatedAt);
 if(prior?.state==="VERIFIED"&&(currentRefund||prior.refundObservedAt!==null)){
  const sourceUpdatedAt=Math.max(prior.sourceUpdatedAt!,evidence.sourceUpdatedAt??prior.sourceUpdatedAt!);
  await tx.update(orderFinances).set({sourceUpdatedAt,refundObservedAt:prior.refundObservedAt??now,checkedAt:now}).where(where);
  return {state:"VERIFIED",result:"RETAINED_ORIGINAL"};
 }
 if(prior?.sourceUpdatedAt!=null&&(evidence.sourceUpdatedAt===null||evidence.sourceUpdatedAt<prior.sourceUpdatedAt))return {state:prior.state as FinanceResult["state"],result:"STALE"};
 const hash=createHash("sha256").update(stableJson(evidence)).digest("hex");
 if(prior?.sourceHash===hash){await tx.update(orderFinances).set({checkedAt:now}).where(where);return {state:prior.state as FinanceResult["state"],result:"UNCHANGED"};}
 // Conflicting totals for the same source version cannot be ordered safely.
 const conflict=prior?.sourceUpdatedAt!=null&&prior.sourceUpdatedAt===evidence.sourceUpdatedAt&&["VERIFIED","UNCERTAIN"].includes(prior.state);
 const state=conflict||prior?.refundObservedAt?"UNCERTAIN":evidence.state,total=state==="VERIFIED"?evidence.total:undefined;
 const values={state,amount:total?BigInt(total.amount):null,divisor:total?BigInt(total.divisor):null,currency:total?.currency??null,sourceUpdatedAt:evidence.sourceUpdatedAt,totalSourceUpdatedAt:total?evidence.sourceUpdatedAt:null,totalVerifiedAt:total?now:null,refundObservedAt:prior?.refundObservedAt??(evidence.refundPresent?now:null),sourceHash:hash,checkedAt:now};
 if(prior)await tx.update(orderFinances).set(values).where(where);
 else await tx.insert(orderFinances).values({organizationId:scope.organizationId,storeId:scope.storeId,orderId,receiptId:order.externalId,shopId,...values});
 return {state,result:"UPDATED"};
}
/** No raw payload, credentials, provenance or BigInt values cross the UI boundary. */
export async function orderFinanceView(db:DbExecutor,scope:Scope,orderId:string):Promise<OrderFinanceView>{
 await verifyScope(db,scope);
 const [order]=await db.select({id:orders.id}).from(orders).where(and(tenantWhere(orders,scope),eq(orders.id,z.uuid().parse(orderId))));if(!order)throw new AccessDenied();
 let row:Pick<typeof orderFinances.$inferSelect,"state"|"amount"|"divisor"|"currency">|undefined;
 try{[row]=await db.select({state:orderFinances.state,amount:orderFinances.amount,divisor:orderFinances.divisor,currency:orderFinances.currency}).from(orderFinances).innerJoin(stores,and(eq(stores.id,orderFinances.storeId),eq(stores.organizationId,orderFinances.organizationId),eq(stores.externalShopId,orderFinances.shopId),eq(stores.source,"etsy"))).where(and(tenantWhere(orderFinances,scope),eq(orderFinances.orderId,orderId))).limit(1);}
 catch{return {state:"UNAVAILABLE"};} // Optional finance failure must not break authorized ordinary order operations.
 if(row?.state!=="VERIFIED"||row.amount===null||row.divisor===null||!row.currency)return {state:"UNAVAILABLE"};
 const parsed=receiptMoneySchema.safeParse({amount:row.amount.toString(),divisor:row.divisor.toString(),currency_code:row.currency});
 return parsed.success?{state:"VERIFIED",total:{amount:parsed.data.amount,divisor:parsed.data.divisor,currency:parsed.data.currency_code}}:{state:"UNAVAILABLE"};
}
export type FinanceRefreshResult={status:"OK";finance:FinanceResult}|{status:"RATE_LIMIT"|"AUTHORIZATION"|"MISSING_RECEIPT"|"TEMPORARY_FAILURE"|"INVALID_SOURCE";retryAfterSeconds?:number};
/** One explicit order, one bounded GET; no operational intake, retry loop or production dispatch. */
export async function refreshOrderFinance(db:Database,scope:Scope,orderId:string,reader:typeof readOwnedReceipt=readOwnedReceipt):Promise<FinanceRefreshResult>{
 await verifyScope(db,scope,true);
 const [order]=await db.select({externalId:orders.externalId}).from(orders).where(and(tenantWhere(orders,scope),eq(orders.id,z.uuid().parse(orderId))));if(!order)throw new AccessDenied();
 try{
  const detail=await reader(db,scope,order.externalId);
  const finance=await db.transaction(tx=>captureReceiptFinanceInTransaction(tx,scope,orderId,detail.body,detail.shopId,detail.epoch));
  return {status:"OK",finance};
 }catch(error){
  if(error instanceof AccessDenied)throw error;
  if(error instanceof ReceiptPilotError){
   if(["receipt_linkage","response_bound"].includes(error.stage))return {status:"INVALID_SOURCE"};
   if(error.httpStatus===429)return {status:"RATE_LIMIT",retryAfterSeconds:error.retryAfterSeconds??60};
   if(error.httpStatus===401||error.httpStatus===403)return {status:"AUTHORIZATION"};
   if(error.httpStatus===404)return {status:"MISSING_RECEIPT"};
   return {status:"TEMPORARY_FAILURE"};
  }
  if(error instanceof Error&&["ETSY_REAUTHORIZE","CONNECTION_CHANGED","SHOP_OWNER_MISMATCH"].includes(error.message))return {status:"AUTHORIZATION"};
  if(error instanceof z.ZodError||error instanceof Error&&["FINANCE_RECEIPT_MISMATCH","INVALID_ETSY_JSON","ETSY_RESPONSE_LIMIT"].includes(error.message))return {status:"INVALID_SOURCE"};
  return {status:"TEMPORARY_FAILURE"}; // Bounded result; never leak SQL, stack or grant material.
 }
}
const backfillOptions=z.object({limit:z.number().int().min(1).max(20).default(10),after:z.uuid().optional()}).strict();
/** Keyset page of owned existing orders. Returned cursor is advanced only past terminal outcomes. */
export async function backfillOrderFinance(db:Database,scope:Scope,rawOptions:unknown,refresh:typeof refreshOrderFinance=refreshOrderFinance){
 await verifyScope(db,scope,true);const options=backfillOptions.parse(rawOptions);
 const [store]=await db.select({source:stores.source}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));if(store?.source!=="etsy")throw new AccessDenied();
 if(options.after){const [cursor]=await db.select({id:orders.id}).from(orders).where(and(tenantWhere(orders,scope),eq(orders.id,options.after)));if(!cursor)throw new AccessDenied();}
 const page=await db.select({id:orders.id}).from(orders).where(and(tenantWhere(orders,scope),options.after?gt(orders.id,options.after):undefined)).orderBy(asc(orders.id)).limit(options.limit+1);
 const results:{orderId:string;result:FinanceRefreshResult}[]= [];let next=options.after;
 for(const order of page.slice(0,options.limit)){
  let result:FinanceRefreshResult;try{result=await refresh(db,scope,order.id);}catch(error){if(error instanceof AccessDenied)throw error;result={status:"TEMPORARY_FAILURE"};}results.push({orderId:order.id,result});
  if(["RATE_LIMIT","AUTHORIZATION","TEMPORARY_FAILURE"].includes(result.status))return {results,next:next??null,done:false,stopped:result.status,retryAfterSeconds:result.status==="RATE_LIMIT"?result.retryAfterSeconds:undefined};
  next=order.id;
 }
 return {results,next:next??null,done:page.length<=options.limit,stopped:null};
}
