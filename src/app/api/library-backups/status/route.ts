import { NextResponse } from "next/server";
import { getLibraryBackupCoverage } from "@/lib/libraryBackup/backupCoverage";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  try {
    const libraryId = new URL(request.url).searchParams.get("libraryId") || undefined;
    const coverage = await getLibraryBackupCoverage(auth.userId, libraryId);
    return NextResponse.json(coverage, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[LibraryBackup] status failed", error);
    return NextResponse.json({ error: "Unable to load backup coverage." }, { status: 500 });
  }
}
