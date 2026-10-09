import Link from "next/link";
import type { DashboardData, DashboardIntegration, DashboardOrder } from "@/modules/dashboard/service";
import { Heading, Badge } from "./ui";
import { displayDate } from "./seller-status";
import styles from "./dashboard.module.css";
import { Icon, type IconName } from "./icon";
import { InformationPopover } from "./information-popover";

export function integrationPresentation(integration: DashboardIntegration) {
  const name = integration.source === "fixtures" ? "Demo store" : "Etsy";
  if (!integration.connectionStatus) return { label: "Connection unavailable", guidance: "Review your store connection in Settings.", action: true };
  if (integration.connectionStatus === "disconnected") return { label: `${name} disconnected`, guidance: "Connect your store from Settings to get started.", action: true };
  if (integration.connectionStatus === "reauthorization_required") return { label: "Reauthorization required", guidance: "Review your authorization in Settings.", action: true };
  if (integration.expired) return { label: "Authorization expired", guidance: "Review your expired store authorization in Settings.", action: true };
  if (integration.syncStatus === "queued") return { label: "Import queued", guidance: "The import is queued. Check its progress in Settings.", action: false };
  if (integration.syncStatus === "running") return { label: "Import running", guidance: "An import is running. Imported orders will appear after refreshing this view.", action: false };
  if (integration.syncStatus === "failed") return { label: "Import needs attention", guidance: "The last import failed. Review store updates in Settings.", action: true };
  if (integration.syncStatus === "succeeded") return { label: `${name} connected`, guidance: "The last import finished. No orders have been imported into Reading OS.", action: false };
  return { label: `${name} connected`, guidance: integration.source === "etsy" ? "No imported orders yet. Live updates are not enabled; review available import options in Settings." : "No imported orders yet. Review demo updates in Settings.", action: false };
}

function DashboardHeader({ days }: { days: number }) {
  return <header className={styles.header}><h1>Dashboard</h1><nav className={styles.ranges} aria-label="Dashboard date range">{[7,30,90].map(range=><Link key={range} href={`/?range=${range}`} aria-current={days===range?"page":undefined}>{range} days</Link>)}</nav></header>;
}
export function DashboardLoading() {
  return <div className={styles.dashboard} aria-busy="true" aria-label="Loading Dashboard"><Heading title="Dashboard"/><div className={styles.metrics}>{[1,2,3,4].map(n=><div className={styles.skeleton} key={n}/>)}</div><div className={styles.grid}><div className={styles.skeletonPanel}/><div className={styles.skeletonPanel}/></div></div>;
}
export function DashboardError({ days = 30 }: { days?: number }) {
  return <div className={styles.dashboard}><Heading title="Dashboard"/><section className={styles.panel} role="alert"><h2>Dashboard unavailable</h2><p>Refresh to try again. Your counts could not be loaded.</p><a className="button" href={`/?range=${days}`}>Reload Dashboard</a><Link className="button ghost" href="/orders">Open Orders</Link></section></div>;
}
function DashboardEmpty({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return <div className={styles.empty}><span className={styles.emptyIcon}><Icon name={icon}/></span><p>{children}</p></div>;
}
function OrderTrend({ analytics }: { analytics: DashboardData["analytics"] }) {
  const { daily, orders, days } = analytics;
  const max = Math.max(1,...daily.map(day=>day.count));
  const width=540,height=120,left=38,top=12,step=width/daily.length;
  const ticks=[...new Set([0,Math.ceil(max/2),max])];
  const labels=[...new Set([0,Math.floor((daily.length-1)/2),daily.length-1])];
  const shortDate=(date:string)=>new Intl.DateTimeFormat("en",{month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(`${date}T00:00:00Z`));
  return <section className={styles.panel} aria-labelledby="order-trend-title"><div className={styles.sectionHeading}><h2 id="order-trend-title">Order Activity</h2></div><p className={styles.context}>Imported orders · Last {days} days · UTC</p>
    {orders ? <><svg className={styles.chart} viewBox="0 0 600 170" aria-hidden="true">{ticks.map(tick=>{const y=top+height-(tick/max)*height;return <g key={tick}><line x1={left} x2={left+width} y1={y} y2={y} className={styles.gridline}/><text x={left-8} y={y+4} textAnchor="end" className={styles.chartLabel}>{tick}</text></g>;})}{daily.map((day,index)=><rect key={day.date} x={left+index*step+step*.15} y={top+height-day.count/max*height} width={step*.7} height={day.count/max*height} rx={Math.min(2,step*.15)} className={styles.bar}/>)}{labels.map(index=><text key={index} x={left+index*step+step/2} y="157" textAnchor={index===0?"start":index===daily.length-1?"end":"middle"} className={styles.chartLabel}>{shortDate(daily[index].date)}</text>)}</svg><InformationPopover label="Daily values · Today is partial" dialog><div className={styles.dataScroll} tabIndex={0} role="region" aria-label="Daily order values"><table><caption>Imported orders by UTC purchase date, including canceled orders</caption><thead><tr><th scope="col">Date</th><th scope="col">Orders</th></tr></thead><tbody>{daily.map(day=><tr key={day.date}><th scope="row">{day.date}</th><td>{day.count}</td></tr>)}</tbody></table></div></InformationPopover></> : <DashboardEmpty icon="orders">No imported orders in this period.</DashboardEmpty>}
  </section>;
}
function Attention({ data }: { data: DashboardData }) {
  return <section className={`${styles.panel} ${data.metrics.attention ? styles.attentionPanel : ""}`} aria-labelledby="dashboard-attention"><div className={styles.sectionHeading}><h2 id="dashboard-attention">Requires Attention</h2>{data.metrics.attention>0&&<Badge tone="warning">{data.metrics.attention} {data.metrics.attention===1?"order":"orders"}</Badge>}</div>{data.metrics.attention>0?<ul className={styles.attention}>{data.attention.map(order=><li key={order.id}><div className={styles.identity}><strong>Order #{order.externalId}</strong><span>{order.status}</span></div><Link className="button ghost" href={`/orders/${order.id}`} aria-label={`Review order ${order.externalId}`}>Review →</Link></li>)}</ul>:<div className={styles.clear}><span className={styles.clearMark} aria-hidden="true">✓</span><div><strong>All clear</strong><span>No orders need attention.</span></div></div>}</section>;
}
function RecentOrders({ rows }: { rows: DashboardOrder[] }) {
  // The shared Orders table uses viewport breakpoints; this bounded list retains
  // its data and links without squeezing five table columns into the grid.
  return <section className={styles.panel} aria-labelledby="dashboard-recent"><div className={styles.sectionHeading}><h2 id="dashboard-recent">Recent Orders</h2><InformationPopover label="Recent Orders information" iconOnly><p>Recent Orders shows the latest five lifetime purchases.</p></InformationPopover><Link href="/orders" className={styles.textLink}>View all orders →</Link></div>{rows.length ? <ul className={styles.recent}>{rows.map(order=><li key={order.id}><div className={styles.identity}><Link href={`/orders/${order.id}`} aria-label={`Open order ${order.externalId}`}>Order #{order.externalId}</Link><span className={styles.productTitle}>{order.products || "Order details"}</span></div><div className={styles.orderStatus}><Badge>{order.status}</Badge></div><time dateTime={order.date}>{displayDate(new Date(order.date))}</time></li>)}</ul> : <DashboardEmpty icon="orders">No imported orders yet.</DashboardEmpty>}</section>;
}
function TopProducts({ products }: { products: DashboardData["analytics"]["topProducts"] }) {
  const max=Math.max(1,...products.map(product=>product.orders));
  return <section className={styles.panel} aria-labelledby="dashboard-products"><div className={styles.sectionHeading}><h2 id="dashboard-products">Top Products</h2><InformationPopover label="Top Products information" iconOnly><p>Top Products counts each listing once per order, not purchased units; canceled orders are included.</p></InformationPopover><Link href="/products" className={styles.textLink}>Manage →</Link></div><p className={styles.context}>Listings by distinct imported orders</p>{products.length ? <ol className={styles.ranking}>{products.map(product=><li key={product.listingId}><div><span className={styles.productTitle}>{product.title}</span><strong>{product.orders}<span className="sr-only"> {product.orders===1?"order":"orders"}</span></strong></div><div className={styles.track} aria-hidden="true"><span style={{width:`${product.orders/max*100}%`}}/></div></li>)}</ol> : <DashboardEmpty icon="products">No product activity in this period.</DashboardEmpty>}</section>;
}
export function Dashboard({ data }: { data: DashboardData }) {
  const { analytics, metrics, production }=data;
  const period=`Last ${analytics.days} days`, emptyStore=metrics.total===0;
  const integration=integrationPresentation(data.integration);
  const cards=[{label:"Orders",value:analytics.orders.toLocaleString("en"),context:period},{label:"Generated Orders",value:metrics.generated.toLocaleString("en"),context:"Now"},{label:"Issues",value:metrics.attention.toLocaleString("en"),context:"Now"},{label:"Avg AI Execution",value:analytics.averageAiMs===null?"—":`${(analytics.averageAiMs/1000).toFixed(1)}s`,context:period}];
  const definitions:Record<string,string>={
    Orders:"Imported purchases in the selected UTC period, including canceled orders. Today is partial.",
    "Generated Orders":"Current orders whose readings all have successful, current results, with no higher-priority attention or production state. Not approval, PDF completion or delivery.",
    Issues:"Current distinct noncanceled orders needing attention, regardless of purchase date. Failures precede stale results, then information or setup issues.",
    "Avg AI Execution":`Successful Google reading AI requests finishing in this period, measured through response validation. Excludes failed attempts, fake providers, queue waiting and retry backoff. ${analytics.aiSamples} eligible ${analytics.aiSamples===1?"sample":"samples"}.`,
  };
  const activity=[{label:"Queued",count:production.queued},{label:"Active",count:production.active},{label:"Retrying",count:production.retry},{label:"Needs attention",count:production.attention}].filter(item=>item.count>0);
  return <div className={styles.dashboard} data-layout="unified" data-activity={emptyStore?"empty":"populated"}>
    <DashboardHeader days={analytics.days}/>
    <div className={styles.integration}><Badge tone={integration.action?"warning":"neutral"}>{integration.label}</Badge>{emptyStore&&<InformationPopover label="Connection details" iconOnly><p>{integration.guidance}</p></InformationPopover>}{(integration.action||emptyStore)&&<Link href="/settings">Review Settings →</Link>}</div>
    <section aria-label="Operational overview"><dl className={styles.metrics}>{cards.map(card=><div className={styles.metric} key={card.label}><dt>{card.label}<InformationPopover label={`${card.label} definition`} iconOnly><p>{definitions[card.label]}</p>{card.label==="Orders"&&<p>Statistics reflect orders persisted in Reading OS, not necessarily all Etsy shop activity.</p>}</InformationPopover></dt><dd>{card.value}<span>{card.context}</span></dd></div>)}</dl></section>

    <div className={styles.grid}><OrderTrend analytics={analytics}/><Attention data={data}/><RecentOrders rows={data.recent}/><TopProducts products={analytics.topProducts}/></div>
    {activity.length>0&&<section className={styles.production} aria-label="Reading production queue activity"><strong>Reading queue</strong>{activity.map(item=><span key={item.label}>{item.label} <b>{item.count}</b></span>)}</section>}
  </div>;
}
