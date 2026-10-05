import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { workspaceData } from "@/modules/intake/service";
import { Heading, Card, Badge, EmptyState } from "@/components/ui";
import { ActionForm } from "@/components/submit";
import { saveMapping } from "@/app/actions";
export default async function ProductsPage() {
  const data = await workspaceData(database(), await currentScope());
  return <><Heading eyebrow="Products & listings" title="Make every purchase identifiable" description="Configure intake requirements per listing or purchased variant. Production recipes will follow in the next milestone." /><div className="stack">{data.listings.map(listing => {
    const variants = [...new Set(["default", ...data.lines.filter(l => l.listingExternalId === listing.externalId).map(l => l.variantKey)])];
    return <Card key={listing.id}><div className="row spread"><h2>{listing.title}</h2><Badge>{listing.state}</Badge></div><p className="muted small">Etsy listing #{listing.externalId}</p><p>Required input: {listing.snapshot.personalization.filter(p => p.required).map(p => p.label).join(", ") || "None configured on source listing"}</p><div className="stack">{variants.map(variant => {
      const mapping = data.mappings.find(m => m.listingExternalId === listing.externalId && m.variantKey === variant);
      return <div key={variant} className="mapping-row"><div><strong>{variant === "default" ? "Default purchase" : `Purchased variant ${variant}`}</strong><p className="muted small">{!mapping ? "Not configured" : mapping.paused ? "Paused" : "Intake configured"}</p></div><ActionForm action={saveMapping} label={!mapping ? "Configure intake" : mapping.paused ? "Resume intake" : "Pause intake"} secondary={!!mapping && !mapping.paused}><input type="hidden" name="listingId" value={listing.externalId} /><input type="hidden" name="variantKey" value={variant} /><input type="hidden" name="paused" value={mapping && !mapping.paused ? "true" : "false"} /></ActionForm></div>;
    })}</div></Card>;
  })}{!data.listings.length && <EmptyState title="No listings imported" href="/store" action="Open store">Synchronize to import listings. This platform does not change your Etsy listing settings.</EmptyState>}</div></>;
}
