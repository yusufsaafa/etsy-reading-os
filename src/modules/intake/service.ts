import { admitReadingInTransaction, reconcileProductionInTransaction } from "../production/service";
import { generations, productVersions, productionQueue } from "../../db/schema";
import { resolveConfiguration, resolveEtsySourceConfiguration, unitPolicy, mappedCustomerAnswers } from "../products/runtime";
import { and, eq, desc } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database, DbExecutor } from "../../db/client";
import { orders, lineItems, units, customerInputs, listings, mappings, stores, connections, auditLogs } from "../../db/schema";
import { authorizeStore, AccessDenied } from "../identity/service";
import { orderSchema, listingSchema, triage, stableJson, type Scope, type Answer, type ExternalOrder } from "./contracts";

export function tenantWhere(table: { organizationId: AnyPgColumn; storeId: AnyPgColumn }, scope: Pick<Scope, "organizationId" | "storeId">) {
  return and(eq(table.organizationId, scope.organizationId), eq(table.storeId, scope.storeId));
}
export async function verifyScope(db: DbExecutor, scope: Scope, owner = false) {
  const actual = await authorizeStore(db, scope.userId, scope.storeId, owner);
  if (actual.organizationId !== scope.organizationId) throw new AccessDenied();
}
export async function ingestListing(db: Database, scope: Scope, raw: unknown, epoch?: number) {
  const listing = listingSchema.parse(raw);
  return db.transaction(async tx => {
    await verifyScope(tx, scope);
    await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    await assertConnection(tx, scope, epoch);
    const where = and(tenantWhere(listings, scope), eq(listings.externalId, listing.externalId));
    const [existing] = await tx.select().from(listings).where(where);
    if (existing && existing.sourceUpdatedAt > listing.updatedAt) return;
    await tx.insert(listings).values({ organizationId: scope.organizationId, storeId: scope.storeId, externalId: listing.externalId, title: listing.title, state: listing.state, sourceUpdatedAt: listing.updatedAt, snapshot: listing }).onConflictDoUpdate({ target: [listings.organizationId, listings.storeId, listings.externalId], set: { title: listing.title, state: listing.state, sourceUpdatedAt: listing.updatedAt, snapshot: listing } });
  });
}
async function assertConnection(db: DbExecutor, scope: Scope, epoch?: number) {
  if (epoch === undefined) return; // Explicit direct import is used only by tests/seed, not HTTP actions.
  const [connection] = await db.select({ status: connections.status, epoch: connections.epoch }).from(connections).where(tenantWhere(connections, scope));
  if (!connection || connection.status !== "connected" || connection.epoch !== epoch) throw new Error("CONNECTION_CHANGED");
}
function purchaseLineFingerprint(line:ExternalOrder["lines"][number]){
 if(!line.etsySource)return stableJson(line);
 const {observedAt,...receipt}=line.etsySource.receipt;void observedAt;
 return stableJson({...line,etsySource:{...line.etsySource,receipt}});
}
export type IngestOptions={epoch?:number;failAfterLines?:number;suppressProductionAdmission?:boolean;controlled?:{commandId:string;versions:Record<string,string>}};
export async function ingestOrder(db: Database, scope: Scope, raw: unknown, options: IngestOptions = {}) {
 return db.transaction(tx=>ingestOrderInTransaction(tx,scope,raw,options));
}
/** Existing receipt-atomic engine, shared with explicitly authorized controlled intake. */
export async function ingestOrderInTransaction(tx:DbExecutor,scope:Scope,raw:unknown,options:IngestOptions={}){
 const incoming=orderSchema.parse(raw);
    await verifyScope(tx, scope,!!options.controlled);
    await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    await assertConnection(tx, scope, options.epoch);
    const where = and(tenantWhere(orders, scope), eq(orders.externalId, incoming.externalId));
    if(incoming.lines.some(l=>l.etsySource)){
      const [ownedStore]=await tx.select({shopId:stores.externalShopId}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId)));
      if(!ownedStore.shopId||incoming.lines.some(l=>l.etsySource&&l.etsySource.receipt.shopId!==ownedStore.shopId)) throw new AccessDenied();
    }
    const [previous] = await tx.select().from(orders).where(where);
    if (previous && incoming.updatedAt < previous.sourceUpdatedAt) return previous.id;
    const effective = { ...incoming, canceled: incoming.canceled || !!previous?.canceled, refund: previous?.refund && previous.refund !== "none" && incoming.refund === "none" ? previous.refund as ExternalOrder["refund"] : incoming.refund };
    const [order] = await tx.insert(orders).values({ organizationId: scope.organizationId, storeId: scope.storeId, externalId: incoming.externalId, buyerName: incoming.buyerName, paid: effective.paid, canceled: effective.canceled, refund: effective.refund, sourceUpdatedAt: incoming.updatedAt, purchasedSnapshot: incoming, latestSnapshot: effective, createdAt: new Date(incoming.createdAt * 1000) }).onConflictDoUpdate({ target: [orders.organizationId, orders.storeId, orders.externalId], set: { paid: effective.paid, canceled: effective.canceled, refund: effective.refund, sourceUpdatedAt: incoming.updatedAt, latestSnapshot: effective } }).returning();
    let completed = 0;
    for (const incomingLine of incoming.lines) {
      const [line] = await tx.insert(lineItems).values({ organizationId: scope.organizationId, storeId: scope.storeId, orderId: order.id, externalId: incomingLine.externalId, listingExternalId: incomingLine.listingId, title: incomingLine.title, quantity: incomingLine.quantity, sku: incomingLine.sku, variantKey: incomingLine.variantKey, snapshot: incomingLine }).onConflictDoNothing().returning();
      const stored = line ?? (await tx.select().from(lineItems).where(and(tenantWhere(lineItems, scope), eq(lineItems.externalId, incomingLine.externalId))))[0];
      if (stored.orderId !== order.id) throw new Error("TRANSACTION_ORDER_MISMATCH");
      const sourceChanged = purchaseLineFingerprint(stored.snapshot) !== purchaseLineFingerprint(incomingLine);
      const retainedUnits=options.controlled&&!line?await tx.select().from(units).where(and(tenantWhere(units,scope),eq(units.lineItemId,stored.id))):[];
      const history=retainedUnits.length?{productVersionId:retainedUnits[0].productVersionId}:undefined;
      const sourceResolution=stored.snapshot.etsySource?await resolveEtsySourceConfiguration(tx,scope,stored.snapshot.etsySource,history,{lineAdoptionOnly:!!options.controlled}):undefined;
      const resolution = sourceResolution ? {mapping:"mapping" in sourceResolution?sourceResolution.mapping:undefined,version:sourceResolution.version,state:sourceResolution.version?"versioned":"unconfigured"} : await resolveConfiguration(tx, scope, stored.listingExternalId, stored.variantKey);
      const mapping = resolution.mapping;
      if(options.controlled?.versions[stored.externalId] && (resolution.version?.id!==options.controlled.versions[stored.externalId] || sourceResolution?.issues.length || sourceChanged))throw new Error("CONTROLLED_SOURCE_HOLD");
      for (let unitIndex = 1; unitIndex <= stored.quantity; unitIndex++) {
        const existingUnit=retainedUnits.find(u=>u.unitIndex===unitIndex);
        const [created] = existingUnit?[]:await tx.insert(units).values({ organizationId: scope.organizationId, storeId: scope.storeId, lineItemId: stored.id, unitIndex, productVersionId: resolution.version?.id ?? null, configurationState: resolution.state, issues: triage(effective, stored.snapshot, undefined, stored.snapshot.answers, false, sourceChanged), sourceChanged }).onConflictDoNothing().returning();
        const unit = created ?? existingUnit ?? (await tx.select().from(units).where(and(tenantWhere(units, scope), eq(units.lineItemId, stored.id), eq(units.unitIndex, unitIndex))))[0];
        if (created) await tx.insert(customerInputs).values({ organizationId: scope.organizationId, storeId: scope.storeId, unitId: unit.id, revision: 0, answers: sourceResolution?.answers??stored.snapshot.answers, source: "etsy_snapshot" }).onConflictDoNothing();
        const [context] = await tx.select().from(customerInputs).where(and(tenantWhere(customerInputs, scope), eq(customerInputs.unitId, unit.id))).orderBy(desc(customerInputs.revision)).limit(1);
        const policy=await unitPolicy(tx,scope,unit,mapping);
        await tx.update(units).set({ sourceChanged: sourceChanged || unit.sourceChanged, issues: [...new Set([...triage(effective, stored.snapshot, policy, mappedCustomerAnswers(stored.snapshot,context,policy), unit.contextAllocated, sourceChanged || unit.sourceChanged),...(unit.configurationState==="unconfigured"?sourceResolution?.issues??[]:[])])] }).where(and(tenantWhere(units, scope), eq(units.id, unit.id)));
      }
      if (options.failAfterLines !== undefined && ++completed >= options.failAfterLines) throw new Error("TEST_PARTIAL_FAILURE");
    }
    // A disappearing transaction is a source drift issue, never deletion of purchased history.
    const historicalLines = await tx.select().from(lineItems).where(and(tenantWhere(lineItems, scope), eq(lineItems.orderId, order.id)));
    for (const historical of historicalLines.filter(l => !incoming.lines.some(n => n.externalId === l.externalId))) {
      const retained = await tx.select().from(units).where(and(tenantWhere(units, scope), eq(units.lineItemId, historical.id)));
      for (const unit of retained) await tx.update(units).set({ sourceChanged: true, issues: [...new Set([...unit.issues, "source_changed", ...(effective.canceled ? ["canceled"] : []), ...(effective.refund !== "none" ? ["refund_review"] : [])])] }).where(and(tenantWhere(units, scope), eq(units.id, unit.id)));
    }
    const readingIds = await tx.select({id:units.id}).from(units).innerJoin(lineItems,eq(units.lineItemId,lineItems.id)).where(and(tenantWhere(units,scope),eq(lineItems.orderId,order.id)));
    if(!options.suppressProductionAdmission) for (const reading of readingIds) await admitReadingInTransaction(tx,scope,reading.id);
    if(options.controlled){
      const action="etsy_controlled_ingestion:"+options.controlled.commandId;
      const [prior]=await tx.select().from(auditLogs).where(and(tenantWhere(auditLogs,scope),eq(auditLogs.action,action)));
      if(prior&&prior.resourceId!==order.id)throw new Error("INGEST_COMMAND_CONFLICT");
      if(!prior)await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action,resourceId:order.id});
    }
    return order.id;
}
export async function workspaceData(db: Database, scope: Scope) {
  await verifyScope(db, scope);
  const [orderRows, lines, unitRows, inputRows, listingRows, mappingRows, versionRows, generationRows, queueRows] = await Promise.all([
    db.select().from(orders).where(tenantWhere(orders, scope)).orderBy(desc(orders.createdAt)),
    db.select().from(lineItems).where(tenantWhere(lineItems, scope)), db.select().from(units).where(tenantWhere(units, scope)),
    db.select().from(customerInputs).where(tenantWhere(customerInputs, scope)).orderBy(desc(customerInputs.revision)),
    db.select().from(listings).where(tenantWhere(listings, scope)), db.select().from(mappings).where(tenantWhere(mappings, scope)),
    db.select().from(productVersions).where(tenantWhere(productVersions,scope)),
    db.select({unitId:generations.unitId,status:generations.status,customerRevision:generations.customerRevision}).from(generations).where(tenantWhere(generations,scope)).orderBy(desc(generations.createdAt)),
    db.select({unitId:productionQueue.unitId,state:productionQueue.state}).from(productionQueue).where(tenantWhere(productionQueue,scope)),
  ]);
  return { orders: orderRows, lines, units: unitRows.map(unit=>{
    const generation=generationRows.find(g=>g.unitId===unit.id),queue=queueRows.find(q=>q.unitId===unit.id);
    const productionStatus=generation?.status==="SUCCEEDED"?(generation.customerRevision!==unit.revision?"STALE":"SUCCEEDED"):
      queue?.state==="ATTENTION"?"FAILED":queue?.state==="RETRY_WAIT"||queue?.state==="CLAIMED"?"WAITING":queue?.state==="EXECUTING"?"PROCESSING":generation?.status??(queue?.state==="EXECUTING"?"PROCESSING":queue?.state==="QUEUED"||queue?.state==="CLAIMED"?"WAITING":undefined);
    return {...unit,productionStatus,productionRevision:generation?.customerRevision};
  }), inputs: inputRows, listings: listingRows, mappings: mappingRows, versions:versionRows };
}
export async function correctInput(db: Database, scope: Scope, unitId: string, expectedRevision: number, answers: Answer[], allocated: boolean) {
  await db.transaction(async tx => {
    await verifyScope(tx, scope);
    await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    const [unit] = await tx.select().from(units).where(and(tenantWhere(units, scope), eq(units.id, unitId))).for("update");
    if (!unit) throw new AccessDenied();
    if (unit.revision !== expectedRevision) throw new Error("STALE_REVISION");
    const [line] = await tx.select().from(lineItems).where(and(tenantWhere(lineItems, scope), eq(lineItems.id, unit.lineItemId)));
    const [order] = await tx.select().from(orders).where(and(tenantWhere(orders, scope), eq(orders.id, line.orderId)));
    const [mapping] = await tx.select().from(mappings).where(and(tenantWhere(mappings, scope), eq(mappings.listingExternalId, line.listingExternalId), eq(mappings.variantKey, line.variantKey)));
    await tx.insert(customerInputs).values({ organizationId: scope.organizationId, storeId: scope.storeId, unitId, revision: unit.revision + 1, answers, source: "seller_correction", actorId: scope.userId });
    await tx.update(units).set({ revision: unit.revision + 1, contextAllocated: allocated, issues: triage(order.latestSnapshot, line.snapshot, await unitPolicy(tx,scope,unit,mapping), answers, allocated, unit.sourceChanged) }).where(and(tenantWhere(units, scope), eq(units.id, unitId)));
    await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: "customer_input_corrected", resourceId: unitId });
    await admitReadingInTransaction(tx,scope,unitId);
  });
}
export async function configureMapping(db: Database, scope: Scope, listingId: string, variantKey: string, paused: boolean) {
  await db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    const [listing] = await tx.select().from(listings).where(and(tenantWhere(listings, scope), eq(listings.externalId, listingId)));
    if (!listing) throw new AccessDenied();
    const [existingMapping] = await tx.select().from(mappings).where(and(tenantWhere(mappings,scope),eq(mappings.listingExternalId,listingId),eq(mappings.variantKey,variantKey)));
    const required = existingMapping?.productId ? existingMapping.required : listing.snapshot.personalization.filter(p => p.required).map(p => ({ label: p.label, minimumLength: 1 }));
    await tx.insert(mappings).values({ organizationId: scope.organizationId, storeId: scope.storeId, listingExternalId: listingId, variantKey, label: listing.title, required, paused }).onConflictDoUpdate({ target: [mappings.organizationId, mappings.storeId, mappings.listingExternalId, mappings.variantKey], set: { required, paused } });
    const lines = await tx.select().from(lineItems).where(and(tenantWhere(lineItems, scope), eq(lineItems.listingExternalId, listingId), eq(lineItems.variantKey, variantKey)));
    for (const line of lines) {
      const [order] = await tx.select().from(orders).where(and(tenantWhere(orders, scope), eq(orders.id, line.orderId)));
      const ownedUnits = await tx.select().from(units).where(and(tenantWhere(units, scope), eq(units.lineItemId, line.id)));
      for (const unit of ownedUnits) {
        const [context] = await tx.select().from(customerInputs).where(and(tenantWhere(customerInputs, scope), eq(customerInputs.unitId, unit.id))).orderBy(desc(customerInputs.revision)).limit(1);
        const policy=unit.configurationState === "legacy" ? {required,paused} : await unitPolicy(tx,scope,unit,existingMapping ? {...existingMapping,paused} : undefined);
        await tx.update(units).set({ issues: triage(order.latestSnapshot, line.snapshot, policy, mappedCustomerAnswers(line.snapshot,context,policy), unit.contextAllocated, unit.sourceChanged) }).where(and(tenantWhere(units, scope), eq(units.id, unit.id)));
      }
    }
    await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: paused ? "mapping_paused" : "mapping_configured", resourceId: listing.id });
    await reconcileProductionInTransaction(tx,scope);
  });
}
