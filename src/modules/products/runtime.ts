import { and, eq, or, isNull, asc } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { mappings, products, productVersions, stores, etsyHistoricalAdoptions } from "../../db/schema";
import type { Scope, InputPolicy } from "../intake/contracts";
import { validateInputs } from "../intake/contracts";
import { configurationSchema, inputPolicy } from "./contracts";
import { assessEtsySource, etsySourceSchema, selectionKey, type EtsyProductPolicy } from "../etsy/source-contract";
import { verifyScope } from "../intake/service";
import { AccessDenied } from "../identity/service";
import {sourceFingerprint} from "../etsy/source-fingerprint";
type Mapping = typeof mappings.$inferSelect;
export async function resolveConfiguration(db: DbExecutor,scope:Scope,listingId:string,variantKey:string) {
  const [mapping]=await db.select().from(mappings).where(and(eq(mappings.organizationId,scope.organizationId),eq(mappings.storeId,scope.storeId),eq(mappings.listingExternalId,listingId),eq(mappings.variantKey,variantKey)));
  if(!mapping?.productId) return {mapping,version:undefined,state:mapping ? "legacy" : "unconfigured"};
  const [version]=await db.select({id:productVersions.id,configuration:productVersions.configuration}).from(products).innerJoin(productVersions,and(eq(products.activeVersionId,productVersions.id),eq(products.id,productVersions.productId),eq(products.organizationId,productVersions.organizationId),eq(products.storeId,productVersions.storeId))).where(and(eq(products.organizationId,scope.organizationId),eq(products.storeId,scope.storeId),eq(products.id,mapping.productId),eq(productVersions.status,"ACTIVE")));
  return {mapping,version,state:version ? "versioned" : "unconfigured"};
}
export async function unitPolicy(db:DbExecutor,scope:Scope,unit:{productVersionId:string|null;configurationState:string},mapping?:Mapping):Promise<{required:InputPolicy;paused:boolean;etsyFulfillment?:EtsyProductPolicy}|undefined> {
  if(unit.configurationState==="legacy") return mapping ? {required:mapping.required,paused:mapping.paused}:undefined;
  if(!unit.productVersionId) return mapping && !mapping.productId ? {required:mapping.required,paused:mapping.paused} : undefined; // Never retroactively adopt today's configuration on replay.
  const [version]=await db.select({configuration:productVersions.configuration}).from(productVersions).where(and(eq(productVersions.organizationId,scope.organizationId),eq(productVersions.storeId,scope.storeId),eq(productVersions.id,unit.productVersionId)));
  if(!version) throw new Error("CONFIGURATION_UNAVAILABLE");
  const configuration=configurationSchema.parse(version.configuration);
  return {required:inputPolicy(configuration),paused:mapping?.paused??false,etsyFulfillment:configuration.etsyFulfillment};
}

/** Owned backend lookup only. No HTTP call, raw Etsy normalization or ingestion. */
export async function resolveEtsySourceConfiguration(db:DbExecutor,scope:Scope,raw:unknown,history?:{productVersionId:string|null},options:{lineAdoptionOnly?:boolean}={}) {
  await verifyScope(db,scope);
  const source=etsySourceSchema.parse(raw);
  const [store]=await db.select().from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId)));
  if(!store?.externalShopId||store.externalShopId!==source.receipt.shopId) throw new AccessDenied();
  let version: typeof productVersions.$inferSelect | undefined, mapping:Mapping|undefined;
  const resolutionIssues:string[]=[];
  if(history){
    // Explicit unresolved history never adopts today's active version.
    if(history.productVersionId){
      [version]=await db.select().from(productVersions).where(and(eq(productVersions.organizationId,scope.organizationId),eq(productVersions.storeId,scope.storeId),eq(productVersions.id,history.productVersionId)));
      if(!version||version.status==="DRAFT") throw new AccessDenied();
    }
  }else if(source.transaction.listingId.presence==="value"){
    let key:string;
    try { key=selectionKey(source.purchaseSelections.map(s=>({propertyId:s.propertyId,valueIds:s.valueIds.presence==="value"?s.valueIds.value:[]}))); }
    catch { return {source,version:undefined,answers:[],issues:["unmapped_purchase_selection"]}; }
      const resolved=await resolveConfiguration(db,scope,source.transaction.listingId.value,key);
      mapping=resolved.mapping;
      if(!mapping){
        const [listingMapping]=await db.select({id:mappings.id}).from(mappings).where(and(eq(mappings.organizationId,scope.organizationId),eq(mappings.storeId,scope.storeId),eq(mappings.listingExternalId,source.transaction.listingId.value))).limit(1);
        if(listingMapping) resolutionIssues.push("unmapped_purchase_selection");
      }
      if(resolved.version) [version]=await db.select().from(productVersions).where(and(eq(productVersions.organizationId,scope.organizationId),eq(productVersions.storeId,scope.storeId),eq(productVersions.id,resolved.version.id)));
  }
  // Explicit durable historical permission takes precedence over today's activation.
  if(!history&&source.transaction.listingId.presence==="value"){
    let key:string|undefined;
    try{key=selectionKey(source.purchaseSelections.map(s=>({propertyId:s.propertyId,valueIds:s.valueIds.presence==="value"?s.valueIds.value:[]})));}catch{/* Assessor holds ambiguous identities. */}
    if(key){
      const [adoption]=await db.select().from(etsyHistoricalAdoptions).where(and(eq(etsyHistoricalAdoptions.organizationId,scope.organizationId),eq(etsyHistoricalAdoptions.storeId,scope.storeId),eq(etsyHistoricalAdoptions.receiptId,source.receipt.receiptId),eq(etsyHistoricalAdoptions.listingId,source.transaction.listingId.value),eq(etsyHistoricalAdoptions.selectionKey,key),or(eq(etsyHistoricalAdoptions.transactionId,source.transaction.transactionId),isNull(etsyHistoricalAdoptions.transactionId)))).orderBy(asc(isNull(etsyHistoricalAdoptions.transactionId)));
      if(adoption){
        if((options.lineAdoptionOnly&&!adoption.transactionId)||(adoption.transactionId&&(adoption.shopId!==source.receipt.shopId||adoption.sourceFingerprint!==sourceFingerprint(source)))){
          version=undefined;resolutionIssues.push("source_changed");
        }else if(source.receipt.createdTimestamp.presence!=="value"||source.receipt.createdTimestamp.value<adoption.purchaseFrom||source.receipt.createdTimestamp.value>adoption.purchaseThrough){version=undefined;resolutionIssues.push("ambiguous_historical_mapping");}
        else{
          [version]=await db.select().from(productVersions).where(and(eq(productVersions.organizationId,scope.organizationId),eq(productVersions.storeId,scope.storeId),eq(productVersions.id,adoption.productVersionId)));
          if(!version||version.status==="DRAFT")throw new Error("CONFIGURATION_UNAVAILABLE");
          history={productVersionId:version.id};
        }
      }
    }
  }
  // Today's activation is not authority for an earlier purchase. Historical callers
  // must supply an already retained version; unresolved history stays held.
  if(!history&&version&&(source.receipt.createdTimestamp.presence!=="value"||!version.activatedAt||source.receipt.createdTimestamp.value<Math.ceil(version.activatedAt.getTime()/1000))){
    version=undefined;
    resolutionIssues.push("ambiguous_historical_mapping");
  }
  const configuration=version?configurationSchema.parse(version.configuration):undefined;
  if(!mapping&&configuration?.etsyFulfillment){
    [mapping]=await db.select().from(mappings).where(and(eq(mappings.organizationId,scope.organizationId),eq(mappings.storeId,scope.storeId),eq(mappings.productId,version!.productId),eq(mappings.listingExternalId,configuration.etsyFulfillment.listingId),eq(mappings.variantKey,selectionKey(configuration.etsyFulfillment.purchaseSelections))));
  }
  const result=assessEtsySource(source,configuration?.etsyFulfillment);
  const issues=[...result.issues,...resolutionIssues,...(mapping?.paused?["mapping_paused"]:[]),...(configuration?validateInputs(result.answers,inputPolicy(configuration)):[])];
  return {source,version,mapping,answers:result.answers,issues:[...new Set(issues)]};
}
