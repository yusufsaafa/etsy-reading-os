import { redirect } from "next/navigation";
import { currentDestination } from "@/modules/identity/session";
import { AuthShell } from "@/components/entry/auth-shell";
import { SecurityForm } from "@/components/entry/security-forms";
import styles from "@/components/entry/entry.module.css";
export const dynamic = "force-dynamic";
export default async function SignUp() {
 const destination=await currentDestination(); if(destination.kind!=="PUBLIC") redirect(destination.path);
 return <AuthShell signup><h1>Create your account</h1><p className={styles.subtitle}>Set up your Etsy reading workspace. Verify your email before you begin.</p><SecurityForm mode="register"/></AuthShell>;
}
