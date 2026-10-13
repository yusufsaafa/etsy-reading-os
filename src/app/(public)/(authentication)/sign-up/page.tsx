import { AuthenticationSecondaryAction } from "@/components/authentication/secondary-action";
import { redirect } from "next/navigation";
import { currentDestination } from "@/modules/identity/session";
import { AuthenticationIntro } from "@/components/authentication/layout";
import { SecurityForm } from "@/components/authentication/forms";
export const dynamic="force-dynamic";
export default async function SignUp() {
 const destination=await currentDestination(); if(destination.kind!=="PUBLIC") redirect(destination.path);
 return <><AuthenticationIntro eyebrow="Your reading workspace" title="Create your Reading OS account." description="A better workflow for your reading business starts here."/><SecurityForm mode="register"/><AuthenticationSecondaryAction registration/></>;
}
