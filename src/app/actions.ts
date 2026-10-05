"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { database } from "@/db/client";
import { requireUser, currentScope } from "@/modules/identity/session";
import { createWorkspace } from "@/modules/identity/service";
import { configureMapping, correctInput } from "@/modules/intake/service";
import { answerSchema } from "@/modules/intake/contracts";
import { PostgresSyncJobs } from "@/infrastructure/jobs";
import { connectFixtures, disconnect, beginOAuth } from "@/modules/etsy/connection-service";
import { vault } from "@/infrastructure/secrets";

export async function onboard(form: FormData) {
  const user = await requireUser();
  const name = z.string().trim().min(1).max(100).parse(form.get("name"));
  const source = process.env.ETSY_ADAPTER === "fixtures" && process.env.NODE_ENV !== "production" ? "fixtures" : "etsy";
  await createWorkspace(database(), user.id, name, source);
  redirect("/store");
}
const refresh = () => revalidatePath("/", "layout");
export async function enableFixtureConnection() { await connectFixtures(database(), await currentScope()); refresh(); }
export async function disconnectStore() { await disconnect(database(), await currentScope()); refresh(); }
export async function connectEtsy() { const url = await beginOAuth(database(), await currentScope(), vault()); redirect(url); }
export async function requestSync(form: FormData) {
  const key = z.string().min(10).max(100).parse(form.get("commandKey"));
  await new PostgresSyncJobs(database()).enqueueSync(await currentScope(), key); refresh();
}
export async function saveMapping(form: FormData) {
  const listing = z.string().regex(/^[1-9]\d{0,19}$/).parse(form.get("listingId"));
  const variant = z.string().min(1).max(2000).parse(form.get("variantKey"));
  await configureMapping(database(), await currentScope(), listing, variant, form.get("paused") === "true"); refresh();
}
export async function saveInput(form: FormData) {
  const unitId = z.string().uuid().parse(form.get("unitId"));
  const revision = z.coerce.number().int().nonnegative().parse(form.get("revision"));
  const raw = z.string().max(50000).parse(form.get("answers"));
  const answers = z.array(answerSchema).max(20).parse(JSON.parse(raw));
  await correctInput(database(), await currentScope(), unitId, revision, answers, form.get("allocated") === "on"); refresh();
}
