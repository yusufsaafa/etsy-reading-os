import { and, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { units, orders, lineItems, customerInputs, productVersions, mappings } from "../../db/schema";
import { tenantWhere, verifyScope } from "../intake/service";
import { triage, type Scope } from "../intake/contracts";
import { AccessDenied } from "../identity/service";
import { activationErrors, configurationSchema, inputPolicy } from "../products/contracts";
import { sellerProductionContextInTransaction } from "../seller-style/context";
import { sellerIdentity, styleConfiguration, publishErrors } from "../seller-style/contracts";
import { AdmissionError, ENGINE_VERSION, type GenerationContext } from "./contracts";
// Caller holds the Store lock; standalone reads use a repeatable-read transaction.
export async function buildGenerationContext(tx: DbExecutor, scope: Scope, unitId: string): Promise<GenerationContext> {
  await verifyScope(tx, scope, true);
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
  const issues = triage(order.latestSnapshot,line.snapshot,{ required:inputPolicy(parsed.data),paused:mapping?.paused??false },input.answers,unit.contextAllocated,unit.sourceChanged);
  if (issues.some(i=>["missing_input","unusable_input","quantity_context"].includes(i))) throw new AdmissionError("CUSTOMER_INFORMATION");
  if (issues.length || unit.issues.length) throw new AdmissionError("READING_HOLD");
  const data = await sellerProductionContextInTransaction(tx,scope);
  if(!data.ready)throw new AdmissionError(data.missing.includes("profile")?"SELLER_SETUP":"STYLE_SETUP");
  const seller = sellerIdentity.safeParse(data.seller && {displayName:data.seller.displayName,shortBio:data.seller.shortBio});
  if (!data.seller || !seller.success) throw new AdmissionError("SELLER_SETUP");
  const style = styleConfiguration.safeParse(data.style.configuration);
  if (!style.success || publishErrors(style.data).length) throw new AdmissionError("STYLE_SETUP");
  return { version:ENGINE_VERSION,unitId:unit.id,orderId:order.id,lineItemId:line.id,
    seller:{id:data.seller.id,...seller.data}, style:{id:data.style.id,versionNumber:data.style.versionNumber,configuration:style.data},
    product:{id:version.id,versionNumber:version.versionNumber,configuration:parsed.data},
    customer:{revision:input.revision,answers:input.answers} };
}
