import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { startBackupJob } from "@/lib/libraryBackup/backupJobs";
import { requireBackupAdmin, isAuthFailure } from "@/lib/libraryBackupAuth";
import { serializeArchiveSummary } from "@/lib/libraryBackup/apiSerialization";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  const archives = await prisma.libraryBackupArchive.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ archives: archives.map(serializeArchiveSummary) }, { headers: { "Cache-Control": "no-store" } });
}

const createSchema = z.object({
  libraryId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  fileNameBase: z.string().max(120).optional(),
});

export async function POST(request: Request) {
  const auth = await requireBackupAdmin();
  if (isAuthFailure(auth)) return auth.response;
  try {
    const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid backup request." }, { status: 400 });
    const { jobId } = await startBackupJob(auth.userId, parsed.data);
    return NextResponse.json({ status: "started", jobId }, { status: 202 });
  } catch (error) {
    console.error("[LibraryBackup] create failed", error);
    return NextResponse.json({ error: "Failed to start backup." }, { status: 500 });
  }
}
