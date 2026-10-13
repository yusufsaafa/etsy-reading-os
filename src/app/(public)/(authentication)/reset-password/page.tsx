import { AuthenticationIntro } from "@/components/authentication/layout";
import { SecurityForm } from "@/components/authentication/forms";
export default function Page() { return <><AuthenticationIntro eyebrow="Account recovery" title="Choose a new password." description="Use your email and reset code to securely choose a new password."/><SecurityForm mode="reset"/></>; }
