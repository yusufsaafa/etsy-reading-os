import { Suspense } from "react";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { AccessDenied } from "@/modules/identity/service";
import type { Scope } from "@/modules/intake/contracts";
import { dashboardData } from "@/modules/dashboard/service";
import { dashboardRange, type DashboardRange } from "@/modules/dashboard/range";
import { Dashboard, DashboardError, DashboardLoading } from "./dashboard";

async function DashboardContent({ scope, range, cutoff }: { scope: Scope; range: DashboardRange; cutoff: Date }) {
  try {
    return <Dashboard data={await dashboardData(database(), scope, range, cutoff)}/>;
  } catch (error) {
    // Authorization failures retain the application's access boundary.
    if (error instanceof AccessDenied) throw error;
    return <DashboardError days={range}/>;
  }
}
export default async function Home({ range }: { range?: unknown } = {}) {
  // Authenticate and enforce onboarding before streaming any Dashboard state.
  const scope = await currentScope();
  const days = dashboardRange(range), cutoff = new Date();
  return <Suspense key={days} fallback={<DashboardLoading/>}><DashboardContent scope={scope} range={days} cutoff={cutoff}/></Suspense>;
}
