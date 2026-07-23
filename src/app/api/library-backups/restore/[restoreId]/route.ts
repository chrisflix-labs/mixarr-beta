import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";
import { serializeRestoreJob } from "@/lib/libraryBackup/apiSerialization";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { restoreId: string } }) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const job = await prisma.libraryRestoreJob.findFirst({ where: { id: params.restoreId, userId: auth.userId } });
  if (!job) return NextResponse.json({ error: "Restore job not found." }, { status: 404 });
  return NextResponse.json({ restore: serializeRestoreJob(job) }, { headers: { "Cache-Control": "no-store" } });
}
