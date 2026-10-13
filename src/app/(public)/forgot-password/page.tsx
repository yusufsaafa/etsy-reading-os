import { AuthShell } from "@/components/entry/auth-shell";
import { SecurityForm } from "@/components/entry/security-forms";
export default function Page() { return <AuthShell><h1>Forgot your password?</h1><p>Request a reset code. If your account is eligible, we will email it to you.</p><SecurityForm mode="forgot"/></AuthShell>; }
