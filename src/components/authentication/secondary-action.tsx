import Link from "next/link";
import styles from "./authentication.module.css";
export function AuthenticationSecondaryAction({ registration = false }: { registration?: boolean }) {
  return <Link className={styles.outlinedAction} href={registration ? "/sign-in" : "/sign-up"}>
    {registration ? "Back to login" : "Create account"}
  </Link>;
}
