import Link from "next/link";
import styles from "./entry.module.css";
export function AuthShell({ children, signup }: { children: React.ReactNode; signup?: boolean }) {
  return <div className={styles.authShell}><header className={styles.header}><Link className="wordmark" href="/">Reading<span>OS</span></Link><Link className="button ghost" href={signup ? "/sign-in" : "/sign-up"}>{signup ? "Log in" : "Create account"}</Link></header><main className={styles.authMain}>{children}</main></div>;
}
