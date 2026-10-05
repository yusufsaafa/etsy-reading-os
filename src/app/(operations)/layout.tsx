import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { currentScope } from "@/modules/identity/session";
import { database } from "@/db/client";
import { stores } from "@/db/schema";
import { signOut } from "@/auth";
export const dynamic = "force-dynamic";
const navigation = [["/", "Overview"], ["/orders", "Orders"], ["/needs-attention", "Attention"], ["/products", "Products"], ["/store", "Store"]];
export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const scope = await currentScope();
  const [store] = await database().select({ name: stores.name, source: stores.source }).from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId)));
  return <div className="app-shell"><aside className="sidebar"><Link href="/" className="wordmark">Reading<span>OS</span></Link><div className="store-label"><span className="eyebrow">Your workspace</span><strong>{store.name}</strong>{store.source === "fixtures" && <span className="demo-label">Synthetic demo data</span>}</div><nav aria-label="Main navigation">{navigation.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</nav><form action={async () => { "use server"; await signOut({ redirectTo: "/sign-in" }); }}><button className="text-button">Sign out</button></form></aside><main id="main-content" className="main-content"><a href="#page-content" className="skip-link">Skip to content</a><div id="page-content">{children}</div><footer className="footer">The term ‘Etsy’ is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.</footer></main></div>;
}
