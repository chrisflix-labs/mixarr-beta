import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exportTracksToPlex, playlistConfigSchema, recordGeneratedPlaylist, rollbackCreatedPlexPlaylist, summarizePlaylistSafetyRules } from "@/lib/playlistService";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import { recordPlaylistHistoryEntry } from "@/lib/playlistHistory";

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
    const safetyConfig = optionsSnapshot ? playlistConfigSchema.safeParse(optionsSnapshot) : null;
    const safetyRuleSummary = safetyConfig?.success ? summarizePlaylistSafetyRules(safetyConfig.data) : "Safety rules: off";
    const safetySummary = safetyConfig?.success && safetyRuleSummary !== "Safety rules: off"
      ? ` Safety rules applied: ${safetyRuleSummary.replace(/^Safety rules: /, "")}.`
      : "";
    const filters = safetyConfig?.success ? safetyConfig.data : optionsSnapshot || { rules: rulesSnapshot || [] };
    const sourceType = safetyConfig?.success && (safetyConfig.data.smartPresetName || safetyConfig.data.moodPresetName || safetyConfig.data.bpmPresetName)
      ? "smart_builder"
      : "manual_builder";
    let generatedPlaylist;
    try {
      generatedPlaylist = await recordGeneratedPlaylist({
        userId,
        serverId: result.serverId,
        plexPlaylistRatingKey: result.playlistId || null,
        plexPlaylistTitle: name,
        sourceType,
        filters,
        trackIds: result.exportedTrackIds || trackIds,
      });
    } catch (error) {
      if (result.createdNewPlaylist) await rollbackCreatedPlexPlaylist({ userId, serverId: result.serverId, playlistId: result.playlistId }).catch(() => undefined);
      throw error;
    }
    const creationSummary = `Created playlist "${name}" from export with ${result.trackCount} track${result.trackCount === 1 ? "" : "s"}.${exclusionSummary}${safetySummary}`;
    await recordPlaylistHistoryEntry({
      userId,
      generatedPlaylistId: generatedPlaylist.id,
      serverId: result.serverId,
      plexPlaylistRatingKey: result.playlistId || null,
      playlistName: name,
      eventType: "created",
      sourceType,
      smartPresetId: safetyConfig?.success ? safetyConfig.data.smartPresetId || null : null,
      smartPresetName: safetyConfig?.success ? safetyConfig.data.smartPresetName || null : null,
      moodPresetId: safetyConfig?.success ? safetyConfig.data.moodPresetId || null : null,
      moodPresetName: safetyConfig?.success ? safetyConfig.data.moodPresetName || null : null,
      bpmPresetId: safetyConfig?.success ? safetyConfig.data.bpmPresetId || null : null,
      bpmPresetName: safetyConfig?.success ? safetyConfig.data.bpmPresetName || null : null,
      engineVersion: safetyConfig?.success ? safetyConfig.data.engineVersion : "v1",
      trackCount: result.trackCount,
      manualExclusionsRemoved: result.excludedTrackCount,
      safetyRulesApplied: Boolean(safetySummary),
      safetyRulesRemoved: 0,
      warnings: [],
      filters,
      safetyRules: safetyConfig?.success ? safetyConfig.data.safetyRules : null,
      qualityScore: (generatedPlaylist.qualityScoreJson as any) || null,
      summary: creationSummary,
      trackIds: result.exportedTrackIds || trackIds,
    });
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist export",
      status: "success",
      trigger: "manual",
      summary: `Playlist export completed. attempted=${trackIds.length}, processed=${result.trackCount}, skipped=${Math.max(0, trackIds.length - result.trackCount)}, failed=0.${exclusionSummary}${safetySummary}`,
      counts: { attempted: trackIds.length, processed: result.trackCount, skipped: Math.max(0, trackIds.length - result.trackCount), failed: 0 },
      metadata: {
        savedRuleId: savedRuleId || null,
        serverId: result.serverId,
        playlistId: result.playlistId || null,
        manualExclusionsApplied: result.excludedTrackCount > 0,
        excludedTrackCount: result.excludedTrackCount,
        manualExclusionsRemoved: result.excludedTrackCount,
        safetyRules: safetyConfig?.success ? safetyConfig.data.safetyRules : null,
        safetyRuleSummary,
        safetyRulesApplied: Boolean(safetySummary),
        finalTrackCount: result.trackCount,
        engineVersion: safetyConfig?.success ? safetyConfig.data.engineVersion : "v1",
        qualityScore: generatedPlaylist.qualityScoreJson || null,
      },
    });

    return NextResponse.json({ success: true, ...result, engineVersion: safetyConfig?.success ? safetyConfig.data.engineVersion : "v1" });

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
