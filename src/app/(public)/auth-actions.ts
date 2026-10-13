"use server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { auth, signIn, signOut, devLoginAllowed } from "@/auth";
import { database } from "@/db/client";
import { currentDestination } from "@/modules/identity/session";
import { AccountSecurity, signupSchema, revokeUserSessions } from "@/modules/identity/security/service";
import { transactionalEmail } from "@/modules/identity/security/email";
export type AuthFormState = { error?: string; success?: string };
function security(email = false) {
  return new AccountSecurity(database(), email ? transactionalEmail() : { async send() { throw new Error("EMAIL_UNAVAILABLE"); } }, process.env.AUTH_CODE_SECRET || "");
}
const message = "If your account is eligible, a code has been sent. Check your inbox. You can request another code after 60 seconds.";
export async function register(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const data = { email: form.get("email"), password: form.get("password"), confirmPassword: form.get("confirmPassword") };
  if (!signupSchema.safeParse(data).success) return { error: "Enter a valid email and matching passwords of 12–128 characters." };
  try { await security(true).register(data); } catch { return { error: "Account creation is temporarily unavailable or limited. Please wait and try again." }; }
  redirect("/verify-email");
}
export async function login(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  try { await signIn("email-password", { email: form.get("email"), password: form.get("password"), redirect: false, redirectTo: "/onboarding" }); }
  catch { return { error: "Unable to log in. Check your details, verify your email, or try again later." }; }
  redirect("/onboarding");
}
export async function sendVerification(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  try { await security(true).sendCode(form.get("email"), "verify"); } catch { return { error: "Email service unavailable or request limited. Please try again later." }; }
  return { success: message };
}
export async function verifyEmail(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  try { if (await security().verifyEmail(form.get("email"),form.get("code"))) return { success: "Email verified. You can now log in." }; } catch {}
  return { error: "Code is invalid, expired or limited. Request a new code and try again." };
}
export async function forgotPassword(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  // Delivery/unknown-account differences never leave the reset boundary.
  let instance: AccountSecurity;
  try { instance=security(true); } catch { return { error: "Password reset email delivery is temporarily unavailable. Please try again later." }; }
  try { await instance.sendCode(form.get("email"),"reset", task => after(async () => { try { await task(); } catch { console.error("Password reset email delivery failed"); } })); } catch {}
  return { success: message };
}
export async function resetPassword(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  try { if (await security().reset({ email: form.get("email"), code: form.get("code"), password: form.get("password"), confirmPassword: form.get("confirmPassword") })) return { success: "Password reset. All sessions have been signed out. Log in with your new password." }; } catch {}
  return { error: "Check your code and matching passwords (12–128 characters), or request a new code." };
}
export async function changePassword(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Please log in again." };
  try {
    const version = session.user.sessionVersion;
    if (typeof version === "number" && await security().change(session.user.id, version, { currentPassword: form.get("currentPassword"), password: form.get("password"), confirmPassword: form.get("confirmPassword") })) return { success: "Password changed. All sessions are signed out. Please log in again." };
  } catch {}
  return { error: "Unable to change password. Check your current password and matching new passwords, or try later." };
}
export async function githubLogin() {
  if ((process.env.NODE_ENV === "production" && process.env.AUTH_LEGACY_GITHUB_ENABLED !== "true") || !process.env.AUTH_GITHUB_ID || !process.env.AUTH_GITHUB_SECRET) redirect("/sign-in?error=unavailable");
  await signIn("github", { redirectTo: "/onboarding" });
}
export async function demoLogin(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  if (!devLoginAllowed()) return { error: "Demo login is unavailable." };
  try { await signIn("development", { password: form.get("password"), redirect: false, redirectTo: "/onboarding" }); }
  catch { return { error: "We couldn't log you in. Check your demo password." }; }
  redirect("/onboarding");
}
export async function logout() {
  try {
    const session=await auth();
    if(session?.user?.id && typeof session.user.sessionVersion === "number") await revokeUserSessions(database(),session.user.id,session.user.sessionVersion);
  } finally { await signOut({ redirectTo: "/" }); }
}
