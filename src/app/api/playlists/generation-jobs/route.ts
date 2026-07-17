import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { playlistConfigSchema } from "@/lib/playlistService";
import { playlistGenerationRuntimeSnapshot, queuePlaylistGenerationJob } from "@/lib/playlistGenerationJobs";
import { playlistGenerationLimitsForDiagnostics } from "@/lib/playlistGenerationLimits";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ limits: playlistGenerationLimitsForDiagnostics(), runtime: playlistGenerationRuntimeSnapshot() });
}

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const config = playlistConfigSchema.parse(await req.json());
    return NextResponse.json(await queuePlaylistGenerationJob({ userId, config }), { status: 202 });
  } catch (error: any) {
    const status = error.name === "ZodError" ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.issues?.[0]?.message || "Invalid playlist request" : error.message || "Unable to queue playlist generation" }, { status });
  }
}
