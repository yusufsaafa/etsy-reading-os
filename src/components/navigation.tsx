"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";
const items: {href:string;label:string;icon:IconName}[] = [
  {href:"/",label:"Home",icon:"home"}, {href:"/orders",label:"Orders",icon:"orders"},
  {href:"/products",label:"Products",icon:"products"}, {href:"/settings",label:"Settings",icon:"settings"},
];
export function Navigation() {
  const path = usePathname();
  return <nav className="primary-nav" aria-label="Main navigation">{items.map(({href,label,icon}) => <Link key={href} href={href} aria-current={(href === "/" ? path === href : path.startsWith(href)) ? "page" : undefined}><Icon name={icon}/><span>{label}</span></Link>)}</nav>;
}
