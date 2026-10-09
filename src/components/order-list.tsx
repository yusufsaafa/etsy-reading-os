import Link from "next/link";
import {NavigableOrderRow} from "./navigable-order-row";
import {customerIdentity} from "@/modules/orders/customer";
import {Badge} from "./ui";
import {Icon} from "./icon";
import {displayDate} from "./seller-status";
import type {DashboardOrder} from "@/modules/dashboard/service";
import styles from "./orders.module.css";
export type OrderRow=DashboardOrder;
export function shortOrderStatus(status:string){return /needed|attention|updated|refund/i.test(status)?"Needs Attention":status;}
export function orderTone(row:OrderRow):"neutral"|"good"|"warning" {
 return row.status==="Generated"?"good":row.status!=="Canceled"&&row.priority<4?"warning":"neutral";
}
export function OrderList({rows,preview=false,returnQuery=""}:{rows:OrderRow[];preview?:boolean;returnQuery?:string}) {
 return <div className={styles.surface}><table className={styles.table} role="table"><caption className="sr-only">Orders with purchased readings, current status and UTC purchase date</caption><thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Product / Reading</th><th scope="col">Status</th><th scope="col">Purchase Date</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map(row=><NavigableOrderRow key={row.id} label={`Open order ${row.externalId}`}><td><div className={styles.identity}><Link href={`${preview?"/orders/preview/":"/orders/"}${row.id}${returnQuery}`}>#{row.externalId}</Link><span className={styles.metadata}>{row.count} {row.count===1?"reading":"readings"}</span></div></td><td><span className={styles.customer} dir="auto">{customerIdentity(row.customer)}</span></td><td><div className={styles.products}><strong dir="auto">{row.products||"No retained product information"}</strong></div></td><td><div className={`${styles.status} ${row.status==="In production"?styles.active:""}`}><Badge tone={orderTone(row)}>{shortOrderStatus(row.status)}</Badge></div></td><td><time className={styles.metadata} dateTime={row.date}>{displayDate(new Date(row.date))}</time></td><td><Link data-order-destination className={styles.navigation} href={`${preview?"/orders/preview/":"/orders/"}${row.id}${returnQuery}`} aria-label={`Open order ${row.externalId}`}><Icon name="chevron"/></Link></td></NavigableOrderRow>)}</tbody></table></div>;
}
