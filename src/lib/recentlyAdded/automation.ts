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
import { createAutomationProposal, evaluatePlaylistAutomation, getAutomationPolicy, quietHoursState, recordAutomationActivity } from "../automation";
import { DEFAULT_SCORING_MODEL } from "../scoringModelCatalog";

export const RECENTLY_ADDED_JOB_KEY = "recently-added:automation";

function snapshotSettings(settings: any) {
  const { id: _id, userId: _userId, createdAt: _createdAt, updatedAt: _updatedAt, ...safe } = settings;
  return safe as Prisma.InputJsonValue;
}

async function startRun(userId: string, triggerType: string, batchId: string | null, settings: any, lockKey?: string, beta?: { requiredFeatureFlags: string[]; requestedScoringModel: string; requestedAccessLevel: string }) {
  return prisma.recentlyAddedAutomationRun.create({
    data: { userId, batchId, triggerType, status: "scanning", phase: "scanning", settingsSnapshot: snapshotSettings(settings), lockKey: lockKey || null, requiredFeatureFlags: beta?.requiredFeatureFlags || [], requestedScoringModel: beta?.requestedScoringModel || DEFAULT_SCORING_MODEL, requestedAccessLevel: beta?.requestedAccessLevel || "STABLE" },
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
      generatedPlaylist: { userId },
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
        // The centralized v2.1.9 policy, not this legacy preview flag, is authoritative.
        status: "approved",
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
  const candidateConfidence = new Map(matches.map((match) => [`${match.generatedPlaylistId}:${match.trackId}`, match.confidenceScore]));
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
      {
        const additions = preview.changes.map((change: any) => ({ id: `add:${change.id || change.position}`, trackId: change.proposedTrackId, positionAfter: change.position, confidence: Math.round(change.proposedMetrics?.confidenceScore ?? change.proposedMetrics?.confidence ?? candidateConfidence.get(`${playlistId}:${change.proposedTrackId}`) ?? 0), metadataComplete: Boolean(change.proposedTrackId) }));
        const removals = preview.changes.map((change: any) => ({ id: `remove:${change.id || change.position}`, trackId: change.originalTrackId, positionBefore: change.position, confidence: Math.round(change.proposedMetrics?.confidenceScore ?? change.proposedMetrics?.confidence ?? candidateConfidence.get(`${playlistId}:${change.proposedTrackId}`) ?? 0), protected: change.originalTrack?.automationProtected, locked: change.originalTrack?.locked, important: change.originalTrack?.liked, metadataComplete: Boolean(change.originalTrackId) }));
        const decision = await evaluatePlaylistAutomation({ userId, generatedPlaylistId: playlistId, source: "SCHEDULED_REGENERATION", additions, removals });
        if (!decision.allowed) {
          const mayCreateQuietProposal = decision.reasonCode !== "quiet_hours_active" || decision.policySnapshot.allowProposalsDuringQuietHours !== false;
          const mayStoreSuggestion = !["automation_disabled", "automation_paused", "policy_invalid"].includes(decision.reasonCode);
          const proposal = mayCreateQuietProposal && mayStoreSuggestion ? await createAutomationProposal({ userId, generatedPlaylistId: playlistId, source: "SCHEDULED_REGENERATION", decision, status: decision.reasonCode === "quiet_hours_active" ? "DELAYED" : decision.requiresApproval || decision.reasonCode === "suggest_only_mode" ? "PENDING" : "SUGGESTED", idempotencyKey: decision.reasonCode === "quiet_hours_active" ? `scheduled-regeneration:quiet:${playlistId}:${decision.eligibleAfter}` : `scheduled-regeneration:${preview.previewId}`, items: [...additions.map((item) => ({ ...item, action: "ADD" as const })), ...removals.map((item) => ({ ...item, action: "REMOVE" as const }))] }) : null;
          await recordAutomationActivity({ userId, generatedPlaylistId: playlistId, source: "SCHEDULED_REGENERATION", status: decision.reasonCode === "quiet_hours_active" ? "DELAYED" : proposal ? (decision.requiresApproval ? "AWAITING_APPROVAL" : "SUGGESTED") : "BLOCKED", decision, proposedAdditions: additions.length, proposedRemovals: removals.length, proposalId: proposal?.id });
          warnings.push(`Playlist ${playlistId}: ${decision.summary}`);
          continue;
        }
        const allowedChanges = preview.changes.filter((change: any) => decision.eligibleAdditionIds.includes(`add:${change.id || change.position}`) && decision.eligibleRemovalIds.includes(`remove:${change.id || change.position}`));
        if (allowedChanges.length !== preview.changes.length) {
          warnings.push(`Playlist ${playlistId}: scheduled regeneration was not applied because the preview contains changes blocked by policy. A new bounded preview is required.`);
          await recordAutomationActivity({ userId, generatedPlaylistId: playlistId, source: "SCHEDULED_REGENERATION", status: "BLOCKED", decision: { ...decision, allowed: false, reasonCode: "policy_preview_mismatch", summary: "The regeneration preview included changes outside the allowed policy limits." }, proposedAdditions: additions.length, proposedRemovals: removals.length });
          continue;
        }
        const result = await applyAdvancedPlaylistRegeneration({ userId, generatedPlaylistId: playlistId, previewId: preview.previewId });
        if (!result.rejected) {
          applied += result.tracksReplaced; playlistsModified += 1;
          await recordAutomationActivity({ userId, generatedPlaylistId: playlistId, source: "SCHEDULED_REGENERATION", status: "APPLIED", decision, proposedAdditions: additions.length, proposedRemovals: removals.length, appliedAdditions: result.tracksReplaced, appliedRemovals: result.tracksReplaced });
        }
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
  const globalAutomationPolicy = await getAutomationPolicy(userId);
  if (triggerType !== "manual" && globalAutomationPolicy.permissionLevel === "DISABLED") {
    console.info("[AutomationPolicy] unattended analysis blocked", { userId, source: "RECENTLY_ADDED", reasonCode: "automation_disabled" });
    return { skipped: true, reason: "automation_disabled", permanent: false };
  }
  if (triggerType !== "manual" && quietHoursState(globalAutomationPolicy).active && !globalAutomationPolicy.allowAnalysisDuringQuietHours) {
    console.info("[AutomationPolicy] unattended analysis delayed", { userId, source: "RECENTLY_ADDED", reasonCode: "quiet_hours_active" });
    return { skipped: true, reason: "quiet_hours_active", permanent: false };
  }
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
  const lock = acquireJobLock({ name: "recently added automation", keys: [RECENTLY_ADDED_JOB_KEY, `recently-added:user:${userId}`, `automation:user:${userId}`], source: triggerType });
  if (!lock.acquired) return { skipped: true, reason: "already_running", activeRun: lock.activeJob };
  const history = await safeStartJobHistory({ userId, type: "playlist", name: "Recently Added Automation", trigger: triggerType, lockKey: lock.job.lockKey, workerId: lock.job.workerId });
  attachJobHistoryToLock(lock.job, history, "playlist");
  let run: any = null;
  let batchId: string | null = null;
  try {
    run = await startRun(userId, triggerType, null, settings, lock.job.lockKey, { requiredFeatureFlags: requestedFeatureFlags, requestedScoringModel: DEFAULT_SCORING_MODEL, requestedAccessLevel: betaStatus.accessLevel });
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
    if (settings.enabled && settings.autoAddStrongMatches && changeSet.proposed) {
      setJobPhase(lock.job, "Applying approved automation");
      await prisma.recentlyAddedAutomationRun.update({ where: { id: run.id }, data: { status: "applying_approved_automation", phase: "applying_approved_automation" } });
      applied = await applyRecentlyAddedChanges({ userId, runId: run.id, automatic: true });
    }
    const regeneration = triggerType === "scheduled" ? await runScheduledRegenerationPreviews(userId, settings, batchId) : { previews: 0, applied: 0, playlistsModified: 0, warnings: [] as string[] };
    applied.applied += regeneration.applied;
    applied.playlistsModified += regeneration.playlistsModified;
    const mix = settings.enabled && settings.createRecentlyAddedPlaylists ? await createRecentlyAddedMix({ userId, automatic: true }).catch((error) => ({ created: false, reason: error instanceof Error ? error.message : "mix_failed" })) : null;
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
  const profile = await prisma.userRecommendationProfile.findUnique({ where: { userId }, select: { enabled: true } });
  const excludedTrackIds = new Set(profile?.enabled ? (await prisma.userTrackPreference.findMany({ where: { userId, state: "NEVER_RECOMMEND", trackId: { in: changes.map((change) => change.trackId) } }, select: { trackId: true } })).map((row) => row.trackId) : []);
  const groups = new Map<string, typeof changes>();
  for (const change of changes) groups.set(change.generatedPlaylistId, [...(groups.get(change.generatedPlaylistId) || []), change]);
  let applied = 0;
  let failed = 0;
  let playlistsModified = 0;
  for (const [playlistId, group] of Array.from(groups.entries())) {
    const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, include: { tracks: { orderBy: { position: "asc" } }, automationSettings: true } });
    if (!playlist) { failed += group.length; continue; }
    let policyDecision = null as Awaited<ReturnType<typeof evaluatePlaylistAutomation>> | null;
    let proposalId: string | null = null;
    let policyEligibleIds: Set<string> | null = null;
    if (automatic) {
      const candidates = group.map((change) => ({ id: change.id, trackId: change.trackId, confidence: change.match?.confidenceScore == null ? null : Math.round(change.match.confidenceScore), metadataComplete: Boolean((change.track.ratingKey || change.track.plexId) && change.track.title && change.track.artist?.title) }));
      policyDecision = await evaluatePlaylistAutomation({ userId, generatedPlaylistId: playlistId, source: "RECENTLY_ADDED", additions: candidates });
      if (!policyDecision.allowed) {
        const mayCreateQuietProposal = policyDecision.reasonCode !== "quiet_hours_active" || policyDecision.policySnapshot.allowProposalsDuringQuietHours !== false;
        const mayStoreSuggestion = !["automation_disabled", "automation_paused", "policy_invalid"].includes(policyDecision.reasonCode);
        const proposal = mayCreateQuietProposal && mayStoreSuggestion
          ? await createAutomationProposal({ userId, generatedPlaylistId: playlistId, source: "RECENTLY_ADDED", decision: policyDecision, status: policyDecision.reasonCode === "quiet_hours_active" ? "DELAYED" : policyDecision.requiresApproval || policyDecision.reasonCode === "suggest_only_mode" ? "PENDING" : "SUGGESTED", idempotencyKey: policyDecision.reasonCode === "quiet_hours_active" ? `recently-added:quiet:${playlistId}:${policyDecision.eligibleAfter}` : `recently-added:${resolvedRunId}:${playlistId}`, requestingJobId: resolvedRunId, items: group.map((change) => ({ id: change.id, action: "ADD", trackId: change.trackId, plexRatingKey: change.track.ratingKey || change.track.plexId, confidence: change.match?.confidenceScore, explanation: change.reasonsJson })) })
          : null;
        proposalId = proposal?.id || null;
        await recordAutomationActivity({ userId, generatedPlaylistId: playlistId, source: "RECENTLY_ADDED", status: proposal ? (policyDecision.requiresApproval ? "AWAITING_APPROVAL" : "SUGGESTED") : policyDecision.reasonCode === "quiet_hours_active" ? "DELAYED" : "BLOCKED", decision: policyDecision, proposedAdditions: group.length, proposalId, jobId: resolvedRunId, items: group.map((change) => ({ action: "ADD", trackId: change.trackId, plexRatingKey: change.track.ratingKey || change.track.plexId, confidence: change.match?.confidenceScore, outcome: "SKIPPED", reasonCode: policyDecision?.skipped.find((item) => item.candidateId === change.id)?.reasonCode || policyDecision?.reasonCode, explanation: change.reasonsJson })) });
        console.info("[AutomationPolicy] automatic write blocked", { userId, playlistId, runId: resolvedRunId, source: "RECENTLY_ADDED", reasonCode: policyDecision.reasonCode, proposalId });
        continue;
      }
      policyEligibleIds = new Set(policyDecision.eligibleAdditionIds);
    }
    const accepted = [] as typeof group;
    const alreadyPresent = [] as typeof group;
    for (const change of group.filter((item) => !policyEligibleIds || policyEligibleIds.has(item.id)).slice(0, automatic && !policyDecision ? settings.maxAddsPerPlaylist : group.length)) {
      if (excludedTrackIds.has(change.trackId)) {
        await prisma.recentlyAddedAutomationChange.update({ where: { id: change.id }, data: { status: "failed", error: "never_recommend" } });
        failed += 1;
        continue;
      }
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
    let backupVersionId: string | null = null;
    try {
      if (accepted.length) await prisma.$transaction(async (tx) => {
        const backup = await createPlaylistVersionInTransaction(tx, { generatedPlaylistId: playlistId, reason: "automation_backup", description: "Automatic backup before Recently Added changes", force: true });
        backupVersionId = backup.id;
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
        await tx.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: playlistId }, { playlistBId: playlistId }] }, data: { stale: true } });
        await tx.playlistCoordinationSetting.updateMany({ where: { playlistId }, data: { analysisStale: true } });
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
      if (automatic && policyDecision) await recordAutomationActivity({ userId, generatedPlaylistId: playlistId, source: "RECENTLY_ADDED", status: "APPLIED", decision: policyDecision, proposedAdditions: group.length, appliedAdditions: accepted.length, playlistRevisionId: backupVersionId, proposalId, jobId: resolvedRunId, items: group.map((change) => ({ action: "ADD", trackId: change.trackId, plexRatingKey: change.track.ratingKey || change.track.plexId, confidence: change.match?.confidenceScore, outcome: accepted.some((item) => item.id === change.id) ? "APPLIED" : "SKIPPED", reasonCode: policyDecision?.skipped.find((item) => item.candidateId === change.id)?.reasonCode, explanation: change.reasonsJson })) });
      console.info("[RecentlyAdded] playlist updated", { playlistId, runId: resolvedRunId, added: accepted.length, automatic });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Playlist update failed";
      const failedChanges = [...accepted, ...alreadyPresent];
      await prisma.recentlyAddedAutomationChange.updateMany({ where: { id: { in: failedChanges.map((item) => item.id) } }, data: { status: "failed", error: message } });
      await prisma.recentlyAddedPlaylistMatch.updateMany({ where: { id: { in: failedChanges.map((item) => item.matchId).filter((id): id is string => Boolean(id)) } }, data: { status: "failed" } });
      if (committed) await prisma.playlistRevision.updateMany({ where: { generatedPlaylistId: playlistId, isCurrent: true, syncStatus: "pending" }, data: { syncStatus: "failed" } });
      if (automatic && policyDecision) await recordAutomationActivity({ userId, generatedPlaylistId: playlistId, source: "RECENTLY_ADDED", status: committed ? "PARTIAL" : "FAILED", decision: { ...policyDecision, reasonCode: "plex_unavailable", summary: committed ? "The local playlist changed, but Plex synchronization failed. Review or roll back before retrying." : "The automated playlist update failed before Plex was changed." }, proposedAdditions: group.length, appliedAdditions: 0, playlistRevisionId: backupVersionId, jobId: resolvedRunId, error: message, items: group.map((change) => ({ action: "ADD", trackId: change.trackId, plexRatingKey: change.track.ratingKey || change.track.plexId, confidence: change.match?.confidenceScore, outcome: committed && accepted.some((item) => item.id === change.id) ? "PARTIAL" : "FAILED", reasonCode: "plex_unavailable", explanation: change.reasonsJson })) });
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
