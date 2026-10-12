import {mappedCustomerAnswers} from "../products/runtime";
import { and, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { units, orders, lineItems, customerInputs, productVersions, mappings, stores } from "../../db/schema";
import { tenantWhere, verifyScope } from "../intake/service";
import { triage, type Scope } from "../intake/contracts";
import { AccessDenied } from "../identity/service";
import { activationErrors, configurationSchema, inputPolicy, pinnedProductTitle } from "../products/contracts";
import { sellerStyleDataForStoreInTransaction } from "../seller-style/service";
import { defaultStyle, DEFAULT_STYLE_VERSION, READING_OUTPUT_LANGUAGE } from "./defaults";
import { sellerIdentity, styleConfiguration, publishErrors } from "../seller-style/contracts";
import { AdmissionError, ENGINE_VERSION, type GenerationContext } from "./contracts";
// Caller holds the Store lock; standalone reads use a repeatable-read transaction.
// Paid generation keeps owner=true. Internal intake admission can check membership
// only: it creates waiting work and never grants permission for provider dispatch.
export async function buildGenerationContext(tx: DbExecutor, scope: Scope, unitId: string, owner = true): Promise<GenerationContext> {
  await verifyScope(tx, scope, owner);
  return buildProductionContextForStoreInTransaction(tx,scope,unitId);
}
// Internal server boundary shared by trusted scheduler and authorized generation.
// Caller derives ownership from persisted Store state and holds that Store lock.
// Returns private domain context; scheduler never persists or returns its body.
export async function buildProductionContextForStoreInTransaction(tx:DbExecutor,scope:Pick<Scope,"organizationId"|"storeId">,unitId:string):Promise<GenerationContext> {
  const [unit] = await tx.select().from(units).where(and(tenantWhere(units,scope),eq(units.id,unitId)));
  if (!unit) throw new AccessDenied();
  if (!unit.productVersionId || unit.configurationState !== "versioned") throw new AdmissionError("PRODUCT_SETUP");
  const [version] = await tx.select().from(productVersions).where(and(tenantWhere(productVersions,scope),eq(productVersions.id,unit.productVersionId)));
  const parsed = configurationSchema.safeParse(version?.configuration);
  if (!version || version.status==="DRAFT" || !parsed.success || activationErrors("Retained configuration",parsed.data).length) throw new AdmissionError("PRODUCT_SETUP");
  const [line] = await tx.select().from(lineItems).where(and(tenantWhere(lineItems,scope),eq(lineItems.id,unit.lineItemId)));
  const [order] = await tx.select().from(orders).where(and(tenantWhere(orders,scope),eq(orders.id,line.orderId)));
  const [input] = await tx.select().from(customerInputs).where(and(tenantWhere(customerInputs,scope),eq(customerInputs.unitId,unit.id))).orderBy(desc(customerInputs.revision)).limit(1);
  if (!input || input.revision!==unit.revision) throw new AdmissionError("CUSTOMER_INFORMATION");
  const [mapping] = await tx.select().from(mappings).where(and(tenantWhere(mappings,scope),eq(mappings.listingExternalId,line.listingExternalId),eq(mappings.variantKey,line.variantKey)));
  const policy={required:inputPolicy(parsed.data),paused:mapping?.paused??false,etsyFulfillment:parsed.data.etsyFulfillment};
  const answers=mappedCustomerAnswers(line.snapshot,input,policy);
  const issues = triage(order.latestSnapshot,line.snapshot,policy,answers,unit.contextAllocated,unit.sourceChanged);
  if (issues.some(i=>["missing_input","unusable_input","quantity_context"].includes(i))) throw new AdmissionError("CUSTOMER_INFORMATION");
  if (issues.length || unit.issues.length) throw new AdmissionError("READING_HOLD");
  const data = await sellerStyleDataForStoreInTransaction(tx,scope);
  const [store]=await tx.select().from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId)));
  if(!store)throw new AccessDenied();
  const seller = sellerIdentity.safeParse(data.seller ? {displayName:data.seller.displayName,shortBio:data.seller.shortBio}:{displayName:store.name.slice(0,100),shortBio:""});
  if (!seller.success) throw new AdmissionError("SELLER_SETUP");
  const selectedStyle=data.active??defaultStyle();
  const style = styleConfiguration.safeParse(selectedStyle.configuration);
  if (!style.success || publishErrors(style.data).length) throw new AdmissionError("STYLE_SETUP");
  return { version:ENGINE_VERSION,integrationVersion:"generation-context/v2",unitId:unit.id,orderId:order.id,lineItemId:line.id,
    seller:{id:data.seller?.id??store.id,source:data.seller?"SELLER_PROFILE":"STORE",...seller.data}, style:{id:selectedStyle.id,versionNumber:selectedStyle.versionNumber,configuration:style.data},
    styleResolution:{source:"PLATFORM_DEFAULT",version:DEFAULT_STYLE_VERSION,configuration:defaultStyle().configuration},outputLanguage:READING_OUTPUT_LANGUAGE,
    product:{id:version.id,versionNumber:version.versionNumber,...pinnedProductTitle(parsed.data),configuration:parsed.data},
    customer:{revision:input.revision,answers} };
}
