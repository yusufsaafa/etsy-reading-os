import Link from "next/link";
import { Badge } from "./ui";
import { Icon } from "./icon";
import { displayDate } from "./seller-status";
import styles from "./operations.module.css";
export type OrderRow = { id:string; externalId:string; customer:string; products:string; count:number; ready:number; status:string; date:Date };
export function OrderList({ rows }: { rows: OrderRow[] }) {
  return <div className={styles.tableSurface}><table className={styles.table}><caption className="sr-only">Orders with purchased readings and current status</caption><thead><tr><th scope="col">Customer / Order</th><th scope="col">Products</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><div className={styles.identity}><Link href={`/orders/${row.id}`} dir="auto">{row.customer}</Link><span className={styles.metadata}>#{row.externalId}</span></div></td><td><div className={styles.products}><strong>{row.count} {row.count === 1 ? "reading" : "readings"}</strong><span className={styles.metadata}>{row.products}</span></div></td><td><div className={styles.status}><Badge tone={row.status === "Ready" ? "good" : "warning"}>{row.status}</Badge>{row.ready > 0 && row.ready < row.count && <span className={styles.metadata}>{row.ready} of {row.count} ready</span>}</div></td><td><time className={styles.metadata} dateTime={row.date.toISOString()}>{displayDate(row.date)}</time></td><td><Link className="button ghost" href={`/orders/${row.id}`} aria-label={`Open order ${row.externalId}`}>Open<Icon name="arrow" width="14" height="14"/></Link></td></tr>)}</tbody></table></div>;
}
