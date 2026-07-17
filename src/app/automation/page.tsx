import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AutomationPoliciesWorkspace from "@/components/AutomationPoliciesWorkspace";

export const metadata = { title: "Automation Policies | Mixarr", description: "Control, review, and reverse Mixarr playlist automation" };
export default function AutomationPoliciesPage() {
  if (!cookies().get("mixarr_session")?.value) redirect("/");
  return <AutomationPoliciesWorkspace />;
}
