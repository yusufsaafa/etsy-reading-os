import {and,eq} from "drizzle-orm";
import {z} from "zod";
import type {Database} from "../../db/client";
import {stores,mappings,products,listingCatalog} from "../../db/schema";
import type {Scope} from "../intake/contracts";
import {verifyScope,tenantWhere} from "../intake/service";
import {savedSetupCatalog} from "../catalog/read";
import {beginEtsyProductDraft} from "./service";
const command=z.object({listingId:z.string().regex(/^[1-9]\d{0,19}$/),choice:z.string().max(2000).startsWith("etsy-selection/1:")}).strict();
/** Explicit owner command over current saved evidence; no provider requests or publication. */
export async function beginCatalogChoiceDraft(db:Database,scope:Scope,raw:unknown){
 const requested=command.parse(raw);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  const [store]=await tx.select().from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
  const [metadata]=await tx.select({shopId:listingCatalog.shopId}).from(listingCatalog).where(and(tenantWhere(listingCatalog,scope),eq(listingCatalog.listingExternalId,requested.listingId)));
  if(store.source!=="etsy"||!store.externalShopId||metadata?.shopId!==store.externalShopId)throw new Error("CHOICE_NOT_VERIFIED");
  const catalog=await savedSetupCatalog(tx,scope,requested.listingId);
  const choice=catalog?.configurations.find(c=>c.key===requested.choice);
  if(catalog?.state!=="READY"||catalog.listing.id!==requested.listingId||catalog.configurations.length>100||!choice)throw new Error("CHOICE_NOT_VERIFIED");
  const [binding]=await tx.select().from(mappings).where(and(tenantWhere(mappings,scope),eq(mappings.listingExternalId,requested.listingId),eq(mappings.variantKey,requested.choice)));
  if(binding?.productId){const [owned]=await tx.select({id:products.id}).from(products).where(and(tenantWhere(products,scope),eq(products.id,binding.productId)));if(!owned)throw new Error("INVALID_ASSOCIATION");return owned.id;}
  return beginEtsyProductDraft(tx as unknown as Database,scope,{contractVersion:"etsy-product-policy/v1",fulfillment:"READING",listingId:requested.listingId,purchaseSelections:choice.purchaseSelections,inputMappings:[]});
 });
}
