import { and, eq, sql, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../db/client";
import { stores, connections, syncRuns, auditLogs } from "../db/schema";
import { tenantWhere, verifyScope, ingestListing, ingestOrder } from "../modules/intake/service";
import type { Scope } from "../modules/intake/contracts";
import type { EtsyIntakeAdapter } from "../modules/etsy/port";

export interface BackgroundJobs {
  enqueueSync(scope: Scope, commandKey: string): Promise<string>;
  runNext(adapter: EtsyIntakeAdapter): Promise<boolean>;
}
export class PostgresSyncJobs implements BackgroundJobs {
  constructor(private readonly db: Database) {}
  async enqueueSync(scope: Scope, commandKey: string) {
    if (!/^[A-Za-z0-9-]{10,100}$/.test(commandKey)) throw new Error("INVALID_COMMAND_KEY");
    return this.db.transaction(async tx => {
      await verifyScope(tx, scope, true);
      const [store] = await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
      const [connection] = await tx.select().from(connections).where(tenantWhere(connections, scope));
      if (connection.status !== "connected") throw new Error("CONNECT_STORE_FIRST");
      if (store.source !== "fixtures") throw new Error("LIVE_INTAKE_CONTRACT_NOT_VERIFIED");
      const [same] = await tx.select().from(syncRuns).where(and(tenantWhere(syncRuns, scope), eq(syncRuns.commandKey, commandKey)));
      if (same) return same.id;
      const [active] = await tx.select().from(syncRuns).where(and(tenantWhere(syncRuns, scope), sql`${syncRuns.status} in ('queued','running')`));
      if (active) return active.id;
      const [run] = await tx.insert(syncRuns).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, commandKey, connectionEpoch: connection.epoch }).onConflictDoNothing().returning();
      if (!run) throw new Error("SYNC_ALREADY_QUEUED");
      await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: "sync_requested", resourceId: run.id });
      return run.id;
    });
  }
  async runNext(adapter: EtsyIntakeAdapter) {
    const claim = randomUUID();
    const run = await this.db.transaction(async tx => {
      // Internal scheduler scan: only the worker can call this port; user queries never scan tenants.
      const [candidate] = await tx.select().from(syncRuns).where(sql`(${syncRuns.status} = 'queued' and ${syncRuns.availableAt} <= now()) or (${syncRuns.status} = 'running' and ${syncRuns.leaseUntil} < now())`).orderBy(asc(syncRuns.createdAt)).for("update", { skipLocked: true }).limit(1);
      if (!candidate) return undefined;
      const scope = { organizationId: candidate.organizationId, storeId: candidate.storeId, userId: candidate.actorId };
      if (candidate.attempts >= 3) {
        await tx.update(syncRuns).set({ status: "failed", errorCode: "RETRY_LIMIT", claim: null }).where(and(tenantWhere(syncRuns, scope), eq(syncRuns.id, candidate.id)));
        return undefined;
      }
      const [updated] = await tx.update(syncRuns).set({ status: "running", claim, attempts: candidate.attempts + 1, leaseUntil: new Date(Date.now() + 60000), errorCode: null }).where(and(tenantWhere(syncRuns, scope), eq(syncRuns.id, candidate.id))).returning();
      return updated;
    });
    if (!run) return false;
    const scope: Scope = { organizationId: run.organizationId, storeId: run.storeId, userId: run.actorId };
    const claimed = and(tenantWhere(syncRuns, scope), eq(syncRuns.id, run.id), eq(syncRuns.claim, claim), eq(syncRuns.status, "running"));
    try {
      await verifyScope(this.db, scope, true);
      const [store] = await this.db.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId)));
      if (store.source !== adapter.kind) throw new Error("WRONG_ADAPTER");
      const checkpoint = async (count: number) => {
        const updated = await this.db.update(syncRuns).set({ checkpoint: count, leaseUntil: new Date(Date.now() + 60000) }).where(claimed).returning({ id: syncRuns.id });
        if (!updated.length) throw new Error("SYNC_CLAIM_LOST");
      };
      // Replay the bounded import on retry; receipt upserts are idempotent, offset is diagnostic only.
      let count = 0;
      for await (const listing of adapter.listings(store.externalShopId ?? "900")) {
        await checkpoint(count); await ingestListing(this.db, scope, listing, run.connectionEpoch);
      }
      for await (const order of adapter.orders(store.externalShopId ?? "900", store.importSince)) {
        await checkpoint(count); await ingestOrder(this.db, scope, order, { epoch: run.connectionEpoch }); await checkpoint(++count);
      }
      await this.db.transaction(async tx => {
        await verifyScope(tx, scope, true);
        await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
        const changed = await tx.update(syncRuns).set({ status: "succeeded", claim: null, leaseUntil: null }).where(claimed).returning({ id: syncRuns.id });
        if (!changed.length) throw new Error("SYNC_CLAIM_LOST");
        await tx.update(connections).set({ lastSyncAt: new Date() }).where(and(tenantWhere(connections, scope), eq(connections.epoch, run.connectionEpoch), eq(connections.status, "connected")));
      });
    } catch (error) {
      const code = error instanceof Error && ["CONNECTION_CHANGED", "LIVE_INTAKE_CONTRACT_NOT_VERIFIED", "WRONG_ADAPTER", "SYNC_CLAIM_LOST"].includes(error.message) ? error.message : "SYNC_FAILED";
      const terminal = code !== "SYNC_FAILED" || run.attempts >= 3;
      await this.db.update(syncRuns).set({ status: terminal ? "failed" : "queued", errorCode: code, claim: null, leaseUntil: null, availableAt: new Date(Date.now() + 1000 * 2 ** run.attempts) }).where(claimed);
    }
    return true;
  }
}
