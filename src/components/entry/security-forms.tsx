"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui";
import { register, login, verifyEmail, sendVerification, forgotPassword, resetPassword, changePassword } from "@/app/(public)/auth-actions";
import styles from "./entry.module.css";
export type SecurityMode = "register" | "login" | "verify" | "resend" | "forgot" | "reset" | "change";
const actions = { register, login, verify: verifyEmail, resend: sendVerification, forgot: forgotPassword, reset: resetPassword, change: changePassword };
const labels = { register: "Create account", login: "Log in", verify: "Verify email", resend: "Send new verification code", forgot: "Send reset code", reset: "Reset password", change: "Change password" };
function Submit({ mode }: { mode: SecurityMode }) {
  const { pending } = useFormStatus();
  return <Button disabled={pending} aria-busy={pending}>{pending ? "Please wait…" : labels[mode]}</Button>;
}
function Password({ name, label, current = false }: { name: string; label: string; current?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className={styles.passwordField}><label htmlFor={name}>{label}<input id={name} name={name} type={visible ? "text" : "password"} autoComplete={current ? "current-password" : "new-password"} minLength={current ? 1 : 12} maxLength={128} required/></label><button type="button" className="button ghost" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible ? "Hide" : "Show"}</button></div>;
}
export function SecurityForm({ mode }: { mode: SecurityMode }) {
  const [state, action] = useActionState(actions[mode], {});
  return <form action={action} className={styles.form}>
    {mode !== "change" && <label htmlFor={`email-${mode}`}>Email<input id={`email-${mode}`} name="email" type="email" autoComplete="email" maxLength={254} required/></label>}
    {(mode === "verify" || mode === "reset") && <label htmlFor={`code-${mode}`}>Six-digit email code<input id={`code-${mode}`} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required/></label>}
    {mode === "change" && <Password name="currentPassword" label="Current password" current/>}
    {["register","login","reset","change"].includes(mode) && <Password name="password" label={mode === "reset" || mode === "change" ? "New password" : "Password"} current={mode === "login"}/>}
    {["register","reset","change"].includes(mode) && <><Password name="confirmPassword" label="Confirm password"/><p className={styles.note}>Use 12–128 characters.</p></>}
    {state.error && <p role="alert" className="error-message">{state.error}</p>}
    {state.success && <p role="status" className="notice">{state.success}</p>}
    <Submit mode={mode}/>
    {mode === "login" && <><Link href="/forgot-password">Forgot password?</Link><Link href="/verify-email">Verify your email</Link></>}
    {mode === "forgot" && <Link href="/reset-password">I have a reset code</Link>}
    {mode === "reset" && <Link href="/forgot-password">Request a new reset code</Link>}
    {mode === "change" && <p className={styles.note}>Changing your password signs out all sessions, including this one.</p>}
    {state.success && ["verify","reset","change"].includes(mode) && <Link className="button secondary" href="/sign-in">Log in</Link>}
  </form>;
}
