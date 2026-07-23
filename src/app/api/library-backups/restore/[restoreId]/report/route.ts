import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { restoreId: string } }) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const job = await prisma.libraryRestoreJob.findFirst({ where: { id: params.restoreId, userId: auth.userId }, select: { reportJson: true } });
  if (!job || !job.reportJson) return NextResponse.json({ error: "No restore report is available yet." }, { status: 404 });
  // The report is built to contain no secrets, full paths, or stack traces.
  const body = JSON.stringify(job.reportJson, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="mixarr-restore-report-${params.restoreId}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
