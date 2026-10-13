"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./authentication.module.css";
export function AuthenticationNavigation() {
 const path=usePathname();
 if (path === "/sign-in" || path === "/sign-up") return null;
 return <Link className={styles.headerLink} href={path === "/sign-in" ? "/sign-up" : "/sign-in"}>{path === "/sign-in" ? "Create account" : path === "/sign-up" ? "Log in" : "Back to sign in"}</Link>;
}
