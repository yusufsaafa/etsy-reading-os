import Link from "next/link";
import { redirect } from "next/navigation";
import { database } from "@/db/client";
import { currentStoreScope, currentDestination } from "@/modules/identity/session";
import { onboardingData } from "@/modules/onboarding/service";
import { StepHeader } from "@/components/onboarding/shell";
import { Card, Badge } from "@/components/ui";
export default async function SetupBoundary() {
  const data = await onboardingData(database(), await currentStoreScope());
  const destination = await currentDestination();
  if (destination.kind !== "PRODUCT_SETUP") redirect(destination.path);
  return <><StepHeader step={4} title="Your products are ready to set up." description="Next: configure your first product."/><Card><Badge>Setup required</Badge><h2 style={{ marginTop: 16 }}>{data.selected.length} {data.selected.length === 1 ? "product selected" : "products selected"}</h2><p>Product setup is coming next. Your selection is saved, but no products are configured or automated yet.</p><Link className="button secondary" href="/onboarding/products">Review selected products</Link></Card></>;
}
