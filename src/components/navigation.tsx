"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const items = [["/", "Home", "⌂"], ["/orders", "Orders", "≡"], ["/products", "Products", "□"], ["/settings", "Settings", "⚙"]];
export function Navigation() {
  const path = usePathname();
  return <nav className="primary-nav" aria-label="Main navigation">{items.map(([href,label,icon]) => <Link key={href} href={href} aria-current={(href === "/" ? path === href : path.startsWith(href)) ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{icon}</span><span>{label}</span></Link>)}</nav>;
}
