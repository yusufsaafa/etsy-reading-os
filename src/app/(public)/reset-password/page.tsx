import { AuthShell } from "@/components/entry/auth-shell";
import { SecurityForm } from "@/components/entry/security-forms";
export default function Page() { return <AuthShell><h1>Reset your password</h1><p>Use your email code to set a new password.</p><SecurityForm mode="reset"/></AuthShell>; }
