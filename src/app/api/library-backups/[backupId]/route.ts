import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { deleteArchive } from "@/lib/libraryBackup/backupStorage";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";
import { serializeArchiveSummary } from "@/lib/libraryBackup/apiSerialization";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { backupId: string } }) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const archive = await prisma.libraryBackupArchive.findFirst({ where: { id: params.backupId, userId: auth.userId } });
  if (!archive) return NextResponse.json({ error: "Backup not found." }, { status: 404 });
  return NextResponse.json({ archive: serializeArchiveSummary(archive), manifest: archive.manifestJson ?? null });
}

export async function DELETE(_request: Request, { params }: { params: { backupId: string } }) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const archive = await prisma.libraryBackupArchive.findFirst({ where: { id: params.backupId, userId: auth.userId } });
  if (!archive) return NextResponse.json({ error: "Backup not found." }, { status: 404 });
  await deleteArchive(archive.storedPath);
  await prisma.libraryBackupArchive.delete({ where: { id: archive.id } });
  return NextResponse.json({ status: "deleted" });
}
