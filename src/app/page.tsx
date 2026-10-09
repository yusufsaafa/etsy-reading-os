import { redirect } from "next/navigation";
import { currentDestination } from "@/modules/identity/session";
import OperationsShell from "@/components/operations-shell";
import OperationsHome from "@/components/operations-home";
import { Landing } from "@/components/entry/landing";
export const dynamic = "force-dynamic";
export default async function Entry({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const destination = await currentDestination();
  if (destination.kind === "PUBLIC") return <Landing/>;
  if (destination.kind !== "OPERATIONS_HOME") redirect(destination.path);
  return <OperationsShell><OperationsHome range={(await searchParams).range}/></OperationsShell>;
}
