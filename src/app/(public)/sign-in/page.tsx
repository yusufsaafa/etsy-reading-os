import { redirect } from "next/navigation";
import { devLoginAllowed } from "@/auth";
import { currentDestination } from "@/modules/identity/session";
import { developmentAccountsAllowed } from "@/modules/identity/accounts";
import { AuthShell } from "@/components/entry/auth-shell";
import { AccountForm, DemoForm } from "@/components/entry/auth-forms";
import { Button } from "@/components/ui";
import { githubLogin } from "../auth-actions";
import styles from "@/components/entry/entry.module.css";
export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const destination = await currentDestination();
  if (destination.kind !== "PUBLIC") redirect(destination.path);
  const { error } = await searchParams, accounts = developmentAccountsAllowed(), github = !!process.env.AUTH_GITHUB_ID && !!process.env.AUTH_GITHUB_SECRET;
  return <AuthShell><h1>Welcome back</h1><p className={styles.subtitle}>Log in to your Reading OS workspace.</p>{error && <p className="error-message" role="alert">Login could not finish. Please try again.</p>}{github && <form action={githubLogin} className={styles.provider}><Button className="secondary">Continue with GitHub</Button></form>}{accounts && <><AccountForm/><p className={styles.note}>Development accounts only. Email login is disabled in production.</p></>}{devLoginAllowed() && <details className={styles.demo}><summary>Development demo account</summary><DemoForm/></details>}{!accounts && !github && !devLoginAllowed() && <p>Application login isn't configured yet. Please return when account access is available.</p>}<p className={styles.note}>Logging in to Reading OS does not connect your Etsy shop.</p></AuthShell>;
}
