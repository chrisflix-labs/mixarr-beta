import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exportTracksToPlex, playlistConfigSchema, recordGeneratedPlaylist, rollbackCreatedPlexPlaylist, summarizePlaylistSafetyRules } from "@/lib/playlistService";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import { recordPlaylistHistoryEntry } from "@/lib/playlistHistory";
import prisma from "@/lib/prisma";
import { markPlaylistRecipeUsed, portableRecipeFromRecord } from "@/lib/playlistRecipes";

function collectRules(node: any, fallbackRules: any[] = []): any[] {
  if (!node) return fallbackRules;
  if (node.type !== "group") return [node];
  return (node.children || []).flatMap((child: any) => collectRules(child, []));
}

function tempoRangeFromOptions(options: any) {
  const rules = collectRules(options?.ruleTree, options?.rules || []);
  const lower = rules.find((rule) => rule.field === "tempo" && (rule.operator === "gte" || rule.operator === "gt"));
  const upper = rules.find((rule) => rule.field === "tempo" && (rule.operator === "lte" || rule.operator === "lt"));
  return {
    bpmMin: lower?.value ? Number(lower.value) : null,
    bpmMax: upper?.value ? Number(upper.value) : null,
  };
}

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, trackIds, savedRuleId, rulesSnapshot, optionsSnapshot, previewId, recipeId, recipeName, filters, sourceType, manualExclusionsApplied, removedBySafetyRules, safetyRulesApplied, discoveryResult } = await req.json();

    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (!trimmedName || !trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
      return NextResponse.json({ error: "Invalid preview payload" }, { status: 400 });
    }

    let ownedRecipe: any = null;
    if (recipeId) {
      ownedRecipe = await prisma.playlistRecipe.findFirst({
        where: { id: recipeId, userId, isArchived: false },
      });

      if (!ownedRecipe) {
        return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
      }
    }

    const pendingConfigParse = optionsSnapshot ? playlistConfigSchema.safeParse(optionsSnapshot) : null;
    const pendingConfig = pendingConfigParse?.success ? pendingConfigParse.data : null;
    if (pendingConfig?.personalizationMode === "HOUSEHOLD" && pendingConfig.householdCollaboration && pendingConfig.householdCollaboration.approvalMode !== "DISABLED") {
      const pendingPlaylist = await recordGeneratedPlaylist({
        userId,
        plexPlaylistRatingKey: null,
        plexPlaylistTitle: trimmedName,
        sourceType: sourceType || (ownedRecipe || recipeId ? "recipe" : pendingConfig.smartPresetName ? "smart_builder" : "manual_builder"),
        recipeId: ownedRecipe?.id || recipeId || null,
        recipeName: ownedRecipe?.name || recipeName || null,
        recipeVersion: ownedRecipe?.recipeVersion || null,
        recipeSchemaVersion: ownedRecipe?.schemaVersion || null,
        resolvedRecipeSnapshot: ownedRecipe ? portableRecipeFromRecord(ownedRecipe) : null,
        playlistOverrides: ownedRecipe ? { generation: optionsSnapshot } : null,
        filters: optionsSnapshot,
        trackIds,
        discoveryResult,
        previewId: previewId || null,
      });
      const pendingSummary = `Created household playlist draft “${trimmedName}” with ${trackIds.length} tracks. Plex sync is blocked until the configured approval threshold is reached.`;
      await recordPlaylistHistoryEntry({ userId, generatedPlaylistId: pendingPlaylist.id, playlistName: trimmedName, eventType: "created", sourceType: sourceType || "smart_builder", engineVersion: pendingConfig.engineVersion, trackCount: trackIds.length, filters: optionsSnapshot, safetyRules: pendingConfig.safetyRules, summary: pendingSummary, trackIds });
      await safeRecordJobHistory({ userId, type: "playlist", name: "Household playlist draft", status: "success", trigger: "manual", summary: pendingSummary, counts: { attempted: trackIds.length, processed: trackIds.length, skipped: 0, failed: 0 }, metadata: { generatedPlaylistId: pendingPlaylist.id, publicationStatus: "PENDING_APPROVAL", householdId: pendingConfig.householdCollaboration.householdId } });
      return NextResponse.json({ success: true, pendingApproval: true, generatedPlaylistId: pendingPlaylist.id, trackCount: trackIds.length, playlistId: null, engineVersion: pendingConfig.engineVersion });
    }

    const result = await exportTracksToPlex({
      userId,
      name: trimmedName,
      trackIds,
      savedRuleId,
      rulesJson: rulesSnapshot ? JSON.stringify(rulesSnapshot) : undefined,
      optionsJson: optionsSnapshot ? JSON.stringify(optionsSnapshot) : undefined,
    });

    if (ownedRecipe) {
      await markPlaylistRecipeUsed(userId, ownedRecipe.id);
    }

    const resolvedRecipeName = ownedRecipe?.name || recipeName || null;
    const excludedTrackCount = Math.max(0, Number(manualExclusionsApplied) || 0, result.excludedTrackCount || 0);
    const exclusionSummary = excludedTrackCount > 0
      ? ` Manual exclusions removed ${excludedTrackCount} track${excludedTrackCount === 1 ? "" : "s"} from the candidate pool.`
      : "";
    const safetyConfig = optionsSnapshot ? playlistConfigSchema.safeParse(optionsSnapshot) : null;
    const parsedOptions = safetyConfig?.success ? safetyConfig.data : null;
    const safetyRuleSummary = parsedOptions ? summarizePlaylistSafetyRules(parsedOptions) : "Safety rules: off";
    const safetySummary = safetyRulesApplied || (safetyConfig?.success && safetyRuleSummary !== "Safety rules: off")
      ? ` Safety rules applied: ${safetyRuleSummary.replace(/^Safety rules: /, "")}.`
      : "";
    const smartPresetName = parsedOptions?.smartPresetName || null;
    const smartPresetSummary = smartPresetName ? ` from Smart Builder preset "${smartPresetName}"` : "";
    const moodPresetName = parsedOptions?.moodPresetName || null;
    const moodPresetDisplayName = moodPresetName ? `${moodPresetName}${parsedOptions?.moodPresetModified ? " modified" : ""}` : null;
    const bpmPresetName = parsedOptions?.bpmPresetName || null;
    const bpmPresetDisplayName = bpmPresetName ? `${bpmPresetName}${parsedOptions?.bpmPresetModified ? " modified" : ""}` : null;
    const tuningPresetName = parsedOptions?.engineVersion === "v2" ? parsedOptions.tuningConfig?.presetName || "Custom" : null;
    const selectedContext = parsedOptions?.contextSelection || null;
    const presetSummaries = [
      ...(moodPresetDisplayName ? [`mood preset "${moodPresetDisplayName}"`] : []),
      ...(bpmPresetDisplayName ? [`BPM preset "${bpmPresetDisplayName}"`] : []),
      ...(tuningPresetName ? [`tuning preset "${tuningPresetName}"`] : []),
    ];
    const presetSummary = presetSummaries.length ? ` with ${presetSummaries.join(" and ")}` : "";
    const trackCountSummary = presetSummary ? ` and ${result.trackCount} tracks` : ` with ${result.trackCount} tracks`;
    const bpmRange = tempoRangeFromOptions(parsedOptions);
    const generationFilters = optionsSnapshot || filters;
    let generatedPlaylist: Awaited<ReturnType<typeof recordGeneratedPlaylist>> | null = null;
    const resolvedSourceType = sourceType || (ownedRecipe || recipeId ? "recipe" : smartPresetName ? "smart_builder" : "manual_builder");
    if (generationFilters) {
      try {
        generatedPlaylist = await recordGeneratedPlaylist({
          userId,
          serverId: result.serverId,
          plexPlaylistRatingKey: result.playlistId || null,
          plexPlaylistTitle: trimmedName,
          sourceType: resolvedSourceType,
          recipeId: ownedRecipe?.id || recipeId || null,
          recipeName: resolvedRecipeName,
          recipeVersion: ownedRecipe?.recipeVersion || null,
          recipeSchemaVersion: ownedRecipe?.schemaVersion || null,
          resolvedRecipeSnapshot: ownedRecipe ? portableRecipeFromRecord(ownedRecipe) : null,
          playlistOverrides: ownedRecipe ? { generation: generationFilters } : null,
          filters: generationFilters,
          trackIds: result.exportedTrackIds || trackIds,
          discoveryResult,
          previewId: previewId || null,
        });
      } catch (error) {
        if (result.createdNewPlaylist) await rollbackCreatedPlexPlaylist({ userId, serverId: result.serverId, playlistId: result.playlistId }).catch(() => undefined);
        throw error;
      }
      if (generatedPlaylist && previewId) {
        await prisma.playlistFitFeedback.updateMany({
          where: { userId, generationId: previewId, scopeKey: `generation:${previewId}` },
          data: { playlistId: generatedPlaylist.id, scopeKey: `playlist:${generatedPlaylist.id}`, engineVersion: parsedOptions?.engineVersion || "v1" },
        });
      }
    }
    const creationSummary = smartPresetName
      ? `Created playlist "${trimmedName}"${smartPresetSummary}${presetSummary}${trackCountSummary}.${exclusionSummary}${safetySummary}`
      : resolvedRecipeName
      ? `Created playlist "${trimmedName}" from recipe "${resolvedRecipeName}"${presetSummary}${trackCountSummary}.${exclusionSummary}${safetySummary}`
      : `Created playlist "${trimmedName}" from preview${presetSummary}${trackCountSummary}.${exclusionSummary}${safetySummary}`;

    await recordPlaylistHistoryEntry({
      userId,
      generatedPlaylistId: generatedPlaylist?.id || null,
      serverId: result.serverId,
      plexPlaylistRatingKey: result.playlistId || null,
      playlistName: trimmedName,
      eventType: "created",
      sourceType: resolvedSourceType,
      recipeId: ownedRecipe?.id || recipeId || null,
      recipeName: resolvedRecipeName,
      smartPresetId: parsedOptions?.smartPresetId || null,
      smartPresetName,
      moodPresetId: parsedOptions?.moodPresetId || null,
      moodPresetName,
      bpmPresetId: parsedOptions?.bpmPresetId || null,
      bpmPresetName,
      engineVersion: parsedOptions?.engineVersion || "v1",
      trackCount: result.trackCount,
      manualExclusionsRemoved: excludedTrackCount,
      safetyRulesApplied: Boolean(safetySummary),
      safetyRulesRemoved: Math.max(0, Number(removedBySafetyRules) || 0),
      warnings: [],
      filters: generationFilters || null,
      safetyRules: parsedOptions?.safetyRules || null,
      qualityScore: (generatedPlaylist?.qualityScoreJson as any) || null,
      context: selectedContext,
      summary: creationSummary,
      trackIds: result.exportedTrackIds || trackIds,
    });

    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist create from preview",
      status: "success",
      trigger: "manual",
      summary: creationSummary,
      counts: { attempted: trackIds.length, processed: result.trackCount, skipped: Math.max(0, trackIds.length - result.trackCount), failed: 0 },
      metadata: {
        savedRuleId: savedRuleId || null,
        serverId: result.serverId,
        playlistId: result.playlistId || null,
        previewId: previewId || null,
        recipeId: ownedRecipe?.id || recipeId || null,
        recipeName: resolvedRecipeName,
        smartPresetId: parsedOptions?.smartPresetId || null,
        smartPresetName,
        smartPresetVersion: parsedOptions?.smartPresetVersion || null,
        moodPresetId: parsedOptions?.moodPresetId || null,
        moodPresetName,
        moodPresetVersion: parsedOptions?.moodPresetVersion || null,
        moodPresetModified: parsedOptions?.moodPresetModified || false,
        bpmPresetId: parsedOptions?.bpmPresetId || null,
        bpmPresetName,
        bpmPresetVersion: parsedOptions?.bpmPresetVersion || null,
        bpmPresetModified: parsedOptions?.bpmPresetModified || false,
        tuningPresetName,
        tuningConfig: parsedOptions?.tuningConfig || null,
        moodBlendMode: parsedOptions?.engineVersion === "v2" ? parsedOptions.moodBlendMode : null,
        selectedMoodPath: parsedOptions?.engineVersion === "v2" ? parsedOptions.selectedMoodPath : [],
        allowedMoods: parsedOptions?.engineVersion === "v2" ? parsedOptions.allowedMoods : [],
        bpmMin: bpmRange.bpmMin,
        bpmMax: bpmRange.bpmMax,
        playlistName: trimmedName,
        trackCount: result.trackCount,
        manualExclusionsApplied: excludedTrackCount > 0,
        excludedTrackCount,
        manualExclusionsRemoved: excludedTrackCount,
        safetyRules: parsedOptions?.safetyRules || null,
        safetyRuleSummary,
        safetyRulesApplied: Boolean(safetySummary),
        removedBySafetyRules: Math.max(0, Number(removedBySafetyRules) || 0),
        finalTrackCount: result.trackCount,
        engineVersion: parsedOptions?.engineVersion || "v1",
        filters: filters || optionsSnapshot || null,
        qualityScore: generatedPlaylist?.qualityScoreJson || null,
        context: selectedContext,
      },
    });

    return NextResponse.json({ success: true, ...result, generatedPlaylistId: generatedPlaylist?.id || null, engineVersion: parsedOptions?.engineVersion || "v1" });
  } catch (error: any) {
    console.error("Create from preview failed:", error.response?.data || error.message);
    const message = error.message || "Failed to create playlist from preview";
    const status = message.includes("not owned") || message.includes("not found") ? 403 : 500;

    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist create from preview",
      status: "failed",
      trigger: "manual",
      summary: "Failed to create playlist from preview. Plex returned an error.",
      counts: { attempted: 0, processed: 0, skipped: 0, failed: 1 },
      error: message,
    });

    return NextResponse.json({ error: message }, { status });
  }
}
