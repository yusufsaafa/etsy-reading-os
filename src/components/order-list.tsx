import Link from "next/link";
import {Badge} from "./ui";
import {Icon} from "./icon";
import {displayDate} from "./seller-status";
import type {DashboardOrder} from "@/modules/dashboard/service";
import styles from "./orders.module.css";
export type OrderRow=DashboardOrder;
export function orderTone(row:OrderRow):"neutral"|"good"|"warning" {
 return row.status==="Generated"?"good":row.status!=="Canceled"&&row.priority<4?"warning":"neutral";
}
export function OrderList({rows,preview=false}:{rows:OrderRow[];preview?:boolean}) {
 return <div className={styles.surface}>{preview&&<p id="sample-order-details" className={styles.sampleNote}>Sample order details are unavailable in this read-only preview.</p>}<table className={styles.table} role="table"><caption className="sr-only">Orders with purchased readings, current status and UTC purchase date</caption><thead><tr><th scope="col">Order</th><th scope="col">Product / Reading</th><th scope="col">Status</th><th scope="col">Purchase Date</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><div className={styles.identity}>{preview?<strong>#{row.externalId}</strong>:<Link href={`/orders/${row.id}`}>#{row.externalId}</Link>}<span className={styles.metadata}>{row.count} {row.count===1?"reading":"readings"}</span></div></td><td><div className={styles.products}><strong dir="auto">{row.products||"No retained product information"}</strong></div></td><td><div className={`${styles.status} ${row.status==="In production"?styles.active:""}`}><Badge tone={orderTone(row)}>{row.status}</Badge></div></td><td><time className={styles.metadata} dateTime={row.date}>{displayDate(new Date(row.date))}</time></td><td>{preview?<button className="button ghost" type="button" disabled aria-describedby="sample-order-details" aria-label={`Sample order ${row.externalId} details unavailable`}>Open</button>:<Link className="button ghost" href={`/orders/${row.id}`} aria-label={`Open order ${row.externalId}`}>Open<Icon name="arrow" width="14" height="14"/></Link>}</td></tr>)}</tbody></table></div>;
}
