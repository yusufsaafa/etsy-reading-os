import { auth } from "@/auth";
import { database } from "@/db/client";
import { completeOAuth } from "@/modules/etsy/connection-service";
import { onboardingDestination } from "@/modules/onboarding/service";
import { vault } from "@/infrastructure/secrets";
export async function GET(request: Request) {
  const session = await auth();
  const appUrl = process.env.APP_URL;
  if (!appUrl || !session?.user?.id) return new Response("Authentication required", { status: 401, headers: { "Cache-Control": "no-store" } });
  const destination = await onboardingDestination(database(), session.user.id);
  const target = new URL(destination === "/" ? "/store" : "/onboarding/etsy", appUrl), incoming = new URL(request.url);
  try {
    await completeOAuth(database(), session.user.id, incoming.searchParams.get("state") ?? "", incoming.searchParams.get("code") ?? "", vault());
    target.searchParams.set("notice", "connected");
  } catch {
    target.searchParams.set("notice", "authorization_failed");
  }
  return Response.redirect(target, 303);
}
