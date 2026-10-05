"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { login, register, demoLogin } from "@/app/(public)/auth-actions";
import styles from "./entry.module.css";
function Submit({ signup = false, demo = false }: { signup?: boolean; demo?: boolean }) {
  const { pending } = useFormStatus();
  return <Button disabled={pending} aria-busy={pending}>{pending ? signup ? "Creating your account…" : "Logging in…" : signup ? "Create account" : demo ? "Log in to demo" : "Log in"}</Button>;
}
export function AccountForm({ signup = false }: { signup?: boolean }) {
  const [state, action] = useActionState(signup ? register : login, {});
  return <form action={action} className={styles.form}>
    {signup && <label htmlFor="full-name">Full name<input id="full-name" name="name" autoComplete="name" maxLength={100} required/></label>}
    <label htmlFor="account-email">Email<input id="account-email" name="email" type="email" autoComplete="email" maxLength={254} required/></label>
    <label htmlFor="account-password">Password<input id="account-password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={12} maxLength={128} required aria-describedby={signup ? "password-help" : undefined}/></label>
    {signup && <p className={styles.note} id="password-help">Use at least 12 characters.</p>}
    {state.error && <p role="alert" className="error-message">{state.error}</p>}<Submit signup={signup}/>
  </form>;
}
export function DemoForm() {
  const [state, action] = useActionState(demoLogin, {});
  return <form action={action} className={styles.form}><label htmlFor="demo-password">Demo password<input id="demo-password" name="password" type="password" autoComplete="current-password" maxLength={200} required/></label>{state.error && <p role="alert" className="error-message">{state.error}</p>}<Submit demo/></form>;
}
