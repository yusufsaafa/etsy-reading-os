import Link from "next/link";
import styles from "./authentication.module.css";
import { AuthenticationNavigation } from "./navigation";
export function AuthenticationLayout({ children }: { children: React.ReactNode }) {
 return <div className={styles.page}>
  <header className={styles.header}><Link href="/" className={styles.brand}><span className={styles.brandMark} aria-hidden="true"><i/><i/></span><span>Reading OS</span></Link><AuthenticationNavigation/></header>
  <main className={styles.panels}>
   <section className={styles.formPanel} aria-label="Account access"><div className={styles.formContainer}>{children}</div></section>
   <AuthenticationShowcase/>
  </main>
 </div>;
}
export function AuthenticationIntro({ eyebrow, title, description }: { eyebrow:string; title:string; description:string }) { return <div className={styles.intro}><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>; }
export function AuthenticationShowcase() {
 return <aside className={styles.showcase} aria-label="Reading OS workflow"><div className={styles.showcaseContent}><span className={styles.pill}>A calmer way to work</span><h2>From incoming order<br/>to beautiful PDF.</h2><div className={styles.workflow}>
  <article className={styles.workflowCard}><span className={styles.step}>01 / INCOMING ORDER</span><h3>Love Tarot Reading</h3><p>A personalized Etsy order arrives.</p><div className={styles.lines} aria-hidden="true"><i/><i/></div><span className={styles.status}>Ready to create</span></article>
  <article className={styles.workflowCard}><span className={styles.step}>02 / READING OS</span><div className={styles.documentIcon} aria-hidden="true">≡</div><h3>Your reading, prepared</h3><p>Thoughtful content in your own style.</p><span className={styles.status}>Ready for review</span></article>
  <article className={styles.workflowCard}><span className={styles.step}>03 / PERSONALIZED PDF</span><div className={styles.paper} aria-hidden="true"><strong>Your reading</strong><div className={styles.lines}><i/><i/><i/></div></div><p>A polished PDF, ready to review.</p><span className={styles.status}>Review your PDF</span></article>
 </div><p className={styles.caption}>One connected workflow.<br/>More time for your craft.</p></div></aside>;
}
