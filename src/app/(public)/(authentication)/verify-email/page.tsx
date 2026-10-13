import { cookies } from "next/headers";
import { AuthenticationIntro } from "@/components/authentication/layout";
import { SecurityForm } from "@/components/authentication/forms";
export default async function Page() { const email=(await cookies()).get("reading-auth-email")?.value; return <><AuthenticationIntro eyebrow="Email verification" title="Verify your email." description="Enter the six-digit code we sent to your email."/><SecurityForm mode="verify" initialEmail={email}/></>; }
