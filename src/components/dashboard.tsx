import Link from "next/link";
import type { DashboardData } from "@/modules/dashboard/service";
import { Heading, Badge, EmptyState } from "./ui";
import { OrderList } from "./order-list";
import styles from "./dashboard.module.css";

export function DashboardLoading() {
  return <div className={styles.dashboard} aria-busy="true" aria-label="Loading Dashboard"><Heading title="Dashboard" description="Loading your operational overview…"/><div className={styles.metrics}>{[1,2,3,4].map(n=><div className={styles.skeleton} key={n}/>)}</div><div className={styles.skeletonPanel}/><div className={styles.skeletonPanel}/></div>;
}
export function DashboardError() {
  return <div className={styles.dashboard}><Heading title="Dashboard" description="Your operational overview"/><section className={styles.surface} role="alert"><h2>Dashboard data could not be loaded</h2><p>Your order counts and activity are unavailable. Refresh this page to try again.</p><div className={styles.actions}><a className="button" href="/">Reload Dashboard</a><Link className="button ghost" href="/orders">Open Orders</Link></div></section></div>;
}
export function Dashboard({ data }: { data: DashboardData }) {
  const metrics = [
    {label:"Total Orders",value:data.metrics.total,detail:"All imported orders, including canceled orders"},
    {label:"Pending Orders",value:data.metrics.pending,detail:"No issue, active production or complete generated result"},
    {label:"In Production",value:data.metrics.active,detail:"Orders with queued, active or retrying readings"},
    {label:"Generated Orders",value:data.metrics.generated,detail:"All readings generated with current information"},
  ];
  const production = [
    {label:"Queued",value:data.production.queued}, {label:"Active",value:data.production.active},
    {label:"Waiting to retry",value:data.production.retry}, {label:"Needs attention",value:data.production.attention},
  ];
  return <div className={styles.dashboard}>
    <Heading title="Dashboard" description="Orders, attention items and current production for your store."/>
    {data.storeNotice && <div className={styles.surface}><div className={styles.sectionHeading}><p>{data.storeNotice}</p><Link className="button ghost" href="/settings">Review store integration →</Link></div></div>}
    <section aria-label="Operational overview"><dl className={styles.metrics}>{metrics.map(metric=><div className={styles.metric} key={metric.label}><dt>{metric.label}</dt><dd>{metric.value.toLocaleString("en")}<p>{metric.detail}</p></dd></div>)}</dl></section>
    <section aria-labelledby="dashboard-attention"><div className={styles.sectionHeading}><div><h2 id="dashboard-attention">Requires Attention</h2><p>{data.metrics.attention} {data.metrics.attention===1?"order needs":"orders need"} a decision. Failures appear first.</p></div><Link className="button ghost" href="/orders">View all orders</Link></div>
      {data.attention.length ? <ul className={styles.attention}>{data.attention.map(order=><li key={order.id}><div className={styles.identity}><strong>Order #{order.externalId}</strong><span>{order.products || "Order details available on review"}</span></div><Badge tone="warning">{order.status}</Badge><Link className="button ghost" href={`/orders/${order.id}`} aria-label={`Review order ${order.externalId}`}>Review order →</Link></li>)}</ul> : <div className={styles.surface}><h3>No reading issues require attention</h3><p>No stored reading production failures or information issues need a decision right now.</p></div>}
    </section>
    <section aria-labelledby="dashboard-recent"><div className={styles.sectionHeading}><div><h2 id="dashboard-recent">Recent Orders</h2><p>The five most recent purchases · dates shown in UTC</p></div><Link className="button ghost" href="/orders">View all orders</Link></div>
      {data.recent.length ? <OrderList rows={data.recent.map(order=>({...order,customer:order.customer||"Customer name unavailable",ready:0,date:new Date(order.date)}))}/> : <EmptyState title="No orders yet" href="/settings" action="Review store integration">Connect your store and import orders to begin your operational overview.</EmptyState>}
    </section>
    <section className={styles.surface} aria-labelledby="dashboard-production"><div className={styles.sectionHeading}><div><h2 id="dashboard-production">Production Overview</h2><p>Reading production queue entries · one per reading, not generation attempts</p></div></div><dl className={styles.production}>{production.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value.toLocaleString("en")}</dd></div>)}</dl>{!production.some(item=>item.value>0)&&<p>No queued, active, retrying or attention entries. Generated work is available from order details.</p>}<p className={styles.note}>Order metrics assign attention before production, then generated results. Canceled orders are excluded from these categories. Generated does not mean approved or delivered.</p></section>
    <aside className={styles.actions} aria-label="Workspace shortcuts"><span>Configure your workflow</span><Link className="button ghost" href="/products">Manage Products →</Link><Link className="button ghost" href="/pdf-studio">Open PDF Studio →</Link></aside>
  </div>;
}
