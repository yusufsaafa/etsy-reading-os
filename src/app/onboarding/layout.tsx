import { requireUser } from "@/modules/identity/session";
import { OnboardingShell } from "@/components/onboarding/shell";
export const dynamic = "force-dynamic";
export default async function Layout({ children }: { children: React.ReactNode }) { await requireUser(); return <OnboardingShell>{children}</OnboardingShell>; }
