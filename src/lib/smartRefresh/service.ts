import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { queryInBatches } from "../databaseBatching";
import { safeFinishJobHistory, safeRecordJobHistory, safeStartJobHistory } from "../jobHistory";
import { analyzeAdvancedPlaylistRegeneration, applyAdvancedPlaylistRegeneration, previewAdvancedPlaylistRegeneration, previewGeneratedPlaylistRegeneration, regenerateGeneratedPlaylistFromPreview } from "../playlistService";
import { evaluateSmartRefresh, isTimeInQuietHours } from "./core";
import { ensureSmartRefreshGlobalSettings, ensureSmartRefreshSettings, resolvedThresholds } from "./settings";
import type { SmartRefreshDecision, SmartRefreshRecommendation, SmartRefreshSignals } from "./types";

const DAY_MS = 86_400_000;
const ACTIVE_JOB_STATUSES = ["queued", "retrying", "running", "processing", "pending", "active", "in_progress"];
const json = (value: unknown) => value as Prisma.InputJsonValue;
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

function regenerationMode(recommendation: SmartRefreshRecommendation) {
  if (recommendation === "REBALANCE_PLAYLIST") return "improve_bpm_flow";
  if (recommendation === "ADD_COMPATIBLE_TRACKS") return "increase_discovery";
  if (recommendation === "REFRESH_METADATA_AFFECTED_TRACKS") return "replace_low_scoring";
  return "replace_weak_tracks";
}

function quietHoursPolicy(settings: any, global: any) {
  const override = settings.quietHoursOverrideJson && typeof settings.quietHoursOverrideJson === "object" && !Array.isArray(settings.quietHoursOverrideJson) ? settings.quietHoursOverrideJson as any : null;
  return override ? { enabled: override.enabled, start: override.start, end: override.end, timezone: override.timezone, allowEvaluations: override.allowEvaluations, allowGeneration: override.allowGeneration }
    : { enabled: global.quietHoursEnabled, start: global.quietHoursStart, end: global.quietHoursEnd, timezone: global.timezone, allowEvaluations: global.allowEvaluationsQuietHours, allowGeneration: global.allowGenerationQuietHours };
}

function nextQuietHoursEnd(now: Date, policy: ReturnType<typeof quietHoursPolicy>) {
  for (let minutes = 1; minutes <= 24 * 60 + 5; minutes++) {
    const candidate = new Date(now.getTime() + minutes * 60_000);
    if (!isTimeInQuietHours({ now: candidate, start: policy.start, end: policy.end, timezone: policy.timezone })) return candidate;
  }
  return new Date(now.getTime() + DAY_MS);
}

function identityDrift(profile: any, tracks: any[]) {
  if (!profile || !tracks.length) return null;
  const bpms = tracks.map((track) => numeric(track.effectiveBpm ?? track.bpm)).filter((value): value is number => value != null);
  const energies = tracks.map((track) => numeric(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy)).filter((value): value is number => value != null);
  const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const bpm = avg(bpms); const energy = avg(energies);
  let total = 0; let weight = 0;
  if (bpm != null && Array.isArray(profile.bpmRange)) { const outside = bpm < profile.bpmRange[0] ? profile.bpmRange[0] - bpm : bpm > profile.bpmRange[1] ? bpm - profile.bpmRange[1] : 0; total += Math.min(100, outside / 40 * 100) * .4; weight += .4; }
  if (energy != null && Array.isArray(profile.energyRange)) { const outside = energy < profile.energyRange[0] ? profile.energyRange[0] - energy : energy > profile.energyRange[1] ? energy - profile.energyRange[1] : 0; total += Math.min(100, outside / .35 * 100) * .35; weight += .35; }
  const preferred = new Set((profile.preferredArtists || []).slice(0, 20).map((item: any) => item.artistId));
  if (preferred.size) { const match = tracks.filter((track) => preferred.has(track.artistId)).length / tracks.length; total += Math.max(0, .25 - match) / .25 * 100 * .25; weight += .25; }
  return weight ? Math.round(total / weight * 10) / 10 : null;
}

function playbackRepetition(profiles: any[]) {
  const observations = profiles.reduce((sum, row) => sum + row.recentPlayCount30Days, 0);
  if (!observations) return { score: null, observations: 0 };
  const sorted = profiles.map((row) => row.recentPlayCount30Days).sort((a, b) => b - a);
  const topCount = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * .2))).reduce((sum, value) => sum + value, 0);
  const skips = profiles.reduce((sum, row) => sum + row.skipCount, 0);
  const plays = profiles.reduce((sum, row) => sum + row.totalPlayCount, 0);
  const concentration = topCount / observations;
  const skipRate = plays ? skips / plays : 0;
  const score = Math.min(100, concentration * 75 + Math.min(1, skipRate) * 25);
  return { score: Math.round(score * 10) / 10, observations };
}

async function gatherSignals(userId: string, playlist: any, settings: any, triggerSource: string) {
  const trackIds: string[] = playlist.tracks.map((row: any) => row.trackId).filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
  const [tracks, profiles, compatibleMatches, previousVersion] = await Promise.all([
    queryInBatches(trackIds, (batch) => prisma.track.findMany({ where: { id: { in: batch }, library: { server: { userId } } }, select: { id: true, syncStatus: true, bpm: true, effectiveBpm: true, bpmAnalyzedAt: true, updatedAt: true, artistId: true, audioFeature: { select: { energy: true, effectiveEnergy: true, lastUpdated: true } } } })),
    queryInBatches(trackIds, (batch) => prisma.userTrackPlaybackProfile.findMany({ where: { userId, trackId: { in: batch } }, select: { totalPlayCount: true, skipCount: true, recentPlayCount30Days: true } })),
    prisma.recentlyAddedPlaylistMatch.findMany({ where: { generatedPlaylistId: playlist.id, status: { in: ["pending", "suggested", "approved"] }, compatibilityScore: { gte: 65 } }, select: { trackId: true, compatibilityScore: true }, orderBy: { compatibilityScore: "desc" }, take: 200 }),
    prisma.playlistRevision.findFirst({ where: { generatedPlaylistId: playlist.id, scoreSnapshot: { not: Prisma.JsonNull } }, orderBy: { createdAt: "desc" }, select: { scoreSnapshot: true } }),
  ]);
  const thresholds = resolvedThresholds(settings);
  const analysis = await analyzeAdvancedPlaylistRegeneration({ userId, generatedPlaylistId: playlist.id, input: { mode: "replace_weak_tracks", scoreThreshold: thresholds.weakTrackThreshold, replacementSensitivity: settings.sensitivity === "LOW" ? "conservative" : settings.sensitivity === "HIGH" ? "aggressive" : "balanced" } });
  const weakTrackCount = analysis.analysis.filter((item: any) => item.overallWeakness >= thresholds.weakTrackThreshold && !item.locked && !item.liked).length;
  const since = settings.lastSuccessfulRefreshAt || playlist.lastRegeneratedAt || playlist.lastGeneratedAt;
  const metadataRows = await queryInBatches(trackIds, (batch) => prisma.trackMetadataCorrectionHistory.findMany({ where: { trackId: { in: batch }, createdAt: { gt: since } }, distinct: ["trackId"], select: { trackId: true } }));
  const metadataTrackIds = new Set(metadataRows.map((row) => row.trackId));
  tracks.forEach((track) => { if ((track.bpmAnalyzedAt && track.bpmAnalyzedAt > since) || (track.audioFeature?.lastUpdated && track.audioFeature.lastUpdated > since)) metadataTrackIds.add(track.id); });
  const playback = playbackRepetition(profiles);
  const currentScore = numeric((analysis.qualityScore as any)?.overallScore ?? (playlist.qualityScoreJson as any)?.overallScore);
  const previousScore = numeric((previousVersion?.scoreSnapshot as any)?.overallScore);
  const fallbackOverdue = settings.refreshMode === "SMART_WITH_FALLBACK" && settings.fallbackAfterHours != null && Date.now() - (settings.lastSuccessfulRefreshAt || playlist.lastRegeneratedAt || playlist.lastGeneratedAt).getTime() >= settings.fallbackAfterHours * 3_600_000;
  const base: SmartRefreshSignals = { currentScore, previousScore, estimatedScoreAfterRefresh: null, weakTrackCount, compatibleNewTrackCount: compatibleMatches.length, averageCandidateScore: compatibleMatches.length ? compatibleMatches.reduce((sum, row) => sum + row.compatibilityScore, 0) / compatibleMatches.length : null, repetitivePlaybackScore: playback.score, playbackObservationCount: playback.observations, identityDriftScore: identityDrift((playlist.identity?.effectiveProfileJson as any) || null, tracks), identityDamageFromProposal: null, improvedMetadataTrackCount: metadataTrackIds.size, unavailableTrackCount: tracks.filter((track) => track.syncStatus !== "active").length + Math.max(0, trackIds.length - tracks.length), libraryChangeCount: triggerSource === "MAJOR_LIBRARY_SYNC" ? compatibleMatches.length : 0, fallbackOverdue, lockedTrackCount: playlist.tracks.filter((track: any) => track.locked || track.regenerationExcluded).length };
  return { base, analysis, candidateTrackIds: compatibleMatches.map((match) => match.trackId), thresholds };
}

async function guardsFor(userId: string, playlist: any, settings: any, automatic: boolean, global: any) {
  const now = new Date(); const policy = quietHoursPolicy(settings, global);
  let quietHours = false; let quietHoursEnd: Date | null = null; let timezoneError = false;
  if (policy.enabled) { try { quietHours = isTimeInQuietHours({ now, start: policy.start, end: policy.end, timezone: policy.timezone }) && !policy.allowGeneration; if (quietHours) quietHoursEnd = nextQuietHoursEnd(now, policy); } catch { timezoneError = true; } }
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [successfulWeek, activeRegeneration, activeOrchestration, activeAnalysis, serverAvailable] = await Promise.all([
    settings.maximumRefreshesPerWeek == null ? Promise.resolve(0) : prisma.smartRefreshEvaluation.count({ where: { generatedPlaylistId: playlist.id, status: "EXECUTED", executedAt: { gte: weekAgo } } }),
    prisma.playlistRegeneration.count({ where: { generatedPlaylistId: playlist.id, status: "applying" } }),
    prisma.playlistOrchestrationJob.count({ where: { managedPlaylist: { generatedPlaylistId: playlist.id }, status: { in: ["QUEUED", "WAITING", "RUNNING"] } } }),
    prisma.jobHistory.count({ where: { OR: [{ userId }, { userId: null }], type: { in: ["audio_features", "local_audio_features", "plex_sync"] }, status: { in: ACTIVE_JOB_STATUSES } } }),
    playlist.serverId ? prisma.server.count({ where: { id: playlist.serverId, userId } }) : Promise.resolve(1),
  ]);
  const last = settings.lastSuccessfulRefreshAt || playlist.lastRegeneratedAt;
  const cooldownUntil = last ? new Date(last.getTime() + settings.minimumRefreshIntervalHours * 3_600_000) : null;
  return { cooldownUntil: cooldownUntil && cooldownUntil > now ? cooldownUntil : null, weeklyLimitReached: settings.maximumRefreshesPerWeek != null && successfulWeek >= settings.maximumRefreshesPerWeek, quietHours: automatic && quietHours, quietHoursEnd, activeGenerationJob: activeRegeneration > 0 || activeOrchestration > 0, playlistLocked: Boolean(playlist.automationSettings?.protected || playlist.automationSettings?.paused), libraryUnavailable: !serverAvailable || timezoneError, analysisInProgress: activeAnalysis > 0, automaticFullRegenerationAllowed: settings.allowAutomaticFullRegeneration };
}

export async function evaluatePlaylistSmartRefresh(input: { userId: string; generatedPlaylistId: string; triggerSource?: string; automatic?: boolean; force?: boolean }) {
  const started = Date.now(); const automatic = Boolean(input.automatic); const triggerSource = input.triggerSource || (automatic ? "PERIODIC_EVALUATION" : "MANUAL_CHECK");
  const settings = await ensureSmartRefreshSettings(input.userId, input.generatedPlaylistId);
  const global = await ensureSmartRefreshGlobalSettings(input.userId);
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: input.generatedPlaylistId, userId: input.userId }, include: { tracks: { orderBy: { position: "asc" } }, identity: true, automationSettings: true } });
  if (!playlist) throw new Error("Generated playlist not found");
  if (playlist.engineVersion !== "v2") throw new Error("Smart Refresh requires a Smart Mix Engine v2 playlist.");
  if (automatic && !["SMART_REFRESH", "SMART_WITH_FALLBACK"].includes(settings.refreshMode)) throw new Error("Automatic Smart Refresh evaluation is not enabled for this playlist.");
  if (!input.force) { const recent = await prisma.smartRefreshEvaluation.findFirst({ where: { generatedPlaylistId: playlist.id, evaluatedAt: { gte: new Date(Date.now() - 5 * 60_000) }, status: { not: "STALE" } }, orderBy: { evaluatedAt: "desc" } }); if (recent) return serializeEvaluation(recent); }
  const history = await safeStartJobHistory({ userId: input.userId, type: "playlist", name: `Smart Refresh evaluation: ${playlist.plexPlaylistTitle}`, trigger: automatic ? "scheduled" : "manual", metadata: { generatedPlaylistId: playlist.id, triggerSource, automatic } });
  try {
    const evaluationQuietPolicy = quietHoursPolicy(settings, global);
    if (automatic && evaluationQuietPolicy.enabled && !evaluationQuietPolicy.allowEvaluations && isTimeInQuietHours({ now: new Date(), start: evaluationQuietPolicy.start, end: evaluationQuietPolicy.end, timezone: evaluationQuietPolicy.timezone })) {
      const deferredUntil = nextQuietHoursEnd(new Date(), evaluationQuietPolicy);
      const blocker = { code: "QUIET_HOURS_EVALUATION", message: "Smart Refresh evaluations are deferred during quiet hours.", eligibleAt: deferredUntil.toISOString() };
      const evaluation = await prisma.smartRefreshEvaluation.create({ data: { userId: input.userId, generatedPlaylistId: playlist.id, triggerSource, status: "DEFERRED", recommendation: settings.lastRecommendation || "NO_ACTION", shouldRefresh: false, automatic: true, confidence: 0, currentScore: numeric((playlist.qualityScoreJson as any)?.overallScore), compatibleNewTrackCount: 0, weakTrackCount: 0, improvedMetadataTrackCount: 0, reasonsJson: json([]), blockersJson: json([blocker]), suggestedActionsJson: json([]), thresholdsJson: json(resolvedThresholds(settings)), playlistUpdatedAt: playlist.updatedAt, settingsUpdatedAt: settings.updatedAt, invalidationVersion: settings.invalidationVersion, deferredUntil, durationMs: Date.now() - started } });
      await prisma.smartRefreshSettings.update({ where: { id: settings.id }, data: { lastEvaluatedAt: evaluation.evaluatedAt, deferredUntil } });
      await safeFinishJobHistory({ job: history, status: "skipped", summary: blocker.message, counts: { attempted: 1, processed: 0, skipped: 1 }, metadata: { evaluationId: evaluation.id, blocker } });
      return serializeEvaluation(evaluation);
    }
    const gathered = await gatherSignals(input.userId, playlist, settings, triggerSource);
    let decision = evaluateSmartRefresh({ playlistId: playlist.id, signals: gathered.base, thresholds: gathered.thresholds, guards: await guardsFor(input.userId, playlist, settings, automatic, global) });
    let preview: any = null;
    if (decision.recommendation !== "NO_ACTION" && !decision.blockers.some((blocker) => ["ACTIVE_JOB", "LIBRARY_UNAVAILABLE", "ANALYSIS_IN_PROGRESS"].includes(blocker.code))) {
      try {
        preview = await previewAdvancedPlaylistRegeneration({ userId: input.userId, generatedPlaylistId: playlist.id, input: { mode: regenerationMode(decision.recommendation), candidateTrackIds: decision.recommendation === "ADD_COMPATIBLE_TRACKS" && gathered.candidateTrackIds.length ? gathered.candidateTrackIds : undefined, preserveLength: !settings.allowPlaylistGrowth, preserveLockedTracks: true, keepLikedTracks: true, preserveMoodCurve: true, preserveBpmCurve: true, preserveEnergyCurve: true, minimumReplacementImprovement: gathered.thresholds.minimumEstimatedImprovement, maximumReplacements: Math.min(25, Math.max(3, gathered.base.weakTrackCount || gathered.thresholds.minimumCompatibleTracks)), replacementSensitivity: settings.sensitivity === "LOW" ? "conservative" : settings.sensitivity === "HIGH" ? "aggressive" : "balanced" } });
        const nextSignals = { ...gathered.base, estimatedScoreAfterRefresh: numeric(preview.proposedPlaylistScore), identityDamageFromProposal: preview.identityImpact?.level === "High" ? 15 : preview.identityImpact?.level === "Medium" ? 6 : 0 };
        decision = evaluateSmartRefresh({ playlistId: playlist.id, signals: nextSignals, thresholds: gathered.thresholds, guards: await guardsFor(input.userId, playlist, settings, automatic, global) });
      } catch (error) {
        decision.blockers.push({ code: "CANDIDATE_ESTIMATE_FAILED", message: error instanceof Error ? error.message : "Candidate estimation failed." }); decision.shouldRefresh = false;
      }
    }
    const deferred = decision.blockers.find((blocker) => blocker.code === "QUIET_HOURS" || blocker.code === "COOLDOWN");
    const status = deferred ? "DEFERRED" : decision.shouldRefresh ? "RECOMMENDED" : decision.recommendation === "NO_ACTION" ? "HEALTHY" : "BLOCKED";
    const evaluation = await prisma.smartRefreshEvaluation.create({ data: { userId: input.userId, generatedPlaylistId: playlist.id, triggerSource, status, recommendation: decision.recommendation, shouldRefresh: decision.shouldRefresh, automatic, confidence: decision.confidence, currentScore: decision.currentScore, estimatedScoreAfterRefresh: decision.estimatedScoreAfterRefresh, estimatedImprovement: decision.estimatedImprovement, compatibleNewTrackCount: decision.compatibleNewTrackCount, weakTrackCount: decision.weakTrackCount, repetitivePlaybackScore: decision.repetitivePlaybackScore, identityDriftScore: decision.identityDriftScore, improvedMetadataTrackCount: decision.improvedMetadataTrackCount, reasonsJson: json(decision.reasons), blockersJson: json(decision.blockers), suggestedActionsJson: json(decision.suggestedActions), thresholdsJson: json(gathered.thresholds), signalSummaryJson: json({ ...gathered.base, compatibleCandidateTrackIds: gathered.candidateTrackIds.slice(0, 25) }), previewId: preview?.previewId || null, playlistUpdatedAt: playlist.updatedAt, settingsUpdatedAt: settings.updatedAt, invalidationVersion: settings.invalidationVersion, deferredUntil: deferred?.eligibleAt ? new Date(deferred.eligibleAt) : null, durationMs: Date.now() - started } });
    await prisma.smartRefreshSettings.update({ where: { id: settings.id }, data: { lastEvaluatedAt: evaluation.evaluatedAt, lastRecommendation: evaluation.recommendation, lastEstimatedImprovement: evaluation.estimatedImprovement, deferredUntil: evaluation.deferredUntil, evaluatedInvalidationVersion: settings.invalidationVersion, pendingTriggerSource: null } });
    await safeFinishJobHistory({ job: history, status: decision.shouldRefresh ? "completed_with_warnings" : "completed", summary: decision.shouldRefresh ? `Smart Refresh recommends ${decision.recommendation.toLowerCase().replaceAll("_", " ")} with an estimated ${decision.estimatedImprovement == null ? "unknown" : `+${decision.estimatedImprovement}`} improvement.` : `Smart Refresh made no playlist change: ${decision.blockers[0]?.message || "playlist is healthy"}`, counts: { attempted: 1, processed: 1, skipped: decision.shouldRefresh ? 0 : 1 }, metadata: { evaluationId: evaluation.id, generatedPlaylistId: playlist.id, recommendation: decision.recommendation, shouldRefresh: decision.shouldRefresh, estimatedImprovement: decision.estimatedImprovement, reasons: decision.reasons, blockers: decision.blockers, previewId: evaluation.previewId } });
    return serializeEvaluation(evaluation);
  } catch (error) { await safeFinishJobHistory({ job: history, status: "failed", error, summary: "Smart Refresh evaluation failed without changing the playlist." }); throw error; }
}

function serializeEvaluation(evaluation: any) { return { ...evaluation, reasons: evaluation.reasonsJson || [], blockers: evaluation.blockersJson || [], suggestedActions: evaluation.suggestedActionsJson || [], thresholds: evaluation.thresholdsJson || {}, signals: evaluation.signalSummaryJson || {} }; }

export async function getSmartRefreshLatest(userId: string, generatedPlaylistId: string) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true } }); if (!playlist) throw new Error("Generated playlist not found");
  const evaluation = await prisma.smartRefreshEvaluation.findFirst({ where: { generatedPlaylistId }, orderBy: { evaluatedAt: "desc" } }); return evaluation ? serializeEvaluation(evaluation) : null;
}

export async function getSmartRefreshPreview(userId: string, generatedPlaylistId: string, evaluationId: string) {
  const evaluation = await prisma.smartRefreshEvaluation.findFirst({ where: { id: evaluationId, generatedPlaylistId, userId } });
  if (!evaluation) throw new Error("Smart Refresh evaluation not found");
  const signalSummary = evaluation.signalSummaryJson && typeof evaluation.signalSummaryJson === "object" && !Array.isArray(evaluation.signalSummaryJson) ? evaluation.signalSummaryJson as any : {};
  if (evaluation.recommendation === "ADD_COMPATIBLE_TRACKS" && Array.isArray(signalSummary.compatibleCandidateTrackIds)) {
    const settings = await prisma.smartRefreshSettings.findUnique({ where: { generatedPlaylistId } });
    if (settings?.allowPlaylistGrowth) {
      const compatibleCandidateTrackIds: string[] = signalSummary.compatibleCandidateTrackIds.filter((id: unknown): id is string => typeof id === "string").slice(0, 25);
      const tracks = await queryInBatches(compatibleCandidateTrackIds, (batch) => prisma.track.findMany({ where: { id: { in: batch }, library: { server: { userId } } }, select: { id: true, title: true, artist: { select: { title: true } }, album: { select: { title: true } }, effectiveBpm: true, bpm: true } }));
      return { evaluation: serializeEvaluation(evaluation), preview: { id: evaluation.previewId, status: "preview", originalScore: evaluation.currentScore, proposedScore: evaluation.estimatedScoreAfterRefresh, warnings: ["Compatible additions are appended in their current candidate order; Plex is unchanged until confirmation."], changes: tracks.map((track, index) => ({ position: index + 1, originalTrack: { id: "addition", title: "Playlist addition" }, proposedTrack: track, originalScore: null, proposedScore: null, improvement: null, reasons: ["Compatible new track"] })) } };
    }
  }
  if (!evaluation.previewId) return { evaluation: serializeEvaluation(evaluation), changes: [], warnings: [] };
  const preview = await prisma.playlistRegeneration.findFirst({ where: { id: evaluation.previewId, generatedPlaylistId, userId }, include: { changes: { orderBy: { position: "asc" } } } });
  if (!preview) throw new Error("The bounded preview has expired. Check for improvements again.");
  const ids = preview.changes.flatMap((change) => [change.originalTrackId, change.proposedTrackId]);
  const tracks = await queryInBatches(ids, (batch) => prisma.track.findMany({ where: { id: { in: batch }, library: { server: { userId } } }, select: { id: true, title: true, artist: { select: { title: true } }, album: { select: { title: true } }, effectiveBpm: true, bpm: true } }));
  const byId = new Map(tracks.map((track) => [track.id, track]));
  return { evaluation: serializeEvaluation(evaluation), preview: { id: preview.id, status: preview.status, originalScore: preview.originalScore, proposedScore: preview.proposedScore, warnings: preview.warningsJson || [], changes: preview.changes.map((change) => ({ position: change.position, originalTrack: byId.get(change.originalTrackId) || { id: change.originalTrackId, title: "Unavailable track" }, proposedTrack: byId.get(change.proposedTrackId) || { id: change.proposedTrackId, title: "Unavailable track" }, originalScore: change.originalScore, proposedScore: change.proposedScore, improvement: change.improvement, reasons: change.reasonsJson || [] })) } };
}

export async function dismissSmartRefreshEvaluation(userId: string, generatedPlaylistId: string, evaluationId: string) {
  const row = await prisma.smartRefreshEvaluation.findFirst({ where: { id: evaluationId, generatedPlaylistId, userId } }); if (!row) throw new Error("Smart Refresh evaluation not found");
  const now = new Date(); await prisma.$transaction([prisma.smartRefreshEvaluation.update({ where: { id: row.id }, data: { status: "DISMISSED", dismissedAt: now } }), prisma.smartRefreshSettings.update({ where: { generatedPlaylistId }, data: { dismissedAt: now } })]);
  return { success: true };
}

export async function executeSmartRefreshEvaluation(input: { userId: string; generatedPlaylistId: string; evaluationId: string; acceptedPositions?: number[]; automatic?: boolean }) {
  const evaluation = await prisma.smartRefreshEvaluation.findFirst({ where: { id: input.evaluationId, generatedPlaylistId: input.generatedPlaylistId, userId: input.userId }, include: { generatedPlaylist: { include: { smartRefreshSettings: true, automationSettings: true, tracks: { orderBy: { position: "asc" } } } } } });
  if (!evaluation) throw new Error("Smart Refresh evaluation not found"); if (!evaluation.previewId) throw new Error("This evaluation has no applicable preview. Check for improvements again.");
  if (evaluation.status === "EXECUTED") return { success: true, alreadyExecuted: true, evaluation: serializeEvaluation(evaluation) };
  const settings = evaluation.generatedPlaylist.smartRefreshSettings; if (!settings) throw new Error("Smart Refresh settings not found");
  if (evaluation.generatedPlaylist.updatedAt.getTime() !== evaluation.playlistUpdatedAt.getTime() || settings.updatedAt.getTime() !== evaluation.settingsUpdatedAt.getTime() || settings.invalidationVersion !== evaluation.invalidationVersion) { await prisma.smartRefreshEvaluation.update({ where: { id: evaluation.id }, data: { status: "STALE" } }); throw new Error("Playlist or Smart Refresh settings changed. Check for improvements again."); }
  const currentGuards = await guardsFor(input.userId, evaluation.generatedPlaylist, settings, Boolean(input.automatic), await ensureSmartRefreshGlobalSettings(input.userId));
  const executionBlockers = [currentGuards.cooldownUntil && "The refresh cooldown is active.", currentGuards.weeklyLimitReached && "The weekly refresh limit is reached.", currentGuards.quietHours && "Playlist changes are deferred during quiet hours.", currentGuards.activeGenerationJob && "Another generation job is active.", currentGuards.playlistLocked && "Playlist automation is paused or protected.", currentGuards.libraryUnavailable && "The Plex library is unavailable.", currentGuards.analysisInProgress && "Required analysis is still running."].filter((value): value is string => Boolean(value));
  if (executionBlockers.length) throw new Error(`Smart Refresh conditions changed: ${executionBlockers.join(" ")}`);
  if (input.automatic && (!evaluation.shouldRefresh || evaluation.recommendation === "FULL_REGENERATION" && !settings.allowAutomaticFullRegeneration || !settings.allowAutomaticWeakTrackRefresh)) throw new Error("Automatic execution is not permitted by the current Smart Refresh settings.");
  const before = evaluation.currentScore;
  const signalSummary = evaluation.signalSummaryJson && typeof evaluation.signalSummaryJson === "object" && !Array.isArray(evaluation.signalSummaryJson) ? evaluation.signalSummaryJson as any : {};
  const compatibleIds = Array.isArray(signalSummary.compatibleCandidateTrackIds) ? signalSummary.compatibleCandidateTrackIds.filter((id: unknown): id is string => typeof id === "string").slice(0, 25) : [];
  const currentTrackIds = evaluation.generatedPlaylist.tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id));
  const additions = evaluation.recommendation === "ADD_COMPATIBLE_TRACKS" && settings.allowPlaylistGrowth ? compatibleIds.filter((id: string) => !currentTrackIds.includes(id)).slice(0, Math.max(0, 5000 - currentTrackIds.length)) : [];
  const result = evaluation.recommendation === "FULL_REGENERATION"
    ? await (async () => { const generated = await previewGeneratedPlaylistRegeneration({ userId: input.userId, generatedPlaylistId: input.generatedPlaylistId, mode: "replace_all", preferDifferentTracks: true }); return regenerateGeneratedPlaylistFromPreview({ userId: input.userId, generatedPlaylistId: input.generatedPlaylistId, trackIds: generated.preview.trackIds, previewId: generated.preview.previewId, mode: "replace_all", preferDifferentTracks: true, regeneration: generated.preview.regeneration, warnings: generated.preview.warnings }); })()
    : additions.length
    ? await regenerateGeneratedPlaylistFromPreview({ userId: input.userId, generatedPlaylistId: input.generatedPlaylistId, trackIds: [...currentTrackIds, ...additions], previewId: evaluation.previewId, mode: "replace_all", preferDifferentTracks: false, regeneration: { mode: "add_compatible_tracks", currentPlaylistTrackCount: currentTrackIds.length, newPreviewTrackCount: currentTrackIds.length + additions.length, tracksKept: currentTrackIds.length, tracksReplaced: 0, newTracks: additions.length, newTracksAdded: additions.length, removedTracks: 0, snapshotAvailable: true }, warnings: ["Smart Refresh appended compatible tracks and preserved the existing order."] })
    : await applyAdvancedPlaylistRegeneration({ userId: input.userId, generatedPlaylistId: input.generatedPlaylistId, previewId: evaluation.previewId, acceptedPositions: input.acceptedPositions });
  if ((result as any).rejected || (result as any).tracksReplaced === 0 && evaluation.recommendation !== "FULL_REGENERATION") { await prisma.smartRefreshEvaluation.update({ where: { id: evaluation.id }, data: { status: "NO_CHANGE", executionAction: evaluation.recommendation, executedAt: new Date() } }); return result; }
  const refreshed = await prisma.generatedPlaylist.findUnique({ where: { id: input.generatedPlaylistId }, select: { qualityScoreJson: true } }); const after = numeric((refreshed?.qualityScoreJson as any)?.overallScore);
  const changedCount = additions.length || (evaluation.recommendation === "FULL_REGENERATION" ? Number((result as any).playlist?.trackCount || evaluation.generatedPlaylist.trackCount || 0) : Number((result as any).tracksReplaced || 0));
  const updated = await prisma.smartRefreshEvaluation.update({ where: { id: evaluation.id }, data: { status: "EXECUTED", executionAction: evaluation.recommendation, actualImprovement: before != null && after != null ? after - before : null, tracksRemoved: additions.length ? 0 : changedCount, tracksAdded: additions.length || changedCount, executedAt: new Date() } });
  await prisma.smartRefreshSettings.update({ where: { generatedPlaylistId: input.generatedPlaylistId }, data: { lastSuccessfulRefreshAt: updated.executedAt, deferredUntil: null } });
  await safeRecordJobHistory({ userId: input.userId, type: "playlist", name: `Smart Refresh execution: ${evaluation.generatedPlaylist.plexPlaylistTitle}`, status: "success", trigger: input.automatic ? "scheduled" : "manual", summary: `Smart Refresh applied ${evaluation.recommendation.toLowerCase().replaceAll("_", " ")} and changed ${changedCount} tracks.`, counts: { attempted: 1, processed: 1 }, metadata: { evaluationId: evaluation.id, previewId: evaluation.previewId, recommendation: evaluation.recommendation, expectedImprovement: evaluation.estimatedImprovement, actualImprovement: updated.actualImprovement, result } });
  return { ...result, tracksReplaced: Number((result as any).tracksReplaced || (evaluation.recommendation === "FULL_REGENERATION" ? changedCount : 0)), tracksAdded: additions.length || Number((result as any).tracksReplaced || 0), evaluation: serializeEvaluation(updated) };
}

export async function runSmartRefreshBatch(limit = 20) {
  const now = new Date(); const dueBefore = new Date(now.getTime() - 60 * 60_000);
  const rows = await prisma.smartRefreshSettings.findMany({ where: { refreshMode: { in: ["SMART_REFRESH", "SMART_WITH_FALLBACK"] }, OR: [{ deferredUntil: { lte: now } }, { deferredUntil: null, lastEvaluatedAt: null }, { deferredUntil: null, lastEvaluatedAt: { lte: dueBefore } }] }, include: { generatedPlaylist: { select: { userId: true } } }, orderBy: [{ deferredUntil: "asc" }, { lastEvaluatedAt: "asc" }], take: Math.max(1, Math.min(100, limit)) });
  const summary = { attempted: rows.length, evaluated: 0, refreshed: 0, deferred: 0, skipped: 0, failed: 0 };
  for (const row of rows) { try { if (row.lastEvaluatedAt && row.evaluatedInvalidationVersion === row.invalidationVersion && now.getTime() - row.lastEvaluatedAt.getTime() < row.evaluationIntervalHours * 3_600_000 && (!row.deferredUntil || row.deferredUntil > now)) { summary.skipped++; continue; } const evaluation = await evaluatePlaylistSmartRefresh({ userId: row.generatedPlaylist.userId, generatedPlaylistId: row.generatedPlaylistId, triggerSource: row.deferredUntil ? "DEFERRED_RETRY" : row.pendingTriggerSource || "PERIODIC_EVALUATION", automatic: true, force: true }); summary.evaluated++; if (evaluation.status === "DEFERRED") summary.deferred++; else if (evaluation.shouldRefresh && evaluation.previewId) { await executeSmartRefreshEvaluation({ userId: row.generatedPlaylist.userId, generatedPlaylistId: row.generatedPlaylistId, evaluationId: evaluation.id, automatic: true }); summary.refreshed++; } else summary.skipped++; } catch (error) { summary.failed++; console.error(`[SmartRefresh] Evaluation failed playlistId=${row.generatedPlaylistId}`, error instanceof Error ? error.message : error); } }
  return summary;
}

export async function recordMajorLibrarySync(input: { userId: string; serverId: string; libraryId: string; scanned: number; newTracks: number; missingTracks: number; restoredTracks?: number }) {
  const changed = input.newTracks + input.missingTracks + (input.restoredTracks || 0);
  const major = changed >= 50 || input.scanned > 0 && changed / input.scanned >= .05;
  if (!major) return { major: false, affectedPlaylists: 0 };
  const affected = await prisma.smartRefreshSettings.updateMany({ where: { refreshMode: { in: ["SMART_REFRESH", "SMART_WITH_FALLBACK"] }, generatedPlaylist: { userId: input.userId, serverId: input.serverId } }, data: { invalidationVersion: { increment: 1 }, pendingTriggerSource: "MAJOR_LIBRARY_SYNC", lastEvaluatedAt: null, deferredUntil: null } });
  await safeRecordJobHistory({ userId: input.userId, type: "playlist", name: "Smart Refresh library-change targeting", status: "success", trigger: "scheduled", summary: `Major library sync affected ${affected.count} Smart Refresh playlist${affected.count === 1 ? "" : "s"}; lightweight evaluations were made eligible.`, counts: { attempted: affected.count, processed: affected.count }, metadata: { triggerSource: "MAJOR_LIBRARY_SYNC", libraryId: input.libraryId, serverId: input.serverId, scanned: input.scanned, newTracks: input.newTracks, missingTracks: input.missingTracks, restoredTracks: input.restoredTracks || 0 } });
  return { major: true, affectedPlaylists: affected.count };
}

export async function getSmartRefreshDashboardSummary(userId: string) {
  const settings = await prisma.smartRefreshSettings.findMany({ where: { generatedPlaylist: { userId } }, select: { generatedPlaylistId: true, refreshMode: true, lastRecommendation: true, lastEstimatedImprovement: true, deferredUntil: true, lastEvaluatedAt: true, generatedPlaylist: { select: { plexPlaylistTitle: true } } } });
  const monitored = settings.filter((row) => ["SMART_REFRESH", "SMART_WITH_FALLBACK"].includes(row.refreshMode)); const recommendations = monitored.filter((row) => row.lastRecommendation && row.lastRecommendation !== "NO_ACTION" && (row.lastEstimatedImprovement || 0) > 0); const deferred = monitored.filter((row) => row.deferredUntil && row.deferredUntil > new Date());
  return { monitored: monitored.length, recommended: recommendations.length, deferred: deferred.length, healthy: Math.max(0, monitored.length - recommendations.length), fixedSchedule: settings.filter((row) => row.refreshMode === "FIXED_SCHEDULE").length, manualOnly: settings.filter((row) => row.refreshMode === "MANUAL_ONLY").length, playlists: recommendations.sort((a, b) => (b.lastEstimatedImprovement || 0) - (a.lastEstimatedImprovement || 0)).slice(0, 10).map((row) => ({ id: row.generatedPlaylistId, name: row.generatedPlaylist.plexPlaylistTitle, recommendation: row.lastRecommendation, estimatedImprovement: row.lastEstimatedImprovement, deferredUntil: row.deferredUntil })) };
}
