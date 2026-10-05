import type { ReactNode } from "react";
import Link from "next/link";
import { signOut } from "@/auth";
import styles from "./onboarding.module.css";
export function OnboardingShell({ children }: { children: ReactNode }) {
  return <div className={styles.shell}><header className={styles.header}><Link href="/onboarding" className="wordmark">Reading<span>OS</span></Link><form action={async () => { "use server"; await signOut({ redirectTo: "/sign-in" }); }}><button className="button ghost">Sign out</button></form></header><main id="main" className={styles.main}>{children}</main></div>;
}
export function StepHeader({ step, title, description }: { step: number; title: string; description: string }) {
  return <><nav aria-label="Store setup progress" className={styles.progress}><p>Set up your store</p><ol>{["Store", "Etsy", "Products", "Product setup"].map((name, index) => <li key={name} aria-current={index + 1 === step ? "step" : undefined} className={index + 1 < step ? styles.finished : ""}><span>{index + 1}</span><span>{name}</span></li>)}</ol></nav><header className={styles.heading}><h1>{title}</h1><p>{description}</p></header></>;
}
