import { and, eq, desc } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database, DbExecutor } from "../../db/client";
import { orders, lineItems, units, customerInputs, listings, mappings, stores, connections, auditLogs } from "../../db/schema";
import { authorizeStore, AccessDenied } from "../identity/service";
import { orderSchema, listingSchema, triage, stableJson, type Scope, type Answer, type ExternalOrder } from "./contracts";

export function tenantWhere(table: { organizationId: AnyPgColumn; storeId: AnyPgColumn }, scope: Scope) {
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
export async function ingestOrder(db: Database, scope: Scope, raw: unknown, options: { epoch?: number; failAfterLines?: number } = {}) {
  const incoming = orderSchema.parse(raw);
  return db.transaction(async tx => {
    await verifyScope(tx, scope);
    await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    await assertConnection(tx, scope, options.epoch);
    const where = and(tenantWhere(orders, scope), eq(orders.externalId, incoming.externalId));
    const [previous] = await tx.select().from(orders).where(where);
    if (previous && incoming.updatedAt < previous.sourceUpdatedAt) return previous.id;
    const effective = { ...incoming, canceled: incoming.canceled || !!previous?.canceled, refund: previous?.refund && previous.refund !== "none" && incoming.refund === "none" ? previous.refund as ExternalOrder["refund"] : incoming.refund };
    const [order] = await tx.insert(orders).values({ organizationId: scope.organizationId, storeId: scope.storeId, externalId: incoming.externalId, buyerName: incoming.buyerName, paid: effective.paid, canceled: effective.canceled, refund: effective.refund, sourceUpdatedAt: incoming.updatedAt, purchasedSnapshot: incoming, latestSnapshot: effective, createdAt: new Date(incoming.createdAt * 1000) }).onConflictDoUpdate({ target: [orders.organizationId, orders.storeId, orders.externalId], set: { paid: effective.paid, canceled: effective.canceled, refund: effective.refund, sourceUpdatedAt: incoming.updatedAt, latestSnapshot: effective } }).returning();
    let completed = 0;
    for (const incomingLine of incoming.lines) {
      const [line] = await tx.insert(lineItems).values({ organizationId: scope.organizationId, storeId: scope.storeId, orderId: order.id, externalId: incomingLine.externalId, listingExternalId: incomingLine.listingId, title: incomingLine.title, quantity: incomingLine.quantity, sku: incomingLine.sku, variantKey: incomingLine.variantKey, snapshot: incomingLine }).onConflictDoNothing().returning();
      const stored = line ?? (await tx.select().from(lineItems).where(and(tenantWhere(lineItems, scope), eq(lineItems.externalId, incomingLine.externalId))))[0];
      if (stored.orderId !== order.id) throw new Error("TRANSACTION_ORDER_MISMATCH");
      const sourceChanged = stableJson(stored.snapshot) !== stableJson(incomingLine);
      const [mapping] = await tx.select().from(mappings).where(and(tenantWhere(mappings, scope), eq(mappings.listingExternalId, stored.listingExternalId), eq(mappings.variantKey, stored.variantKey)));
      for (let unitIndex = 1; unitIndex <= stored.quantity; unitIndex++) {
        const [created] = await tx.insert(units).values({ organizationId: scope.organizationId, storeId: scope.storeId, lineItemId: stored.id, unitIndex, issues: triage(effective, stored.snapshot, mapping, stored.snapshot.answers, false, sourceChanged), sourceChanged }).onConflictDoNothing().returning();
        const unit = created ?? (await tx.select().from(units).where(and(tenantWhere(units, scope), eq(units.lineItemId, stored.id), eq(units.unitIndex, unitIndex))))[0];
        if (created) await tx.insert(customerInputs).values({ organizationId: scope.organizationId, storeId: scope.storeId, unitId: unit.id, revision: 0, answers: stored.snapshot.answers, source: "etsy_snapshot" }).onConflictDoNothing();
        const [context] = await tx.select().from(customerInputs).where(and(tenantWhere(customerInputs, scope), eq(customerInputs.unitId, unit.id))).orderBy(desc(customerInputs.revision)).limit(1);
        await tx.update(units).set({ sourceChanged: sourceChanged || unit.sourceChanged, issues: triage(effective, stored.snapshot, mapping, context.answers, unit.contextAllocated, sourceChanged || unit.sourceChanged) }).where(and(tenantWhere(units, scope), eq(units.id, unit.id)));
      }
      if (options.failAfterLines !== undefined && ++completed >= options.failAfterLines) throw new Error("TEST_PARTIAL_FAILURE");
    }
    // A disappearing transaction is a source drift issue, never deletion of purchased history.
    const historicalLines = await tx.select().from(lineItems).where(and(tenantWhere(lineItems, scope), eq(lineItems.orderId, order.id)));
    for (const historical of historicalLines.filter(l => !incoming.lines.some(n => n.externalId === l.externalId))) {
      const retained = await tx.select().from(units).where(and(tenantWhere(units, scope), eq(units.lineItemId, historical.id)));
      for (const unit of retained) await tx.update(units).set({ sourceChanged: true, issues: [...new Set([...unit.issues, "source_changed", ...(effective.canceled ? ["canceled"] : []), ...(effective.refund !== "none" ? ["refund_review"] : [])])] }).where(and(tenantWhere(units, scope), eq(units.id, unit.id)));
    }
    return order.id;
  });
}
export async function workspaceData(db: Database, scope: Scope) {
  await verifyScope(db, scope);
  const [orderRows, lines, unitRows, inputRows, listingRows, mappingRows] = await Promise.all([
    db.select().from(orders).where(tenantWhere(orders, scope)).orderBy(desc(orders.createdAt)),
    db.select().from(lineItems).where(tenantWhere(lineItems, scope)), db.select().from(units).where(tenantWhere(units, scope)),
    db.select().from(customerInputs).where(tenantWhere(customerInputs, scope)).orderBy(desc(customerInputs.revision)),
    db.select().from(listings).where(tenantWhere(listings, scope)), db.select().from(mappings).where(tenantWhere(mappings, scope)),
  ]);
  return { orders: orderRows, lines, units: unitRows, inputs: inputRows, listings: listingRows, mappings: mappingRows };
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
    await tx.update(units).set({ revision: unit.revision + 1, contextAllocated: allocated, issues: triage(order.latestSnapshot, line.snapshot, mapping, answers, allocated, unit.sourceChanged) }).where(and(tenantWhere(units, scope), eq(units.id, unitId)));
    await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: "customer_input_corrected", resourceId: unitId });
  });
}
export async function configureMapping(db: Database, scope: Scope, listingId: string, variantKey: string, paused: boolean) {
  await db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    const [listing] = await tx.select().from(listings).where(and(tenantWhere(listings, scope), eq(listings.externalId, listingId)));
    if (!listing) throw new AccessDenied();
    const required = listing.snapshot.personalization.filter(p => p.required).map(p => ({ label: p.label, minimumLength: 1 }));
    await tx.insert(mappings).values({ organizationId: scope.organizationId, storeId: scope.storeId, listingExternalId: listingId, variantKey, label: listing.title, required, paused }).onConflictDoUpdate({ target: [mappings.organizationId, mappings.storeId, mappings.listingExternalId, mappings.variantKey], set: { required, paused } });
    const lines = await tx.select().from(lineItems).where(and(tenantWhere(lineItems, scope), eq(lineItems.listingExternalId, listingId), eq(lineItems.variantKey, variantKey)));
    for (const line of lines) {
      const [order] = await tx.select().from(orders).where(and(tenantWhere(orders, scope), eq(orders.id, line.orderId)));
      const ownedUnits = await tx.select().from(units).where(and(tenantWhere(units, scope), eq(units.lineItemId, line.id)));
      for (const unit of ownedUnits) {
        const [context] = await tx.select().from(customerInputs).where(and(tenantWhere(customerInputs, scope), eq(customerInputs.unitId, unit.id))).orderBy(desc(customerInputs.revision)).limit(1);
        await tx.update(units).set({ issues: triage(order.latestSnapshot, line.snapshot, { required, paused }, context.answers, unit.contextAllocated, unit.sourceChanged) }).where(and(tenantWhere(units, scope), eq(units.id, unit.id)));
      }
    }
    await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: paused ? "mapping_paused" : "mapping_configured", resourceId: listing.id });
  });
}
