import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { database } from "@/db/client";
import { resolveSellerDestination } from "../onboarding/destination";
import { authorizeStore, findUserStore } from "./service";
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return session.user;
}
export async function currentStoreScope() {
  const user = await requireUser();
  const store = await findUserStore(database(), user.id);
  if (!store) redirect("/onboarding");
  return authorizeStore(database(), user.id, store.id);
}

export async function currentScope() {
  const scope = await currentStoreScope();
  const destination = await resolveSellerDestination(database(), scope.userId);
  if (destination.kind !== "OPERATIONS_HOME") redirect(destination.path);
  return scope;
}

export async function currentDestination() {
  const user = (await auth())?.user;
  return resolveSellerDestination(user?.id ? database() : undefined, user?.id);
}
