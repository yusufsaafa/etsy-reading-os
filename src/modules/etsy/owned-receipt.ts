import {and,eq} from "drizzle-orm";
import type {Database} from "../../db/client";
import {connections,stores} from "../../db/schema";
import {verifyScope,tenantWhere} from "../intake/service";
import type {Scope} from "../intake/contracts";
import {vault} from "../../infrastructure/secrets";
import {liveOAuthConfig,refreshConnection} from "./connection-service";
import {tokenSchema} from "./oauth";
import {etsyId} from "./source-contract";
import {parseEtsyJson} from "./raw-normalizer";
import {readReceiptDetail} from "./receipt-read";
import {readReceiptPage} from "./receipt-read";
import {ingestControlledReceipt} from "./controlled-intake";
/** Trusted server read of one explicitly selected receipt; never exposes grant material. */
async function ownedGrant(db:Database,scope:Scope){
 await verifyScope(db,scope,true);
 const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 let [grant]=await db.select().from(connections).where(tenantWhere(connections,scope));
 if(!store?.externalShopId||grant?.status!=="connected"||!grant.encryptedTokens||!grant.scopes.includes("transactions_r"))throw new Error("ETSY_REAUTHORIZE");
 const secrets=vault(),config=liveOAuthConfig();
 if(grant.expiresAt&&grant.expiresAt<=new Date()){await refreshConnection(db,scope,secrets,config);[grant]=await db.select().from(connections).where(tenantWhere(connections,scope));}
 if(grant?.status!=="connected"||!grant.encryptedTokens)throw new Error("ETSY_REAUTHORIZE");
 const tokens=tokenSchema.parse(JSON.parse(secrets.open(grant.encryptedTokens,`${scope.organizationId}:${scope.storeId}:etsy`)));
 return {store,grant,tokens,config};
}
export async function readOwnedReceipt(db:Database,scope:Scope,receiptId:string){
 etsyId.parse(receiptId);
 const {store,grant,tokens,config}=await ownedGrant(db,scope);
 const detail=await readReceiptDetail(store.externalShopId!,receiptId,tokens.access_token,config);
 const decoded=parseEtsyJson(detail.body) as Record<string,unknown>;
 if(decoded.seller_user_id!=null&&String(decoded.seller_user_id)!==tokens.access_token.split(".")[0])throw new Error("SHOP_OWNER_MISMATCH");
 return {...detail,epoch:grant.epoch,shopId:store.externalShopId!};
}
export async function readOwnedReceiptPage(db:Database,scope:Scope,window:Parameters<typeof readReceiptPage>[3]){
 const {store,grant,tokens,config}=await ownedGrant(db,scope);
 return {...await readReceiptPage(store.externalShopId!,tokens.access_token,config,window),epoch:grant.epoch,shopId:store.externalShopId!};
}
/** No route/startup/worker calls this. Live invocation requires separate seller authorization. */
export async function ingestOwnedReceipt(db:Database,scope:Scope,receiptId:string,command:unknown){
 const detail=await readOwnedReceipt(db,scope,receiptId);
 return ingestControlledReceipt(db,scope,detail.body,Math.floor(Date.now()/1000),command,{epoch:detail.epoch,verifiedShopId:detail.shopId});
}

/** Genuinely read-only DB assessment after the authorized GET/necessary grant refresh. */
export async function dryRunOwnedReceipt(db:Database,scope:Scope,receiptId:string){
 const detail=await readOwnedReceipt(db,scope,receiptId);
 return db.transaction(async tx=>{
  const {sql}=await import("drizzle-orm");
  await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
  const [grant]=await tx.select().from(connections).where(tenantWhere(connections,scope));
  if(grant?.status!=="connected"||grant.epoch!==detail.epoch)throw new Error("CONNECTION_CHANGED");
  const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
  if(store?.externalShopId!==detail.shopId)throw new Error("CONNECTION_CHANGED");
  const {assessReceiptForIntake}=await import("./controlled-intake");
  return (await assessReceiptForIntake(tx,scope,detail.body,Math.floor(Date.now()/1000))).report;
 });
}
/** Explicit owner approval of one fetched line. Never called by discovery/dry-run. */
export async function approveOwnedHistoricalLine(db:Database,scope:Scope,receiptId:string,transactionId:string,productVersionId:string,commandId:string){
 etsyId.parse(transactionId);
 const detail=await readOwnedReceipt(db,scope,receiptId);
 const {normalizeEtsyReceipt}=await import("./raw-normalizer");
 const source=normalizeEtsyReceipt(detail.body,{verifiedShopId:detail.shopId,observedAt:Math.floor(Date.now()/1000)}).find(s=>s.transaction.transactionId===transactionId);
 if(!source)throw new Error("SOURCE_SELECTION_MISMATCH");
 const {authorizeHistoricalAdoption}=await import("../products/historical-adoption");
 return authorizeHistoricalAdoption(db,scope,{contractVersion:"etsy-historical-adoption/v2",commandId,productVersionId,source});
}

/** Explicit authenticated owner discovery, maximum three receipts from the last 90 days. */
export async function readOwnedReceiptSample(db:Database,scope:Scope){
 const {store,tokens,config}=await ownedGrant(db,scope);
 const {readReceiptSample}=await import("./receipt-read");
 const sample=await readReceiptSample(store.externalShopId!,tokens.access_token,config,Math.floor(Date.now()/1000)-90*86400);
 for(const detail of sample.details){
  const raw=parseEtsyJson(detail.body) as Record<string,unknown>;
  if(raw.seller_user_id!=null&&String(raw.seller_user_id)!==tokens.access_token.split(".")[0])throw new Error("SHOP_OWNER_MISMATCH");
 }
 return sample;
}
