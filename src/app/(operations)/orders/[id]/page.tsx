import Link from "next/link";
import { notFound } from "next/navigation";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { workspaceData } from "@/modules/intake/service";
import { Heading, Card, Badge, issueLabels } from "@/components/ui";
import { InputEditor } from "@/components/input-editor";
export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await workspaceData(database(), await currentScope());
  const order = data.orders.find(o => o.id === id); if (!order) notFound();
  const lines = data.lines.filter(l => l.orderId === id);
  return <><Link href="/orders" className="back-link">← Orders</Link><Heading eyebrow={`Order #${order.externalId}`} title={order.buyerName || "Customer order"} description={`${lines.length} purchased line items. Review the context for each fulfillment unit.`} /><div className="row"><Badge>{order.canceled ? "Canceled" : order.paid ? "Paid" : "Awaiting payment"}</Badge>{order.refund !== "none" && <Badge tone="warning">Refund: {order.refund}</Badge>}</div><div className="stack order-detail">{lines.map(line => <section key={line.id}><div className="section-heading"><h2>{line.title} ×{line.quantity}</h2><span className="muted small">Variant: {line.variantKey} · SKU: {line.sku || "Not provided"}</span></div><details className="source-details"><summary>Original purchased information</summary>{line.snapshot.answers.length ? line.snapshot.answers.map((answer,i) => <p key={i} dir="auto"><strong>{answer.label}: </strong>{answer.value}</p>) : <p>No personalization was supplied.</p>}{line.snapshot.variations.map((v,i) => <p key={i}>{v.label}: {v.value}</p>)}</details><div className="grid-two">{data.units.filter(u => u.lineItemId === line.id).sort((a,b) => a.unitIndex - b.unitIndex).map(unit => {
    const context = data.inputs.find(c => c.unitId === unit.id);
    const inputLabel = data.mappings.find(m => m.listingExternalId === line.listingExternalId && m.variantKey === line.variantKey)?.required[0]?.label ?? "Customer input";
    return <Card key={unit.id}><div className="row spread"><h3>Unit {unit.unitIndex} of {line.quantity}</h3><Badge tone={unit.issues.length ? "warning" : "good"}>{unit.issues.length ? "Needs attention" : "Intake checked"}</Badge></div>{!!unit.issues.length && <ul className="issue-list">{unit.issues.map(issue => <li key={issue}>{issueLabels[issue] || issue}</li>)}</ul>}{unit.issues.includes("unmapped_listing") && <Link href="/products" className="inline-link">Configure this listing</Link>}<details><summary>Review & correct customer input</summary><InputEditor unitId={unit.id} revision={unit.revision} initial={context?.answers ?? []} allocated={unit.contextAllocated} needsAllocation={line.quantity > 1} inputLabel={inputLabel} /></details><p className="small muted">Context revision {unit.revision} · No content generated</p></Card>;
  })}</div></section>)}</div></>;
}
