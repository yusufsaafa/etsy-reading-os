import { it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../src/app/(public)/auth-actions",()=>({register:async()=>({}),login:async()=>({}),verifyEmail:async()=>({}),sendVerification:async()=>({}),forgotPassword:async()=>({}),resetPassword:async()=>({}),changePassword:async()=>({})}));
import { SecurityForm, type SecurityMode } from "../src/components/entry/security-forms";
it.each(["register","login","verify","forgot","reset","change"] as SecurityMode[])("%s has labelled accessible required fields and a submit action",mode=>{
 const html=renderToStaticMarkup(createElement(SecurityForm,{mode}));expect(html).toContain("<form");expect(html).toContain("<label");expect(html).toContain("required");expect(html).toContain("<button");
 if(["register","login","reset","change"].includes(mode)){expect(html).toContain('type="password"');expect(html).toContain('type="button"');expect(html).toContain('aria-pressed="false"');}
 if(["verify","reset"].includes(mode)){expect(html).toContain('inputMode="numeric"');expect(html).toContain('autoComplete="one-time-code"');}
});
