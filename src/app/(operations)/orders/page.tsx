import Link from "next/link";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { workspaceData } from "@/modules/intake/service";
import { Heading, Card, Badge, EmptyState } from "@/components/ui";
export default async function OrdersPage() {
  const data = await workspaceData(database(), await currentScope());
  return <><Heading eyebrow="Orders" title="Every checkout. Every item." description="Purchased quantities are tracked independently within their original order." /><div className="stack">{data.orders.map(order => {
    const lines = data.lines.filter(l => l.orderId === order.id), units = data.units.filter(u => lines.some(l => l.id === u.lineItemId)), count = units.filter(u => u.issues.length).length;
    return <Link key={order.id} href={`/orders/${order.id}`} className="order-link"><Card><div className="row spread"><strong>Order #{order.externalId}</strong><Badge tone={count ? "warning" : "good"}>{count ? `${count} units need attention` : "Intake checks passed"}</Badge></div><h2 dir="auto">{order.buyerName || "Buyer name unavailable"}</h2><p className="muted">{lines.map(l => `${l.title} ×${l.quantity}`).join(" · ")}</p><div className="row spread small"><span>{lines.length} line items · {units.length} fulfillment units</span><span>{order.canceled ? "Canceled" : order.paid ? "Paid" : "Awaiting payment"}</span></div></Card></Link>;
  })}{!data.orders.length && <EmptyState title="No orders imported" href="/store" action="Synchronize store">Imported orders will appear here. No output is generated during intake.</EmptyState>}</div></>;
}
