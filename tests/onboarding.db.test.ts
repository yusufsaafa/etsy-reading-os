import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { registerDevelopmentAccount, authenticateDevelopmentAccount } from "../src/modules/identity/accounts";
import { resolveSellerDestination } from "../src/modules/onboarding/destination";
import { authorizeStore, createWorkspace } from "../src/modules/identity/service";
import { createOnboardingStore, onboardingDestination, onboardingData, startProductImport, saveProductSelection } from "../src/modules/onboarding/service";
import { ingestListing, tenantWhere } from "../src/modules/intake/service";
import { fixtureListings, FixtureEtsyAdapter } from "../src/modules/etsy/fixtures";
import { connectFixtures, disconnect } from "../src/modules/etsy/connection-service";
import { PostgresSyncJobs } from "../src/infrastructure/jobs";
import type { Scope } from "../src/modules/intake/contracts";
let pg: PGlite, db: Database, a: Scope, b: Scope;
beforeEach(async () => {
  pg = new PGlite();
  for (const file of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
  db = drizzle(pg, { schema }) as unknown as Database;
  for (const id of ["a", "b", "new-user"]) await db.insert(schema.users).values({ id, name: id });
  a = await authorizeStore(db, "a", await createOnboardingStore(db, "a", "Reading Studio", "fixtures"));
  b = await authorizeStore(db, "b", await createOnboardingStore(db, "b", "Other Store", "fixtures"));
  process.env.ETSY_ADAPTER = "fixtures";
}, 20000);
afterEach(async () => { vi.unstubAllEnvs(); await pg.close(); });
async function imported() {
  await connectFixtures(db, a);
  const jobs = new PostgresSyncJobs(db);
  const first = await startProductImport(db, jobs, a);
  expect(await startProductImport(db, jobs, a)).toBe(first);
  await jobs.runNext(new FixtureEtsyAdapter());
}
it("authenticated user without a store enters store onboarding; replay creates one workspace", async () => {
  expect(await onboardingDestination(db, "new-user")).toBe("/onboarding/store");
  const id = await createOnboardingStore(db, "new-user", "  New Store  ", "fixtures");
  expect(await createOnboardingStore(db, "new-user", "Different name", "fixtures")).toBe(id);
  expect(await onboardingDestination(db, "new-user")).toBe("/onboarding/etsy");
  expect((await db.select().from(schema.stores).where(eq(schema.stores.id, id)))[0].name).toBe("New Store");
  expect((await db.select().from(schema.memberships).where(eq(schema.memberships.userId, "new-user")))).toHaveLength(1);
  await expect(createOnboardingStore(db, "new-user", " ", "fixtures")).rejects.toThrow();
});
it("legacy Milestone 1 stores retain access to operations", async () => {
  await createWorkspace(db, "new-user", "Existing Store", "fixtures");
  expect(await onboardingDestination(db, "new-user")).toBe("/");
});
it("scoped connection DTO excludes all secrets; connection and listings belong to the authorized store", async () => {
  expect((await onboardingData(db, a)).connection.kind).toBe("disconnected");
  await imported();
  const data = await onboardingData(db, a);
  expect(data.connection.kind).toBe("connected");
  expect(Object.keys(data.connection).sort()).toEqual(["kind", "label", "lastSyncAt"]);
  expect(data.products).toHaveLength(fixtureListings.length);
  expect((await onboardingData(db, b)).products).toHaveLength(0);
  await expect(authorizeStore(db, "b", a.storeId)).rejects.toThrow();
  await expect(onboardingData(db, { ...a, userId: b.userId })).rejects.toThrow();
  await expect(startProductImport(db, new PostgresSyncJobs(db), { ...a, organizationId: b.organizationId })).rejects.toThrow();
});
it("selected listings persist on reload and replay without creating configurations", async () => {
  await imported();
  expect(await onboardingDestination(db, a.userId)).toBe("/onboarding/products");
  await saveProductSelection(db, a, ["101", "102", "101"]);
  await saveProductSelection(db, a, ["102", "101"]);
  const data = await onboardingData(db, a);
  expect(data.selected.sort()).toEqual(["101", "102"]);
  expect(await onboardingDestination(db, a.userId)).toBe("/onboarding/products/setup");
  expect(await db.select().from(schema.mappings).where(tenantWhere(schema.mappings, a))).toHaveLength(0);
  expect(await db.select().from(schema.listingSelections).where(tenantWhere(schema.listingSelections, a))).toHaveLength(2);
  expect((await db.select().from(schema.auditLogs).where(tenantWhere(schema.auditLogs, a))).filter(e => e.action === "products_selected")).toHaveLength(1);
  await saveProductSelection(db, a, ["102"]);
  expect((await onboardingData(db, a)).selected).toEqual(["102"]);
});
it("zero, cross-tenant, unavailable and forged selections fail atomically", async () => {
  await imported();
  await ingestListing(db, b, { ...fixtureListings[0], externalId: "999" });
  await saveProductSelection(db, a, ["101"]);
  await expect(saveProductSelection(db, a, [])).rejects.toThrow();
  await expect(saveProductSelection(db, a, ["999"])).rejects.toThrow("PRODUCT_UNAVAILABLE");
  await expect(saveProductSelection(db, { ...a, userId: "b" }, ["101"])).rejects.toThrow();
  await db.update(schema.listings).set({ state: "inactive" }).where(eq(schema.listings.externalId, "102"));
  await expect(saveProductSelection(db, a, ["101", "102"])).rejects.toThrow("PRODUCT_UNAVAILABLE");
  expect((await onboardingData(db, a)).selected).toEqual(["101"]);
  await expect(db.insert(schema.listingSelections).values({ organizationId: b.organizationId, storeId: b.storeId, listingExternalId: "102", selectedBy: "b" })).rejects.toThrow();
});
it("disconnect prevents selection and import, and preserves existing selections", async () => {
  await imported(); await saveProductSelection(db, a, ["101"]); await disconnect(db, a);
  expect((await onboardingData(db, a)).connection.kind).toBe("disconnected");
  await expect(saveProductSelection(db, a, ["102"])).rejects.toThrow("CONNECT_STORE_FIRST");
  await expect(startProductImport(db, new PostgresSyncJobs(db), a)).rejects.toThrow("CONNECT_STORE_FIRST");
  expect((await onboardingData(db, a)).selected).toEqual(["101"]);
});
it("live import remains gated and never advances onboarding as a successful import", async () => {
  await db.update(schema.stores).set({ source: "etsy" }).where(eq(schema.stores.id, a.storeId));
  await db.update(schema.connections).set({ status: "connected" }).where(tenantWhere(schema.connections, a));
  await expect(startProductImport(db, new PostgresSyncJobs(db), a)).rejects.toThrow("LIVE_INTAKE_CONTRACT_NOT_VERIFIED");
  expect(await onboardingDestination(db, a.userId)).toBe("/onboarding/products");
  expect((await onboardingData(db, a)).importStatus).toBe("not_started");
});

it("registration persists one isolated identity, hashes credentials and replays without creating workspaces", async () => {
  vi.stubEnv("DEV_ACCOUNT_AUTH_ENABLED", "true");
  const input = { name: "New Seller", email: "  SELLER@example.test  ", password: "synthetic-registration-password" };
  const first = await registerDevelopmentAccount(db, input);
  expect(await registerDevelopmentAccount(db, input)).toEqual(first);
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, "seller@example.test"));
  expect(rows).toHaveLength(1); expect(rows[0].passwordHash).toMatch(/^scrypt-v1:/); expect(rows[0].passwordHash).not.toContain(input.password);
  expect(Object.keys(first).sort()).toEqual(["email", "id", "name"]);
  expect(await authenticateDevelopmentAccount(db, { email: "seller@example.test", password: input.password })).toEqual(first);
  expect(await resolveSellerDestination(db, first.id)).toEqual({ kind: "STORE_SETUP", path: "/onboarding/store" });
  expect(await db.select().from(schema.memberships).where(eq(schema.memberships.userId, first.id))).toHaveLength(0);
  const id = await createOnboardingStore(db, first.id, "New Workspace", "fixtures");
  expect(await createOnboardingStore(db, first.id, "Replay", "fixtures")).toBe(id);
  expect(await db.select().from(schema.memberships).where(eq(schema.memberships.userId, first.id))).toHaveLength(1);
  await expect(authorizeStore(db, first.id, a.storeId)).rejects.toThrow();
});
it("duplicate email cannot overwrite an account or authenticate with a wrong password", async () => {
  vi.stubEnv("DEV_ACCOUNT_AUTH_ENABLED", "true");
  const original = { name: "Original", email: "account@example.test", password: "synthetic-original-password" };
  const user = await registerDevelopmentAccount(db, original);
  await expect(registerDevelopmentAccount(db, { ...original, name: "Attacker", password: "synthetic-different-password" })).rejects.toThrow("ACCOUNT_CREATION_FAILED");
  expect(await authenticateDevelopmentAccount(db, { email: original.email, password: "synthetic-wrong-password" })).toBeNull();
  expect(await authenticateDevelopmentAccount(db, { email: "absent@example.test", password: original.password })).toBeNull();
  expect(await authenticateDevelopmentAccount(db, original)).toEqual(user);
});
it("production always rejects development registration and password authentication", async () => {
  vi.stubEnv("DEV_ACCOUNT_AUTH_ENABLED", "true"); vi.stubEnv("NODE_ENV", "production");
  const input = { name: "Seller", email: "blocked@example.test", password: "synthetic-development-password" };
  await expect(registerDevelopmentAccount(db, input)).rejects.toThrow("REGISTRATION_UNAVAILABLE");
  expect(await authenticateDevelopmentAccount(db, input)).toBeNull();
  expect(await db.select().from(schema.users).where(eq(schema.users.email, input.email))).toHaveLength(0);
});
it("central resume resolver uses trusted connection/selection state without redirect cycles", async () => {
  expect(await resolveSellerDestination(undefined)).toEqual({ kind: "PUBLIC", path: "/" });
  expect((await resolveSellerDestination(db, a.userId)).path).toBe("/onboarding/etsy");
  await connectFixtures(db, a);
  // Even if a redirect was interrupted before the stage write, connection state resumes Products.
  expect((await resolveSellerDestination(db, a.userId)).path).toBe("/onboarding/products");
  await imported(); await saveProductSelection(db, a, ["101"]);
  expect((await resolveSellerDestination(db, a.userId)).path).toBe("/onboarding/products/setup");
  await disconnect(db, a);
  expect((await resolveSellerDestination(db, a.userId)).path).toBe("/onboarding/etsy");
  expect((await onboardingData(db, a)).selected).toEqual(["101"]);
  await db.update(schema.stores).set({ onboardingStage: "complete" }).where(eq(schema.stores.id, a.storeId));
  expect(await resolveSellerDestination(db, a.userId)).toEqual({ kind: "OPERATIONS_HOME", path: "/" });
});
