"use server";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { auth, signIn, signOut, devLoginAllowed } from "@/auth";
import { database } from "@/db/client";
import { currentDestination } from "@/modules/identity/session";
import { developmentAccountsAllowed, registrationSchema, registerDevelopmentAccount } from "@/modules/identity/accounts";
export type AuthFormState = { error?: string };
export async function register(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  if ((await auth())?.user?.id) redirect((await currentDestination()).path);
  if (!developmentAccountsAllowed()) return { error: "Email registration is not available in this environment." };
  const parsed = registrationSchema.safeParse({ name: form.get("name"), email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your name, a valid email, and a password of 12–128 characters." };
  try {
    await registerDevelopmentAccount(database(), parsed.data);
    await signIn("email-password", { email: parsed.data.email, password: parsed.data.password, redirect: false, redirectTo: "/onboarding" });
  } catch { return { error: "We couldn't create your account. Try again or log in with your existing details." }; }
  redirect("/onboarding");
}
export async function login(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  if (!developmentAccountsAllowed()) return { error: "Email login is not available in this environment." };
  try { await signIn("email-password", { email: form.get("email"), password: form.get("password"), redirect: false, redirectTo: "/onboarding" }); }
  catch (error) { if (error instanceof AuthError) return { error: "We couldn't log you in. Check your email and password." }; return { error: "Login is temporarily unavailable. Please try again." }; }
  redirect("/onboarding");
}
export async function githubLogin() {
  if (!process.env.AUTH_GITHUB_ID || !process.env.AUTH_GITHUB_SECRET) redirect("/sign-in?error=unavailable");
  await signIn("github", { redirectTo: "/onboarding" });
}
export async function demoLogin(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  if (!devLoginAllowed()) return { error: "Demo login is unavailable." };
  try { await signIn("development", { password: form.get("password"), redirect: false, redirectTo: "/onboarding" }); }
  catch { return { error: "We couldn't log you in. Check your demo password." }; }
  redirect("/onboarding");
}
export async function logout() { await signOut({ redirectTo: "/" }); }
