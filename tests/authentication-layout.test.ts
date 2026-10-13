import { it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const mocks=vi.hoisted(()=>({path:"/sign-in"}));
vi.mock("next/navigation",()=>({usePathname:()=>mocks.path,redirect:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>({value:"seller@example.test"})})}));
vi.mock("@/modules/identity/session",()=>({currentDestination:async()=>({kind:"PUBLIC"})}));
vi.mock("@/app/(public)/auth-actions",()=>({register:vi.fn(),login:vi.fn(),verifyEmail:vi.fn(),sendVerification:vi.fn(),forgotPassword:vi.fn(),resetPassword:vi.fn(),changePassword:vi.fn()}));
import authStyles from "../src/components/authentication/authentication.module.css";
import { AuthenticationSecondaryAction } from "../src/components/authentication/secondary-action";
import { AuthenticationLayout } from "../src/components/authentication/layout";
import SignIn from "../src/app/(public)/(authentication)/sign-in/page";
import SignUp from "../src/app/(public)/(authentication)/sign-up/page";
import Verify from "../src/app/(public)/(authentication)/verify-email/page";
import Forgot from "../src/app/(public)/(authentication)/forgot-password/page";
import Reset from "../src/app/(public)/(authentication)/reset-password/page";
beforeEach(()=>{mocks.path="/sign-in";});
it("header is outside the main and main has exactly a form panel and showcase",()=>{
 const html=renderToStaticMarkup(createElement(AuthenticationLayout,{children:createElement("form",null,"Real form panel")}));
 expect(html.match(/<main\b/g)).toHaveLength(1);expect(html.match(/<header\b/g)).toHaveLength(1);
 expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<main"));
 expect(html).toMatch(/<main[^>]*><section[^>]*>.*Real form panel.*<\/section><aside/s);
 expect(html).not.toContain("sidebar");expect(html).not.toContain("main-content");
});
it.each([["/verify-email","Back to sign in","/sign-in"]])("header navigation for %s",(path,label,href)=>{mocks.path=path;const html=renderToStaticMarkup(createElement(AuthenticationLayout,{children:"Form"}));expect(html).toContain(`href="${href}"`);expect(html).toContain(label);});
it("all real pages retain supported fields without social login or prototype billing",async()=>{
 const pages=[await SignIn({searchParams:Promise.resolve({})}),await SignUp(),await Verify(),Forgot(),Reset()];
 const html=pages.map(page=>renderToStaticMarkup(page));
 expect(html[0]).toContain("Good to see you again.");expect(html[0]).toContain("Forgot password?");expect(html[0]).toContain('autoComplete="current-password"');
 expect(html[1]).toContain("Create your Reading OS account.");expect(html[1]).toContain('name="confirmPassword"');
 expect(html[2]).toContain("seller@example.test");expect(html[2]).not.toContain('type="email"');expect(html[2]).toContain('autoComplete="one-time-code"');
 expect(html[3]).toContain("Send reset instructions");expect(html[4]).toContain("Choose a new password.");expect(html[4]).toContain('name="code"');
 for(const text of html) {expect(text).not.toContain("GitHub");expect(text).not.toContain("free trial");expect(text).not.toContain("Development demo");}
});

it.each(["/sign-in","/sign-up"])("header avoids duplicate navigation for %s",path=>{mocks.path=path;const html=renderToStaticMarkup(createElement(AuthenticationLayout,{children:"Form"}));expect(html.match(/<a /g)).toHaveLength(1);expect(html).toContain("Reading OS");});
it("login has exactly one registration CTA and no verification navigation",async()=>{const html=renderToStaticMarkup(await SignIn({searchParams:Promise.resolve({})}));expect(html.match(/href="\/sign-up"/g)).toHaveLength(1);expect(html).not.toContain("Don&#x27;t have an account?");expect(html).toContain("Create account");expect(html).not.toContain("New to Reading OS?");expect(html).not.toContain('href="/verify-email"');});

it("registration uses one outlined return action",async()=>{const html=renderToStaticMarkup(await SignUp());expect(html).not.toContain("Already have an account?");expect(html).toContain("Back to login");expect(html.match(/href="\/sign-in"/g)).toHaveLength(1);});

it("login renders primary submit followed by a class-bound registration navigation action",async()=>{const html=renderToStaticMarkup(await SignIn({searchParams:Promise.resolve({})}));expect(html.match(/<button[^>]*type="submit"/g)).toHaveLength(1);expect(html).toMatch(/>Log in<\/button><\/form><a class="[^"]+" href="\/sign-up">Create account<\/a>/);expect(html).not.toContain("<footer");});

it("actual sign-in route binds the exact outlined CSS export to its only registration anchor",async()=>{
 const page=await SignIn({searchParams:Promise.resolve({})});
 const children=page.props.children;
 expect(children.at(-1).type).toBe(AuthenticationSecondaryAction);
 const action=AuthenticationSecondaryAction({});
 expect(action.props.href).toBe("/sign-up");
 expect(authStyles.outlinedAction).toBeTruthy();
 expect(action.props.className).toBe(authStyles.outlinedAction);
 const html=renderToStaticMarkup(page);
 const anchors=[...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].filter(match=>match[1].includes('href="/sign-up"'));
 expect(anchors).toHaveLength(1);
 expect(anchors[0][1]).toContain(`class="${authStyles.outlinedAction}"`);
 expect(anchors[0][2]).toBe("Create account");
 expect(html).not.toContain("Don't have an account?");
 expect(html).not.toContain("authSwitch");
});
