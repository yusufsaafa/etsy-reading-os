import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client";
import { stores, connections, listings, listingSelections, syncRuns, auditLogs, mappings, products, productVersions } from "../../db/schema";
import { createWorkspace, findUserStore as userStore } from "../identity/service";
import { tenantWhere, verifyScope } from "../intake/service";
import type { Scope } from "../intake/contracts";
import type { BackgroundJobs } from "../../infrastructure/jobs";

export { userStore };
import { resolveSellerDestination } from "./destination";
export async function onboardingDestination(db: DbExecutor, userId: string) {
  return (await resolveSellerDestination(db, userId)).path;
}
export async function createOnboardingStore(db: Database, userId: string, rawName: unknown, source: "etsy" | "fixtures") {
  const name = z.string().trim().min(1).max(100).parse(rawName);
  return createWorkspace(db, userId, name, source, "etsy");
}
export function connectionPresentation(status: string, expiresAt: Date | null, now = new Date()) {
  if (status === "reauthorization_required") return { kind: "expired", label: "Reconnect Etsy" } as const;
  // An expired access token may still be refreshable; do not claim the entire grant is revoked.
  if (status === "connected" && expiresAt && expiresAt <= now) return { kind: "expired", label: "Etsy connection needs attention" } as const;
  return status === "connected" ? { kind: "connected", label: "Etsy connected" } as const : { kind: "disconnected", label: "Not connected" } as const;
}
export async function onboardingData(db: DbExecutor, scope: Scope) {
  await verifyScope(db, scope);
  const [store] = await db.select({ name: stores.name, source: stores.source, stage: stores.onboardingStage, externalShopId: stores.externalShopId }).from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId)));
  const [connection] = await db.select({ status: connections.status, expiresAt: connections.expiresAt, lastSyncAt: connections.lastSyncAt, epoch: connections.epoch }).from(connections).where(tenantWhere(connections, scope));
  const products = await db.select({ externalId: listings.externalId, title: listings.title, state: listings.state }).from(listings).where(tenantWhere(listings, scope)).orderBy(asc(listings.title));
  const selected = await db.select({ externalId: listingSelections.listingExternalId }).from(listingSelections).where(tenantWhere(listingSelections, scope));
  const [importRun] = await db.select({ status: syncRuns.status }).from(syncRuns).where(and(tenantWhere(syncRuns, scope), eq(syncRuns.connectionEpoch, connection.epoch))).orderBy(desc(syncRuns.createdAt)).limit(1);
  return { store, connection: { ...connectionPresentation(connection.status, connection.expiresAt), lastSyncAt: connection.lastSyncAt }, products, selected: selected.map(p => p.externalId), importStatus: importRun?.status ?? "not_started" };
}
// Replays use a server-derived connection identity, never a browser-supplied tenant or job key.
export async function startProductImport(db: Database, jobs: Pick<BackgroundJobs, "enqueueSync">, scope: Scope) {
  await verifyScope(db, scope, true);
  const [connection] = await db.select({ status: connections.status, epoch: connections.epoch }).from(connections).where(tenantWhere(connections, scope));
  if (connection.status !== "connected") throw new Error("CONNECT_STORE_FIRST");
  const id = await jobs.enqueueSync(scope, `onboarding-${scope.storeId}-${connection.epoch}`);
  await db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    const [current] = await tx.select({ status: connections.status, epoch: connections.epoch }).from(connections).where(tenantWhere(connections, scope));
    if (current.status !== "connected" || current.epoch !== connection.epoch) throw new Error("CONNECTION_CHANGED");
    await tx.update(stores).set({ onboardingStage: "products" }).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId), eq(stores.onboardingStage, "etsy")));
  });
  return id;
}
export async function saveProductSelection(db: Database, scope: Scope, rawIds: unknown) {
  const ids = [...new Set(z.array(z.string().min(1).max(100)).min(1).max(1000).parse(rawIds))];
  return db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    const [store] = await tx.select({ stage: stores.onboardingStage }).from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    if (!["products", "product_setup"].includes(store.stage)) throw new Error("PRODUCT_SELECTION_UNAVAILABLE");
    const [connection] = await tx.select({ status: connections.status }).from(connections).where(tenantWhere(connections, scope));
    if (connection.status !== "connected") throw new Error("CONNECT_STORE_FIRST");
    const owned = await tx.select({ id: listings.externalId }).from(listings).where(and(tenantWhere(listings, scope), inArray(listings.externalId, ids), eq(listings.state, "active"))).for("share");
    if (owned.length !== ids.length) throw new Error("PRODUCT_UNAVAILABLE");
    const existing = await tx.select({ id: listingSelections.listingExternalId }).from(listingSelections).where(tenantWhere(listingSelections, scope));
    const changed = existing.length !== ids.length || existing.some(p => !ids.includes(p.id));
    if (changed) {
      await tx.delete(listingSelections).where(tenantWhere(listingSelections, scope));
      await tx.insert(listingSelections).values(ids.map(listingExternalId => ({ organizationId: scope.organizationId, storeId: scope.storeId, listingExternalId, selectedBy: scope.userId }))).onConflictDoNothing();
      await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: "products_selected" });
    }
    await tx.update(stores).set({ onboardingStage: "product_setup" }).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId)));
    return ids.length;
  });
}

// Completion is an explicit server command; choosing products never satisfies this gate.
export async function completeProductOnboarding(db: Database, scope: Scope) {
  return db.transaction(async tx=>{
    await verifyScope(tx,scope,true);
    const [store]=await tx.select().from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
    if(store.onboardingStage==="complete") return;
    const [ready]=await tx.select({id:products.id}).from(listingSelections)
      .innerJoin(mappings,and(eq(mappings.organizationId,listingSelections.organizationId),eq(mappings.storeId,listingSelections.storeId),eq(mappings.listingExternalId,listingSelections.listingExternalId)))
      .innerJoin(products,and(eq(products.organizationId,mappings.organizationId),eq(products.storeId,mappings.storeId),eq(products.id,mappings.productId)))
      .innerJoin(productVersions,and(eq(productVersions.organizationId,products.organizationId),eq(productVersions.storeId,products.storeId),eq(productVersions.productId,products.id),eq(productVersions.id,products.activeVersionId)))
      .where(and(tenantWhere(listingSelections,scope),eq(productVersions.status,"ACTIVE"),eq(mappings.paused,false))).limit(1);
    if(!ready) throw new Error("ACTIVATE_ONE_SELECTED_PRODUCT");
    await tx.update(stores).set({onboardingStage:"complete"}).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId)));
    await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action:"product_onboarding_completed",resourceId:ready.id});
  });
}
