import { it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn(), store: vi.fn(), authorize: vi.fn(), destination: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/db/client", () => ({ database: mocks.database }));
vi.mock("../src/modules/identity/service", () => ({ findUserStore: mocks.store, authorizeStore: mocks.authorize }));
vi.mock("../src/modules/onboarding/destination", () => ({ resolveSellerDestination: mocks.destination }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
import { currentScope, requireUser } from "../src/modules/identity/session";
beforeEach(() => { vi.clearAllMocks(); });
it("unauthenticated operations and onboarding guards reject before any tenant query", async () => {
  mocks.auth.mockResolvedValue(null);
  await expect(currentScope()).rejects.toThrow("REDIRECT:/sign-in");
  await expect(requireUser()).rejects.toThrow("REDIRECT:/sign-in");
  expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled();
});
it("incomplete operations resolve server membership and redirect to the central destination", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "server-user" } }); mocks.store.mockResolvedValue({ id: "server-store" });
  mocks.authorize.mockResolvedValue({ userId: "server-user", storeId: "server-store", organizationId: "server-org" });
  mocks.destination.mockResolvedValue({ kind: "ETSY_CONNECTION", path: "/onboarding/etsy" });
  await expect(currentScope()).rejects.toThrow("REDIRECT:/onboarding/etsy");
  expect(mocks.authorize).toHaveBeenCalledWith(undefined, "server-user", "server-store");
});
