"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { database } from "@/db/client";
import { requireUser, currentStoreScope } from "@/modules/identity/session";
import { createOnboardingStore, saveProductSelection, startProductImport, onboardingData } from "@/modules/onboarding/service";
import { beginOAuth, connectFixtures, disconnect } from "@/modules/etsy/connection-service";
import { PostgresSyncJobs } from "@/infrastructure/jobs";
import { vault } from "@/infrastructure/secrets";
export type FormState = { error?: string };
export async function createStoreAction(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = form.get("name");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) return { error: "Enter a store name between 1 and 100 characters." };
  try { await createOnboardingStore(database(), user.id, name, process.env.NODE_ENV !== "production" && process.env.ETSY_ADAPTER === "fixtures" ? "fixtures" : "etsy"); }
  catch { return { error: "We couldn't create your store. Please try again." }; }
  redirect("/onboarding");
}
export async function connectAction(_previous: FormState): Promise<FormState> {
  const scope = await currentStoreScope();
  let destination: string;
  try {
    const data = await onboardingData(database(), scope);
    if (data.store.source === "fixtures") {
      if (data.connection.kind !== "connected") await connectFixtures(database(), scope);
      await startProductImport(database(), new PostgresSyncJobs(database()), scope);
      destination = "/onboarding/products";
    } else destination = await beginOAuth(database(), scope, vault());
  } catch { return { error: "We couldn't connect your shop. Please try again or check that Etsy connection is available." }; }
  redirect(destination);
}
export async function continueToProductsAction(_previous: FormState): Promise<FormState> {
  const scope = await currentStoreScope();
  try { await startProductImport(database(), new PostgresSyncJobs(database()), scope); }
  catch { return { error: "Your shop is connected, but product imports aren't available yet. Your products have not been imported. Please try again when Etsy imports are enabled." }; }
  redirect("/onboarding/products");
}
export async function selectProductsAction(_previous: FormState, form: FormData): Promise<FormState> {
  const scope = await currentStoreScope();
  if (!form.getAll("listing").length) return { error: "Select at least one product to continue." };
  try { await saveProductSelection(database(), scope, form.getAll("listing")); }
  catch { return { error: "We couldn't save your selection. Check your Etsy connection and choose available products from your shop." }; }
  revalidatePath("/onboarding", "layout");
  redirect("/onboarding/products/setup");
}
export async function retryImportAction(_previous: FormState): Promise<FormState> {
  const scope = await currentStoreScope();
  try { await new PostgresSyncJobs(database()).enqueueSync(scope, `onboarding-retry-${randomUUID()}`); }
  catch { return { error: "Products couldn't be imported. Check your Etsy connection and try again." }; }
  revalidatePath("/onboarding/products");
  return {};
}

export async function disconnectOnboardingAction(_previous: FormState): Promise<FormState> {
  const scope = await currentStoreScope();
  try { await disconnect(database(), scope); }
  catch { return { error: "We couldn't disconnect your shop. Please try again." }; }
  revalidatePath("/onboarding", "layout");
  redirect("/onboarding/etsy");
}
