import { it, expect, vi, beforeEach } from "vitest";
const mocks=vi.hoisted(()=>({set:vi.fn(),register:vi.fn(),signIn:vi.fn(),redirect:vi.fn((path:string)=>{throw new Error(`REDIRECT:${path}`);})}));
vi.mock("next/headers",()=>({cookies:async()=>({set:mocks.set})}));
vi.mock("next/navigation",()=>({redirect:mocks.redirect}));
vi.mock("next/server",()=>({after:vi.fn()}));
vi.mock("@/auth",()=>({auth:vi.fn(),signIn:mocks.signIn,signOut:vi.fn(),devLoginAllowed:()=>false}));
vi.mock("@/db/client",()=>({database:()=>({})}));
vi.mock("@/modules/identity/session",()=>({currentDestination:vi.fn()}));
vi.mock("@/modules/identity/security/email",()=>({transactionalEmail:()=>({send:vi.fn()})}));
vi.mock("@/modules/identity/security/service",async importOriginal=>{const original=await importOriginal<typeof import("../src/modules/identity/security/service")>();return {...original,AccountSecurity:class {register=mocks.register;}};});
import {register,login} from "../src/app/(public)/auth-actions";
beforeEach(()=>{vi.clearAllMocks();mocks.signIn.mockReset();});
it("successful registration carries normalized email in a bounded HttpOnly cookie",async()=>{const form=new FormData();form.set("email"," Seller@Example.test ");form.set("password","A sufficiently long password");form.set("confirmPassword","A sufficiently long password");await expect(register({},form)).rejects.toThrow("REDIRECT:/verify-email");expect(mocks.set).toHaveBeenCalledWith("reading-auth-email","seller@example.test",expect.objectContaining({httpOnly:true,sameSite:"lax",maxAge:600}));});
it("failed registration does not establish verification context",async()=>{const form=new FormData();form.set("email","bad");expect((await register({},form)).error).toBeDefined();expect(mocks.set).not.toHaveBeenCalled();});
it.each([["/orders?status=review","/orders?status=review"],["https://evil.example","/onboarding"]])("login safely redirects %s",async(target,result)=>{const form=new FormData();form.set("callbackUrl",target);await expect(login({},form)).rejects.toThrow(`REDIRECT:${result}`);expect(mocks.signIn).toHaveBeenCalled();});

import { UnverifiedLogin } from "../src/modules/identity/security/unverified-login";
it("password-validated unverified login resumes with private email context",async()=>{mocks.signIn.mockRejectedValue({cause:{err:new UnverifiedLogin("seller@example.test")}});await expect(login({},new FormData())).rejects.toThrow("REDIRECT:/verify-email");expect(mocks.set).toHaveBeenCalledWith("reading-auth-email","seller@example.test",expect.objectContaining({httpOnly:true,sameSite:"lax",maxAge:600}));});
it("incorrect credentials never establish verification context",async()=>{mocks.signIn.mockRejectedValue(new Error("Invalid credentials"));const result=await login({},new FormData());expect(result.error).toContain("Check your details");expect(mocks.set).not.toHaveBeenCalled();expect(mocks.redirect).not.toHaveBeenCalled();});
