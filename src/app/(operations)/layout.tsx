import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { currentScope } from "@/modules/identity/session";
import { database } from "@/db/client";
import { stores } from "@/db/schema";
import { Icon } from "@/components/icon";
import { Navigation } from "@/components/navigation";
export const dynamic = "force-dynamic";
export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const scope = await currentScope();
  const [store] = await database().select({ name: stores.name, source: stores.source }).from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId)));
  return <div className="app-shell"><a href="#main-content" className="skip-link">Skip to content</a><aside className="sidebar"><Link href="/" className="wordmark">Reading<span>OS</span></Link><div className="workspace-label">Seller workspace</div><Navigation /><Link href="/settings" className="sidebar-account"><span className="store-avatar"><Icon name="store"/></span><div className="store-label"><strong dir="auto">{store.name}</strong><span className="demo-label">{store.source === "fixtures" ? "Demo store · sample orders" : "Store settings"}</span></div></Link></aside><main id="main-content" className="main-content">{children}<footer className="footer">The term ‘Etsy’ is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.</footer></main></div>;
}
