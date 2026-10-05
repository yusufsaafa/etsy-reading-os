import { and, asc, eq } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client";
import { memberships, organizations, stores, users, connections, auditLogs } from "../../db/schema";
import type { Scope } from "../intake/contracts";
export class AccessDenied extends Error { constructor() { super("Resource unavailable"); } }
export async function authorizeStore(db: DbExecutor, userId: string, storeId: string, ownerOnly = false): Promise<Scope> {
  const [row] = await db.select({ organizationId: stores.organizationId, role: memberships.role }).from(stores).innerJoin(memberships, and(eq(memberships.organizationId, stores.organizationId), eq(memberships.userId, userId))).where(eq(stores.id, storeId));
  if (!row || (ownerOnly && row.role !== "owner")) throw new AccessDenied();
  return { userId, organizationId: row.organizationId, storeId };
}
export async function createWorkspace(db: Database, userId: string, name: string, source: "fixtures" | "etsy", onboardingStage: "complete" | "etsy" = "complete") {
  return db.transaction(async tx => {
    // Lock the signed-in user to serialize duplicate onboarding submissions.
    await tx.select().from(users).where(eq(users.id, userId)).for("update");
    const [existing] = await tx.select({ id: stores.id }).from(stores).innerJoin(memberships, eq(memberships.organizationId, stores.organizationId)).where(eq(memberships.userId, userId));
    if (existing) return existing.id;
    const [organization] = await tx.insert(organizations).values({ name }).returning();
    await tx.insert(memberships).values({ organizationId: organization.id, userId, role: "owner" });
    const [store] = await tx.insert(stores).values({ organizationId: organization.id, name, source, onboardingStage, importSince: new Date(Date.now() - 30 * 86400000) }).returning();
    await tx.insert(connections).values({ organizationId: organization.id, storeId: store.id });
    await tx.insert(auditLogs).values({ organizationId: organization.id, storeId: store.id, actorId: userId, action: "workspace_created" });
    return store.id;
  });
}

export async function findUserStore(db: DbExecutor, userId: string) {
  const [store] = await db.select({ id: stores.id, stage: stores.onboardingStage }).from(stores)
    .innerJoin(memberships, and(eq(memberships.organizationId, stores.organizationId), eq(memberships.userId, userId))).orderBy(asc(stores.createdAt)).limit(1);
  return store;
}
