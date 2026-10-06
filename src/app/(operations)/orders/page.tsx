import Link from "next/link";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { workspaceData } from "@/modules/intake/service";
import { Heading, EmptyState, Button } from "@/components/ui";
import { Icon } from "@/components/icon";
import { OrderList } from "@/components/order-list";
import { orderStatus, informationIssues } from "@/components/seller-status";
import { reviewAvailable } from "@/modules/review/service";
const filters = [["all","All"],["new","New"],["info","Needs info"],["ready","Ready"],["completed","Completed"],["attention","Needs attention"]];
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?:string; filter?:string }> }) {
  const scope=await currentScope(),data = await workspaceData(database(),scope);
  const reviewable=new Set((await Promise.all(data.units.map(async unit=>{const line=data.lines.find(l=>l.id===unit.lineItemId);return line&&await reviewAvailable(database(),scope,line.orderId,unit.id)?unit.id:null;}))).filter(Boolean));
  const params = await searchParams, q = typeof params.q === "string" ? params.q.slice(0,200) : "", filter = filters.some(([key]) => key === params.filter) ? params.filter : "all";
  const rows = data.orders.map(order => {
    const lines = data.lines.filter(l => l.orderId === order.id), units = data.units.filter(u => lines.some(l => l.id === u.lineItemId));
    return {id:order.id, externalId:order.externalId, customer:order.buyerName || "Customer name unavailable", products:lines.map(l => `${l.title} ×${l.quantity}`).join(" · "), count:units.length, ready:units.filter(u => reviewable.has(u.id)||!u.issues.length&&!u.productionStatus).length, status:orderStatus(units.map(u=>({...u,productionStatus:reviewable.has(u.id)?"SUCCEEDED":u.productionStatus==="SUCCEEDED"?"FAILED":u.productionStatus}))), date:order.createdAt, issues:units.flatMap(u => u.issues), needsAttention:units.some(u=>u.issues.length||!reviewable.has(u.id)&&["FAILED","STALE","SUCCEEDED"].includes(u.productionStatus??"")), canceled:order.canceled};
  }).filter(row => `${row.customer} ${row.externalId} ${row.products}`.toLocaleLowerCase().includes(q.toLocaleLowerCase())).filter(row => filter === "completed" ? false : filter === "ready" ? row.ready > 0 : filter === "info" ? row.issues.some(i => informationIssues.includes(i)) : filter === "attention" ? row.needsAttention : filter === "new" ? !row.canceled : true).sort((a,b)=>b.date.getTime()-a.date.getTime());
  return <><Heading title="Orders" description="Your daily queue. Review customer information and prepare each reading." /><form className="search-form" role="search"><input type="hidden" name="filter" value={filter} /><label className="sr-only" htmlFor="order-search">Search customer, order or product</label><div className="search-field"><Icon name="search"/><input id="order-search" name="q" defaultValue={q} maxLength={200} placeholder="Search customer, order or product" type="search" /></div><Button className="secondary">Search</Button></form><div className="filter-tabs" aria-label="Order filters">{filters.filter(([key]) => key !== "attention" || filter === "attention").map(([key,label])=><Link key={key} href={`/orders?filter=${key}&q=${encodeURIComponent(q)}`} aria-current={filter === key ? "page" : undefined}>{label}</Link>)}</div><p className="small muted queue-note">{rows.length} orders · New means received and awaiting creation. Eligible readings can be prepared from their order details. Sending remains unavailable.</p>{rows.length ? <OrderList rows={rows} /> : <EmptyState title={data.orders.length ? "No matching orders" : "Your orders will appear here"} href={data.orders.length ? "/orders" : "/settings"} action={data.orders.length ? "View all orders" : "Connect your store"}>{filter === "completed" ? "Completed readings will appear here when review and sending become available." : "Try another filter or check your store connection."}</EmptyState>}</>;
}
