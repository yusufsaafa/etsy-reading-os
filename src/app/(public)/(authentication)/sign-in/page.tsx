import { AuthenticationSecondaryAction } from "@/components/authentication/secondary-action";
import { redirect } from "next/navigation";
import { currentDestination } from "@/modules/identity/session";
import { AuthenticationIntro } from "@/components/authentication/layout";
import { SecurityForm } from "@/components/authentication/forms";
import styles from "@/components/authentication/authentication.module.css";
export const dynamic="force-dynamic";
export default async function SignIn({searchParams}:{searchParams:Promise<{error?:string;callbackUrl?:string}>}) {
 const destination=await currentDestination(); if(destination.kind!=="PUBLIC") redirect(destination.path);
 const {error,callbackUrl}=await searchParams;
 return <><AuthenticationIntro eyebrow="Welcome back" title="Good to see you again." description="Your readings are right where you left them."/>{error && <p className={styles.error} role="alert">Login could not finish. Please try again.</p>}<SecurityForm mode="login" callbackUrl={callbackUrl}/><AuthenticationSecondaryAction/></>;
}
