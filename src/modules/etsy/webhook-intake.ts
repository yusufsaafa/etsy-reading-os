import {and,eq,lte,desc,asc,sql} from "drizzle-orm";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {Database,DbExecutor} from "../../db/client";
import {webhookEvents,automaticIntake,connections,stores,auditLogs} from "../../db/schema";
import type {Scope} from "../intake/contracts";
import {verifyScope,tenantWhere} from "../intake/service";
import {assertInternalOperator} from "../identity/internal-access";
import {AccessDenied} from "../identity/service";
import {syncOrderReceipt} from "../orders/sync";
import {readOwnedReceipt} from "./owned-receipt";
import {ReceiptPilotError} from "./receipt-read";
import {parseEtsyJson} from "./raw-normalizer";
import {assertVerifiedWebhook,type VerifiedWebhook} from "./webhook-receiver";
import {webhookSecretConfigured} from "./webhook-digest";

const leaseMs=180000;
type Event=typeof webhookEvents.$inferSelect;

/** Store first, then event. Never use an event's tenant identifiers as authority. */
async function eventConnection(tx:DbExecutor,event:Event) {
  if(!event.organizationId||!event.storeId||event.epoch===null)throw new Error("UNKNOWN_SHOP");
  const [state]=await tx.select().from(automaticIntake).where(and(eq(automaticIntake.organizationId,event.organizationId),eq(automaticIntake.storeId,event.storeId),eq(automaticIntake.epoch,event.epoch)));
  if(!state)throw new Error("CONNECTION_CHANGED");
  const scope:Scope={organizationId:state.organizationId,storeId:state.storeId,userId:state.actorId};
  await verifyScope(tx,scope,true);
  const [store]=await tx.select().from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
  await verifyScope(tx,scope,true);
  const [grant]=await tx.select().from(connections).where(tenantWhere(connections,scope));
  if(store?.source!=="etsy"||store.externalShopId!==event.shopId||grant?.status!=="connected"||!grant.encryptedTokens||!grant.scopes.includes("transactions_r")||grant.epoch!==event.epoch)throw new Error("CONNECTION_CHANGED");
  return {scope,state};
}

/** Authenticated notification, not intake authorization. Capture epoch at first
 * durable acceptance so queued notifications never acquire a later grant.
 */
export async function acceptVerifiedWebhook(db:Database,event:VerifiedWebhook) {
  assertVerifiedWebhook(event);
  return db.transaction(async tx=>{
    const matches=await tx.select().from(stores).where(and(eq(stores.source,"etsy"),eq(stores.externalShopId,event.shopId))).limit(2);
    let binding:{organizationId:string;storeId:string;epoch:number}|undefined;
    let errorCode=matches.length===0?"UNKNOWN_SHOP":matches.length>1?"AMBIGUOUS_SHOP":undefined;
    if(matches.length===1){
      const candidate=matches[0];
      const [store]=await tx.select().from(stores).where(and(eq(stores.organizationId,candidate.organizationId),eq(stores.id,candidate.id))).for("update");
      const [grant]=await tx.select().from(connections).where(and(eq(connections.organizationId,candidate.organizationId),eq(connections.storeId,candidate.id)));
      if(store?.source!=="etsy"||store.externalShopId!==event.shopId||grant?.status!=="connected"||!grant.encryptedTokens)errorCode="AUTHORIZATION_REQUIRED";
      else if(!grant.scopes.includes("transactions_r"))errorCode="SCOPE_REQUIRED";
      else {
        const [state]=await tx.select().from(automaticIntake).where(and(eq(automaticIntake.organizationId,candidate.organizationId),eq(automaticIntake.storeId,candidate.id),eq(automaticIntake.epoch,grant.epoch)));
        if(!state)errorCode="CONNECTION_INITIALIZATION_REQUIRED";
        else {
          binding={organizationId:candidate.organizationId,storeId:candidate.id,epoch:grant.epoch};
          // Persist a safe quarantine if the OAuth actor has lost owner permission.
          try{await verifyScope(tx,{...binding,userId:state.actorId},true);}catch{errorCode="AUTHORIZATION_REQUIRED";}
        }
      }
    }
    const ignored=event.eventType!=="order.paid";
    const [inserted]=await tx.insert(webhookEvents).values({...event,...binding,
      status:ignored?"SUCCEEDED":errorCode?"ATTENTION":"PENDING",errorCode:ignored?null:errorCode,
      result:ignored?"IGNORED_EVENT":null,settledAt:ignored?new Date():null,
    }).onConflictDoNothing({target:webhookEvents.eventId}).returning({id:webhookEvents.id});
    if(inserted)return {id:inserted.id,duplicate:false};
    const [previous]=await tx.select().from(webhookEvents).where(eq(webhookEvents.eventId,event.eventId));
    // Retry timestamps may differ; authenticated body evidence must not.
    if(!previous||previous.bodyHash!==event.bodyHash||previous.eventType!==event.eventType||previous.shopId!==event.shopId||previous.receiptId!==event.receiptId)throw new Error("WEBHOOK_ID_CONFLICT");
    return {id:previous.id,duplicate:true};
  });
}

function failure(error:unknown,attempts:number,now:Date) {
  const auth=error instanceof AccessDenied||(error instanceof ReceiptPilotError&&(error.httpStatus===401||error.httpStatus===403));
  const permanent=auth||error instanceof z.ZodError||(error instanceof ReceiptPilotError&&error.httpStatus!==undefined&&error.httpStatus>=400&&error.httpStatus<500&&error.httpStatus!==429)||(error instanceof Error&&["UNKNOWN_SHOP","CONNECTION_CHANGED","SHOP_OWNER_MISMATCH","SOURCE_SELECTION_MISMATCH","ETSY_REAUTHORIZE","SYNC_CONNECTION_REQUIRED","SYNC_RECEIPT_BOUND","WEBHOOK_HISTORICAL_CUTOFF"].includes(error.message));
  const code=auth?"AUTHORIZATION_REQUIRED":error instanceof Error&&error.message==="WEBHOOK_HISTORICAL_CUTOFF"?"HISTORICAL_APPROVAL_REQUIRED":permanent?"CONNECTION_OR_SOURCE_REQUIRED":error instanceof ReceiptPilotError&&error.httpStatus===429?"RATE_LIMITED":attempts>=5?"RETRY_LIMIT":"RETRY_PENDING";
  const seconds=Math.max(Math.min(86400,30*2**attempts),error instanceof ReceiptPilotError?error.retryAfterSeconds??0:0);
  return {status:permanent||attempts>=5?"ATTENTION":"PENDING",errorCode:code,nextAt:new Date(now.getTime()+seconds*1000)};
}

export type WebhookEventSelector={id:string;eventId:string;organizationId:string;storeId:string;shopId:string;epoch:number};
/** Internal selection only; all identity fences are included in the candidate query. */
export function webhookEventSelection(selector:WebhookEventSelector){
 if(!z.uuid().safeParse(selector.id).success||!z.uuid().safeParse(selector.organizationId).success||!z.uuid().safeParse(selector.storeId).success||!/^[A-Za-z0-9_-]{1,256}$/.test(selector.eventId)||!/^([1-9][0-9]{0,19})$/.test(selector.shopId)||!Number.isSafeInteger(selector.epoch)||selector.epoch<0)throw new Error("INVALID_ACCEPTANCE_SELECTOR");
 return and(eq(webhookEvents.id,selector.id),eq(webhookEvents.eventId,selector.eventId),eq(webhookEvents.organizationId,selector.organizationId),eq(webhookEvents.storeId,selector.storeId),eq(webhookEvents.shopId,selector.shopId),eq(webhookEvents.epoch,selector.epoch),eq(webhookEvents.eventType,"order.paid"));
}
/** Trusted worker: at most one event/tick. No polling, generation or document work. */
export async function runWebhookIntakeTick(db:Database,ports:{receipt?:typeof readOwnedReceipt;now?:Date;selector?:WebhookEventSelector}={}) {
  const now=ports.now??new Date(),reader=ports.receipt??readOwnedReceipt;
  // Raw SQL parameters do not use the column encoder; postgres-js needs an ISO string here.
  const [candidate]=await db.select().from(webhookEvents).where(and(...(ports.selector?[webhookEventSelection(ports.selector)]:[]),lte(webhookEvents.nextAt,now),sql`(${webhookEvents.status}='PENDING' or (${webhookEvents.status}='PROCESSING' and ${webhookEvents.leaseUntil}<${now.toISOString()}))`)).orderBy(asc(webhookEvents.nextAt),asc(webhookEvents.id)).limit(1);
  if(!candidate)return;
  const claim=randomUUID();let item:Event|undefined;
  let access:Awaited<ReturnType<typeof eventConnection>>|undefined;
  try {
    await db.transaction(async tx=>{
      access=await eventConnection(tx,candidate);
      const [current]=await tx.select().from(webhookEvents).where(eq(webhookEvents.id,candidate.id)).for("update");
      if(!current||current.eventType!=="order.paid"||current.nextAt>now||!["PENDING","PROCESSING"].includes(current.status)||(current.status==="PROCESSING"&&current.leaseUntil!>=now))return;
      if(current.attempts>=5){await tx.update(webhookEvents).set({status:"ATTENTION",claim:null,leaseUntil:null,errorCode:"RETRY_LIMIT"}).where(eq(webhookEvents.id,current.id));return;}
      [item]=await tx.update(webhookEvents).set({status:"PROCESSING",claim,leaseUntil:new Date(now.getTime()+leaseMs),attempts:current.attempts+1}).where(eq(webhookEvents.id,current.id)).returning();
    });
    if(!item||!access)return;
    const event=item,scope=access.scope,cutoff=access.state.cutoff;
    const result=await syncOrderReceipt(db,scope,{receiptId:event.receiptId,commandId:event.id},async(...args)=>{
      const detail=await reader(...args);
      if(detail.epoch!==event.epoch||detail.shopId!==event.shopId)throw new Error("CONNECTION_CHANGED");
      const raw=parseEtsyJson(detail.body) as Record<string,unknown>,created=raw.created_timestamp??raw.create_timestamp;
      if(String(raw.receipt_id)!==event.receiptId||(raw.shop_id!=null&&String(raw.shop_id)!==event.shopId))throw new Error("SOURCE_SELECTION_MISMATCH");
      if(typeof created!=="number"||!Number.isSafeInteger(created)||created<cutoff)throw new Error("WEBHOOK_HISTORICAL_CUTOFF");
      return detail;
    },async tx=>{
      // syncOrderReceipt owns the Store lock before this event lease lock.
      await eventConnection(tx,event);
      const [current]=await tx.select().from(webhookEvents).where(and(tenantWhere(webhookEvents,scope),eq(webhookEvents.id,event.id))).for("update");
      if(current?.claim!==claim||current.status!=="PROCESSING"||current.leaseUntil!<=new Date())throw new Error("CONNECTION_CHANGED");
    });
    const attention=!["IMPORTED","ALREADY_IMPORTED"].includes(result.kind);
    await db.update(webhookEvents).set({status:attention?"ATTENTION":"SUCCEEDED",claim:null,leaseUntil:null,result:result.kind,errorCode:attention?result.kind:null,settledAt:new Date()}).where(and(tenantWhere(webhookEvents,scope),eq(webhookEvents.id,event.id),eq(webhookEvents.claim,claim)));
  } catch(error) {
    if(item){await db.update(webhookEvents).set({...failure(error,item.attempts,now),claim:null,leaseUntil:null}).where(and(eq(webhookEvents.id,item.id),eq(webhookEvents.claim,claim)));}
    else {
      // Metadata-only quarantine of a pending/expired obligation. No order mutation.
      await db.transaction(async tx=>{
        if(candidate.storeId)await tx.select().from(stores).where(and(eq(stores.id,candidate.storeId),eq(stores.organizationId,candidate.organizationId!))).for("update");
        await tx.update(webhookEvents).set({status:"ATTENTION",claim:null,leaseUntil:null,errorCode:"AUTHORIZATION_REQUIRED"}).where(and(eq(webhookEvents.id,candidate.id),sql`(${webhookEvents.status}='PENDING' or (${webhookEvents.status}='PROCESSING' and ${webhookEvents.leaseUntil}<${now.toISOString()}))`));
      });
    }
  }
}

export async function webhookDiagnostics(db:DbExecutor,scope:Scope) {
  assertInternalOperator(scope.userId);await verifyScope(db,scope,true);
  return db.select({id:webhookEvents.id,eventId:webhookEvents.eventId,eventType:webhookEvents.eventType,receivedAt:webhookEvents.receivedAt,
    status:webhookEvents.status,attempts:webhookEvents.attempts,errorCode:webhookEvents.errorCode,result:webhookEvents.result,claim:webhookEvents.claim})
    .from(webhookEvents).where(tenantWhere(webhookEvents,scope)).orderBy(desc(webhookEvents.receivedAt)).limit(20);
}
export async function retryWebhookEvent(db:Database,scope:Scope,raw:unknown) {
  assertInternalOperator(scope.userId);
  const command=z.object({id:z.uuid(),commandId:z.uuid()}).strict().parse(raw);
  await db.transaction(async tx=>{
    await verifyScope(tx,scope,true);
    const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
    if(!store)throw new Error("RETRY_UNAVAILABLE");
    const [previous]=await tx.select().from(auditLogs).where(and(tenantWhere(auditLogs,scope),eq(auditLogs.action,`webhook_retry:${command.commandId}`)));
    if(previous){if(previous.resourceId!==command.id)throw new Error("RETRY_COMMAND_CONFLICT");return;}
    const [event]=await tx.select().from(webhookEvents).where(and(tenantWhere(webhookEvents,scope),eq(webhookEvents.id,command.id))).for("update");
    if(!event||event.status!=="ATTENTION"||event.claim||event.eventType!=="order.paid")throw new Error("RETRY_UNAVAILABLE");
    if(event.errorCode==="RATE_LIMITED"&&event.nextAt>new Date())throw new Error("RETRY_UNAVAILABLE");
    await eventConnection(tx,event); // The Store lock is already held; no reverse ordering.
    await tx.update(webhookEvents).set({status:"PENDING",attempts:0,errorCode:null,nextAt:new Date(),settledAt:null}).where(eq(webhookEvents.id,event.id));
    await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action:`webhook_retry:${command.commandId}`,resourceId:event.id});
  });
}

export async function webhookIntakeStatus(db:DbExecutor,scope:Scope) {
  await verifyScope(db,scope);
  const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
  const [grant]=await db.select().from(connections).where(tenantWhere(connections,scope));
  if(store?.source!=="etsy"||!store.externalShopId||grant?.status!=="connected"||!grant.encryptedTokens)return "Etsy is disconnected or needs reauthorization. Webhook intake is unavailable.";
  if(!grant.scopes.includes("transactions_r"))return "Etsy order access is missing. Reauthorize Etsy in Settings.";
  if(!webhookSecretConfigured(process.env.ETSY_WEBHOOK_SIGNING_SECRET))return "Etsy connected. Webhook receiver is not configured; contact the application operator.";
  const [event]=await db.select({status:webhookEvents.status,result:webhookEvents.result}).from(webhookEvents).where(and(tenantWhere(webhookEvents,scope),eq(webhookEvents.epoch,grant.epoch),eq(webhookEvents.eventType,"order.paid"))).orderBy(desc(webhookEvents.receivedAt)).limit(1);
  const activity=!event?"No order webhook has been recorded.":event.status==="PROCESSING"?"An order webhook is processing.":event.status==="PENDING"?"An order webhook was received; processing or a bounded retry is pending.":event.status==="ATTENTION"?"An order webhook requires operator attention.":event.result==="ALREADY_IMPORTED"?"The latest order webhook refers to an already imported order.":"The latest order webhook intake succeeded.";
  return `Webhook receiver configured. Etsy Portal interoperability and connected-shop coverage are not yet verified. ${activity}`;
}
