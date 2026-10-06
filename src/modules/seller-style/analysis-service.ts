import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client";
import { auditLogs, stores, styleProfiles, styleSources, styleAnalysisVersions as versions, styleAnalysisSources as sources } from "../../db/schema";
import { AccessDenied } from "../identity/service";
import type { Scope } from "../intake/contracts";
import { tenantWhere, verifyScope } from "../intake/service";
import { analysisSelection, analysisCompletion, analysisFailure, STYLE_INTELLIGENCE_CONTRACT, STYLE_ANALYSIS_OPERATION } from "./analysis-contracts";

async function lock(tx: DbExecutor, scope: Scope) {
  await verifyScope(tx, scope, true);
  await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
}
async function audit(tx: DbExecutor, scope: Scope, action: string, resourceId: string) {
  await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action, resourceId });
}
async function ownedVersion(db: DbExecutor, scope: Scope, versionId: string) {
  z.string().uuid().parse(versionId);
  const [version] = await db.select().from(versions).where(and(tenantWhere(versions, scope), eq(versions.id, versionId)));
  if (!version) throw new AccessDenied();
  return version;
}
// Source selection is explicit and frozen atomically; never loads/analyzes source text.
export async function createStyleAnalysisVersion(db: Database, scope: Scope, raw: unknown) {
  const selection = analysisSelection.parse(raw);
  return db.transaction(async tx => {
    await lock(tx, scope);
    const [profile] = await tx.select({ id: styleProfiles.id }).from(styleProfiles).where(and(tenantWhere(styleProfiles, scope), eq(styleProfiles.id, selection.styleProfileId)));
    if (!profile) throw new AccessDenied();
    const selected = await tx.select({ id: styleSources.id }).from(styleSources).where(and(tenantWhere(styleSources, scope), inArray(styleSources.id, selection.sourceIds)));
    if (selected.length !== selection.sourceIds.length) throw new AccessDenied();
    const [latest] = await tx.select({ number: versions.versionNumber }).from(versions).where(and(tenantWhere(versions, scope), eq(versions.styleProfileId, profile.id))).orderBy(desc(versions.versionNumber)).limit(1);
    const [shell] = await tx.insert(versions).values({ organizationId: scope.organizationId, storeId: scope.storeId, styleProfileId: profile.id, versionNumber: (latest?.number ?? 0) + 1, contractVersion: STYLE_INTELLIGENCE_CONTRACT, operationVersion: STYLE_ANALYSIS_OPERATION }).returning();
    await tx.insert(sources).values(selection.sourceIds.map(sourceId => ({ organizationId: scope.organizationId, storeId: scope.storeId, analysisVersionId: shell.id, sourceId })));
    const [pending] = await tx.update(versions).set({ status: "PENDING" }).where(and(tenantWhere(versions, scope), eq(versions.id, shell.id))).returning();
    await audit(tx, scope, "style_analysis_created", shell.id);
    return pending;
  });
}
export async function markStyleAnalysisAnalyzing(db: Database, scope: Scope, versionId: string) {
  return db.transaction(async tx => {
    await lock(tx, scope);
    const version = await ownedVersion(tx, scope, versionId);
    if (version.status !== "PENDING") throw new Error("INVALID_ANALYSIS_TRANSITION");
    const [saved] = await tx.update(versions).set({ status: "ANALYZING", startedAt: new Date() }).where(and(tenantWhere(versions, scope), eq(versions.id, versionId))).returning();
    await audit(tx, scope, "style_analysis_started", versionId);
    return saved;
  });
}
export async function completeStyleAnalysisVersion(db: Database, scope: Scope, versionId: string, raw: unknown) {
  const completion = analysisCompletion.parse(raw);
  return db.transaction(async tx => {
    await lock(tx, scope);
    const version = await ownedVersion(tx, scope, versionId);
    if (!["PENDING", "ANALYZING"].includes(version.status)) throw new Error("INVALID_ANALYSIS_TRANSITION");
    const [saved] = await tx.update(versions).set({ status: "READY", payload: completion.payload, aiRequestId: completion.aiRequestId, completedAt: new Date() }).where(and(tenantWhere(versions, scope), eq(versions.id, versionId))).returning();
    await audit(tx, scope, "style_analysis_completed", versionId);
    return saved;
  });
}
export async function failStyleAnalysisVersion(db: Database, scope: Scope, versionId: string, raw: unknown) {
  const failureCode = analysisFailure.parse(raw);
  return db.transaction(async tx => {
    await lock(tx, scope);
    const version = await ownedVersion(tx, scope, versionId);
    if (!["PENDING", "ANALYZING"].includes(version.status)) throw new Error("INVALID_ANALYSIS_TRANSITION");
    const [saved] = await tx.update(versions).set({ status: "FAILED", failureCode, completedAt: new Date() }).where(and(tenantWhere(versions, scope), eq(versions.id, versionId))).returning();
    await audit(tx, scope, "style_analysis_failed", versionId);
    return saved;
  });
}
export async function styleAnalysisVersion(db: DbExecutor, scope: Scope, versionId: string) {
  await verifyScope(db, scope);
  return ownedVersion(db, scope, versionId);
}
async function latest(db: DbExecutor, scope: Scope, styleProfileId: string, usable: boolean) {
  await verifyScope(db, scope);
  z.string().uuid().parse(styleProfileId);
  const [version] = await db.select().from(versions).where(and(tenantWhere(versions, scope), eq(versions.styleProfileId, styleProfileId), usable ? eq(versions.status, "READY") : undefined)).orderBy(desc(versions.versionNumber)).limit(1);
  return version;
}
export const latestStyleAnalysisAttempt = (db: DbExecutor, scope: Scope, styleProfileId: string) => latest(db, scope, styleProfileId, false);
export const latestUsableStyleAnalysis = (db: DbExecutor, scope: Scope, styleProfileId: string) => latest(db, scope, styleProfileId, true);
export async function styleAnalysisSourceProvenance(db: DbExecutor, scope: Scope, versionId: string) {
  await verifyScope(db, scope);
  await ownedVersion(db, scope, versionId);
  return db.select({ sourceId: sources.sourceId, contentHash: styleSources.contentHash, sourceType: styleSources.sourceType, createdAt: styleSources.createdAt }).from(sources)
    .innerJoin(styleSources, and(eq(sources.sourceId, styleSources.id), eq(sources.organizationId, styleSources.organizationId), eq(sources.storeId, styleSources.storeId)))
    .where(and(tenantWhere(sources, scope), eq(sources.analysisVersionId, versionId))).orderBy(sources.sourceId);
}
