import {and,eq} from "drizzle-orm";
import {z} from "zod";
import type {Database} from "../../db/client";
import {stores,connections,listings,listingSelections} from "../../db/schema";
import type {Scope} from "../intake/contracts";
import {verifyScope,tenantWhere} from "../intake/service";
import type {SecretVault} from "../../infrastructure/secrets";
import {liveOAuthConfig,refreshConnection} from "../etsy/connection-service";
import {tokenSchema} from "../etsy/oauth";
import {fetchSetupCatalog,SetupCatalogError,type SetupCatalog} from "../etsy/setup-catalog";
import {etsyProductPolicySchema,selectionKey} from "../etsy/source-contract";
import {beginEtsyProductDraft} from "./service";
const command=z.object({listingId:z.string().regex(/^[1-9]\d{0,18}$/),configurationKey:z.string().min(1).max(2000)}).strict();
type Options={config?:ReturnType<typeof liveOAuthConfig>;fetcher?:typeof fetch};
async function ownedSetup(db:Database,scope:Scope,listingId:string,vault:SecretVault,options:Options){
 await verifyScope(db,scope,true);
 command.shape.listingId.parse(listingId);
 const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 const [listing]=await db.select().from(listings).where(and(tenantWhere(listings,scope),eq(listings.externalId,listingId)));
 const [selected]=await db.select().from(listingSelections).where(and(tenantWhere(listingSelections,scope),eq(listingSelections.listingExternalId,listingId)));
 if(store.source!=="etsy"||!store.externalShopId||!listing||!selected)throw new SetupCatalogError();
 let [connection]=await db.select().from(connections).where(tenantWhere(connections,scope));
 if(!connection||connection.status!=="connected"||!connection.encryptedTokens||!connection.scopes.includes("listings_r"))throw new SetupCatalogError();
 const config=options.config??liveOAuthConfig();
 if(connection.expiresAt&&connection.expiresAt<=new Date()){
  await refreshConnection(db,scope,vault,config);[connection]=await db.select().from(connections).where(tenantWhere(connections,scope));
 }
 const tokens=tokenSchema.parse(JSON.parse(vault.open(connection.encryptedTokens!,`${scope.organizationId}:${scope.storeId}:etsy`)));
 const catalog=await fetchSetupCatalog(store.externalShopId,listingId,tokens.access_token,config,options.fetcher);
 return {catalog,epoch:connection.epoch,shopId:store.externalShopId};
}
async function verifyGrant(db:Database,scope:Scope,epoch:number,shopId:string,listingId:string){
 await verifyScope(db,scope,true);
 const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 const [connection]=await db.select().from(connections).where(tenantWhere(connections,scope));
 const [selected]=await db.select().from(listingSelections).where(and(tenantWhere(listingSelections,scope),eq(listingSelections.listingExternalId,listingId)));
 if(!selected||store.externalShopId!==shopId||connection?.status!=="connected"||connection.epoch!==epoch)throw new SetupCatalogError();
}
export async function getEtsySetupCatalog(db:Database,scope:Scope,listingId:string,vault:SecretVault,options:Options={}):Promise<SetupCatalog>{
 try{const result=await ownedSetup(db,scope,listingId,vault,options);await verifyGrant(db,scope,result.epoch,result.shopId,listingId);return result.catalog;}
 catch{throw new SetupCatalogError();}
}
/** Only a server-verified exact identity choice enters the existing source-aware owner command.
 * This intentionally leaves question-to-field mapping and all behavior decisions for draft setup. */
export async function beginSelectedEtsyDraft(db:Database,scope:Scope,raw:unknown,vault:SecretVault,options:Options={}){
 const requested=command.parse(raw),result=await ownedSetup(db,scope,requested.listingId,vault,options);
 const choice=result.catalog.configurations.find(c=>c.key===requested.configurationKey);
 if(result.catalog.state!=="READY"||!choice)throw new SetupCatalogError();
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  await verifyGrant(tx as unknown as Database,scope,result.epoch,result.shopId,requested.listingId);
  return beginEtsyProductDraft(tx as unknown as Database,scope,{contractVersion:"etsy-product-policy/v1",fulfillment:"READING",listingId:requested.listingId,purchaseSelections:choice.purchaseSelections,inputMappings:[]});
 });
}
export function assertSetupPolicy(catalog:SetupCatalog,raw:unknown){
 const policy=etsyProductPolicySchema.safeParse(raw);
 if(catalog.state!=="READY"||!policy.success||policy.data.listingId!==catalog.listing.id||!catalog.configurations.some(c=>c.key===selectionKey(policy.data.purchaseSelections)))throw new SetupCatalogError();
 const mappings=policy.data.inputMappings;
 if(catalog.questions.some(q=>q.support!=="TEXT"||!mappings.some(m=>m.questionId===q.questionId))||mappings.some(m=>!catalog.questions.some(q=>q.questionId===m.questionId&&q.support==="TEXT")))throw new SetupCatalogError();
}

/** Persisted current evidence for GET rendering; no OAuth refresh or Etsy request. */
export async function getSavedEtsySetupCatalog(db:Database,scope:Scope,listingId:string):Promise<SetupCatalog>{
 const {savedSetupCatalog}=await import("../catalog/read");
 const catalog=await savedSetupCatalog(db,scope,listingId);
 if(!catalog)throw new SetupCatalogError();return catalog;
}
