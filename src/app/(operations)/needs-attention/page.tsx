import Link from "next/link";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { workspaceData } from "@/modules/intake/service";
import { Heading, Card, Badge, EmptyState, issueLabels } from "@/components/ui";
export default async function AttentionPage() {
  const data = await workspaceData(database(), await currentScope());
  const affected = data.units.filter(u => u.issues.length);
  return <><Heading eyebrow="Needs Attention" title="Resolve what’s holding intake" description="Issues are attached to individual purchased units. Connection and sync issues are shown in Store." /><Link className="inline-link" href="/store">Check connection & sync health</Link><div className="stack">{affected.map(unit => {
    const line = data.lines.find(l => l.id === unit.lineItemId)!, order = data.orders.find(o => o.id === line.orderId)!;
    return <Card key={unit.id}><div className="row spread"><h2>{line.title}</h2><Badge tone="warning">Unit {unit.unitIndex} of {line.quantity}</Badge></div><p className="muted">Order #{order.externalId} · {order.buyerName}</p><ul className="issue-list">{unit.issues.map(issue => <li key={issue}>{issueLabels[issue] || issue}</li>)}</ul><Link className="button" href={`/orders/${order.id}`}>Review purchased unit</Link></Card>;
  })}{!affected.length && <EmptyState title="No unit issues to resolve" href="/orders" action="View orders">Imported units have passed their current intake checks. This does not mean content was produced or delivered.</EmptyState>}</div></>;
}
