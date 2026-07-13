import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { acquireJobLock, attachJobHistoryToLock, setJobPhase } from "../jobLock";
import { safeFinishJobHistory, safeStartJobHistory } from "../jobHistory";
import { applyAdvancedPlaylistRegeneration, playlistConfigSchema, previewAdvancedPlaylistRegeneration, syncGeneratedPlaylistToPlex } from "../playlistService";
import { createRecentlyAddedMix } from "./playlists";
import { createPlaylistVersionInTransaction } from "../playlists/versions/playlist-version-service";
import { detectRecentlyAddedTracks, analyzeRecentlyAddedTracks } from "./detection";
import { findRecentlyAddedPlaylistMatches } from "./matching";
import { createRecentlyAddedNotification } from "./notifications";
import { getRecentlyAddedSettings } from "./settings";
import { getBetaStatus, getFeatureState, recordBetaUsage } from "../featureFlagService";

export const RECENTLY_ADDED_JOB_KEY = "recently-added:automation";

function snapshotSettings(settings: any) {
  const { id: _id, userId: _userId, createdAt: _createdAt, updatedAt: _updatedAt, ...safe } = settings;
  return safe as Prisma.InputJsonValue;
}

async function startRun(userId: string, triggerType: string, batchId: string | null, settings: any, lockKey?: string, beta?: { requiredFeatureFlags: string[]; requestedScoringModel: string; requestedAccessLevel: string }) {
  return prisma.recentlyAddedAutomationRun.create({
    data: { userId, batchId, triggerType, status: "scanning", phase: "scanning", settingsSnapshot: snapshotSettings(settings), lockKey: lockKey || null, requiredFeatureFlags: beta?.requiredFeatureFlags || [], requestedScoringModel: beta?.requestedScoringModel || "stable-v2", requestedAccessLevel: beta?.requestedAccessLevel || "STABLE" },
  });
}

async function createAutomaticChangeSet(userId: string, runId: string, settings: any, batchId?: string | null) {
  if (!settings.enabled || !settings.autoAddStrongMatches || settings.regenerationBehavior !== "add_only") return { proposed: 0 };
  const matches = await prisma.recentlyAddedPlaylistMatch.findMany({
    where: {
      ...(batchId ? { batchId } : {}),
      compatibilityScore: { gte: settings.matchThreshold },
      confidenceScore: { gte: settings.metadataConfidenceThreshold },
      status: { in: ["suggested", "pending"] },
      generatedPlaylist: { userId, automationSettings: { is: { mode: "automatic" } } },
      track: { recentlyAddedState: { is: { ignored: false, neverAutoAdd: false, manualUseOnly: false, status: { in: settings.allowLowConfidenceAutomation ? ["ready_for_matching", "suggested", "low_confidence"] : ["ready_for_matching", "suggested"] } } } },
    },
    orderBy: [{ compatibilityScore: "desc" }, { createdAt: "asc" }],
    take: settings.maxAddsPerRun * 5,
  });
  const perPlaylist = new Map<string, number>();
  let proposed = 0;
  for (const match of matches) {
    const used = perPlaylist.get(match.generatedPlaylistId) || 0;
    if (used >= settings.maxAddsPerPlaylist || proposed >= settings.maxAddsPerRun) continue;
    await prisma.recentlyAddedAutomationChange.upsert({
      where: { runId_trackId_generatedPlaylistId_action: { runId, trackId: match.trackId, generatedPlaylistId: match.generatedPlaylistId, action: "add" } },
      update: {},
      create: {
        runId,
        matchId: match.id,
        trackId: match.trackId,
        generatedPlaylistId: match.generatedPlaylistId,
        action: "add",
        status: settings.requirePreview ? "pending" : "approved",
        scoreAfter: match.expectedScoreChange == null ? null : match.expectedScoreChange,
        reasonsJson: match.matchReasonsJson as Prisma.InputJsonValue,
      },
    });
    perPlaylist.set(match.generatedPlaylistId, used + 1);
    proposed += 1;
  }
  return { proposed };
}

async function runScheduledRegenerationPreviews(userId: string, settings: any, batchId?: string | null) {
  if (!settings.enabled || !settings.scheduledRegenerationEnabled || ["add_only", "suggestions_only"].includes(settings.regenerationBehavior)) return { previews: 0, applied: 0, playlistsModified: 0, warnings: [] as string[] };
  const matches = await prisma.recentlyAddedPlaylistMatch.findMany({
    where: {
      ...(batchId ? { batchId } : {}),
      compatibilityScore: { gte: settings.matchThreshold },
      confidenceScore: { gte: settings.metadataConfidenceThreshold },
      generatedPlaylist: { userId },
      track: { recentlyAddedState: { is: { ignored: false, neverAutoAdd: false, manualUseOnly: false, status: { in: settings.allowLowConfidenceAutomation ? ["ready_for_matching", "suggested", "low_confidence"] : ["ready_for_matching", "suggested"] } } } },
    },
    orderBy: { compatibilityScore: "desc" },
    take: settings.maxAddsPerRun * 5,
    include: { generatedPlaylist: { include: { automationSettings: true } } },
  });
  const eligibleMatches = matches.filter((match) => match.generatedPlaylist.automationSettings?.mode !== "off" && !match.generatedPlaylist.automationSettings?.excludeFromScheduledRegeneration);
  const byPlaylist = new Map<string, string[]>();
  for (const match of eligibleMatches) {
    const ids = byPlaylist.get(match.generatedPlaylistId) || [];
    if (ids.length < settings.maxAddsPerPlaylist) byPlaylist.set(match.generatedPlaylistId, [...ids, match.trackId]);
  }
  let previews = 0;
  let applied = 0;
  let playlistsModified = 0;
  const warnings: string[] = [];
  for (const [playlistId, candidateTrackIds] of Array.from(byPlaylist.entries()).slice(0, 25)) {
    try {
      const mode = settings.regenerationBehavior === "weak_sections" ? "regenerate_section" : "replace_weak_tracks";
      const preview = await previewAdvancedPlaylistRegeneration({
        userId,
        generatedPlaylistId: playlistId,
        input: {
          mode,
          ...(mode === "regenerate_section" ? { targetSection: { type: "middle" } } : {}),
          candidateTrackIds,
          preserveLength: true,
          preserveMoodCurve: true,
          preserveBpmCurve: true,
          preserveEnergyCurve: true,
          preserveLockedTracks: true,
          keepLikedTracks: true,
          preserveOrder: settings.regenerationBehavior !== "rebuild_preserving_locked",
          maximumReplacements: Math.min(100, Math.max(1, settings.maxAddsPerPlaylist)),
          replacementSensitivity: settings.automationPreset === "aggressive" ? "aggressive" : settings.automationPreset === "conservative" ? "conservative" : "balanced",
          minimumReplacementImprovement: 8,
        },
      });
      if (!preview.changes.length) continue;
      previews += 1;
      const playlistMode = eligibleMatches.find((item) => item.generatedPlaylistId === playlistId)?.generatedPlaylist.automationSettings?.mode || "suggestions";
      if (!settings.requirePreview && playlistMode === "automatic") {
        const result = await applyAdvancedPlaylistRegeneration({ userId, generatedPlaylistId: playlistId, previewId: preview.previewId });
        if (!result.rejected) { applied += result.tracksReplaced; playlistsModified += 1; }
      }
    } catch (error) {
      warnings.push(`Playlist ${playlistId}: ${error instanceof Error ? error.message : "regeneration failed"}`);
    }
  }
  return { previews, applied, playlistsModified, warnings };
}

export async function runRecentlyAddedAutomation({
  userId,
  triggerType = "manual",
  libraryId,
  scan = true,
}: {
  userId: string;
  triggerType?: "manual" | "scheduled" | "plex_sync";
  libraryId?: string | null;
  scan?: boolean;
}) {
  const storedSettings = await getRecentlyAddedSettings(userId);
  const requestedFeatureFlags = [
    ...(storedSettings.autoAddStrongMatches ? ["smartMix.recentlyAddedAutoAdd"] : []),
    ...(triggerType === "scheduled" && storedSettings.scheduledRegenerationEnabled && !["add_only", "suggestions_only"].includes(storedSettings.regenerationBehavior) ? ["smartMix.experimentalScheduledRegeneration"] : []),
  ];
  const featureStates = await Promise.all(requestedFeatureFlags.map((featureKey) => getFeatureState(featureKey, { userId })));
  const scheduledState = featureStates.find((state) => state.key === "smartMix.experimentalScheduledRegeneration");
  if (triggerType === "scheduled" && scheduledState && !scheduledState.enabled) {
    await recordBetaUsage({ userId, featureKey: scheduledState.key, action: "scheduled_regeneration", success: false, errorCode: scheduledState.reason });
    console.warn("[RecentlyAdded] scheduled beta job skipped", { userId, feature: scheduledState.key, reason: scheduledState.reason });
    return { skipped: true, reason: scheduledState.reason, permanent: true };
  }
  const autoAddState = featureStates.find((state) => state.key === "smartMix.recentlyAddedAutoAdd");
  const settings = autoAddState && !autoAddState.enabled ? { ...storedSettings, autoAddStrongMatches: false } : storedSettings;
  if (autoAddState && !autoAddState.enabled) await recordBetaUsage({ userId, featureKey: autoAddState.key, action: "recently_added_auto_add", success: true, fallbackUsed: true, errorCode: autoAddState.reason });
  const betaStatus = await getBetaStatus({ userId });
  if (triggerType !== "manual" && !settings.enabled) return { skipped: true, reason: "automation_disabled" };
  if (triggerType === "scheduled" && (!settings.scheduledRegenerationEnabled || settings.scheduleType === "manual")) return { skipped: true, reason: "schedule_disabled" };
  const activeStatuses = ["scanning", "analyzing_new_tracks", "matching_playlists", "applying_approved_automation"];
  const staleBefore = new Date(Date.now() - settings.staleLockTimeoutMinutes * 60_000);
  await prisma.recentlyAddedAutomationRun.updateMany({
    where: { userId, status: { in: activeStatuses }, startedAt: { lt: staleBefore } },
    data: { status: "completed_with_warnings", phase: "stale_lock_recovered", warningsJson: ["A stale automation lock was recovered after its configured timeout."], completedAt: new Date() },
  });
  const persistedActive = await prisma.recentlyAddedAutomationRun.findFirst({ where: { userId, status: { in: activeStatuses }, startedAt: { gte: staleBefore } }, orderBy: { startedAt: "desc" } });
  if (persistedActive) return { skipped: true, reason: "already_running", activeRun: { id: persistedActive.id, phase: persistedActive.phase, startedAt: persistedActive.startedAt } };
  const lock = acquireJobLock({ name: "recently added automation", keys: [RECENTLY_ADDED_JOB_KEY, `recently-added:user:${userId}`], source: triggerType });
  if (!lock.acquired) return { skipped: true, reason: "already_running", activeRun: lock.activeJob };
  const history = await safeStartJobHistory({ userId, type: "playlist", name: "Recently Added Automation", trigger: triggerType, lockKey: lock.job.lockKey, workerId: lock.job.workerId });
  attachJobHistoryToLock(lock.job, history, "playlist");
  let run: any = null;
  let batchId: string | null = null;
  try {
    run = await startRun(userId, triggerType, null, settings, lock.job.lockKey, { requiredFeatureFlags: requestedFeatureFlags, requestedScoringModel: "stable-v2", requestedAccessLevel: betaStatus.accessLevel });
    let discovered = 0;
    if (scan) {
      setJobPhase(lock.job, "Scanning recently added tracks");
      const detection = await detectRecentlyAddedTracks({ userId, libraryId, source: triggerType === "plex_sync" ? "plex_sync" : triggerType });
      batchId = detection.batchId;
      discovered = detection.discovered;
      await prisma.recentlyAddedAutomationRun.update({ where: { id: run.id }, data: { batchId, tracksDiscovered: discovered } });
    }
    setJobPhase(lock.job, "Analyzing new tracks");
    await prisma.recentlyAddedAutomationRun.update({ where: { id: run.id }, data: { status: "analyzing_new_tracks", phase: "analyzing_new_tracks" } });
    const analysis = await analyzeRecentlyAddedTracks({ userId, batchId });
    setJobPhase(lock.job, "Matching playlists");
    await prisma.recentlyAddedAutomationRun.update({ where: { id: run.id }, data: { status: "matching_playlists", phase: "matching_playlists", tracksAnalyzed: analysis.analyzed, tracksQuarantined: analysis.quarantined } });
    const matching = settings.suggestExistingPlaylistMatches || settings.autoAddStrongMatches || settings.scheduledRegenerationEnabled || triggerType === "manual"
      ? await findRecentlyAddedPlaylistMatches({ userId, batchId })
      : { tracks: 0, playlists: 0, matches: 0, strong: 0 };
    const changeSet = await createAutomaticChangeSet(userId, run.id, settings, batchId);
    let applied = { applied: 0, playlistsModified: 0, failed: 0 };
    if (settings.enabled && settings.autoAddStrongMatches && !settings.requirePreview && changeSet.proposed) {
      setJobPhase(lock.job, "Applying approved automation");
      await prisma.recentlyAddedAutomationRun.update({ where: { id: run.id }, data: { status: "applying_approved_automation", phase: "applying_approved_automation" } });
      applied = await applyRecentlyAddedChanges({ userId, runId: run.id, automatic: true });
    }
    const regeneration = triggerType === "scheduled" ? await runScheduledRegenerationPreviews(userId, settings, batchId) : { previews: 0, applied: 0, playlistsModified: 0, warnings: [] as string[] };
    applied.applied += regeneration.applied;
    applied.playlistsModified += regeneration.playlistsModified;
    const mix = settings.enabled && settings.createRecentlyAddedPlaylists ? await createRecentlyAddedMix({ userId }).catch((error) => ({ created: false, reason: error instanceof Error ? error.message : "mix_failed" })) : null;
    const warnings = [...(analysis.failed ? [`${analysis.failed} track analyses failed.`] : []), ...regeneration.warnings, ...(mix && !mix.created && !["not_enough_tracks", "period_playlist_exists"].includes(String(mix.reason)) ? [`Recently added mix: ${mix.reason}`] : [])];
    const finalStatus = applied.failed || warnings.length ? "completed_with_warnings" : "completed";
    await prisma.recentlyAddedAutomationRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        phase: "completed",
        playlistMatches: matching.matches,
        suggestions: matching.matches,
        automaticallyAdded: applied.applied,
        playlistsModified: applied.playlistsModified,
        warningsJson: warnings,
        completedAt: new Date(),
        progressJson: { discovered, analyzed: analysis.analyzed, matched: matching.matches, proposed: changeSet.proposed, regenerationPreviews: regeneration.previews, mixCreated: Boolean(mix?.created), applied: applied.applied },
      },
    });
    await prisma.recentlyAddedSettings.update({ where: { userId }, data: { lastSuccessfulRunAt: finalStatus === "completed" ? new Date() : settings.lastSuccessfulRunAt } });
    if (matching.strong > 0) await createRecentlyAddedNotification({ userId, batchKey: batchId || run.id, triggerType: "strong_matches", title: "New playlist matches", message: `Mixarr found ${matching.strong} strong recently added playlist match${matching.strong === 1 ? "" : "es"}.` });
    if (matching.matches > 0) await createRecentlyAddedNotification({ userId, batchKey: batchId || run.id, triggerType: "suggestions_ready", title: "Recently added suggestions are ready", message: `${matching.matches} playlist match${matching.matches === 1 ? " is" : "es are"} ready for review.` });
    if (analysis.quarantined > 0) await createRecentlyAddedNotification({ userId, batchKey: batchId || run.id, triggerType: "low_confidence", title: "New tracks need analysis", message: `${analysis.quarantined} recently added track${analysis.quarantined === 1 ? " is" : "s are"} waiting in automation quarantine.` });
    if (applied.applied > 0) await createRecentlyAddedNotification({ userId, batchKey: batchId || run.id, triggerType: "automatic_additions", title: "Playlists updated", message: `Mixarr automatically added ${applied.applied} track${applied.applied === 1 ? "" : "s"} across ${applied.playlistsModified} playlist${applied.playlistsModified === 1 ? "" : "s"}.` });
    await safeFinishJobHistory({ job: history, status: finalStatus, summary: `Recently Added Automation found ${matching.matches} matches and applied ${applied.applied} additions.`, counts: { attempted: analysis.analyzed, processed: matching.matches, skipped: analysis.quarantined, failed: analysis.failed } });
    return { runId: run.id, batchId, discovered, analysis, matching, proposed: changeSet.proposed, ...applied, status: finalStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recently Added Automation failed";
    if (run) await prisma.recentlyAddedAutomationRun.update({ where: { id: run.id }, data: { status: "failed", phase: "failed", errorsJson: [message], completedAt: new Date() } }).catch(() => undefined);
    await createRecentlyAddedNotification({ userId, batchKey: batchId || run?.id || String(Date.now()), triggerType: "failed", title: "Recently Added Automation failed", message }).catch(() => undefined);
    await safeFinishJobHistory({ job: history, status: "failed", summary: message, error: message });
    console.error("[RecentlyAdded] automation failed", { userId, runId: run?.id || null, reason: message });
    throw error;
  } finally {
    lock.release();
  }
}

function respectsVarietyLimits(playlist: any, track: any) {
  const parsed = playlistConfigSchema.safeParse(playlist.filtersJson);
  if (!parsed.success) return { allowed: false, reason: "invalid_playlist_configuration" };
  const rules = parsed.data.safetyRules;
  const artistCount = playlist.tracks.filter((item: any) => item.artist && item.artist === track.artist.title).length;
  const albumCount = playlist.tracks.filter((item: any) => item.album && item.album === track.album.title).length;
  if (rules.limitTracksPerArtist && artistCount >= rules.maxTracksPerArtist) return { allowed: false, reason: "artist_limit" };
  if (rules.limitTracksPerAlbum && albumCount >= rules.maxTracksPerAlbum) return { allowed: false, reason: "album_limit" };
  if (playlist.tracks.length >= parsed.data.limit) return { allowed: false, reason: "playlist_length_limit" };
  return { allowed: true, reason: null };
}

export async function applyRecentlyAddedChanges({
  userId,
  runId,
  matchIds,
  automatic = false,
}: {
  userId: string;
  runId?: string | null;
  matchIds?: string[];
  automatic?: boolean;
}) {
  const settings = await getRecentlyAddedSettings(userId);
  if (automatic && (!settings.enabled || !settings.autoAddStrongMatches)) return { applied: 0, playlistsModified: 0, failed: 0 };
  let resolvedRunId = runId || null;
  if (!resolvedRunId) {
    const run = await startRun(userId, "manual", null, settings);
    resolvedRunId = run.id;
    const matches = await prisma.recentlyAddedPlaylistMatch.findMany({ where: { id: { in: (matchIds || []).slice(0, 500) }, generatedPlaylist: { userId } } });
    for (const match of matches) {
      await prisma.recentlyAddedAutomationChange.create({ data: { runId: resolvedRunId, matchId: match.id, trackId: match.trackId, generatedPlaylistId: match.generatedPlaylistId, status: "approved", reasonsJson: match.matchReasonsJson as Prisma.InputJsonValue } });
    }
  } else if (matchIds?.length) {
    await prisma.recentlyAddedAutomationChange.updateMany({ where: { runId: resolvedRunId, matchId: { in: matchIds.slice(0, 500) }, status: "pending" }, data: { status: "approved", reviewedAt: new Date(), approvedBy: userId } });
  }
  const changes = await prisma.recentlyAddedAutomationChange.findMany({
    where: { runId: resolvedRunId, status: "approved", run: { userId } },
    orderBy: { createdAt: "asc" },
    include: { track: { include: { artist: true, album: true } }, match: true },
  });
  const groups = new Map<string, typeof changes>();
  for (const change of changes) groups.set(change.generatedPlaylistId, [...(groups.get(change.generatedPlaylistId) || []), change]);
  let applied = 0;
  let failed = 0;
  let playlistsModified = 0;
  for (const [playlistId, group] of Array.from(groups.entries())) {
    const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, include: { tracks: { orderBy: { position: "asc" } }, automationSettings: true } });
    if (!playlist) { failed += group.length; continue; }
    if (automatic && playlist.automationSettings?.mode !== "automatic") continue;
    const accepted = [] as typeof group;
    const alreadyPresent = [] as typeof group;
    for (const change of group.slice(0, automatic ? settings.maxAddsPerPlaylist : group.length)) {
      if (playlist.tracks.some((item) => item.trackId === change.trackId) || accepted.some((item) => item.trackId === change.trackId)) {
        alreadyPresent.push(change);
        continue;
      }
      const safety = respectsVarietyLimits({ ...playlist, tracks: [...playlist.tracks, ...accepted.map((item) => ({ artist: item.track.artist.title, album: item.track.album.title }))] as any[] }, change.track);
      if (!safety.allowed) {
        await prisma.recentlyAddedAutomationChange.update({ where: { id: change.id }, data: { status: "failed", error: safety.reason } });
        failed += 1;
        console.info("[RecentlyAdded] automatic addition skipped", { trackId: change.trackId, playlistId, reason: safety.reason });
        continue;
      }
      accepted.push(change);
    }
    if (!accepted.length && !alreadyPresent.length) continue;
    let committed = false;
    try {
      if (accepted.length) await prisma.$transaction(async (tx) => {
        await createPlaylistVersionInTransaction(tx, { generatedPlaylistId: playlistId, reason: "manual_edit", description: "Automatic backup before Recently Added changes", force: true });
        await tx.generatedPlaylistTrack.createMany({
          data: accepted.map((change, index) => ({
            generatedPlaylistId: playlistId,
            trackId: change.trackId,
            plexTrackRatingKey: change.track.ratingKey || change.track.plexId,
            position: playlist.tracks.length + index + 1,
            title: change.track.title,
            artist: change.track.artist.title,
            album: change.track.album.title,
            liked: Number(change.track.rating) >= 8,
          })),
          skipDuplicates: true,
        });
        await tx.generatedPlaylist.update({ where: { id: playlistId }, data: { trackCount: playlist.tracks.length + accepted.length, lastRegeneratedAt: new Date() } });
        await tx.recentlyAddedAutomationChange.updateMany({ where: { id: { in: accepted.map((item) => item.id) } }, data: { status: "applied", appliedAt: new Date(), error: null } });
        await tx.recentlyAddedPlaylistMatch.updateMany({ where: { id: { in: accepted.map((item) => item.matchId).filter((id): id is string => Boolean(id)) } }, data: { status: "applied", appliedAt: new Date() } });
        await tx.recentlyAddedTrackState.updateMany({ where: { trackId: { in: accepted.map((item) => item.trackId) } }, data: { status: automatic ? "automatically_added" : "manually_added", processedAt: new Date() } });
        await tx.track.updateMany({ where: { id: { in: accepted.map((item) => item.trackId) } }, data: { recentlyAddedStatus: automatic ? "automatically_added" : "manually_added", recentlyAddedProcessedAt: new Date() } });
        await createPlaylistVersionInTransaction(tx, { generatedPlaylistId: playlistId, reason: "recently_added_automation", description: `Recently Added Automation added ${accepted.length} track${accepted.length === 1 ? "" : "s"}`, syncStatus: "pending", force: true });
      });
      committed = accepted.length > 0;
      if (playlist.plexPlaylistRatingKey) await syncGeneratedPlaylistToPlex(userId, playlistId);
      const completedIds = [...accepted, ...alreadyPresent].map((item) => item.id);
      const completedMatchIds = [...accepted, ...alreadyPresent].map((item) => item.matchId).filter((id): id is string => Boolean(id));
      await prisma.$transaction([
        prisma.recentlyAddedAutomationChange.updateMany({ where: { id: { in: completedIds } }, data: { status: "applied", appliedAt: new Date(), error: null } }),
        prisma.recentlyAddedPlaylistMatch.updateMany({ where: { id: { in: completedMatchIds } }, data: { status: "applied", appliedAt: new Date() } }),
        prisma.playlistRevision.updateMany({ where: { generatedPlaylistId: playlistId, isCurrent: true, syncStatus: "pending" }, data: { syncStatus: "synced" } }),
      ]);
      applied += accepted.length;
      playlistsModified += 1;
      console.info("[RecentlyAdded] playlist updated", { playlistId, runId: resolvedRunId, added: accepted.length, automatic });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Playlist update failed";
      const failedChanges = [...accepted, ...alreadyPresent];
      await prisma.recentlyAddedAutomationChange.updateMany({ where: { id: { in: failedChanges.map((item) => item.id) } }, data: { status: "failed", error: message } });
      await prisma.recentlyAddedPlaylistMatch.updateMany({ where: { id: { in: failedChanges.map((item) => item.matchId).filter((id): id is string => Boolean(id)) } }, data: { status: "failed" } });
      if (committed) await prisma.playlistRevision.updateMany({ where: { generatedPlaylistId: playlistId, isCurrent: true, syncStatus: "pending" }, data: { syncStatus: "failed" } });
      failed += failedChanges.length;
      console.error("[RecentlyAdded] playlist update failed", { playlistId, runId: resolvedRunId, reason: message });
    }
  }
  await prisma.recentlyAddedAutomationRun.update({ where: { id: resolvedRunId }, data: { status: failed ? "completed_with_warnings" : "completed", phase: "completed", automaticallyAdded: automatic ? applied : 0, playlistsModified, completedAt: new Date() } });
  return { runId: resolvedRunId, applied, playlistsModified, failed };
}

export async function rejectRecentlyAddedChanges(userId: string, runId: string, matchIds?: string[]) {
  const changes = await prisma.recentlyAddedAutomationChange.updateMany({ where: { runId, run: { userId }, status: { in: ["pending", "approved"] }, ...(matchIds?.length ? { matchId: { in: matchIds.slice(0, 500) } } : {}) }, data: { status: "rejected", reviewedAt: new Date(), approvedBy: userId } });
  return { rejected: changes.count };
}
