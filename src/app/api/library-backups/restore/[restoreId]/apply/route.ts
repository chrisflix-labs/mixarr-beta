import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { applyRestore } from "@/lib/libraryBackup/restoreService";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";
import type { CategoryPolicies, ConflictPolicy } from "@/lib/libraryBackup/trackMatching";

export const dynamic = "force-dynamic";

const policyEnum = z.enum(["fill_missing", "prefer_backup", "keep_current"]);
const schema = z.object({
  conflictPolicy: policyEnum.default("fill_missing"),
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
  const job = await prisma.libraryRestoreJob.findFirst({ where: { id: params.restoreId, userId: auth.userId }, select: { id: true, status: true } });
  if (!job) return NextResponse.json({ error: "Restore job not found." }, { status: 404 });
  if (job.status === "restoring" || job.status === "matching") {
    return NextResponse.json({ error: "This restore is already running." }, { status: 409 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid restore options." }, { status: 400 });

  // Run in the background so the restore continues even if the browser closes.
  void applyRestore(params.restoreId, parsed.data.conflictPolicy as ConflictPolicy, parsed.data.categoryPolicies as CategoryPolicies | undefined)
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
