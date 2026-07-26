import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { applyRestore } from "@/lib/libraryBackup/restoreService";
import { isRestoreDryRunPreview } from "@/lib/libraryBackup/apiSerialization";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";
import type { CategoryPolicies, ConflictPolicy } from "@/lib/libraryBackup/trackMatching";

export const dynamic = "force-dynamic";

const policyEnum = z.enum(["fill_missing", "prefer_backup", "keep_current"]);
const schema = z.object({
  conflictPolicy: policyEnum.default("fill_missing"),
  confirmPartial: z.boolean().default(false),
  categoryPolicies: z
    .object({
      audio_features: policyEnum.optional(),
      bpm: policyEnum.optional(),
      popularity: policyEnum.optional(),
      genres: policyEnum.optional(),
      no_data: policyEnum.optional(),
    })
    .optional(),
});

export async function POST(request: Request, { params }: { params: { restoreId: string } }) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const job = await prisma.libraryRestoreJob.findFirst({ where: { id: params.restoreId, userId: auth.userId }, select: { id: true, status: true, previewJson: true } });
  if (!job) return NextResponse.json({ error: "Restore job not found." }, { status: 404 });
  if (job.status === "restoring" || job.status === "matching") {
    return NextResponse.json({ error: "This restore is already running." }, { status: 409 });
  }
  if (!isRestoreDryRunPreview(job.previewJson)) {
    return NextResponse.json({ error: "Run the restore dry run before applying this backup." }, { status: 409 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid restore options." }, { status: 400 });
  const preview = job.previewJson && typeof job.previewJson === "object" ? job.previewJson as Record<string, unknown> : null;
  const matches = preview?.matches && typeof preview.matches === "object" ? preview.matches as Record<string, unknown> : null;
  const partialCount = Number(matches?.unmatched ?? 0) + Number(matches?.ambiguous ?? 0) + Number(preview?.invalidRecords ?? 0);
  if (partialCount > 0 && !parsed.data.confirmPartial) {
    return NextResponse.json({
      error: `Restore dry run is partial (${partialCount} unmatched, ambiguous, or invalid records). Explicit partial-restore confirmation is required.`,
    }, { status: 409 });
  }

  // Run in the background so the restore continues even if the browser closes.
  void applyRestore(params.restoreId, parsed.data.conflictPolicy as ConflictPolicy, parsed.data.categoryPolicies as CategoryPolicies | undefined, parsed.data.confirmPartial)
    .then(() => {
      revalidatePath("/");
      revalidatePath("/data-enrichment");
      revalidatePath("/settings/system/library-backup");
    })
    .catch(async (error) => {
      console.error("[LibraryBackup] apply failed", error);
      await prisma.libraryRestoreJob.update({ where: { id: params.restoreId }, data: { status: "failed", phase: "failed", error: String(error).slice(0, 500), finishedAt: new Date() } }).catch(() => undefined);
    });

  return NextResponse.json({ status: "started" }, { status: 202 });
}
