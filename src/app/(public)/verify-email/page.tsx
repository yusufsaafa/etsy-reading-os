import { AuthShell } from "@/components/entry/auth-shell";
import { SecurityForm } from "@/components/entry/security-forms";
export default function Page() { return <AuthShell><h1>Verify your email</h1><p>Enter the code from your inbox. Codes expire after 10 minutes.</p><SecurityForm mode="verify"/><details><summary>Need another code?</summary><SecurityForm mode="resend"/></details></AuthShell>; }
