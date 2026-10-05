import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { connections, listingSelections, stores } from "../../db/schema";
import { findUserStore, authorizeStore } from "../identity/service";
export type SellerDestination = { kind: "PUBLIC" | "STORE_SETUP" | "ETSY_CONNECTION" | "PRODUCT_SELECTION" | "PRODUCT_SETUP" | "OPERATIONS_HOME"; path: string };
export async function resolveSellerDestination(db: DbExecutor | undefined, userId?: string): Promise<SellerDestination> {
  if (!userId) return { kind: "PUBLIC", path: "/" };
  if (!db) throw new Error("DATABASE_REQUIRED");
  const store = await findUserStore(db, userId);
  if (!store) return { kind: "STORE_SETUP", path: "/onboarding/store" };
  const scope = await authorizeStore(db, userId, store.id);
  // Completion is explicit persisted product-setup state, never inferred from selection alone.
  if (store.stage === "complete") return { kind: "OPERATIONS_HOME", path: "/" };
  const owned = and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId));
  const [connection] = await db.select({ status: connections.status, expiresAt: connections.expiresAt }).from(connections).innerJoin(stores, and(eq(stores.id, connections.storeId), eq(stores.organizationId, connections.organizationId))).where(owned);
  if (!connection || connection.status !== "connected" || connection.expiresAt && connection.expiresAt <= new Date()) return { kind: "ETSY_CONNECTION", path: "/onboarding/etsy" };
  const [selection] = await db.select({ id: listingSelections.id }).from(listingSelections).where(and(eq(listingSelections.organizationId, scope.organizationId), eq(listingSelections.storeId, scope.storeId))).limit(1);
  return selection ? { kind: "PRODUCT_SETUP", path: "/onboarding/products/setup" } : { kind: "PRODUCT_SELECTION", path: "/onboarding/products" };
}
