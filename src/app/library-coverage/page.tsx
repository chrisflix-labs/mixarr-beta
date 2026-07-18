import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LibraryCoverageDashboard from "@/components/LibraryCoverageDashboard";

export default function LibraryCoveragePage() {
  if (!cookies().get("mixarr_session")?.value) redirect("/");
  return <LibraryCoverageDashboard />;
}
