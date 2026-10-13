import Link from "next/link";
import { AuthenticationIntro } from "@/components/authentication/layout";
import { SecurityForm } from "@/components/authentication/forms";
import styles from "@/components/authentication/authentication.module.css";
export default function Page() { return <><AuthenticationIntro eyebrow="Account recovery" title="Reset your password." description="Enter your email address and we'll send you instructions to reset your password."/><SecurityForm mode="forgot"/><p className={styles.formFooter}><Link href="/sign-in">Back to login</Link></p></>; }
