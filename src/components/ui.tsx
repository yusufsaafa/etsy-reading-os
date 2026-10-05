import type { ReactNode, ButtonHTMLAttributes } from "react";
import Link from "next/link";
export function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={`button ${className}`} {...props}>{children}</button>; }
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Heading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) { return <header className="page-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="muted">{description}</p>}</header>; }
export function EmptyState({ title, children, href, action }: { title: string; children: ReactNode; href?: string; action?: string }) { return <Card><h2>{title}</h2><p className="muted">{children}</p>{href && <Link className="button" href={href}>{action}</Link>}</Card>; }
export const issueLabels: Record<string, string> = {
  unmapped_listing: "Product setup required", missing_input: "Customer information needed", unusable_input: "Review customer information", quantity_context: "Confirm who this reading is for", canceled: "Order canceled", refund_review: "Review the refund before continuing", unpaid: "Awaiting payment", not_digital: "This product is not a digital reading", source_changed: "Purchase details changed — review before continuing", mapping_paused: "Product paused",
};
