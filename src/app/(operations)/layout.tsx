import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { currentScope } from "@/modules/identity/session";
import { database } from "@/db/client";
import { stores } from "@/db/schema";
import { Navigation } from "@/components/navigation";
export const dynamic = "force-dynamic";
export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const scope = await currentScope();
  const [store] = await database().select({ name: stores.name, source: stores.source }).from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId)));
  return <div className="app-shell"><a href="#main-content" className="skip-link">Skip to content</a><aside className="sidebar"><Link href="/" className="wordmark">Reading<span>OS</span></Link><div className="store-label"><strong dir="auto">{store.name}</strong>{store.source === "fixtures" && <span className="demo-label">Demo store · sample orders</span>}</div><Navigation /><p className="sidebar-note">Your daily reading workspace</p></aside><main id="main-content" className="main-content">{children}<footer className="footer">The term ‘Etsy’ is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.</footer></main></div>;
}
