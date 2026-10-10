import {and,eq,sql} from "drizzle-orm";
import type {Database} from "../../db/client";
import {stores,connections,listings,mappings,products,listingSelections,listingCatalog} from "../../db/schema";
import {verifyScope,tenantWhere,ingestListing} from "../intake/service";
import type {Scope} from "../intake/contracts";
import type {SecretVault} from "../../infrastructure/secrets";
import {tokenSchema} from "../etsy/oauth";
import {liveOAuthConfig,refreshConnection} from "../etsy/connection-service";
import {fetchShopListings,ListingDiscoveryError} from "../etsy/listing-discovery";
export type DiscoveredProduct={externalId:string;title:string;state:string;configured:boolean;thumbnailUrl?:string|null};
export async function discoverProducts(db:Database,scope:Scope,vault:SecretVault,options:{config?:ReturnType<typeof liveOAuthConfig>;fetcher?:typeof fetch}={}):Promise<{products:DiscoveredProduct[];selected:string[]}>{
 await verifyScope(db,scope,true);
 const [store]=await db.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 let [connection]=await db.select().from(connections).where(tenantWhere(connections,scope));
 if(!connection||connection.status!=="connected")throw new ListingDiscoveryError("connection");
 if(store.source==="etsy"){
  try{
   const config=options.config??liveOAuthConfig();
   if(!store.externalShopId||!connection.encryptedTokens||!connection.scopes.includes("listings_r"))throw new ListingDiscoveryError("connection");
   if(connection.expiresAt&&connection.expiresAt<=new Date()){
    await refreshConnection(db,scope,vault,config);
    [connection]=await db.select().from(connections).where(tenantWhere(connections,scope));
   }
   const tokens=tokenSchema.parse(JSON.parse(vault.open(connection.encryptedTokens!,`${scope.organizationId}:${scope.storeId}:etsy`)));
   const rows=await fetchShopListings(store.externalShopId,tokens.access_token,config,options.fetcher);
   for(const row of rows)await ingestListing(db,scope,{externalId:row.listing_id,title:row.title,state:row.state,updatedAt:row.updated_timestamp,personalization:[]},connection.epoch);
   // Check grant/ownership again after network reads before advancing persisted onboarding.
   await db.transaction(async tx=>{
    await verifyScope(tx,scope,true);await tx.select().from(stores).where(eq(stores.id,scope.storeId)).for("update");
    const [current]=await tx.select().from(connections).where(tenantWhere(connections,scope));
    if(current.status!=="connected"||current.epoch!==connection.epoch)throw new ListingDiscoveryError("connection");
    await tx.update(stores).set({onboardingStage:"products"}).where(and(eq(stores.id,scope.storeId),eq(stores.onboardingStage,"etsy")));
   });
   const [bindings,ownedProducts,selections]=await Promise.all([db.select().from(mappings).where(tenantWhere(mappings,scope)),db.select().from(products).where(tenantWhere(products,scope)),db.select().from(listingSelections).where(tenantWhere(listingSelections,scope))]);
   return {products:rows.map(row=>({externalId:row.listing_id,title:row.title,state:row.state,thumbnailUrl:row.thumbnailUrl,configured:bindings.some(b=>b.listingExternalId===row.listing_id&&ownedProducts.some(p=>p.id===b.productId&&p.activeVersionId!==null))})),selected:selections.map(s=>s.listingExternalId)};
  }catch(error){if(error instanceof ListingDiscoveryError)throw error;throw new ListingDiscoveryError("unavailable");}
 }
 // Explicit development fixture Stores retain their existing imported catalog only.
 const rows=await db.select().from(listings).where(tenantWhere(listings,scope));const selected=await db.select().from(listingSelections).where(tenantWhere(listingSelections,scope));
 return {products:rows.map(row=>({externalId:row.externalId,title:row.title,state:row.state,configured:false})),selected:selected.map(s=>s.listingExternalId)};
}

// Navigation reads cached catalog only. Discovery remains an explicit legacy command.
export async function readSavedProducts(db:Database,scope:Scope):Promise<{products:DiscoveredProduct[];selected:string[]}>{
 await verifyScope(db,scope,true);
 // Legacy picker already paginates locally. Retain its bounded 10,000-listing discovery ceiling,
 // but read only lightweight listing fields: never versions, purchases or external resources.
 const [rows,selected]=await Promise.all([
 db.select({externalId:listings.externalId,title:listings.title,state:listings.state,thumbnailUrl:listingCatalog.thumbnailUrl,
 configured:sql<boolean>`exists (select 1 from listing_mappings m join products p on p.id=m.product_id and p.organization_id=m.organization_id and p.store_id=m.store_id where m.organization_id=${scope.organizationId} and m.store_id=${scope.storeId} and m.listing_external_id=${listings.externalId} and p.active_version_id is not null)`})
 .from(listings).leftJoin(listingCatalog,and(eq(listingCatalog.organizationId,listings.organizationId),eq(listingCatalog.storeId,listings.storeId),eq(listingCatalog.listingExternalId,listings.externalId)))
 .where(tenantWhere(listings,scope)).orderBy(listings.title,listings.externalId).limit(10000),
 db.select({id:listingSelections.listingExternalId}).from(listingSelections).where(tenantWhere(listingSelections,scope)).limit(10000)]);
 return {products:rows,selected:selected.map(s=>s.id)};
}
