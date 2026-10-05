import { it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ destination: vi.fn(), signOut: vi.fn(), auth: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }) }));
vi.mock("@/modules/identity/session", () => ({ currentDestination: mocks.destination }));
vi.mock("@/auth", () => ({ auth: mocks.auth, signOut: mocks.signOut, signIn: vi.fn(), devLoginAllowed: () => false }));
vi.mock("next-auth", () => ({ AuthError: class extends Error {} }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/operations-shell", () => ({ default: () => createElement("div", null, "Protected workspace") }));
vi.mock("@/components/operations-home", () => ({ default: () => createElement("div", null, "Home") }));
import Entry from "../src/app/page";
import { logout } from "../src/app/(public)/auth-actions";
beforeEach(() => { vi.clearAllMocks(); });
it("unauthenticated root renders public entry with signup and login, without an app sidebar", async () => {
  mocks.destination.mockResolvedValue({ kind: "PUBLIC", path: "/" });
  const html = renderToStaticMarkup(await Entry());
  expect(html).toContain('href="/sign-up"'); expect(html).toContain('href="/sign-in"');
  expect(html).toContain("without the repetitive work"); expect(html).not.toContain('class="sidebar"');
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it.each(["/onboarding/store", "/onboarding/etsy", "/onboarding/products", "/onboarding/products/setup"])("root resumes %s without redirecting back to itself", async path => {
  mocks.destination.mockResolvedValue({ kind: "INCOMPLETE", path });
  await expect(Entry()).rejects.toThrow(`REDIRECT:${path}`);
});
it("completed root renders the existing operations shell and does not redirect", async () => {
  mocks.destination.mockResolvedValue({ kind: "OPERATIONS_HOME", path: "/" });
  expect(renderToStaticMarkup(await Entry())).toContain("Protected workspace");
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("logout delegates solely to Auth.js session termination and returns to public root", async () => {
  await logout(); expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ redirectTo: "/" });
});
