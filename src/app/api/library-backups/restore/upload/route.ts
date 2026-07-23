import { NextResponse } from "next/server";
import { createRestoreJobFromUpload } from "@/lib/libraryBackup/restoreService";
import { BackupValidationError, LIMITS } from "@/lib/libraryBackup/archiveFormat";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A backup file is required." }, { status: 400 });
    }
    if (file.size > LIMITS.maxArchiveBytes) {
      return NextResponse.json({ error: "Backup file exceeds the maximum allowed size." }, { status: 413 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await createRestoreJobFromUpload(auth.userId, file.name || "upload.mixarr-library-backup", buffer);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BackupValidationError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("[LibraryBackup] restore upload failed", error);
    return NextResponse.json({ error: "Failed to process the uploaded backup." }, { status: 500 });
  }
}
