import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generatePlaylistTracksWithStats, playlistConfigSchema } from "@/lib/playlistService";
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
    const result = await generatePlaylistTracksWithStats({
      userId,
      config,
    });
    const tracks = result.tracks;
    const exclusionSummary = result.manualExclusionsApplied > 0
      ? ` Manual exclusions removed ${result.manualExclusionsApplied} track${result.manualExclusionsApplied === 1 ? "" : "s"} from the candidate pool.`
      : "";
    const safetySummary = result.safety.safetyRulesApplied
      ? ` Safety rules applied: ${result.safety.summary.replace(/^Safety rules: /, "")}.`
      : "";
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist generation",
      status: "success",
      trigger: "manual",
      summary: `Playlist generation completed. attempted=${config.limit}, processed=${tracks.length}, skipped=${Math.max(0, config.limit - tracks.length)}, failed=0.${exclusionSummary}${safetySummary}`,
      counts: { attempted: config.limit, processed: tracks.length, skipped: Math.max(0, config.limit - tracks.length), failed: 0 },
      metadata: {
        libraryId: config.libraryId || null,
        serverId: config.serverId || null,
        manualExclusionsApplied: result.manualExclusionsApplied > 0,
        excludedTrackCount: result.manualExclusionsApplied,
        safetyRules: result.safety.enabledRules,
        safetyRuleSummary: result.safety.summary,
        removedBySafetyRules: result.safety.removedBySafetyRules,
        finalTrackCount: tracks.length,
        engineVersion: result.engineVersion,
        engine: result.engine,
      },
    });

    return NextResponse.json({ tracks, engineVersion: result.engineVersion, engine: result.engine });
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
