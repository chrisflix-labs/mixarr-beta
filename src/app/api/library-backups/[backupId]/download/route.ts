import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { archiveExists, readArchive } from "@/lib/libraryBackup/backupStorage";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { backupId: string } }) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const archive = await prisma.libraryBackupArchive.findFirst({ where: { id: params.backupId, userId: auth.userId } });
  if (!archive || !archive.storedPath || !(await archiveExists(archive.storedPath))) {
    return NextResponse.json({ error: "Backup file is no longer available on the server." }, { status: 404 });
  }
  const data = await readArchive(archive.storedPath);
  return new NextResponse(Buffer.from(data), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${archive.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      "Content-Length": String(data.length),
      "Cache-Control": "no-store",
    },
  });
}
