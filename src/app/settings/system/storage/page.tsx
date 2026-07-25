import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import StorageDiagnostics from "@/components/StorageDiagnostics";
import { requireAdminUser } from "@/lib/auth";
import { getStorageDiagnostics } from "@/lib/storageMaintenance";

export const dynamic = "force-dynamic";

export default async function StoragePage() {
  try { await requireAdminUser(cookies().get("mixarr_session")?.value); } catch { redirect("/settings"); }
  const diagnostics = await getStorageDiagnostics();
  return <main style={{ maxWidth: 1200, margin: "0 auto", padding: "1rem" }}><StorageDiagnostics initial={diagnostics}/></main>;
}
