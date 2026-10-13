"use client";
import { useActionState, useState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { register, login, verifyEmail, sendVerification, forgotPassword, resetPassword, changePassword } from "@/app/(public)/auth-actions";
import { otpDigits, safeAuthDestination } from "../entry/auth-ux";
import styles from "./authentication.module.css";
export type SecurityMode = "register" | "login" | "verify" | "resend" | "forgot" | "reset" | "change";
const actions = { register, login, verify: verifyEmail, resend: sendVerification, forgot: forgotPassword, reset: resetPassword, change: changePassword };
const labels = { register: "Create account", login: "Log in", verify: "Verify email", resend: "Send new verification code", forgot: "Send reset instructions", reset: "Reset password", change: "Change password" };
function Submit({ mode }: { mode: SecurityMode }) {
  const { pending } = useFormStatus();
  return <button className={styles.primary} type="submit" disabled={pending} aria-busy={pending}>{pending ? "Please wait…" : labels[mode]}</button>;
}
function Password({ name, label, current = false }: { name: string; label: string; current?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className={styles.passwordField}><label htmlFor={name}>{label}<input id={name} name={name} type={visible ? "text" : "password"} autoComplete={current ? "current-password" : "new-password"} minLength={current ? 1 : 12} maxLength={128} required aria-describedby={!current ? `${name}-help` : undefined}/></label>{!current && <span id={`${name}-help`} className={styles.fieldHelp}>{name === "confirmPassword" ? "Enter the same password again." : "Use 12–128 characters."}</span>}<button type="button" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible ? "Hide" : "Show"}</button></div>;
}
export function SecurityForm({ mode, initialEmail, callbackUrl }: { mode: SecurityMode; initialEmail?: string; callbackUrl?: string }) {
  const [state, action] = useActionState(actions[mode], {});
  const [email, setEmail] = useState(initialEmail || "");
  const [recover, setRecover] = useState(!initialEmail);
  const [code, setCode] = useState("");
  return <form action={action} onSubmit={event => {
    const form = event.currentTarget;
    const password = form.elements.namedItem("password") as HTMLInputElement | null;
    const confirm = form.elements.namedItem("confirmPassword") as HTMLInputElement | null;
    if (confirm && password) { confirm.setCustomValidity(confirm.value === password.value ? "" : "Passwords must match."); if (!confirm.reportValidity()) event.preventDefault(); }
  }} onInput={event => { if ((event.target as HTMLInputElement).name === "confirmPassword" || (event.target as HTMLInputElement).name === "password") { const confirm = event.currentTarget.elements.namedItem("confirmPassword") as HTMLInputElement | null; confirm?.setCustomValidity(""); } }} className={styles.form}>
    {mode === "login" && <input type="hidden" name="callbackUrl" value={safeAuthDestination(callbackUrl)}/>}
    {mode === "verify" && !recover ? <div className={styles.emailDestination}><span>Code sent to</span><strong>{email}</strong><input type="hidden" name="email" value={email}/><button type="button" onClick={() => { setRecover(true); setCode(""); }} className={styles.textButton}>Change email</button></div> : mode !== "change" && <label htmlFor={`email-${mode}`}>Email address<input placeholder="you@yourshop.com" id={`email-${mode}`} name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} required/></label>}
    {(mode === "verify" || mode === "reset") && <label htmlFor={`code-${mode}`}>Verification code<input className={styles.otpInput} id={`code-${mode}`} name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={event => setCode(otpDigits(event.target.value))} onPaste={event => { event.preventDefault(); setCode(otpDigits(event.clipboardData.getData("text"))); }} placeholder="000000" required aria-describedby="code-help"/><span id="code-help" className={styles.fieldHelp}>Six digits · valid for 10 minutes</span></label>}
    {mode === "change" && <Password name="currentPassword" label="Current password" current/>}
    {["register","login","reset","change"].includes(mode) && <Password name="password" label={mode === "reset" || mode === "change" ? "New password" : "Password"} current={mode === "login"}/>}
    {["register","reset","change"].includes(mode) && <><Password name="confirmPassword" label={mode === "reset" ? "Confirm new password" : "Confirm password"}/></>}
    {mode === "login" && <div className={styles.forgotLink}><Link href="/forgot-password">Forgot password?</Link></div>}
    {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
    {state.success && <p role="status" className={styles.success}>{state.success}</p>}
    {!(state.success && ["verify","reset","change"].includes(mode)) && <Submit mode={mode}/> }
    {mode === "verify" && !state.success && <Resend email={email}/> }
    {mode === "forgot" && <Link href="/reset-password">I have a reset code</Link>}
    {mode === "reset" && <Link href="/forgot-password">Request a new reset code</Link>}
    {mode === "change" && <p className={styles.note}>Changing your password signs out all sessions, including this one.</p>}
    {state.success && ["verify","reset","change"].includes(mode) && <Link href="/sign-in">Log in</Link>}
  </form>;
}

function Resend({ email }: { email: string }) {
 const [state, action, pending] = useActionState(sendVerification, {});
 const [remaining, setRemaining] = useState(60);
 useEffect(() => { if (!remaining) return; const timer = setTimeout(() => setRemaining(value => value - 1), 1000); return () => clearTimeout(timer); }, [remaining]);
 useEffect(() => { if (state.success) setRemaining(60); }, [state]);
 return <div className={styles.resend}><p>Didn't receive a code? Check your spam folder.</p><input type="hidden" name="resend-email" value={email}/><ResendButton action={action} email={email} remaining={remaining} sending={pending}/>{state.error && <p role="alert" className={styles.error}>{state.error}</p>}{state.success && <p role="status" className={styles.fieldHelp}>{state.success}</p>}</div>;
}
function ResendButton({ action, email, remaining, sending }: { action: (data: FormData) => void; email: string; remaining: number; sending: boolean }) {
 const { pending } = useFormStatus();
 return <button className={styles.textButton} type="submit" formNoValidate disabled={pending || sending || remaining > 0 || !email} formAction={() => { const data = new FormData(); data.set("email", email); action(data); }}>{pending || sending ? "Please wait…" : remaining ? `Resend code in ${remaining}s` : "Resend code"}</button>;
}
