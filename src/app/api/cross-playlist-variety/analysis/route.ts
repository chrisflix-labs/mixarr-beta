import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelCrossPlaylistAnalysis, getCrossPlaylistAnalysisStatus, queueCrossPlaylistAnalysis } from "@/lib/playlistCoordination";

const startSchema = z.object({ playlistIds: z.array(z.string().uuid()).max(100).optional(), retry: z.boolean().optional(), forceAll: z.boolean().optional(), batchSize: z.coerce.number().int().min(5).max(50).optional() });

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobId = new URL(request.url).searchParams.get("jobId") || undefined;
  return NextResponse.json({ job: await getCrossPlaylistAnalysisStatus(userId, jobId) });
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = startSchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json(await queueCrossPlaylistAnalysis(userId, { playlistIds: input.playlistIds, trigger: input.retry ? "retry" : "manual", batchSize: input.batchSize, forceAll: input.forceAll }), { status: 202 });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to start analysis" }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await cancelCrossPlaylistAnalysis(userId, new URL(request.url).searchParams.get("jobId") || "")); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to cancel analysis" }, { status: 400 }); }
}
