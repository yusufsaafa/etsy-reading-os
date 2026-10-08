import OperationsShell from "@/components/operations-shell";
import {OnboardingShell} from "@/components/onboarding/shell";
import {requireUser,currentDestination} from "@/modules/identity/session";
export const dynamic="force-dynamic";
/** Owner configuration remains usable before onboarding completion; reuse both existing shells. */
export default async function StoreSetupLayout({children}:{children:React.ReactNode}){
 await requireUser();const destination=await currentDestination();
 return destination.kind==="OPERATIONS_HOME"?OperationsShell({children}):<OnboardingShell>{children}</OnboardingShell>;
}
