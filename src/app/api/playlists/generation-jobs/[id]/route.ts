import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cancelPlaylistGenerationJob, getPlaylistGenerationJob } from "@/lib/playlistGenerationJobs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const job = await getPlaylistGenerationJob(userId, params.id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Generation job not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const job = await cancelPlaylistGenerationJob(userId, params.id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Generation job not found" }, { status: 404 });
}
