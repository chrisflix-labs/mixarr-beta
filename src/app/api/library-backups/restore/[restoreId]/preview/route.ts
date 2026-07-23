import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { previewRestore } from "@/lib/libraryBackup/restoreService";
import { BackupValidationError } from "@/lib/libraryBackup/archiveFormat";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const job = await prisma.libraryRestoreJob.findFirst({ where: { id: params.restoreId, userId: auth.userId }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "Restore job not found." }, { status: 404 });
  try {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid restore options." }, { status: 400 });
    const preview = await previewRestore(params.restoreId, parsed.data.conflictPolicy, parsed.data.categoryPolicies);
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof BackupValidationError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("[LibraryBackup] preview failed", error);
    return NextResponse.json({ error: "Failed to build restore preview." }, { status: 500 });
  }
}
