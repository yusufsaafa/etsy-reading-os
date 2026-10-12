import {and,eq,lte,sql} from "drizzle-orm";
import {z} from "zod";
import type {Database} from "../../../src/db/client";
import {stores,connections,automaticIntake,webhookEvents} from "../../../src/db/schema";
import {verifyScope,tenantWhere} from "../../../src/modules/intake/service";
import {runWebhookIntakeTick,type WebhookEventSelector} from "../../../src/modules/etsy/webhook-intake";
import {readOwnedReceipt} from "../../../src/modules/etsy/owned-receipt";
import {liveOAuthConfig} from "../../../src/modules/etsy/connection-service";
import {vault} from "../../../src/infrastructure/secrets";
import {tokenSchema} from "../../../src/modules/etsy/oauth";

export function requireLiveEvent(event:{id:string;eventId:string;organizationId:string|null;storeId:string|null;shopId:string;epoch:number|null;eventType:string;status:string;attempts:number;nextAt:Date;leaseUntil:Date|null},expected:WebhookEventSelector,now:Date){
 if(event.id!==expected.id||event.eventId!==expected.eventId||event.organizationId!==expected.organizationId||event.storeId!==expected.storeId||event.shopId!==expected.shopId||event.epoch!==expected.epoch||event.eventType!=="order.paid")throw new Error("LIVE_EVENT_BINDING_MISMATCH");
 if(event.attempts>=5||event.nextAt>now||!(event.status==="PENDING"||(event.status==="PROCESSING"&&event.leaseUntil!==null&&event.leaseUntil<now)))throw new Error("LIVE_EVENT_NOT_ELIGIBLE");
}
/** Runtime-only outbound guard: one exact receipt GET, no refresh/AI/delivery. */
export function restrictLiveReceiptNetwork(shopId:string,receiptId:string){
 const original=globalThis.fetch,allowed=`https://api.etsy.com/v3/application/shops/${shopId}/receipts/${receiptId}`;
 globalThis.fetch=async(input,init)=>{
  const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  const method=init?.method??(input instanceof Request?input.method:"GET");
  if(url!==allowed||method!=="GET"||init?.redirect!=="error")throw new Error("ACCEPTANCE_NETWORK_DISPATCH_FORBIDDEN");
  return original(input,init);
 };
 return ()=>{globalThis.fetch=original;};
}
export async function liveContext(db:Database,storeId:string,shopId:string,epoch:number,receiptAccess=false){
 if(!z.uuid().safeParse(storeId).success||!/^([1-9][0-9]{0,19})$/.test(shopId)||!Number.isSafeInteger(epoch)||epoch<0)throw new Error("LIVE_CONTEXT_INVALID");
 const [store]=await db.select().from(stores).where(eq(stores.id,storeId));
 if(store?.source!=="etsy"||store.externalShopId!==shopId)throw new Error("LIVE_STORE_SHOP_MISMATCH");
 const base={organizationId:store.organizationId,storeId};
 const [grant]=await db.select().from(connections).where(tenantWhere(connections,base));
 if(grant?.status!=="connected"||grant.epoch!==epoch||!grant.encryptedTokens||!grant.scopes.includes("transactions_r"))throw new Error("LIVE_CONNECTION_EPOCH_MISMATCH");
 if(receiptAccess&&(!grant.expiresAt||grant.expiresAt<=new Date(Date.now()+60000)||grant.refreshClaim))throw new Error("LIVE_TOKEN_REFRESH_REQUIRED");
 const [state]=await db.select().from(automaticIntake).where(and(tenantWhere(automaticIntake,base),eq(automaticIntake.epoch,epoch)));
 if(!state)throw new Error("OAUTH_INITIALIZATION_REQUIRED");
 const scope={...base,userId:state.actorId};await verifyScope(db,scope,true);
 if(receiptAccess){liveOAuthConfig();tokenSchema.parse(JSON.parse(vault().open(grant.encryptedTokens,`${scope.organizationId}:${scope.storeId}:etsy`)));}
 return scope;
}
export async function inspectLive(db:Database,storeId:string,shopId:string,epoch:number){
 const scope=await liveContext(db,storeId,shopId,epoch),now=new Date();
 const events=await db.select({id:webhookEvents.id,eventId:webhookEvents.eventId,receiptId:webhookEvents.receiptId,shopId:webhookEvents.shopId,epoch:webhookEvents.epoch,status:webhookEvents.status,attempts:webhookEvents.attempts,nextAt:webhookEvents.nextAt,receivedAt:webhookEvents.receivedAt,errorCode:webhookEvents.errorCode,result:webhookEvents.result}).from(webhookEvents).where(and(tenantWhere(webhookEvents,scope),eq(webhookEvents.shopId,shopId),eq(webhookEvents.epoch,epoch),eq(webhookEvents.eventType,"order.paid"),lte(webhookEvents.nextAt,now),sql`${webhookEvents.attempts}<5`,sql`(${webhookEvents.status}='PENDING' or (${webhookEvents.status}='PROCESSING' and ${webhookEvents.leaseUntil}<${now.toISOString()}))`)).limit(100);
 return {status:"PASS",mode:"READ_ONLY",storeId,shopId,epoch,events};
}
export async function processLive(db:Database,storeId:string,shopId:string,epoch:number,id:string){
 if(!z.uuid().safeParse(id).success)throw new Error("LIVE_EVENT_ID_INVALID");
 const scope=await liveContext(db,storeId,shopId,epoch,true);
 // Preserve production lock ordering: Store before inbox lease.
 await db.select().from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,storeId))).for("update");
 await liveContext(db,storeId,shopId,epoch,true);
 const [event]=await db.select().from(webhookEvents).where(eq(webhookEvents.id,id)).for("update");
 if(!event)throw new Error("LIVE_EVENT_NOT_FOUND");
 const selector={id,eventId:event.eventId,...scope,shopId,epoch};requireLiveEvent(event,selector,new Date());
 const restore=restrictLiveReceiptNetwork(shopId,event.receiptId);
 try{await runWebhookIntakeTick(db,{selector,receipt:readOwnedReceipt});}finally{restore();}
 const [settled]=await db.select({status:webhookEvents.status,attempts:webhookEvents.attempts,result:webhookEvents.result,errorCode:webhookEvents.errorCode}).from(webhookEvents).where(eq(webhookEvents.id,id));
 return {execution:"PROCESSED",storeId,shopId,epoch,inboxId:id,messageId:event.eventId,receiptId:event.receiptId,...settled};
}
