import {and,eq,lte,asc,sql} from "drizzle-orm";
import {randomUUID} from "node:crypto";
import type {Database,DbExecutor} from "../../db/client";
import {automaticIntake,automaticReceipts,connections,stores} from "../../db/schema";
import type {Scope} from "../intake/contracts";
import {tenantWhere,verifyScope} from "../intake/service";
import {syncOrderReceipt} from "../orders/sync";
import {readOwnedReceipt,readOwnedReceiptPage} from "./owned-receipt";
import {ReceiptPilotError} from "./receipt-read";
import {parseEtsyJson} from "./raw-normalizer";
import {assertInternalOperator} from "../identity/internal-access";
import {auditLogs} from "../../db/schema";
import {z} from "zod";

const leaseMs=180000;
export function automaticIntakeConfigured(env:Readonly<Record<string,string|undefined>>=process.env){return env.ETSY_AUTOMATIC_INTAKE_ENABLED==="true"&&env.ETSY_ADAPTER==="etsy"&&env.ETSY_LIVE_OAUTH_ENABLED==="true";}
async function ownedConnection(tx:DbExecutor,scope:Scope,epoch:number){
 await verifyScope(tx,scope,true);
 const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
 await verifyScope(tx,scope,true);
 const [grant]=await tx.select().from(connections).where(tenantWhere(connections,scope));
 if(store?.source!=="etsy"||!store.externalShopId||grant?.status!=="connected"||grant.epoch!==epoch||!grant.encryptedTokens||!grant.scopes.includes("transactions_r"))throw new Error("CONNECTION_CHANGED");
 return store;
}
function failure(error:unknown,attempts:number,now:Date){
 const auth=error instanceof ReceiptPilotError&&(error.httpStatus===401||error.httpStatus===403);
 const terminal=attempts>=5||auth||(error instanceof Error&&["CONNECTION_CHANGED","SHOP_OWNER_MISMATCH","ETSY_REAUTHORIZE","AUTO_CUTOFF","SYNC_RECEIPT_BOUND"].includes(error.message));
 const code=auth?"AUTHORIZATION_REQUIRED":error instanceof Error&&error.message==="AUTO_CUTOFF"?"HISTORICAL_APPROVAL_REQUIRED":error instanceof ReceiptPilotError&&error.httpStatus===429?"RATE_LIMITED":terminal?"ATTENTION_REQUIRED":"RETRY_PENDING";
 const seconds=Math.min(86400,Math.max(30*2**attempts,error instanceof ReceiptPilotError?error.retryAfterSeconds??0:0));
 return {terminal,code,nextAt:new Date(now.getTime()+seconds*1000)};
}
/** Trusted worker only. One discovery page and one receipt per tick; never invokes production. */
export async function runAutomaticIntakeTick(db:Database,ports:{page?:typeof readOwnedReceiptPage;receipt?:typeof readOwnedReceipt;now?:Date}={}){
 const now=ports.now??new Date(),page=ports.page??readOwnedReceiptPage,reader=ports.receipt??readOwnedReceipt;
 // Internal scan uses persisted OAuth actor and epoch; no browser-supplied tenant identity.
 const [candidate]=await db.select({state:automaticIntake}).from(automaticIntake).innerJoin(connections,and(eq(connections.organizationId,automaticIntake.organizationId),eq(connections.storeId,automaticIntake.storeId),eq(connections.epoch,automaticIntake.epoch),eq(connections.status,"connected"))).where(and(lte(automaticIntake.nextAt,now),sql`${automaticIntake.attempts}<5 and (${automaticIntake.claim} is null or ${automaticIntake.leaseUntil}<${now})`)).orderBy(asc(automaticIntake.nextAt),asc(automaticIntake.id)).limit(1);
 if(candidate){
  const scope={organizationId:candidate.state.organizationId,storeId:candidate.state.storeId,userId:candidate.state.actorId},claim=randomUUID();
  let state:typeof automaticIntake.$inferSelect|undefined;
  try{
   state=await db.transaction(async tx=>{
    await ownedConnection(tx,scope,candidate.state.epoch);
    const [s]=await tx.select().from(automaticIntake).where(and(tenantWhere(automaticIntake,scope),eq(automaticIntake.id,candidate.state.id))).for("update");
    if(!s||s.attempts>=5||s.nextAt>now||(s.claim&&s.leaseUntil!>=now))return undefined;
    const end=s.windowEnd??Math.floor(now.getTime()/1000)-30;if(end<s.cursor)return undefined;
    const [updated]=await tx.update(automaticIntake).set({claim,leaseUntil:new Date(now.getTime()+leaseMs),windowEnd:end,attempts:s.attempts+1}).where(eq(automaticIntake.id,s.id)).returning();return updated;
   });
   if(state){
    const response=await page(db,scope,{cutoff:state.cutoff,from:Math.max(state.cutoff,state.cursor-300),through:state.windowEnd!,offset:state.offset});
    await db.transaction(async tx=>{
     const store=await ownedConnection(tx,scope,state!.epoch);
     const [current]=await tx.select().from(automaticIntake).where(and(tenantWhere(automaticIntake,scope),eq(automaticIntake.id,state!.id))).for("update");
     if(current?.claim!==claim||current.leaseUntil!<=new Date()||response.epoch!==state!.epoch||response.shopId!==store.externalShopId)throw new Error("CONNECTION_CHANGED");
     if(response.receipts.length>10||new Set(response.receipts.map(r=>r.receiptId)).size!==response.receipts.length)throw new Error("INVALID_DISCOVERY");
     for(const receipt of response.receipts)await tx.insert(automaticReceipts).values({organizationId:scope.organizationId,storeId:scope.storeId,epoch:state!.epoch,receiptId:receipt.receiptId,sourceModified:receipt.modified}).onConflictDoNothing();
     const offset=state!.offset+response.receipts.length;if(!response.complete&&(!response.receipts.length||offset>=10000))throw new Error("DISCOVERY_BOUND");
     await tx.update(automaticIntake).set({claim:null,leaseUntil:null,attempts:0,errorCode:null,lastSuccessAt:now,...response.complete?{cursor:state!.windowEnd!,windowEnd:null,offset:0,nextAt:new Date(now.getTime()+60000)}:{offset,nextAt:now}}).where(eq(automaticIntake.id,state!.id));
    });
   }
  }catch(error){
   if(state){const f=failure(error,state.attempts,now);await db.update(automaticIntake).set({claim:null,leaseUntil:null,errorCode:f.code,nextAt:f.nextAt,attempts:f.terminal?5:state.attempts}).where(and(eq(automaticIntake.id,state.id),eq(automaticIntake.claim,claim)));}
   else await db.transaction(async tx=>{
    // Trusted scheduler may quarantine its own expired metadata when actor permission was revoked.
    // This grants no authority to mutate orders or reuse the revoked grant.
    await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
    await tx.update(automaticIntake).set({claim:null,leaseUntil:null,errorCode:"AUTHORIZATION_REQUIRED",attempts:5}).where(and(tenantWhere(automaticIntake,scope),eq(automaticIntake.id,candidate.state.id),sql`(${automaticIntake.claim} is null or ${automaticIntake.leaseUntil}<${now})`));
   });
  }
 }
 const [pending]=await db.select({item:automaticReceipts,state:automaticIntake}).from(automaticReceipts).innerJoin(automaticIntake,and(eq(automaticIntake.organizationId,automaticReceipts.organizationId),eq(automaticIntake.storeId,automaticReceipts.storeId),eq(automaticIntake.epoch,automaticReceipts.epoch))).innerJoin(connections,and(eq(connections.organizationId,automaticReceipts.organizationId),eq(connections.storeId,automaticReceipts.storeId),eq(connections.epoch,automaticReceipts.epoch),eq(connections.status,"connected"))).where(and(lte(automaticReceipts.nextAt,now),sql`(${automaticReceipts.status}='PENDING' or (${automaticReceipts.status}='PROCESSING' and ${automaticReceipts.leaseUntil}<${now}))`)).orderBy(asc(automaticReceipts.nextAt),asc(automaticReceipts.createdAt)).limit(1);
 if(!pending)return;
 const scope:Scope={organizationId:pending.item.organizationId,storeId:pending.item.storeId,userId:pending.state.actorId},claim=randomUUID();
 let item:typeof automaticReceipts.$inferSelect|undefined;
 try{
  item=await db.transaction(async tx=>{
   await ownedConnection(tx,scope,pending.item.epoch);
   const [current]=await tx.select().from(automaticReceipts).where(and(tenantWhere(automaticReceipts,scope),eq(automaticReceipts.id,pending.item.id))).for("update");
   if(!current||current.nextAt>now||!["PENDING","PROCESSING"].includes(current.status)||(current.status==="PROCESSING"&&current.leaseUntil!>=now))return undefined;
   if(current.attempts>=5){await tx.update(automaticReceipts).set({status:"ATTENTION",claim:null,leaseUntil:null,errorCode:"RETRY_LIMIT"}).where(eq(automaticReceipts.id,current.id));return undefined;}
   const [updated]=await tx.update(automaticReceipts).set({status:"PROCESSING",claim,leaseUntil:new Date(now.getTime()+leaseMs),attempts:current.attempts+1}).where(eq(automaticReceipts.id,current.id)).returning();return updated;
  });
  if(!item)return;
  const result=await syncOrderReceipt(db,scope,{receiptId:item.receiptId,commandId:item.id},async(...args)=>{
   const detail=await reader(...args);if(detail.epoch!==item!.epoch)throw new Error("CONNECTION_CHANGED");
   const raw=parseEtsyJson(detail.body) as Record<string,unknown>,created=raw.created_timestamp??raw.create_timestamp;
   if(typeof created!=="number"||!Number.isSafeInteger(created)||created<pending.state.cutoff)throw new Error("AUTO_CUTOFF");return detail;
  },async tx=>{
   const [current]=await tx.select().from(automaticReceipts).where(and(tenantWhere(automaticReceipts,scope),eq(automaticReceipts.id,item!.id))).for("update");
   if(current?.claim!==claim||current.status!=="PROCESSING"||current.leaseUntil!<=new Date())throw new Error("CONNECTION_CHANGED");
  });
  const attention=!["IMPORTED","ALREADY_IMPORTED"].includes(result.kind);
  await db.update(automaticReceipts).set({status:attention?"ATTENTION":"SUCCEEDED",claim:null,leaseUntil:null,result:result.kind,errorCode:attention?result.kind:null}).where(and(tenantWhere(automaticReceipts,scope),eq(automaticReceipts.id,item.id),eq(automaticReceipts.claim,claim)));
 }catch(error){if(item){const f=failure(error,item.attempts,now);await db.update(automaticReceipts).set({status:f.terminal?"ATTENTION":"PENDING",claim:null,leaseUntil:null,errorCode:f.code,nextAt:f.nextAt}).where(and(tenantWhere(automaticReceipts,scope),eq(automaticReceipts.id,item.id),eq(automaticReceipts.claim,claim)));}else await db.transaction(async tx=>{
  await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  await tx.update(automaticReceipts).set({status:"ATTENTION",claim:null,leaseUntil:null,errorCode:"AUTHORIZATION_REQUIRED"}).where(and(tenantWhere(automaticReceipts,scope),eq(automaticReceipts.id,pending.item.id),sql`(${automaticReceipts.status}='PENDING' or (${automaticReceipts.status}='PROCESSING' and ${automaticReceipts.leaseUntil}<${now}))`));
 });}
}

export async function intakeDiagnostics(db:DbExecutor,scope:Scope){
 assertInternalOperator(scope.userId);await verifyScope(db,scope,true);
 const [grant]=await db.select().from(connections).where(tenantWhere(connections,scope));
 const state=await db.select().from(automaticIntake).where(and(tenantWhere(automaticIntake,scope),eq(automaticIntake.epoch,grant.epoch))).limit(1);
 const receipts=await db.select({id:automaticReceipts.id,receiptId:automaticReceipts.receiptId,status:automaticReceipts.status,errorCode:automaticReceipts.errorCode,result:automaticReceipts.result,attempts:automaticReceipts.attempts}).from(automaticReceipts).where(and(tenantWhere(automaticReceipts,scope),eq(automaticReceipts.epoch,grant.epoch))).orderBy(asc(automaticReceipts.nextAt)).limit(20);
 return {state:state[0],receipts};
}
export async function retryAutomaticIntake(db:Database,scope:Scope,raw:unknown){
 assertInternalOperator(scope.userId);
 const command=z.object({id:z.uuid(),kind:z.enum(["discovery","receipt"]),commandId:z.uuid()}).strict().parse(raw);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  const [grant]=await tx.select().from(connections).where(tenantWhere(connections,scope));
  await ownedConnection(tx,scope,grant.epoch);
  const [previous]=await tx.select().from(auditLogs).where(and(tenantWhere(auditLogs,scope),eq(auditLogs.action,`automatic_intake_retry:${command.commandId}`)));
  if(previous){if(previous.resourceId!==command.id)throw new Error("RETRY_COMMAND_CONFLICT");return;}
  const table=command.kind==="receipt"?automaticReceipts:automaticIntake;
  const [row]=await tx.select().from(table).where(and(tenantWhere(table,scope),eq(table.id,command.id),eq(table.epoch,grant.epoch))).for("update");
  if(!row||row.claim)throw new Error("RETRY_UNAVAILABLE");
  if(command.kind==="receipt"){
   const changed=await tx.update(automaticReceipts).set({status:"PENDING",attempts:0,errorCode:null,nextAt:new Date()}).where(and(tenantWhere(automaticReceipts,scope),eq(automaticReceipts.id,row.id),eq(automaticReceipts.status,"ATTENTION"))).returning();if(!changed.length)throw new Error("RETRY_UNAVAILABLE");
  }else{if(!row.errorCode)throw new Error("RETRY_UNAVAILABLE");await tx.update(automaticIntake).set({attempts:0,errorCode:null,nextAt:new Date()}).where(eq(automaticIntake.id,row.id));}
  await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action:`automatic_intake_retry:${command.commandId}`,resourceId:row.id});
 });
}

export async function automaticIntakeStatus(db:DbExecutor,scope:Scope){
 await verifyScope(db,scope);
 const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 const [grant]=await db.select().from(connections).where(tenantWhere(connections,scope));
 if(store?.source!=="etsy"||!store.externalShopId||grant?.status!=="connected"||!grant.encryptedTokens)return "Etsy is disconnected or needs reauthorization. Automatic intake is unavailable.";
 if(!grant.scopes.includes("transactions_r"))return "Etsy order access is missing. Reauthorize Etsy in Settings.";
 if(!automaticIntakeConfigured())return "Etsy connected. Automatic intake is not enabled in this environment.";
 const [state]=await db.select().from(automaticIntake).where(and(tenantWhere(automaticIntake,scope),eq(automaticIntake.epoch,grant.epoch)));
 if(!state)return "Etsy connected. Automatic intake initialization is required; contact the application operator.";
 // Earlier held observations remain history when a later observation has succeeded.
 const [receipt]=await db.select({status:automaticReceipts.status,error:automaticReceipts.errorCode}).from(automaticReceipts).where(and(tenantWhere(automaticReceipts,scope),eq(automaticReceipts.epoch,grant.epoch),sql`${automaticReceipts.status}<>'SUCCEEDED'`,sql`not exists (select 1 from etsy_automatic_receipts newer where newer.organization_id=${automaticReceipts.organizationId} and newer.store_id=${automaticReceipts.storeId} and newer.epoch=${automaticReceipts.epoch} and newer.receipt_id=${automaticReceipts.receiptId} and newer.source_modified>${automaticReceipts.sourceModified})`)).orderBy(asc(automaticReceipts.createdAt)).limit(1);
 if(receipt?.error==="AUTHORIZATION_REQUIRED")return "Etsy authorization failed. Reauthorize Etsy in Settings.";
 if(receipt?.status==="ATTENTION")return "An incoming receipt requires attention. Existing imported orders remain visible; contact the application operator for intake diagnostics.";
 if(receipt)return "A receipt was discovered. Automatic intake or a bounded retry is pending; check Orders again shortly.";
 if(state.errorCode)return state.errorCode==="AUTHORIZATION_REQUIRED"?"Etsy authorization failed. Reauthorize Etsy in Settings.":"Automatic intake is delayed. Retry or operator attention is pending.";
 if(!state.lastSuccessAt||Date.now()-state.lastSuccessAt.getTime()>300000)return "Automatic intake is configured, but recent worker progress is not confirmed. Contact the application operator.";
 return "Automatic intake recently checked Etsy orders. New eligible orders appear here; reading generation and delivery are separate steps.";
}
