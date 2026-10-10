import {validateCatalogEvidence} from "./evidence";
import {randomUUID} from "node:crypto";
import {and,eq,gt,inArray,ne,sql} from "drizzle-orm";
import {z} from "zod";
import type {Database,DbExecutor} from "../../db/client";
import {stores,connections,listings,catalogSections,listingCatalog,catalogSync} from "../../db/schema";
import {verifyScope,tenantWhere} from "../intake/service";
import type {Scope} from "../intake/contracts";
import {vault,type SecretVault} from "../../infrastructure/secrets";
import {liveOAuthConfig,refreshConnection} from "../etsy/connection-service";
import {tokenSchema} from "../etsy/oauth";
import {catalogReader,CatalogError,listingStates,primaryThumbnail,safeListingUrl,type CatalogReader,type CatalogListing,type CatalogSection} from "./transport";
const request=z.object({pages:z.number().int().min(1).max(5).default(5),choices:z.number().int().min(1).max(20).default(10),restart:z.boolean().default(false)}).strict();
type Cursor=NonNullable<typeof catalogSync.$inferSelect.cursor>;
export type ReaderFactory=(db:Database,scope:Scope)=>Promise<CatalogReader>;
export async function authenticatedCatalogReader(db:Database,scope:Scope,secrets:SecretVault=vault()):Promise<CatalogReader>{
 await verifyScope(db,scope,true);
 const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 let [grant]=await db.select().from(connections).where(tenantWhere(connections,scope));
 if(store.source!=="etsy"||!store.externalShopId||grant?.status!=="connected"||!grant.encryptedTokens||!grant.scopes.includes("listings_r"))throw new CatalogError("AUTHORIZATION");
 const config=liveOAuthConfig();
 if(grant.expiresAt&&grant.expiresAt<=new Date()){await refreshConnection(db,scope,secrets,config);[grant]=await db.select().from(connections).where(tenantWhere(connections,scope));}
 if(grant.status!=="connected"||!grant.encryptedTokens||!grant.scopes.includes("listings_r"))throw new CatalogError("AUTHORIZATION");
 const token=tokenSchema.parse(JSON.parse(secrets.open(grant.encryptedTokens,`${scope.organizationId}:${scope.storeId}:etsy`)));
 return catalogReader(store.externalShopId,grant.epoch,token.access_token,config);
}
async function fence(tx:DbExecutor,scope:Scope,claim:string,shopId:string,epoch:number){
 await verifyScope(tx,scope,true);
 const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
 const [state]=await tx.select().from(catalogSync).where(tenantWhere(catalogSync,scope));
 const [grant]=await tx.select().from(connections).where(tenantWhere(connections,scope));
 if(!state||state.claim!==claim||!state.claimUntil||state.claimUntil<=new Date()||store.externalShopId!==shopId||store.source!=="etsy"||grant?.status!=="connected"||grant.epoch!==epoch)throw new CatalogError("CONNECTION_CHANGED");
 return state;
}
async function saveSections(tx:DbExecutor,scope:Scope,shopId:string,rows:CatalogSection[]){
 if(rows.length>1000||new Set(rows.map(r=>r.shop_section_id)).size!==rows.length)throw new CatalogError("INVALID_RESPONSE");
 const now=new Date();await tx.update(catalogSections).set({present:false}).where(tenantWhere(catalogSections,scope));
 for(const row of rows)await tx.insert(catalogSections).values({organizationId:scope.organizationId,storeId:scope.storeId,shopId,externalId:row.shop_section_id,title:row.title,rank:row.rank,activeListingCount:row.active_listing_count,present:true,verifiedAt:now}).onConflictDoUpdate({target:[catalogSections.organizationId,catalogSections.storeId,catalogSections.externalId],set:{title:row.title,rank:row.rank,activeListingCount:row.active_listing_count,present:true,verifiedAt:now}});
 // Retired sections retain identity; last verified listing relationships are never deleted.
 await tx.update(listingCatalog).set({sectionState:"MISSING"}).where(and(tenantWhere(listingCatalog,scope),sql`${listingCatalog.sectionId} in (select external_id from catalog_sections where organization_id=${scope.organizationId} and store_id=${scope.storeId} and present=false)`));
 const active=rows.map(s=>s.shop_section_id);if(active.length)await tx.update(listingCatalog).set({sectionState:"KNOWN"}).where(and(tenantWhere(listingCatalog,scope),inArray(listingCatalog.sectionId,active)));
}
async function savePage(tx:DbExecutor,scope:Scope,shopId:string,runId:string,rows:CatalogListing[],sectionsReliable:boolean){
 if(rows.length>100)throw new CatalogError("INVALID_RESPONSE");
 const existing=rows.length?await tx.select().from(listings).where(and(tenantWhere(listings,scope),inArray(listings.externalId,rows.map(r=>r.listing_id)))):[];
 const sections=await tx.select().from(catalogSections).where(and(tenantWhere(catalogSections,scope),eq(catalogSections.present,true))).limit(1000);const now=new Date();
 for(const row of rows){
  if(row.shop_id!==shopId)throw new CatalogError("INVALID_RESPONSE");
  const previous=existing.find(l=>l.externalId===row.listing_id);
  if(previous&&previous.sourceUpdatedAt>row.updated_timestamp){await tx.update(listingCatalog).set({seenRun:runId,present:true}).where(and(tenantWhere(listingCatalog,scope),eq(listingCatalog.listingExternalId,row.listing_id)));continue;}
  // Only current catalog fields change. No operational re-ingestion or production reconciliation.
  await tx.insert(listings).values({organizationId:scope.organizationId,storeId:scope.storeId,externalId:row.listing_id,title:row.title,state:row.state,sourceUpdatedAt:row.updated_timestamp,snapshot:{externalId:row.listing_id,title:row.title,state:row.state,updatedAt:row.updated_timestamp,personalization:[]}}).onConflictDoUpdate({target:[listings.organizationId,listings.storeId,listings.externalId],set:{title:row.title,state:row.state,sourceUpdatedAt:row.updated_timestamp}});
  let sectionId:string|null=null,sectionState="UNKNOWN";
  if(sectionsReliable&&row.shop_section_id!==undefined){
   if(row.shop_section_id===null||String(row.shop_section_id)==="0")sectionState="UNCATEGORIZED";
   else{sectionId=String(row.shop_section_id);const section=sections.find(s=>s.externalId===sectionId);sectionState=section?.present?"KNOWN":"MISSING";
    if(!section)await tx.insert(catalogSections).values({organizationId:scope.organizationId,storeId:scope.storeId,shopId,externalId:sectionId,title:null,rank:null,activeListingCount:null,present:false,verifiedAt:null}).onConflictDoNothing();}
  }
  const relation=sectionState!=="UNKNOWN"?{sectionId,sectionState,sectionVerifiedAt:now}:{};
  const metadata={thumbnailUrl:primaryThumbnail(row),listingUrl:safeListingUrl(row.url,row.listing_id),sourceCreatedAt:row.creation_timestamp??null,verifiedAt:now,seenRun:runId,present:true};
  await tx.insert(listingCatalog).values({organizationId:scope.organizationId,storeId:scope.storeId,listingExternalId:row.listing_id,shopId,...metadata,...relation}).onConflictDoUpdate({target:[listingCatalog.organizationId,listingCatalog.storeId,listingCatalog.listingExternalId],set:{...metadata,...relation}});
 }
}
function safeCode(error:unknown){return error instanceof CatalogError?error.code:"TEMPORARY_FAILURE";}
/** Explicit manual batch only. Each network request is outside a DB transaction. No queue or timer. */
export async function syncCatalog(db:Database,scope:Scope,raw:unknown={},factory:ReaderFactory=authenticatedCatalogReader){
 await verifyScope(db,scope,true);const options=request.parse(raw),claim=randomUUID();
 const started=await db.transaction(async tx=>{
  await verifyScope(tx,scope,true);const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  const [grant]=await tx.select().from(connections).where(tenantWhere(connections,scope));
  if(store.source!=="etsy"||!store.externalShopId||grant?.status!=="connected"||!grant.scopes.includes("listings_r"))throw new CatalogError("AUTHORIZATION");
  const [old]=await tx.select().from(catalogSync).where(tenantWhere(catalogSync,scope));
  if(old?.claim&&old.claimUntil&&old.claimUntil>new Date())throw new CatalogError("BUSY");
  const resume=!options.restart&&old?.cursor&&old.shopId===store.externalShopId&&old.epoch===grant.epoch;
  const runId=resume?old.runId!:randomUUID(),cursor:Cursor=resume?old.cursor!:{phase:"LISTINGS",stateIndex:0,offset:0,after:null};
  const values={shopId:store.externalShopId,status:"IN_PROGRESS",claim,claimUntil:new Date(Date.now()+30*60*1000),runId,cursor,epoch:grant.epoch,lastAttemptAt:new Date(),processed:resume?old.processed:0,failures:resume?old.failures:0,issues:resume?old.issues:[]};
  await tx.insert(catalogSync).values({organizationId:scope.organizationId,storeId:scope.storeId,...values}).onConflictDoUpdate({target:[catalogSync.organizationId,catalogSync.storeId],set:values});
  return {...values,resume:!!resume};
 });
 let cursor=started.cursor,failures=started.failures,processed=started.processed,issues=started.issues.filter(i=>!["RATE_LIMIT","AUTHORIZATION","TEMPORARY_FAILURE","INVALID_RESPONSE","CONNECTION_CHANGED"].includes(i));let progressed=false;
 const addIssue=(code:string)=>{if(!issues.includes(code))issues=[...issues,code].slice(0,10);};
 try{
  const reader=await factory(db,scope);if(reader.shopId!==started.shopId||reader.epoch!==started.epoch)throw new CatalogError("CONNECTION_CHANGED");
  const beforeRequest=()=>db.transaction(async tx=>{
   const current=await fence(tx,scope,claim,reader.shopId,reader.epoch);
   // Leave enough lease time for the bounded three-request setup observation.
   if(current.claimUntil!.getTime()-Date.now()<60000)throw new CatalogError("CONNECTION_CHANGED");
  });
  let sectionsReliable=false;
  if(!started.resume||issues.includes("SECTIONS_UNAVAILABLE")){
   try{await beforeRequest();const sections=await reader.sections();await db.transaction(async tx=>{await fence(tx,scope,claim,reader.shopId,reader.epoch);await saveSections(tx,scope,reader.shopId,sections);await tx.update(catalogSync).set({sectionsVerifiedAt:new Date()}).where(tenantWhere(catalogSync,scope));});sectionsReliable=true;progressed=true;if(issues.includes("SECTIONS_UNAVAILABLE")){issues=issues.filter(i=>i!=="SECTIONS_UNAVAILABLE");failures=Math.max(0,failures-1);}}
   catch(error){if(error instanceof CatalogError&&["RATE_LIMIT","AUTHORIZATION","CONNECTION_CHANGED"].includes(error.code))throw error;if(!issues.includes("SECTIONS_UNAVAILABLE"))failures++;addIssue("SECTIONS_UNAVAILABLE");}
  }else sectionsReliable=!issues.includes("SECTIONS_UNAVAILABLE");
  for(let page=0;cursor.phase==="LISTINGS"&&page<options.pages;page++){
   await beforeRequest();const state=listingStates[cursor.stateIndex],data=await reader.listings(state,cursor.offset);
   if(data.results.length>100||data.count>10000||(!data.results.length&&cursor.offset<data.count)||data.results.some(r=>r.state!==state||r.shop_id!==reader.shopId)||new Set(data.results.map(r=>r.listing_id)).size!==data.results.length)throw new CatalogError("INVALID_RESPONSE");
   const offset=cursor.offset+data.results.length;if(offset>10000||processed+data.results.length>10000)throw new CatalogError("INVALID_RESPONSE");
   const next:Cursor=offset>=data.count?cursor.stateIndex===4?{phase:"CHOICES",stateIndex:4,offset:0,after:null}:{...cursor,stateIndex:cursor.stateIndex+1,offset:0}:{...cursor,offset};
   await db.transaction(async tx=>{await fence(tx,scope,claim,reader.shopId,reader.epoch);await savePage(tx,scope,reader.shopId,started.runId,data.results,sectionsReliable);await tx.update(catalogSync).set({cursor:next,processed:processed+data.results.length,failures,issues}).where(tenantWhere(catalogSync,scope));});
   cursor=next;processed+=data.results.length;progressed=true;
  }
  if(cursor.phase==="CHOICES"){
   const rows=await db.select({id:listingCatalog.listingExternalId,sourceUpdatedAt:listings.sourceUpdatedAt,state:listings.state}).from(listingCatalog).innerJoin(listings,and(eq(listings.organizationId,listingCatalog.organizationId),eq(listings.storeId,listingCatalog.storeId),eq(listings.externalId,listingCatalog.listingExternalId))).where(and(tenantWhere(listingCatalog,scope),eq(listingCatalog.seenRun,started.runId),...(cursor.after?[gt(listingCatalog.listingExternalId,cursor.after)]:[]))).orderBy(listingCatalog.listingExternalId).limit(options.choices+1);
   for(const row of rows.slice(0,options.choices)){
    try{await beforeRequest();const catalog=validateCatalogEvidence(await reader.choices(row.id));if(catalog.listing.id!==row.id||catalog.listing.state!==row.state||catalog.listing.updatedAt!==row.sourceUpdatedAt||Buffer.byteLength(JSON.stringify(catalog))>262144)throw new CatalogError("INVALID_RESPONSE");
     await db.transaction(async tx=>{await fence(tx,scope,claim,reader.shopId,reader.epoch);await tx.update(listingCatalog).set({setupCatalog:catalog,choicesSourceUpdatedAt:row.sourceUpdatedAt,choicesVerifiedAt:new Date(),choicesAttemptedAt:new Date(),choicesError:null}).where(and(tenantWhere(listingCatalog,scope),eq(listingCatalog.listingExternalId,row.id)));});
    }catch(error){
     if(error instanceof CatalogError&&error.code==="CONNECTION_CHANGED")throw error;
     await db.transaction(async tx=>{await fence(tx,scope,claim,reader.shopId,reader.epoch);await tx.update(listingCatalog).set({choicesError:safeCode(error),choicesAttemptedAt:new Date()}).where(and(tenantWhere(listingCatalog,scope),eq(listingCatalog.listingExternalId,row.id)));});
     if(error instanceof CatalogError&&["RATE_LIMIT","AUTHORIZATION"].includes(error.code))throw error;
     failures++;addIssue("CHOICES_UNAVAILABLE");
    }
    cursor={...cursor,after:row.id};progressed=true;await db.transaction(async tx=>{await fence(tx,scope,claim,reader.shopId,reader.epoch);await tx.update(catalogSync).set({cursor,failures,issues}).where(tenantWhere(catalogSync,scope));});
   }
   if(rows.length<=options.choices){
    // Absence is published only after a complete, error-free enumeration; never delete listings.
    await db.transaction(async tx=>{await fence(tx,scope,claim,reader.shopId,reader.epoch);await tx.update(listingCatalog).set({present:false}).where(and(tenantWhere(listingCatalog,scope),ne(listingCatalog.seenRun,started.runId)));await tx.update(catalogSync).set({cursor:null,status:failures?"PARTIAL":"SUCCEEDED",claim:null,claimUntil:null,failures,issues,...(!failures?{lastSuccessAt:new Date()}:{})}).where(tenantWhere(catalogSync,scope));});
    return {status:failures?"PARTIAL" as const:"SUCCEEDED" as const,processed,failures,hasMore:false,issues};
   }
  }
  await db.transaction(async tx=>{await fence(tx,scope,claim,reader.shopId,reader.epoch);await tx.update(catalogSync).set({status:"PARTIAL",claim:null,claimUntil:null,cursor,failures,issues}).where(tenantWhere(catalogSync,scope));});
  return {status:"PARTIAL" as const,processed,failures,hasMore:true,issues};
 }catch(error){
  addIssue(safeCode(error));await db.transaction(async tx=>{await verifyScope(tx,scope,true);await tx.update(catalogSync).set({status:progressed||started.resume?"PARTIAL":"FAILED",claim:null,claimUntil:null,failures,issues}).where(and(tenantWhere(catalogSync,scope),eq(catalogSync.claim,claim)));});
  return {status:progressed||started.resume?"PARTIAL" as const:"FAILED" as const,processed,failures:failures+1,hasMore:true,issues,...(error instanceof CatalogError&&error.retryAfterSeconds?{retryAfterSeconds:error.retryAfterSeconds}:{})};
 }
}
