import {z} from "zod";
import {and,eq} from "drizzle-orm";
import type {Database} from "../../db/client";
import {etsyHistoricalAdoptions,productVersions,stores,mappings,auditLogs} from "../../db/schema";
import {verifyScope,tenantWhere} from "../intake/service";
import {stableJson,type Scope} from "../intake/contracts";
import {configurationSchema} from "./contracts";
import {sourceFingerprint} from "../etsy/source-fingerprint";
import {etsySourceSchema,assessEtsySource,etsyId,selectionKey} from "../etsy/source-contract";
import {AccessDenied} from "../identity/service";

const legacyAdoptionCommandSchema=z.object({
  contractVersion:z.literal("etsy-historical-adoption/v1"),commandId:z.uuid(),
  receiptId:etsyId,productVersionId:z.uuid(),
  purchaseFrom:z.number().int().nonnegative().safe(),purchaseThrough:z.number().int().nonnegative().safe(),
}).strict().refine(c=>c.purchaseFrom<=c.purchaseThrough,{message:"Invalid purchase bounds"});

export const lineAdoptionCommandSchema=z.object({
 contractVersion:z.literal("etsy-historical-adoption/v2"),commandId:z.uuid(),productVersionId:z.uuid(),source:etsySourceSchema,
}).strict();
export const historicalAdoptionCommandSchema=z.union([legacyAdoptionCommandSchema,lineAdoptionCommandSchema]);

/** Future onboarding can enumerate an approved interval and submit selected receipts.
 * A bound alone never imports every matching old order. No receipt fetching/intake. */
export async function authorizeHistoricalAdoption(db:Database,scope:Scope,raw:unknown){
  const command=historicalAdoptionCommandSchema.parse(raw);
  return db.transaction(async tx=>{
    await verifyScope(tx,scope,true);
    const [store]=await tx.select().from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
    if(!store?.externalShopId)throw new AccessDenied();
    const [version]=await tx.select().from(productVersions).where(and(tenantWhere(productVersions,scope),eq(productVersions.id,command.productVersionId)));
    if(!version||version.status==="DRAFT"||!version.activatedAt)throw new AccessDenied();
    const policy=configurationSchema.parse(version.configuration).etsyFulfillment;
    if(!policy)throw new Error("ETSY_MAPPING_REQUIRED");
    const source=command.contractVersion==="etsy-historical-adoption/v2"?command.source:undefined;
    if(source && (source.receipt.shopId!==store.externalShopId || source.receipt.createdTimestamp.presence!=="value"))throw new AccessDenied();
    if(source && assessEtsySource(source,policy).issues.length)throw new Error("HISTORICAL_SOURCE_HOLD");
    const purchaseFrom=source?.receipt.createdTimestamp.presence==="value"?source.receipt.createdTimestamp.value:command.contractVersion==="etsy-historical-adoption/v1"?command.purchaseFrom:0;
    const purchaseThrough=source?purchaseFrom:command.contractVersion==="etsy-historical-adoption/v1"?command.purchaseThrough:0;
    if(purchaseThrough>=Math.ceil(version.activatedAt.getTime()/1000))throw new Error("NOT_HISTORICAL_BOUNDARY");
    const key=selectionKey(policy.purchaseSelections);
    const [mapping]=await tx.select().from(mappings).where(and(tenantWhere(mappings,scope),eq(mappings.productId,version.productId),eq(mappings.listingExternalId,policy.listingId),eq(mappings.variantKey,key)));
    if(!mapping)throw new Error("ETSY_MAPPING_REQUIRED");
    const desired={organizationId:scope.organizationId,storeId:scope.storeId,commandId:command.commandId,receiptId:source?.receipt.receiptId??(command.contractVersion==="etsy-historical-adoption/v1"?command.receiptId:""),
      transactionId:source?.transaction.transactionId??null,shopId:source?.receipt.shopId??null,sourceFingerprint:source?sourceFingerprint(source):null,
      listingId:policy.listingId,selectionKey:key,productVersionId:version.id,authorizedBy:scope.userId,purchaseFrom,purchaseThrough};
    const [prior]=await tx.select().from(etsyHistoricalAdoptions).where(and(tenantWhere(etsyHistoricalAdoptions,scope),eq(etsyHistoricalAdoptions.commandId,command.commandId)));
    if(prior){
      if(stableJson(Object.fromEntries(Object.keys(desired).map(k=>[k,prior[k as keyof typeof prior]])))!==stableJson(desired))throw new Error("HISTORICAL_COMMAND_CONFLICT");
      return prior;
    }
    // SQL uniqueness is authoritative even if another writer bypasses the Store lock.
    const [decision]=await tx.insert(etsyHistoricalAdoptions).values(desired).returning();
    await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action:"etsy_historical_adoption_authorized",resourceId:decision.id});
    return decision;
  });
}
