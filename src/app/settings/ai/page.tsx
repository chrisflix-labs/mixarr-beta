import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isUserAdmin } from "@/lib/auth";
import AiProviderDashboard from "@/components/AiProviderDashboard";

export const dynamic = "force-dynamic";
export default async function AiSettingsPage() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) redirect("/");
  if (!(await isUserAdmin(userId))) redirect("/settings");
  return <AiProviderDashboard />;
}
