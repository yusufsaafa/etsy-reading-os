import { redirect } from "next/navigation";
import { devLoginAllowed } from "@/auth";
import { currentDestination } from "@/modules/identity/session";
import { AuthShell } from "@/components/entry/auth-shell";
import { DemoForm } from "@/components/entry/auth-forms";
import { SecurityForm } from "@/components/entry/security-forms";
import { Button } from "@/components/ui";
import { githubLogin } from "../auth-actions";
import styles from "@/components/entry/entry.module.css";
export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const destination = await currentDestination();
  if (destination.kind !== "PUBLIC") redirect(destination.path);
  const { error } = await searchParams, github = (process.env.NODE_ENV !== "production" || process.env.AUTH_LEGACY_GITHUB_ENABLED === "true") && !!process.env.AUTH_GITHUB_ID && !!process.env.AUTH_GITHUB_SECRET;
  return <AuthShell><h1>Welcome back</h1><p className={styles.subtitle}>Log in to your Reading OS workspace.</p>{error && <p className="error-message" role="alert">Login could not finish. Please try again.</p>}<SecurityForm mode="login"/>{github && <details className={styles.demo}><summary>Legacy GitHub account</summary><form action={githubLogin} className={styles.provider}><Button className="secondary">Log in with GitHub</Button></form></details>}{devLoginAllowed() && <details className={styles.demo}><summary>Development demo account</summary><DemoForm/></details>}<p className={styles.note}>Logging in to Reading OS does not connect your Etsy shop.</p></AuthShell>;
}
