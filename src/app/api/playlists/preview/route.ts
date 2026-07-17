import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { playlistConfigSchema, previewPlaylistTracks } from "@/lib/playlistService";
import { queuePlaylistGenerationJob } from "@/lib/playlistGenerationJobs";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const config = playlistConfigSchema.parse(body);
    if (String(config.engineVersion) === "v2") {
      return NextResponse.json(await queuePlaylistGenerationJob({ userId, config }), { status: 202 });
    }
    const preview = await previewPlaylistTracks({
      userId,
      config,
    });

    return NextResponse.json(preview);
  } catch (error: any) {
    const status = error.name === "ZodError" ? 400 : 500;
    if (status === 400) {
      const message = error.issues?.[0]?.message || "Invalid playlist rules";
      console.warn(`[PlaylistPreview] Rejected invalid request: ${message}`);
      return NextResponse.json({ error: `Invalid playlist request: ${message}` }, { status });
    }

    console.error("Preview error:", error);
    return NextResponse.json({ error: "Failed to preview playlist" }, { status });
  }
}
