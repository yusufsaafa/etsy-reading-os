import { redirect } from "next/navigation";
import { requireUser } from "@/modules/identity/session";
import { database } from "@/db/client";
import { userStore } from "@/modules/onboarding/service";
import { StepHeader } from "@/components/onboarding/shell";
import { StoreForm } from "@/components/onboarding/forms";
export default async function CreateStore() {
  const user = await requireUser();
  if (await userStore(database(), user.id)) redirect("/onboarding");
  return <><StepHeader step={1} title="Let's set up your store." description="Create your Reading OS workspace. You'll connect your Etsy shop next."/><StoreForm/></>;
}
