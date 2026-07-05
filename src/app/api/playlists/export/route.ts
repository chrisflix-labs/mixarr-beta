import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exportTracksToPlex } from "@/lib/playlistService";
import { safeRecordJobHistory } from "@/lib/jobHistory";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, trackIds, savedRuleId, rulesSnapshot, optionsSnapshot } = await req.json();

    if (!name || !trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const result = await exportTracksToPlex({
      userId,
      name,
      trackIds,
      savedRuleId,
      rulesJson: rulesSnapshot ? JSON.stringify(rulesSnapshot) : undefined,
      optionsJson: optionsSnapshot ? JSON.stringify(optionsSnapshot) : undefined,
    });
    const exclusionSummary = result.excludedTrackCount > 0
      ? ` Manual exclusions removed ${result.excludedTrackCount} track${result.excludedTrackCount === 1 ? "" : "s"} from the candidate pool.`
      : "";
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist export",
      status: "success",
      trigger: "manual",
      summary: `Playlist export completed. attempted=${trackIds.length}, processed=${result.trackCount}, skipped=${Math.max(0, trackIds.length - result.trackCount)}, failed=0.${exclusionSummary}`,
      counts: { attempted: trackIds.length, processed: result.trackCount, skipped: Math.max(0, trackIds.length - result.trackCount), failed: 0 },
      metadata: {
        savedRuleId: savedRuleId || null,
        serverId: result.serverId,
        playlistId: result.playlistId || null,
        manualExclusionsApplied: result.excludedTrackCount > 0,
        excludedTrackCount: result.excludedTrackCount,
      },
    });

    return NextResponse.json({ success: true, ...result });

  } catch (error: any) {
    console.error("Export to Plex failed:", error.response?.data || error.message);
    const message = error.message || "Failed to export playlist to Plex";
    const status = message.includes("not owned") || message.includes("not found") ? 403 : 500;
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist export",
      status: "failed",
      trigger: "manual",
      summary: "Playlist export failed.",
      error: message,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
