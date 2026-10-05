import { redirect } from "next/navigation";
import { requireUser } from "@/modules/identity/session";
import { database } from "@/db/client";
import { onboardingDestination } from "@/modules/onboarding/service";
export default async function Onboarding() { const user = await requireUser(); redirect(await onboardingDestination(database(), user.id)); }
