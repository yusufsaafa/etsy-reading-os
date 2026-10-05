import { requireUser } from "@/modules/identity/session";
import { onboard } from "@/app/actions";
import { Heading, Card, Button } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Onboarding() {
  await requireUser();
  return <main className="auth-shell"><Heading eyebrow="Get started" title="Create your workspace" description="A workspace keeps your store’s orders and customer information isolated." /><Card><form action={onboard} className="stack"><label>Store / workspace name<input name="name" required maxLength={100} placeholder="Your reading studio" /></label><Button>Create workspace</Button></form></Card></main>;
}
