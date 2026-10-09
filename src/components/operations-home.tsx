import { Suspense } from "react";
import { database } from "@/db/client";
import { currentScope } from "@/modules/identity/session";
import { AccessDenied } from "@/modules/identity/service";
import type { Scope } from "@/modules/intake/contracts";
import { dashboardData } from "@/modules/dashboard/service";
import { Dashboard, DashboardError, DashboardLoading } from "./dashboard";

async function DashboardContent({ scope }: { scope: Scope }) {
  try {
    return <Dashboard data={await dashboardData(database(), scope)}/>;
  } catch (error) {
    // Authorization failures retain the application's access boundary.
    if (error instanceof AccessDenied) throw error;
    return <DashboardError/>;
  }
}
export default async function Home() {
  // Authenticate and enforce onboarding before streaming any Dashboard state.
  const scope = await currentScope();
  return <Suspense fallback={<DashboardLoading/>}><DashboardContent scope={scope}/></Suspense>;
}
