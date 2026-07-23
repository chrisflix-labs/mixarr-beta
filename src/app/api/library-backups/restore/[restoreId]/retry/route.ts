import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { applyRestore } from "@/lib/libraryBackup/restoreService";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";
import type { CategoryPolicies, ConflictPolicy } from "@/lib/libraryBackup/trackMatching";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { restoreId: string } }) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const job = await prisma.libraryRestoreJob.findFirst({ where: { id: params.restoreId, userId: auth.userId } });
  if (!job) return NextResponse.json({ error: "Restore job not found." }, { status: 404 });
  if (job.status === "restoring" || job.status === "matching") {
    return NextResponse.json({ error: "This restore is already running." }, { status: 409 });
  }

  // Resume from the last committed batch — already-applied records are skipped.
  void applyRestore(job.id, (job.conflictPolicy as ConflictPolicy) || "fill_missing", (job.categoryPolicyJson as CategoryPolicies) || undefined)
    .catch(async (error) => {
      console.error("[LibraryBackup] retry failed", error);
      await prisma.libraryRestoreJob.update({ where: { id: job.id }, data: { status: "failed", phase: "failed", error: String(error).slice(0, 500), finishedAt: new Date() } }).catch(() => undefined);
    });

  return NextResponse.json({ status: "resumed" }, { status: 202 });
}
