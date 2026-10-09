import { eq, and } from "drizzle-orm";
import { currentScope, requireUser } from "@/modules/identity/session";
import { database } from "@/db/client";
import { stores } from "@/db/schema";
import { ApplicationFrame } from "@/components/application-frame";
export const dynamic = "force-dynamic";
export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const scope = await currentScope();
  const user = await requireUser();
  const [store] = await database().select({ name: stores.name, source: stores.source }).from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId)));
  return <ApplicationFrame storeName={store.name} demo={store.source === "fixtures"} accountName={user.name || "Store owner"}>{children}<footer className="footer">The term ‘Etsy’ is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.</footer></ApplicationFrame>;
}
