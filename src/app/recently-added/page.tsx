import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import RecentlyAddedWorkspace from "@/components/RecentlyAddedWorkspace";

export const metadata = { title: "Recently Added Automation | Mixarr", description: "Review and configure new music automation" };

export default function RecentlyAddedPage() {
  if (!cookies().get("mixarr_session")?.value) redirect("/");
  return <RecentlyAddedWorkspace />;
}

