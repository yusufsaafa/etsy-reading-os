import Link from "next/link";
import styles from "./setup.module.css";
export function SetupNavigation({current,href="/onboarding/products/setup"}:{current:string;href?:string}){return <nav className={styles.setupNavigation} aria-label="Product setup navigation"><Link className="back-link" href={href}>← Back to products</Link><span>Products / Product setup / {current}</span></nav>;}
