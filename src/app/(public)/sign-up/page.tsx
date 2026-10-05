import { redirect } from "next/navigation";
import { currentDestination } from "@/modules/identity/session";
import { developmentAccountsAllowed } from "@/modules/identity/accounts";
import { AuthShell } from "@/components/entry/auth-shell";
import { AccountForm } from "@/components/entry/auth-forms";
import { Button } from "@/components/ui";
import { githubLogin } from "../auth-actions";
import styles from "@/components/entry/entry.module.css";
export const dynamic = "force-dynamic";
export default async function SignUp() {
  const destination = await currentDestination();
  if (destination.kind !== "PUBLIC") redirect(destination.path);
  const accounts = developmentAccountsAllowed(), github = !!process.env.AUTH_GITHUB_ID && !!process.env.AUTH_GITHUB_SECRET;
  return <AuthShell signup><h1>Create your Reading OS account</h1><p className={styles.subtitle}>Start setting up your Etsy reading workflow.</p>{github && <form action={githubLogin} className={styles.provider}><Button className="secondary">Continue with GitHub</Button></form>}{accounts ? <><AccountForm signup/><p className={styles.note}>Development registration only. Your account is saved securely, but production email registration is not enabled.</p></> : <p className={styles.note}>{github ? "Create your account securely with GitHub. Email registration is not available yet." : "Account registration isn't available in this environment yet. No account will be created until authentication is configured."}</p>}</AuthShell>;
}
