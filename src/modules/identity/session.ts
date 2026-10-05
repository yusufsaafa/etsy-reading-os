import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { database } from "@/db/client";
import { memberships, stores } from "@/db/schema";
import { authorizeStore } from "./service";
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return session.user;
}
export async function currentScope() {
  const user = await requireUser();
  const [store] = await database().select({ id: stores.id }).from(stores).innerJoin(memberships, and(eq(memberships.organizationId, stores.organizationId), eq(memberships.userId, user.id))).limit(1);
  if (!store) redirect("/onboarding");
  return authorizeStore(database(), user.id, store.id);
}
