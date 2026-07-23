import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";
import { serializeBackupJob } from "@/lib/libraryBackup/apiSerialization";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { jobId: string } }) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const job = await prisma.libraryBackupJob.findFirst({ where: { id: params.jobId, userId: auth.userId } });
  if (!job) return NextResponse.json({ error: "Backup job not found." }, { status: 404 });
  return NextResponse.json({ job: serializeBackupJob(job) }, { headers: { "Cache-Control": "no-store" } });
}
