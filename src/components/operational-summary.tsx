import Link from "next/link";
import styles from "./operations.module.css";
export function OperationalSummary({newOrders, ready, needInformation}: {newOrders:number;ready:number;needInformation:number}) {
  const metrics = [{label:"New orders",value:newOrders,href:"/orders?filter=new"},{label:"Ready to create",value:ready,href:"/orders?filter=ready"},{label:"Need information",value:needInformation,href:"/orders?filter=info"}];
  return <section className={styles.metrics} aria-label="Order summary">{metrics.map(metric => <Link className={styles.metric} href={metric.href} key={metric.label}><dl><dt>{metric.label}</dt><dd>{metric.value}</dd></dl></Link>)}<div className={styles.metric}><dl><dt>Ready to send</dt><dd>0</dd></dl></div></section>;
}
