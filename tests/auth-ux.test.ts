import { it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { safeAuthDestination, otpDigits } from "../src/components/entry/auth-ux";
vi.mock("@/app/(public)/auth-actions", () => ({ register:vi.fn(),login:vi.fn(),verifyEmail:vi.fn(),sendVerification:vi.fn(),forgotPassword:vi.fn(),resetPassword:vi.fn(),changePassword:vi.fn() }));
import { SecurityForm } from "../src/components/entry/security-forms";
import { AuthenticationLayout } from "../src/components/authentication/layout";
it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/sign-in", "/verify-email?x=1", "/\norders"])("rejects unsafe or recursive login destination %s", value => { expect(safeAuthDestination(value)).toBe("/onboarding"); });
it("preserves internal destination and query", () => { expect(safeAuthDestination("/orders?status=review#reading")).toBe("/orders?status=review#reading"); });
it("accepts pasted codes and keeps six ASCII digits", () => { expect(otpDigits("12 34-56\n7")).toBe("123456"); expect(otpDigits("000123")).toBe("000123"); });
it("verification handoff displays email without requiring re-entry", () => {
 const html=renderToStaticMarkup(createElement(SecurityForm,{mode:"verify",initialEmail:"seller@example.test"}));
 expect(html).toContain('type="hidden" name="email"'); expect(html).not.toContain('type="email"'); expect(html).toContain("seller@example.test"); expect(html).toContain('autoComplete="one-time-code"'); expect(html).toContain("Change email"); expect(html).toContain("Resend code in 60s");
});
it("direct navigation provides email recovery", () => { expect(renderToStaticMarkup(createElement(SecurityForm,{mode:"verify"}))).toContain('type="email"'); });
it("login supports password manager autofill and safe return destination", () => { const html=renderToStaticMarkup(createElement(SecurityForm,{mode:"login",callbackUrl:"/orders"})); expect(html).toContain('autoComplete="current-password"'); expect(html).toContain('value="/orders"'); expect(html).toContain('aria-label="Show password"'); });
it("registration renders matching password controls and requirements", () => { const html=renderToStaticMarkup(createElement(SecurityForm,{mode:"register"})); expect(html).toContain('name="confirmPassword"'); expect(html).toContain("12–128 characters"); });
it("shared shell provides branding and exactly one account navigation link", () => { const html=renderToStaticMarkup(createElement(AuthenticationLayout,{children:"Form"})); expect(html).toContain("From incoming order"); expect(html.match(/<main/g)).toHaveLength(1); expect(html).not.toContain("sidebar"); });
vi.mock("next/navigation", () => ({ usePathname: () => "/sign-in", redirect: vi.fn() }));
vi.mock("@/auth", () => ({ devLoginAllowed: () => false }));
vi.mock("@/modules/identity/session", () => ({ currentDestination: async () => ({kind:"PUBLIC"}) }));
it("public sign-in has no GitHub button even if legacy credentials are configured", async () => {
 vi.stubEnv("AUTH_LEGACY_GITHUB_ENABLED","true"); vi.stubEnv("AUTH_GITHUB_ID","fixture"); vi.stubEnv("AUTH_GITHUB_SECRET","fixture");
 try { const { default: SignIn } = await import("../src/app/(public)/(authentication)/sign-in/page"); const html = renderToStaticMarkup(await SignIn({searchParams:Promise.resolve({})})); expect(html).not.toContain("GitHub"); expect(html.indexOf("Forgot password?")).toBeLessThan(html.indexOf('>Log in</button>')); } finally { vi.unstubAllEnvs(); }
});
