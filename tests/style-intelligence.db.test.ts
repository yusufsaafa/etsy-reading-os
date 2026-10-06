import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as s from "../src/db/schema";
import { authorizeStore, createWorkspace } from "../src/modules/identity/service";
import type { Scope } from "../src/modules/intake/contracts";
import { addPreviousWork, editStyle, removePreviousWork, applyStyle, saveSellerProfile } from "../src/modules/seller-style/service";
import { sellerProductionContext } from "../src/modules/seller-style/context";
import { assembleInstructions } from "../src/modules/generation/instructions";
import { stableJson } from "../src/modules/intake/contracts";
import { createHash } from "node:crypto";
import type { GenerationContext } from "../src/modules/generation/contracts";
import * as api from "../src/modules/seller-style/analysis-service";
import { intelligence } from "./style-intelligence.fixture";
let pg: PGlite, db: Database, a: Scope, b: Scope, profile: string, ids: string[];
beforeEach(async () => {
 pg = new PGlite();
 for (const file of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync("drizzle/" + file, "utf8"));
 db = drizzle(pg, { schema: s }) as unknown as Database;
 for (const userId of ["analysis-a", "analysis-b"]) await db.insert(s.users).values({ id: userId, name: userId });
 a = await authorizeStore(db, "analysis-a", await createWorkspace(db, "analysis-a", "A", "fixtures"));
 b = await authorizeStore(db, "analysis-b", await createWorkspace(db, "analysis-b", "B", "fixtures"));
 profile = (await editStyle(db, a)).styleProfileId;
 ids = [];
 for (const title of ["A", "B", "C"]) ids.push(await addPreviousWork(db, a, { title, text: "Synthetic writing evidence", commandKey: randomUUID() }));
}, 20000);
afterEach(async () => { vi.restoreAllMocks(); await pg.close(); });
const shell = (sourceIds = ids.slice(0, 2)) => api.createStyleAnalysisVersion(db, a, { styleProfileId: profile, sourceIds });
const complete = (id: string) => api.completeStyleAnalysisVersion(db, a, id, { payload: intelligence(), aiRequestId: null });
it("migration replays; analysis numbering is independent and selected sources are exact", async () => {
 const v1 = await shell(), v2 = await shell([ids[2]]);
 expect([v1.versionNumber, v2.versionNumber]).toEqual([1, 2]);
 expect(v1.status).toBe("PENDING"); expect(v1.payload).toBeNull();
 expect((await api.styleAnalysisSourceProvenance(db, a, v1.id)).map(x => x.sourceId).sort()).toEqual(ids.slice(0, 2).sort());
 expect((await api.styleAnalysisSourceProvenance(db, a, v1.id))[0].contentHash).toHaveLength(64);
 expect(await api.latestUsableStyleAnalysis(db, a, profile)).toBeUndefined();
 expect((await api.latestStyleAnalysisAttempt(db, a, profile))?.id).toBe(v2.id);
});
it("source membership freezes at admission; added sources never alter previous provenance", async () => {
 const v = await shell();
 await addPreviousWork(db, a, { title: "D", text: "New evidence", commandKey: randomUUID() });
 await expect(db.insert(s.styleAnalysisSources).values({ organizationId: a.organizationId, storeId: a.storeId, analysisVersionId: v.id, sourceId: ids[2] })).rejects.toThrow();
 await expect(db.update(s.styleAnalysisSources).set({ sourceId: ids[2] }).where(eq(s.styleAnalysisSources.analysisVersionId, v.id))).rejects.toThrow();
 await expect(db.delete(s.styleAnalysisSources).where(eq(s.styleAnalysisSources.analysisVersionId, v.id))).rejects.toThrow();
 await expect(removePreviousWork(db, a, ids[0])).rejects.toThrow();
 expect((await api.styleAnalysisSourceProvenance(db, a, v.id)).map(x => x.sourceId).sort()).toEqual(ids.slice(0, 2).sort());
 await removePreviousWork(db, a, ids[2]); // Unreferenced source deletion remains available.
});
it("completed payload, identity, schema, AI reference and history cannot mutate or delete", async () => {
 const v = await shell(); await api.markStyleAnalysisAnalyzing(db, a, v.id); const ready = await complete(v.id);
 expect(ready.status).toBe("READY"); expect(ready.startedAt).not.toBeNull(); expect(ready.completedAt).not.toBeNull();
 for (const patch of [{ payload: { ...intelligence(), voiceSummary: "Changed" } }, { contractVersion: "v2" }, { versionNumber: 2 }, { aiRequestId: randomUUID() }, { status: "FAILED", payload: null, failureCode: "INTERNAL_FAILURE" }]) await expect(db.update(s.styleAnalysisVersions).set(patch).where(eq(s.styleAnalysisVersions.id, v.id))).rejects.toThrow();
 await expect(db.delete(s.styleAnalysisVersions).where(eq(s.styleAnalysisVersions.id, v.id))).rejects.toThrow();
 await expect(complete(v.id)).rejects.toThrow("INVALID_ANALYSIS_TRANSITION");
 await expect(api.failStyleAnalysisVersion(db, a, v.id, "INTERNAL_FAILURE")).rejects.toThrow();
});
it("latest incomplete/failed attempt preserves last usable version; future completion advances usable", async () => {
 const v1 = await shell(); await complete(v1.id);
 const v2 = await shell(); expect((await api.latestUsableStyleAnalysis(db, a, profile))?.id).toBe(v1.id);
 await api.markStyleAnalysisAnalyzing(db, a, v2.id); await api.failStyleAnalysisVersion(db, a, v2.id, "PROVIDER_FAILURE");
 expect((await api.latestStyleAnalysisAttempt(db, a, profile))?.id).toBe(v2.id);
 expect((await api.latestUsableStyleAnalysis(db, a, profile))?.id).toBe(v1.id);
 await expect(api.markStyleAnalysisAnalyzing(db, a, v2.id)).rejects.toThrow();
 const v3 = await shell(ids); await complete(v3.id);
 expect(v3.versionNumber).toBe(3); expect((await api.latestUsableStyleAnalysis(db, a, profile))?.id).toBe(v3.id);
});
it("reads and all mutations reject foreign analyses and forged scopes; latest usable cannot leak", async () => {
 const v = await shell(); await complete(v.id);
 await expect(api.styleAnalysisVersion(db, b, v.id)).rejects.toThrow();
 await expect(api.styleAnalysisSourceProvenance(db, b, v.id)).rejects.toThrow();
 await expect(api.completeStyleAnalysisVersion(db, b, v.id, { payload: intelligence(), aiRequestId: null })).rejects.toThrow();
 await expect(api.failStyleAnalysisVersion(db, b, v.id, "CANCELED")).rejects.toThrow();
 await expect(api.markStyleAnalysisAnalyzing(db, b, v.id)).rejects.toThrow();
 expect(await api.latestUsableStyleAnalysis(db, b, profile)).toBeUndefined();
 expect(await api.latestStyleAnalysisAttempt(db, b, profile)).toBeUndefined();
 await expect(api.latestUsableStyleAnalysis(db, { ...a, userId: b.userId }, profile)).rejects.toThrow();
 await expect(api.createStyleAnalysisVersion(db, { ...a, userId: b.userId }, { styleProfileId: profile, sourceIds: ids })).rejects.toThrow();
});
it("application and DB reject foreign sources including another Store in the same organization", async () => {
 const otherProfile = (await editStyle(db, b)).styleProfileId;
 const foreign = await addPreviousWork(db, b, { title: "Foreign", text: "Synthetic", commandKey: randomUUID() });
 await expect(shell([foreign])).rejects.toThrow();
 await expect(api.createStyleAnalysisVersion(db, b, { styleProfileId: profile, sourceIds: [foreign] })).rejects.toThrow();
 const secondStore = randomUUID();
 await db.insert(s.stores).values({ id: secondStore, organizationId: a.organizationId, name: "Second", importSince: new Date() });
 const sameTenant = { ...a, storeId: secondStore };
 const other = await addPreviousWork(db, sameTenant, { title: "Other store", text: "Synthetic", commandKey: randomUUID() });
 await expect(shell([other])).rejects.toThrow();
 for (const sourceId of [foreign, other, randomUUID()]) await expect(db.transaction(async tx => {
  const [v] = await tx.insert(s.styleAnalysisVersions).values({ organizationId: a.organizationId, storeId: a.storeId, styleProfileId: profile, versionNumber: 1, contractVersion: "style-intelligence/v1", operationVersion: "style-analysis/v1" }).returning();
  await tx.insert(s.styleAnalysisSources).values({ organizationId: a.organizationId, storeId: a.storeId, analysisVersionId: v.id, sourceId });
 })).rejects.toThrow();
 await expect(db.insert(s.styleAnalysisVersions).values({ organizationId: a.organizationId, storeId: a.storeId, styleProfileId: otherProfile, versionNumber: 1, contractVersion: "style-intelligence/v1", operationVersion: "style-analysis/v1" })).rejects.toThrow();
});
it("invalid completion rolls back; DB validates strict payloads and cannot commit unsealed shells", async () => {
 const v = await shell();
 for (const payload of [{ ...intelligence(), customerName: "private" }, { ...intelligence(), tone: Array(7).fill("x") }, { ...intelligence(), voiceSummary: "x".repeat(601) }, { ...intelligence(), structure: { ...intelligence().structure, question: "private" } }]) {
  await expect(api.completeStyleAnalysisVersion(db, a, v.id, { payload, aiRequestId: null })).rejects.toThrow();
  await expect(db.update(s.styleAnalysisVersions).set({ status: "READY", payload, completedAt: new Date() }).where(eq(s.styleAnalysisVersions.id, v.id))).rejects.toThrow();
 }
 expect((await api.styleAnalysisVersion(db, a, v.id)).status).toBe("PENDING");
 await expect(db.insert(s.styleAnalysisVersions).values({ organizationId: a.organizationId, storeId: a.storeId, styleProfileId: profile, versionNumber: 2, contractVersion: "style-intelligence/v1", operationVersion: "style-analysis/v1" })).rejects.toThrow();
 await expect(api.completeStyleAnalysisVersion(db, a, v.id, { payload: intelligence(), aiRequestId: randomUUID() })).rejects.toThrow();
});
it("source creation has no analysis trigger; domain operations require zero provider/accounting calls", async () => {
 const fetch = vi.spyOn(globalThis, "fetch");
 expect(await db.select().from(s.styleAnalysisVersions)).toHaveLength(0);
 const v = await shell(); await complete(v.id); const failed = await shell(); await api.failStyleAnalysisVersion(db, a, failed.id, "CANCELED");
 expect(await db.select().from(s.aiRequests)).toHaveLength(0); expect(await db.select().from(s.usageEvents)).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
 const audits = await db.select().from(s.auditLogs); expect(JSON.stringify(audits)).not.toContain(intelligence().voiceSummary);
});
it("seller production context, generation input hash and prompt remain identical after analysis", async () => {
 await saveSellerProfile(db, a, { displayName: "Writer", shortBio: "" });
 const [draft] = await db.select().from(s.styleVersions).where(eq(s.styleVersions.styleProfileId, profile));
 await applyStyle(db, a, draft.id, 0, { tone: "WARM", detail: "BALANCED", approach: "STRUCTURED", preferredExpressions: [], avoidExpressions: [], instructions: "" });
 const before = await sellerProductionContext(db, a);
 if (!before.ready) throw new Error("Fixture not ready");
 const context = { seller: before.seller, style: before.style, product: { configuration: { sections: [{ id: "intro", title: "Introduction", instruction: "Welcome" }] } }, customer: { answers: [] } } as unknown as GenerationContext;
 const hash = createHash("sha256").update(stableJson(context)).digest("hex"), prompt = assembleInstructions(context);
 const v = await shell(); await complete(v.id); const failed = await shell(); await api.failStyleAnalysisVersion(db, a, failed.id, "INTERNAL_FAILURE");
 const after = await sellerProductionContext(db, a); expect(after).toEqual(before);
 if (!after.ready) throw new Error("Fixture not ready");
 const later = { ...context, seller: after.seller, style: after.style } as unknown as GenerationContext;
 expect(createHash("sha256").update(stableJson(later)).digest("hex")).toBe(hash); expect(assembleInstructions(later)).toEqual(prompt);
});
it("AI provenance reuses owned request metadata, rejects wrong operation/status/store", async () => {
 const { pricingFor } = await import("../src/infrastructure/ai/pricing");
 async function request(scope: Scope, operation: string, status: string) {
  return db.transaction(async tx => {
  const [r] = await tx.insert(s.aiRequests).values({ organizationId: scope.organizationId, storeId: scope.storeId, attemptNumber: 1, commandKey: randomUUID(), commandHash: "a".repeat(64), operation, provider: "google", model: "gemini-3.5-flash-lite", resolvedModel: "gemini-3.5-flash-lite-001", status, pricing: pricingFor("google", "gemini-3.5-flash-lite"), reservedNanos: 0n }).returning();
  await tx.insert(s.usageEvents).values({ organizationId: scope.organizationId, storeId: scope.storeId, aiRequestId: r.id, operation });
  return r;
  });
 }
 const v = await shell();
 for (const r of [await request(b, "style-analysis/v1", "SUCCEEDED"), await request(a, "generation", "SUCCEEDED"), await request(a, "style-analysis/v1", "CLAIMED")]) {
  await expect(api.completeStyleAnalysisVersion(db, a, v.id, { payload: intelligence(), aiRequestId: r.id })).rejects.toThrow();
 }
 const r = await request(a, "style-analysis/v1", "SUCCEEDED");
 const ready = await api.completeStyleAnalysisVersion(db, a, v.id, { payload: intelligence(), aiRequestId: r.id });
 expect(ready.aiRequestId).toBe(r.id);
 expect(await db.select().from(s.usageEvents)).toHaveLength(4);
});
it("owner mutations and atomic rollback preserve deterministic allocation without partial membership", async () => {
 await db.insert(s.users).values({ id: "analysis-operator", name: "Operator" });
 await db.insert(s.memberships).values({ organizationId: a.organizationId, userId: "analysis-operator", role: "operator" });
 const operator = { ...a, userId: "analysis-operator" }, v = await shell();
 expect((await api.styleAnalysisVersion(db, operator, v.id)).id).toBe(v.id);
 await expect(api.createStyleAnalysisVersion(db, operator, { styleProfileId: profile, sourceIds: ids })).rejects.toThrow();
 await expect(api.completeStyleAnalysisVersion(db, operator, v.id, { payload: intelligence(), aiRequestId: null })).rejects.toThrow();
 await pg.exec("CREATE FUNCTION fail_analysis_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='style_analysis_created' THEN RAISE EXCEPTION 'TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_analysis_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_analysis_audit();");
 await expect(shell()).rejects.toThrow();
 expect(await db.select().from(s.styleAnalysisVersions)).toHaveLength(1);
 expect(await db.select().from(s.styleAnalysisSources)).toHaveLength(2);
 await pg.exec("DROP TRIGGER reject_analysis_audit ON audit_logs;");
 expect((await shell()).versionNumber).toBe(2);
});
