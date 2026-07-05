import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generatePlaylistTracks, playlistConfigSchema } from "@/lib/playlistService";
import { safeRecordJobHistory } from "@/lib/jobHistory";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const config = playlistConfigSchema.parse(body);
    const tracks = await generatePlaylistTracks({
      userId,
      config,
    });
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist generation",
      status: "success",
      trigger: "manual",
      summary: `Playlist generation completed. attempted=${config.limit}, processed=${tracks.length}, skipped=${Math.max(0, config.limit - tracks.length)}, failed=0.`,
      counts: { attempted: config.limit, processed: tracks.length, skipped: Math.max(0, config.limit - tracks.length), failed: 0 },
      metadata: { libraryId: config.libraryId || null, serverId: config.serverId || null },
    });

    return NextResponse.json({ tracks });
  } catch (error: any) {
    const status = error.name === "ZodError" ? 400 : 500;
    if (status === 400) {
      const message = error.issues?.[0]?.message || "Invalid playlist rules";
      console.warn(`[PlaylistGenerate] Rejected invalid request: ${message}`);
      return NextResponse.json({ error: `Invalid playlist request: ${message}` }, { status });
    }
    console.error("Generate error:", error);
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist generation",
      status: "failed",
      trigger: "manual",
      summary: "Playlist generation failed.",
      error,
    });
    return NextResponse.json({ error: "Failed to generate playlist" }, { status });
  }
}
