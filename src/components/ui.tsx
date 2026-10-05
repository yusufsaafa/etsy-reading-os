import type { ReactNode, ButtonHTMLAttributes } from "react";
import Link from "next/link";
export function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={`button ${className}`} {...props}>{children}</button>; }
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Heading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) { return <header className="page-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="muted">{description}</p>}</header>; }
export function EmptyState({ title, children, href, action }: { title: string; children: ReactNode; href?: string; action?: string }) { return <Card><h2>{title}</h2><p className="muted">{children}</p>{href && <Link className="button" href={href}>{action}</Link>}</Card>; }
export const issueLabels: Record<string, string> = {
  unmapped_listing: "Listing needs configuration", missing_input: "Customer input is missing", unusable_input: "Customer input needs review", quantity_context: "Confirm each recipient", canceled: "Order canceled", refund_review: "Refund needs review", unpaid: "Awaiting payment", not_digital: "Outside digital intake", source_changed: "Purchased information changed", mapping_paused: "Configuration paused",
};
