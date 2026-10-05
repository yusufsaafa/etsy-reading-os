import Link from "next/link";
import { Badge } from "./ui";
import { displayDate } from "./seller-status";
export type OrderRow = { id:string; externalId:string; customer:string; products:string; count:number; ready:number; status:string; date:Date };
export function OrderList({ rows }: { rows: OrderRow[] }) {
  return <div className="record-list"><div className="record-header" aria-hidden="true"><span>Customer / order</span><span>Products</span><span>Status</span><span>Date</span><span /></div>{rows.map(row => <article className="record-row" key={row.id}><div className="record-identity"><Link href={`/orders/${row.id}`} dir="auto">{row.customer}</Link><span className="muted small">#{row.externalId}</span></div><div className="record-products"><strong>{row.count} {row.count === 1 ? "reading" : "readings"}</strong><span className="muted small">{row.products}</span></div><div className="record-status"><Badge tone={row.status === "Ready" ? "good" : "warning"}>{row.status}</Badge>{row.ready > 0 && row.ready < row.count && <span className="muted small">{row.ready} of {row.count} ready</span>}</div><time className="record-date small muted" dateTime={row.date.toISOString()}>{displayDate(row.date)}</time><Link className="inline-link record-action" href={`/orders/${row.id}`} aria-label={`Open order ${row.externalId}`}>Open <span aria-hidden="true">↗</span></Link></article>)}</div>;
}
