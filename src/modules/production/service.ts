import { and, eq } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client";
import { productionQueue, generations, units, stores, orders, auditLogs } from "../../db/schema";
import type { Scope } from "../intake/contracts";
import { tenantWhere, verifyScope } from "../intake/service";
import { AccessDenied } from "../identity/service";
import { buildGenerationContext } from "../generation/context";
import { AdmissionError } from "../generation/contracts";
import { productionPolicy } from "../products/contracts";

// Internal application boundary: caller has authorized scope and holds the Store lock.
// No provider, gateway, GenerationService, prompt, or Generation writes belong here.
export async function admitReadingInTransaction(tx: DbExecutor, scope: Scope, unitId: string) {
  await verifyScope(tx, scope);
  const [unit] = await tx.select().from(units).where(and(tenantWhere(units,scope),eq(units.id,unitId)));
  if (!unit) throw new AccessDenied();
  const [existing] = await tx.select().from(productionQueue).where(and(tenantWhere(productionQueue,scope),eq(productionQueue.unitId,unitId)));
  if (existing) return { outcome: "already_queued" as const, item: existing };
  const [generation] = await tx.select({id:generations.id}).from(generations).where(and(tenantWhere(generations,scope),eq(generations.unitId,unitId))).limit(1);
  // Existing work belongs to manual retry/review, never a second automatic operation.
  if (generation) return { outcome: "ineligible" as const };
  let context;
  try { context = await buildGenerationContext(tx,scope,unitId,false); }
  catch (error) { if (error instanceof AdmissionError) return { outcome: "ineligible" as const }; throw error; }
  const policy = productionPolicy(context.product.configuration);
  if (policy.automation !== "ASSISTED") return { outcome: "manual" as const };
  const [order] = await tx.select({createdAt:orders.createdAt}).from(orders).where(and(tenantWhere(orders,scope),eq(orders.id,context.orderId)));
  const [item] = await tx.insert(productionQueue).values({organizationId:scope.organizationId,storeId:scope.storeId,unitId,
    productVersionId:context.product.id,priorityClass:policy.priorityClass,targetCompletionMinutes:policy.targetCompletionMinutes,
    targetDeadline:policy.targetCompletionMinutes===null?null:new Date(order.createdAt.getTime()+policy.targetCompletionMinutes*60000),
  }).onConflictDoNothing({target:[productionQueue.organizationId,productionQueue.storeId,productionQueue.unitId]}).returning();
  if (!item) {
    const [winner] = await tx.select().from(productionQueue).where(and(tenantWhere(productionQueue,scope),eq(productionQueue.unitId,unitId)));
    return { outcome: "already_queued" as const, item: winner };
  }
  await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action:"reading_preparation_admitted",resourceId:item.id});
  return { outcome: "queued" as const, item };
}
export async function admitReading(db: Database, scope: Scope, unitId: string) {
  return db.transaction(async tx => {
    await verifyScope(tx,scope,true);
    await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
    return admitReadingInTransaction(tx,scope,unitId);
  });
}
// Internal reconciliation for setup/hold transitions, under the caller's Store lock.
export async function reconcileProductionInTransaction(tx: DbExecutor, scope: Scope) {
  const candidates = await tx.select({id:units.id}).from(units).where(tenantWhere(units,scope));
  let queued=0;
  for (const unit of candidates) if ((await admitReadingInTransaction(tx,scope,unit.id)).outcome === "queued") queued++;
  return {scanned:candidates.length,queued};
}
// Explicit owner-scoped repair command. Never invoked by page reads; never executes work.
export async function reconcileProduction(db: Database, scope: Scope) {
  await verifyScope(db,scope,true);
  const candidates = await db.select({id:units.id}).from(units).where(tenantWhere(units,scope));
  let queued=0;
  for (const unit of candidates) if ((await admitReading(db,scope,unit.id)).outcome === "queued") queued++;
  return { scanned:candidates.length, queued };
}
export async function readQueueItem(db: DbExecutor, scope: Scope, itemId: string) {
  await verifyScope(db,scope);
  const [item] = await db.select().from(productionQueue).where(and(tenantWhere(productionQueue,scope),eq(productionQueue.id,itemId)));
  if (!item) throw new AccessDenied();
  return item;
}
