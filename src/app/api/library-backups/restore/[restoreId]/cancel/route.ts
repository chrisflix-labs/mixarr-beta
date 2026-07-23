import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requestCancel } from "@/lib/libraryBackup/restoreService";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { restoreId: string } }) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const job = await prisma.libraryRestoreJob.findFirst({ where: { id: params.restoreId, userId: auth.userId }, select: { id: true, status: true } });
  if (!job) return NextResponse.json({ error: "Restore job not found." }, { status: 404 });
  // Cancellation is only safe before the final commit; completed jobs are immutable.
  if (["completed", "completed_with_warnings", "failed", "canceled"].includes(job.status)) {
    return NextResponse.json({ error: "This restore can no longer be canceled." }, { status: 409 });
  }
  await requestCancel(job.id);
  return NextResponse.json({ status: "cancel_requested" });
}
