import { requireUser, currentDestination } from "@/modules/identity/session";
import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/shell";
export const dynamic = "force-dynamic";
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const destination = await currentDestination();
  if (destination.kind === "OPERATIONS_HOME") redirect(destination.path);
  return <OnboardingShell>{children}</OnboardingShell>;
}
