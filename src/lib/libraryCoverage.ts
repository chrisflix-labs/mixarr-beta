import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { safeFinishJobHistory, safeStartJobHistory } from "./jobHistory";
import {
  NEGLECTED_MIX_PRESETS,
  calculateMetadataConfidence,
  calculateOpportunityScore,
  calculateOveruseScore,
  calculateRotationFairness,
  decadeForYear,
} from "./libraryCoverageCore";

export const COVERAGE_BATCH_SIZE = 400;
export const COVERAGE_MAX_PAGE_SIZE = 200;
export const COVERAGE_JOB_STAGES = [
  "Determining eligible library tracks",
  "Aggregating track selection history",
  "Aggregating artist and album coverage",
  "Calculating genre and mood coverage",
  "Calculating decade coverage",
  "Calculating recently added coverage",
  "Calculating overuse scores",
  "Calculating discovery opportunities",
  "Calculating rotation fairness",
  "Saving coverage snapshot",
] as const;

const ACTIVE_JOB_STATUSES = ["queued", "running", "retrying"];
const SMART_HISTORY_SOURCES = ["smart_builder", "recipe", "regeneration"];
const MANUAL_HISTORY_SOURCES = ["manual_builder"];
const IMPORTED_HISTORY_SOURCES = ["import", "imported", "plex_import"];

export type CoveragePeriod = "active" | "30d" | "90d" | "12m" | "all_time";
export type CoverageTrackView = "all" | "never_selected" | "opportunities" | "overused";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function summaryFingerprint(value: unknown) {
  const input = JSON.stringify(value);
  let left = 2166136261;
  let right = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619);
    right = Math.imul(right ^ code, 2246822519);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

function daysSince(date: Date | null | undefined, now = new Date()) {
  return date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000)) : null;
}

function normalizedConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return clamp(number <= 1 ? number * 100 : number);
}

function analyzedTrack(track: any) {
  const status = String(track.audioFeature?.audioFeatureStatus || track.bpmAnalysisStatus || "").toLowerCase();
  return ["complete", "completed", "success", "estimated", "partial"].some((value) => status.includes(value))
    || normalizedConfidence(track.audioFeature?.audioFeatureConfidence ?? track.audioFeature?.confidence) > 0;
}

function trackEligibility(track: any, settings: Awaited<ReturnType<typeof getCoverageSettings>>) {
  if (settings.excludeMissingPlexTracks && (track.syncStatus !== "active" || track.deletedAt || track.localFileStatus === "missing")) return { eligible: false, reason: "Missing or unavailable Plex item" };
  if (track.exclusions?.length) return { eligible: false, reason: "Explicit user exclusion" };
  if (track.blockedBy?.length) return { eligible: false, reason: "Blocked track" };
  const preference = track.userPreferences?.[0]?.state;
  if (settings.excludeNeverRecommend && preference === "NEVER_RECOMMEND") return { eligible: false, reason: "Never recommend feedback" };
  if (settings.excludeExplicitDislikes && preference === "DISLIKED") return { eligible: false, reason: "Explicitly disliked" };
  if (settings.excludeDuplicateVersions && track.duplicateReviewStatus === "confirmed_duplicate" && !track.preferredDuplicateCopy) return { eligible: false, reason: "Duplicate or alternate version" };
  if (!settings.allowLiveTracks && track.isLive) return { eligible: false, reason: "Live versions are excluded" };
  if (track.recentlyAddedState?.doNotSuggest || track.recentlyAddedState?.neverAutoAdd) return { eligible: false, reason: "Recently added item is excluded from suggestions" };
  return { eligible: true, reason: null as string | null };
}

function neverSelectedReason(input: { considered: number; rejections: number; metadata: number; bpm: number | null; mood: number | null; duplicate: boolean; quarantine: boolean }) {
  if (input.considered === 0) return "Never considered";
  if (input.duplicate) return "Duplicate or alternate version";
  if (input.quarantine) return "Recently added and still quarantined";
  if (input.metadata < 55) return "Low metadata confidence";
  if (input.bpm == null) return "Missing BPM";
  if (input.mood == null) return "Missing mood";
  if (input.rejections >= Math.max(2, input.considered / 2)) return "Rejected by personalization or playlist compatibility";
  return "Selection competition was consistently stronger";
}

export async function getCoverageSettings(userId: string) {
  return prisma.libraryCoverageSetting.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function loadCoverageScoringContext(userId: string, trackIds: string[], override?: { enabled?: boolean; level?: string; maximumBoost?: number } | null) {
  const settings = await getCoverageSettings(userId);
  const enabled = override?.enabled ?? settings.coverageAwareScoringEnabled;
  if (!enabled || trackIds.length === 0) return undefined;
  const level = override?.level || settings.coverageInfluenceLevel;
  const factor = level === "low" ? 0.35 : level === "medium" ? 0.6 : level === "high" ? 1 : level === "custom" ? 1 : 0;
  if (factor <= 0) return undefined;
  const statistics: Record<string, { opportunityScore: number; overuseScore: number; eligible: boolean; qualityPassed: boolean; explanation: unknown }> = {};
  for (let index = 0; index < trackIds.length; index += COVERAGE_BATCH_SIZE) {
    const rows = await prisma.trackRotationStatistic.findMany({ where: { userId, trackId: { in: trackIds.slice(index, index + COVERAGE_BATCH_SIZE) } }, select: { trackId: true, opportunityScore: true, overuseScore: true, eligible: true, analyzed: true, metadataConfidence: true, audioFeatureConfidence: true, explanationJson: true } });
    for (const row of rows) statistics[row.trackId] = { opportunityScore: row.opportunityScore, overuseScore: row.overuseScore, eligible: row.eligible, qualityPassed: row.analyzed && row.metadataConfidence >= settings.minimumMetadataConfidence * 100 && row.audioFeatureConfidence >= settings.minimumAudioFeatureConfidence * 100, explanation: row.explanationJson };
  }
  return { enabled: true, level, maximumBoost: Math.min(10, Math.max(0, override?.maximumBoost ?? settings.maximumRotationInfluence) * factor), statistics, settingsVersion: settings.updatedAt.toISOString() };
}

export async function updateCoverageSettings(userId: string, input: Record<string, unknown>) {
  const current = await getCoverageSettings(userId);
  const booleanKeys = ["snapshotsEnabled", "includeManualTracks", "includeImportedPlaylists", "includeDeletedPlaylistHistory", "excludeExplicitDislikes", "excludeNeverRecommend", "excludeMissingPlexTracks", "excludeDuplicateVersions", "allowLiveTracks", "allowCompilations", "coverageAwareScoringEnabled"] as const;
  const data: Prisma.LibraryCoverageSettingUpdateInput = {};
  for (const key of booleanKeys) if (typeof input[key] === "boolean") (data as any)[key] = input[key];
  const bounded: Array<[string, number, number]> = [
    ["snapshotFrequencyHours", 1, 720], ["snapshotRetentionDays", 7, 3650], ["coverageHistoryPeriodDays", 30, 3650],
    ["minimumMetadataConfidence", 0, 1], ["minimumAudioFeatureConfidence", 0, 1], ["minimumOpportunityScore", 0, 100],
    ["overuseThreshold", 0, 100], ["selectionCooldownDays", 0, 365], ["maximumRotationInfluence", 0, 10], ["recentlyAddedWindowDays", 1, 730],
  ];
  for (const [key, minimum, maximum] of bounded) {
    const value = Number(input[key]);
    if (Number.isFinite(value)) (data as any)[key] = Math.min(maximum, Math.max(minimum, value));
  }
  if (["disabled", "low", "medium", "high", "custom"].includes(String(input.coverageInfluenceLevel))) data.coverageInfluenceLevel = String(input.coverageInfluenceLevel);
  else if (input.coverageAwareScoringEnabled === true && current.coverageInfluenceLevel === "disabled") data.coverageInfluenceLevel = "low";
  if (input.customInfluenceJson && typeof input.customInfluenceJson === "object") data.customInfluenceJson = json(input.customInfluenceJson);
  if (input.resetCalculatedStatistics === true) {
    await prisma.$transaction([
      prisma.librarySegmentCoverage.deleteMany({ where: { userId } }),
      prisma.libraryCoverageSnapshot.deleteMany({ where: { userId } }),
      prisma.trackRotationStatistic.deleteMany({ where: { userId } }),
    ]);
  }
  return prisma.libraryCoverageSetting.update({ where: { id: current.id }, data });
}

function ownedTrackWhere(userId: string, libraryId?: string | null): Prisma.TrackWhereInput {
  return { library: { server: { userId } }, ...(libraryId ? { libraryId } : {}) };
}

async function updateJob(jobId: string, stageNumber: number, stage: string, data: Record<string, unknown> = {}) {
  return prisma.coverageCalculationJob.update({
    where: { id: jobId },
    data: { currentStageNumber: stageNumber, currentStage: stage, percentage: Math.min(99, Math.max(0, ((stageNumber - 1) / 10) * 100)), lastHeartbeatAt: new Date(), ...data },
  });
}

async function assertNotCancelled(jobId: string) {
  const job = await prisma.coverageCalculationJob.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
  if (job?.cancelRequested) throw new Error("COVERAGE_JOB_CANCELLED");
}

function tagsOf(track: any, type: string) {
  return (track.tags || []).filter((tag: any) => tag.type === type).map((tag: any) => String(tag.name)).filter(Boolean);
}

async function calculateTrackStatistics(job: any, settings: Awaited<ReturnType<typeof getCoverageSettings>>) {
  const userId = job.userId as string;
  const libraryId = job.libraryId as string | null;
  const historySources = [
    ...SMART_HISTORY_SOURCES,
    ...(settings.includeManualTracks ? MANUAL_HISTORY_SOURCES : []),
    ...(settings.includeImportedPlaylists ? IMPORTED_HISTORY_SOURCES : []),
  ];
  const totalTracks = await prisma.track.count({ where: ownedTrackWhere(userId, libraryId) });
  await updateJob(job.id, 1, COVERAGE_JOB_STAGES[0], { status: "running", startedAt: job.startedAt || new Date(), totalTracks, attemptCount: { increment: 1 } });
  let cursor = job.cursorTrackId || undefined;
  let processed = job.processedTracks || 0;
  const now = new Date();
  while (true) {
    await assertNotCancelled(job.id);
    const tracks = await prisma.track.findMany({
      where: ownedTrackWhere(userId, libraryId),
      orderBy: { id: "asc" },
      take: COVERAGE_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        artist: { select: { id: true, title: true } },
        album: { select: { id: true, title: true, year: true } },
        tags: { select: { type: true, name: true } },
        popularity: { select: { score: true, confidence: true } },
        audioFeature: { select: { effectiveEnergy: true, effectiveMood: true, audioFeatureConfidence: true, confidence: true, audioFeatureStatus: true } },
        exclusions: { where: { userId }, select: { id: true } },
        blockedBy: { where: { userId }, select: { id: true } },
        userPreferences: { where: { userId }, select: { state: true, scoreAdjustment: true } },
        recentlyAddedState: { select: { status: true, quarantineReason: true, doNotSuggest: true, neverAutoAdd: true } },
      },
    });
    if (!tracks.length) break;
    const ids = tracks.map((track) => track.id);
    const [traces, historyRows, interactions, currentRows] = await Promise.all([
      prisma.smartMixDecisionTrace.findMany({
        where: { userId, trackId: { in: ids } },
        select: { trackId: true, generationId: true, generatedPlaylistId: true, decision: true, rejectionStage: true, finalScore: true, explanationJson: true, createdAt: true },
      }),
      prisma.playlistHistoryTrack.findMany({
        where: { trackId: { in: ids }, historyEntry: { userId, engineVersion: "v2", sourceType: { in: historySources }, ...(!settings.includeDeletedPlaylistHistory ? { generatedPlaylistId: { not: null } } : {}) } },
        select: { trackId: true, historyEntryId: true, createdAt: true, historyEntry: { select: { generatedPlaylistId: true, sourceType: true, createdAt: true } } },
      }),
      prisma.trackInteractionEvent.findMany({ where: { userId, trackId: { in: ids } }, select: { trackId: true, playlistId: true, eventType: true, eventSource: true, generationId: true, occurredAt: true } }),
      prisma.generatedPlaylistTrack.findMany({ where: { trackId: { in: ids }, generatedPlaylist: { userId, engineVersion: "v2" } }, select: { trackId: true, locked: true, liked: true, generatedPlaylistId: true } }),
    ]);
    const traceByTrack = new Map<string, typeof traces>();
    const historyByTrack = new Map<string, typeof historyRows>();
    const interactionByTrack = new Map<string, typeof interactions>();
    const currentByTrack = new Map<string, typeof currentRows>();
    for (const [rows, map] of [[traces, traceByTrack], [historyRows, historyByTrack], [interactions, interactionByTrack], [currentRows, currentByTrack]] as any) {
      for (const row of rows) {
        const key = row.trackId;
        if (!key) continue;
        const existing = map.get(key) || [];
        existing.push(row);
        map.set(key, existing);
      }
    }
    const batchData: Prisma.TrackRotationStatisticCreateManyInput[] = tracks.map((track) => {
      const eligibility = trackEligibility(track, settings);
      const trackTraces = traceByTrack.get(track.id) || [];
      const selectedTraces = trackTraces.filter((trace) => trace.decision === "selected" && trace.generatedPlaylistId);
      const rejectedTraces = trackTraces.filter((trace) => trace.decision !== "selected");
      const uniqueSelectedGenerations = new Map(selectedTraces.map((trace) => [trace.generationId, trace]));
      const events = interactionByTrack.get(track.id) || [];
      const history = historyByTrack.get(track.id) || [];
      const smartHistory = history.filter((row: any) => SMART_HISTORY_SOURCES.includes(row.historyEntry.sourceType));
      const supplementalHistory = history.filter((row: any) => !SMART_HISTORY_SOURCES.includes(row.historyEntry.sourceType));
      const fallbackGenerations = new Map(smartHistory.map((row: any) => [row.historyEntryId, row]));
      const historySelections = [...(uniqueSelectedGenerations.size ? [] : Array.from(fallbackGenerations.values())), ...supplementalHistory]
        .map((row: any) => ({ createdAt: row.historyEntry.createdAt, generatedPlaylistId: row.historyEntry.generatedPlaylistId, finalScore: null, sourceType: row.historyEntry.sourceType }));
      const supplementalEventSelections = events
        .filter((event) => (settings.includeManualTracks && event.eventType === "MANUAL_TRACK_ADDITION") || (settings.includeImportedPlaylists && event.eventSource === "IMPORT"))
        .map((event) => ({ createdAt: event.occurredAt, generatedPlaylistId: event.playlistId, finalScore: null, sourceType: event.eventSource === "IMPORT" ? "import" : "manual_builder" }));
      const unmatchedEventSelections = supplementalEventSelections.filter((event) => !historySelections.some((historyRow) => historyRow.generatedPlaylistId && historyRow.generatedPlaylistId === event.generatedPlaylistId && (MANUAL_HISTORY_SOURCES.includes(historyRow.sourceType) === MANUAL_HISTORY_SOURCES.includes(event.sourceType))));
      const selectionRows = [...Array.from(uniqueSelectedGenerations.values()), ...historySelections, ...unmatchedEventSelections];
      const current = currentByTrack.get(track.id) || [];
      const firstSelectedAt = selectionRows.reduce<Date | null>((value, row: any) => !value || row.createdAt < value ? row.createdAt : value, null);
      const lastSelectedAt = selectionRows.reduce<Date | null>((value, row: any) => !value || row.createdAt > value ? row.createdAt : value, null);
      const genres = tagsOf(track, "genre");
      const moods = tagsOf(track, "mood");
      const audioConfidence = normalizedConfidence(track.audioFeature?.audioFeatureConfidence ?? track.audioFeature?.confidence);
      const metadataConfidence = calculateMetadataConfidence({ title: track.title, artist: track.artist?.title, album: track.album?.title, year: track.album?.year, bpm: track.effectiveBpm ?? track.bpm, genres, moods, audioFeatureConfidence: audioConfidence / 100 });
      const popularity = normalizedConfidence(track.popularity?.score);
      const analyzed = analyzedTrack(track);
      const baseQualityScore = clamp(metadataConfidence * 0.48 + audioConfidence * 0.32 + (popularity || 55) * 0.2);
      const preferenceAdjustment = Number(track.userPreferences?.[0]?.scoreAdjustment) || 0;
      const personalizedQualityScore = clamp(baseQualityScore + preferenceAdjustment);
      const compatibilityPotential = clamp(baseQualityScore * 0.65 + Math.min(100, (genres.length + moods.length) * 15) * 0.35);
      const rejectionCount = rejectedTraces.length + events.filter((event) => ["TRACK_REJECTED", "TRACK_REJECTED_FROM_PREVIEW"].includes(event.eventType)).length;
      const opportunity = calculateOpportunityScore({
        eligible: eligibility.eligible, analyzed, selectionCount: selectionRows.length, rejectionCount, baseQualityScore,
        personalizedQualityScore, metadataConfidence, audioFeatureConfidence: audioConfidence, compatibilityPotential,
        daysSinceAdded: daysSince(track.plexAddedAt || track.addedAt || track.firstSeenAt, now), daysSinceSelected: daysSince(lastSelectedAt, now),
      });
      const generationVolume = Math.max(1, new Set(trackTraces.map((trace) => trace.generationId)).size);
      const overuse = calculateOveruseScore({
        selectionCount: selectionRows.length, uniquePlaylistCount: new Set(selectionRows.map((row: any) => row.generatedPlaylistId).filter(Boolean)).size,
        recentSelectionCount: selectionRows.filter((row: any) => row.createdAt >= new Date(now.getTime() - 90 * 86_400_000)).length,
        averageSelectionCount: 1, generationVolume, locked: current.some((row) => row.locked), liked: current.some((row) => row.liked) || track.userPreferences?.[0]?.state === "LIKED",
      });
      return {
        userId, trackId: track.id, eligible: eligibility.eligible, exclusionReason: eligibility.reason, analyzed, currentlySelected: current.length > 0,
        firstSelectedAt, lastSelectedAt, selectionCount: selectionRows.length,
        acceptedSelectionCount: events.filter((event) => event.eventType === "TRACK_ACCEPTED_FROM_PREVIEW").length,
        rejectionCount, removalCount: events.filter((event) => ["TRACK_REMOVED", "TRACK_REPLACED"].includes(event.eventType)).length,
        lockedCount: events.filter((event) => event.eventType === "TRACK_LOCKED").length + current.filter((row) => row.locked).length,
        manualAdditionCount: historySelections.filter((row) => MANUAL_HISTORY_SOURCES.includes(row.sourceType)).length + unmatchedEventSelections.filter((row) => MANUAL_HISTORY_SOURCES.includes(row.sourceType)).length,
        importedSelectionCount: historySelections.filter((row) => IMPORTED_HISTORY_SOURCES.includes(row.sourceType)).length + unmatchedEventSelections.filter((row) => IMPORTED_HISTORY_SOURCES.includes(row.sourceType)).length,
        uniquePlaylistCount: new Set(selectionRows.map((row: any) => row.generatedPlaylistId).filter(Boolean)).size,
        generationSelectionCount: uniqueSelectedGenerations.size, generationConsiderationCount: new Set(trackTraces.map((trace) => trace.generationId)).size,
        qualifiedNotSelectedCount: rejectedTraces.filter((trace) => trace.rejectionStage !== "hard_filter").length,
        recentSelectionCount: selectionRows.filter((row: any) => row.createdAt >= new Date(now.getTime() - 90 * 86_400_000)).length,
        historicalBestScore: trackTraces.reduce<number | null>((best, trace) => trace.finalScore != null && (best == null || trace.finalScore > best) ? trace.finalScore : best, null),
        averageSelectionScore: selectedTraces.length ? selectedTraces.reduce((sum, trace) => sum + Number(trace.finalScore || 0), 0) / selectedTraces.length : null,
        baseQualityScore, personalizedQualityScore, metadataConfidence, audioFeatureConfidence: audioConfidence, compatibilityPotential,
        opportunityScore: opportunity.score, overuseScore: overuse.score,
        reasonNeverSelected: selectionRows.length ? null : neverSelectedReason({ considered: trackTraces.length, rejections: rejectionCount, metadata: metadataConfidence, bpm: track.effectiveBpm ?? track.bpm ?? null, mood: track.audioFeature?.effectiveMood ?? null, duplicate: track.duplicateReviewStatus === "confirmed_duplicate", quarantine: Boolean(track.recentlyAddedState?.quarantineReason) }),
        explanationJson: json({ opportunity: opportunity.reasons, overuse: overuse.reasons, overuseExempt: overuse.exempt, qualityRequirementsPassed: eligibility.eligible && analyzed && metadataConfidence >= settings.minimumMetadataConfidence * 100 && audioConfidence >= settings.minimumAudioFeatureConfidence * 100 }),
        calculatedAt: now,
      };
    });
    await prisma.$transaction(async (tx) => {
      await tx.trackRotationStatistic.deleteMany({ where: { userId, trackId: { in: ids } } });
      await tx.trackRotationStatistic.createMany({ data: batchData });
    });
    processed += tracks.length;
    cursor = tracks.at(-1)!.id;
    await prisma.coverageCalculationJob.update({ where: { id: job.id }, data: { currentStageNumber: 2, currentStage: COVERAGE_JOB_STAGES[1], cursorTrackId: cursor, processedTracks: processed, totalTracks, percentage: Math.min(20, totalTracks ? processed / totalTracks * 20 : 20), lastHeartbeatAt: new Date() } });
  }
  return totalTracks;
}

type SegmentAccumulator = { dimension: string; key: string; label: string; eligible: number; analyzed: number; selected: number; appearances: number; opportunities: number; overused: number; quality: number; lastSelectedAt: Date | null; demand?: number };

function addSegment(map: Map<string, SegmentAccumulator>, dimension: string, key: string, label: string, stat: any, thresholds: { opportunity: number; overuse: number }) {
  const mapKey = `${dimension}:${key}`;
  const item = map.get(mapKey) || { dimension, key, label, eligible: 0, analyzed: 0, selected: 0, appearances: 0, opportunities: 0, overused: 0, quality: 0, lastSelectedAt: null };
  item.eligible += 1;
  item.analyzed += stat.analyzed ? 1 : 0;
  item.selected += stat.selectionCount > 0 ? 1 : 0;
  item.appearances += stat.selectionCount;
  item.opportunities += stat.opportunityScore >= thresholds.opportunity ? 1 : 0;
  item.overused += stat.overuseScore >= thresholds.overuse ? 1 : 0;
  item.quality += stat.baseQualityScore;
  if (stat.lastSelectedAt && (!item.lastSelectedAt || stat.lastSelectedAt > item.lastSelectedAt)) item.lastSelectedAt = stat.lastSelectedAt;
  map.set(mapKey, item);
}

async function buildSnapshot(job: any, settings: Awaited<ReturnType<typeof getCoverageSettings>>, totalTracks: number) {
  const userId = job.userId as string;
  const libraryId = job.libraryId as string | null;
  const statWhere: Prisma.TrackRotationStatisticWhereInput = { userId, ...(libraryId ? { track: { libraryId } } : {}) };
  const eligibleWhere = { ...statWhere, eligible: true, analyzed: true };
  await updateJob(job.id, 3, COVERAGE_JOB_STAGES[2]);
  const segments = new Map<string, SegmentAccumulator>();
  const selectionCounts: number[] = [];
  const qualityWeights: number[] = [];
  const artists = new Set<string>(); const usedArtists = new Set<string>(); const albums = new Set<string>(); const usedAlbums = new Set<string>();
  let cursor: string | undefined;
  let recentEligible = 0; let recentSelected = 0;
  const recentCutoff = new Date(Date.now() - settings.recentlyAddedWindowDays * 86_400_000);
  while (true) {
    await assertNotCancelled(job.id);
    const rows = await prisma.trackRotationStatistic.findMany({
      where: { ...statWhere, eligible: true }, orderBy: { id: "asc" }, take: COVERAGE_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { track: { select: { libraryId: true, addedAt: true, plexAddedAt: true, artistId: true, albumId: true, album: { select: { year: true } }, library: { select: { name: true } }, tags: { select: { type: true, name: true } } } } },
    });
    if (!rows.length) break;
    for (const stat of rows) {
      const track = stat.track;
      selectionCounts.push(stat.selectionCount); qualityWeights.push(stat.baseQualityScore);
      artists.add(track.artistId); albums.add(track.albumId);
      if (stat.selectionCount > 0) { usedArtists.add(track.artistId); usedAlbums.add(track.albumId); }
      addSegment(segments, "library", track.libraryId, track.library.name, stat, { opportunity: settings.minimumOpportunityScore, overuse: settings.overuseThreshold });
      const decade = decadeForYear(track.album.year);
      addSegment(segments, "decade", decade.key, decade.label, stat, { opportunity: settings.minimumOpportunityScore, overuse: settings.overuseThreshold });
      const genres = tagsOf(track, "genre"); const moods = tagsOf(track, "mood");
      const primaryGenre = genres[0] || "Unknown genre"; const primaryMood = moods[0] || "Unknown mood";
      addSegment(segments, "genre_primary", primaryGenre.toLowerCase(), primaryGenre, stat, { opportunity: settings.minimumOpportunityScore, overuse: settings.overuseThreshold });
      addSegment(segments, "mood_primary", primaryMood.toLowerCase(), primaryMood, stat, { opportunity: settings.minimumOpportunityScore, overuse: settings.overuseThreshold });
      for (const genre of genres) addSegment(segments, "genre_multi", genre.toLowerCase(), genre, stat, { opportunity: settings.minimumOpportunityScore, overuse: settings.overuseThreshold });
      for (const mood of moods) addSegment(segments, "mood_multi", mood.toLowerCase(), mood, stat, { opportunity: settings.minimumOpportunityScore, overuse: settings.overuseThreshold });
      const added = track.plexAddedAt || track.addedAt;
      if (added && added >= recentCutoff) { recentEligible++; if (stat.selectionCount > 0) recentSelected++; }
    }
    cursor = rows.at(-1)!.id;
  }
  await updateJob(job.id, 4, COVERAGE_JOB_STAGES[3]);
  await updateJob(job.id, 5, COVERAGE_JOB_STAGES[4]);
  await updateJob(job.id, 6, COVERAGE_JOB_STAGES[5]);
  await updateJob(job.id, 7, COVERAGE_JOB_STAGES[6]);
  await updateJob(job.id, 8, COVERAGE_JOB_STAGES[7]);
  const [eligibleTracks, excludedTracks, analyzedTracks, usedTracks, activeTracks, neverSelectedTracks, highConfidenceNeglected, overusedTracks, historyCount, generatedCount] = await prisma.$transaction([
    prisma.trackRotationStatistic.count({ where: { ...statWhere, eligible: true } }),
    prisma.trackRotationStatistic.count({ where: { ...statWhere, eligible: false } }),
    prisma.trackRotationStatistic.count({ where: eligibleWhere }),
    prisma.trackRotationStatistic.count({ where: { ...eligibleWhere, selectionCount: { gt: 0 } } }),
    prisma.trackRotationStatistic.count({ where: { ...eligibleWhere, currentlySelected: true } }),
    prisma.trackRotationStatistic.count({ where: { ...eligibleWhere, selectionCount: 0 } }),
    prisma.trackRotationStatistic.count({ where: { ...eligibleWhere, selectionCount: { lte: 2 }, opportunityScore: { gte: settings.minimumOpportunityScore } } }),
    prisma.trackRotationStatistic.count({ where: { ...eligibleWhere, overuseScore: { gte: settings.overuseThreshold } } }),
    prisma.playlistHistoryEntry.count({ where: { userId, engineVersion: "v2" } }),
    prisma.generatedPlaylist.count({ where: { userId, engineVersion: "v2" } }),
  ]);
  await updateJob(job.id, 9, COVERAGE_JOB_STAGES[8]);
  const fairness = calculateRotationFairness(selectionCounts, qualityWeights);
  const summary = {
    totalTracks, eligibleTracks, excludedTracks, analyzedTracks, usedTracks, activeTracks, neverSelectedTracks, highConfidenceNeglected, overusedTracks,
    eligibleArtists: artists.size, usedArtists: usedArtists.size, eligibleAlbums: albums.size, usedAlbums: usedAlbums.size,
    artistCoverage: artists.size ? usedArtists.size / artists.size * 100 : 0, albumCoverage: albums.size ? usedAlbums.size / albums.size * 100 : 0,
    coveragePercentage: analyzedTracks ? usedTracks / analyzedTracks * 100 : 0, rotationFairnessScore: fairness.score,
    recentlyAddedCoverage: recentEligible ? recentSelected / recentEligible * 100 : 0, partialHistory: historyCount === 0 && generatedCount > 0,
  };
  const fingerprint = summaryFingerprint(summary);
  await updateJob(job.id, 10, COVERAGE_JOB_STAGES[9]);
  const latest = await prisma.libraryCoverageSnapshot.findFirst({ where: { userId, libraryId, period: "all_time" }, orderBy: { createdAt: "desc" } });
  if (latest?.fingerprint === fingerprint) return { snapshot: latest, summary, fairness, segmentCount: segments.size, unchanged: true };
  const snapshot = await prisma.libraryCoverageSnapshot.create({ data: {
    userId, libraryId, period: "all_time", ...summary, fingerprint,
    explanationJson: json({ fairness, coverage: "Unique eligible analyzed tracks used in at least one Smart Mix v2 generation divided by eligible analyzed tracks.", exclusions: "Explicit exclusions, never-recommend feedback, missing Plex items, suppressed duplicates, and configured content exclusions are shown separately.", history: summary.partialHistory ? "Historical coverage is partial because generated playlists exist without retained v2 playlist history." : "Persistent Smart Mix decision and playlist history is included." }),
  } });
  const segmentRows: Prisma.LibrarySegmentCoverageCreateManyInput[] = Array.from(segments.values()).map((segment) => ({
    userId, snapshotId: snapshot.id, dimension: segment.dimension, segmentKey: segment.key, label: segment.label,
    eligibleTracks: segment.eligible, analyzedTracks: segment.analyzed, selectedTracks: segment.selected, neverSelectedTracks: segment.eligible - segment.selected,
    playlistAppearances: segment.appearances, opportunityCount: segment.opportunities, overuseCount: segment.overused,
    coveragePercentage: segment.analyzed ? segment.selected / segment.analyzed * 100 : 0, averageUseCount: segment.selected ? segment.appearances / segment.selected : 0,
    averageQuality: segment.eligible ? segment.quality / segment.eligible : 0, lastSelectedAt: segment.lastSelectedAt,
  }));
  for (let index = 0; index < segmentRows.length; index += 500) await prisma.librarySegmentCoverage.createMany({ data: segmentRows.slice(index, index + 500) });
  const cutoff = new Date(Date.now() - settings.snapshotRetentionDays * 86_400_000);
  await prisma.libraryCoverageSnapshot.deleteMany({ where: { userId, createdAt: { lt: cutoff } } });
  return { snapshot, summary, fairness, segmentCount: segments.size, unchanged: false };
}

export async function runCoverageCalculation(jobId: string) {
  const job = await prisma.coverageCalculationJob.findUnique({ where: { id: jobId } });
  if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) return null;
  const settings = await getCoverageSettings(job.userId);
  const historyJob = await safeStartJobHistory({ userId: job.userId, type: "library_coverage", name: "Library coverage calculation", trigger: job.trigger, lockKey: `library-coverage:${job.userId}:${job.libraryId || "all"}`, metadata: { coverageJobId: job.id, libraryId: job.libraryId } });
  const started = Date.now();
  console.info(`[LibraryCoverage] Started jobId=${job.id} libraryId=${job.libraryId || "all"}`);
  try {
    const totalTracks = await calculateTrackStatistics(job, settings);
    console.info(`[LibraryCoverage] Track aggregation complete processed=${totalTracks}`);
    const result = await buildSnapshot(job, settings, totalTracks);
    await prisma.coverageCalculationJob.update({ where: { id: job.id }, data: { status: "completed", currentStage: "Completed", currentStageNumber: 10, percentage: 100, processedTracks: totalTracks, totalTracks, cursorTrackId: null, completedAt: new Date(), lastHeartbeatAt: new Date(), resultJson: json(result) } });
    await safeFinishJobHistory({ job: historyJob, status: "completed", counts: { attempted: totalTracks, processed: totalTracks, skipped: 0, failed: 0 }, summary: `Library coverage calculated. Coverage ${result.summary.coveragePercentage.toFixed(1)}%, fairness ${result.fairness.score}.`, metadata: { coverageJobId: job.id, snapshotId: result.snapshot.id } });
    console.info(`[LibraryCoverage] Completed jobId=${job.id} durationMs=${Date.now() - started} coverage=${result.summary.coveragePercentage.toFixed(1)} fairness=${result.fairness.score}`);
    return result;
  } catch (error) {
    const cancelled = error instanceof Error && error.message === "COVERAGE_JOB_CANCELLED";
    const message = cancelled ? "Calculation cancelled by user" : error instanceof Error ? error.message.slice(0, 2_000) : "Coverage calculation failed";
    await prisma.coverageCalculationJob.update({ where: { id: job.id }, data: { status: cancelled ? "cancelled" : "failed", error: message, completedAt: new Date(), lastHeartbeatAt: new Date() } }).catch(() => undefined);
    await safeFinishJobHistory({ job: historyJob, status: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : error, summary: message });
    console.error(`[LibraryCoverage] ${cancelled ? "Cancelled" : "Failed"} jobId=${job.id}`, cancelled ? undefined : error);
    if (!cancelled) throw error;
    return null;
  }
}

export async function queueCoverageCalculation(input: { userId: string; libraryId?: string | null; trigger?: string; force?: boolean }) {
  if (input.libraryId) {
    const owned = await prisma.library.findFirst({ where: { id: input.libraryId, server: { userId: input.userId } }, select: { id: true } });
    if (!owned) throw new Error("LIBRARY_NOT_FOUND");
  }
  const existing = await prisma.coverageCalculationJob.findFirst({ where: { userId: input.userId, libraryId: input.libraryId || null, status: { in: ACTIVE_JOB_STATUSES } }, orderBy: { createdAt: "desc" } });
  if (existing && !input.force) {
    const stale = (existing.lastHeartbeatAt || existing.startedAt || existing.createdAt).getTime() < Date.now() - 15 * 60_000;
    if (stale) {
      const resumed = await prisma.coverageCalculationJob.update({ where: { id: existing.id }, data: { status: "retrying", currentStage: "Resuming from last checkpoint", cancelRequested: false, error: null, completedAt: null, lastHeartbeatAt: new Date() } });
      void runCoverageCalculation(resumed.id).catch(() => undefined);
      return { job: resumed, duplicate: false, resumed: true };
    }
    return { job: existing, duplicate: true };
  }
  if (existing && input.force) await prisma.coverageCalculationJob.update({ where: { id: existing.id }, data: { cancelRequested: true } });
  const settings = await getCoverageSettings(input.userId);
  const job = await prisma.coverageCalculationJob.create({ data: { userId: input.userId, libraryId: input.libraryId || null, trigger: input.trigger || "manual", settingsSnapshot: json(settings) } });
  void runCoverageCalculation(job.id).catch(() => undefined);
  return { job, duplicate: false };
}

export async function cancelCoverageJob(userId: string, jobId: string) {
  const job = await prisma.coverageCalculationJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw new Error("JOB_NOT_FOUND");
  if (!ACTIVE_JOB_STATUSES.includes(job.status)) return job;
  return prisma.coverageCalculationJob.update({ where: { id: job.id }, data: { cancelRequested: true, currentStage: "Cancelling" } });
}

function periodStart(period: CoveragePeriod) {
  if (period === "30d") return new Date(Date.now() - 30 * 86_400_000);
  if (period === "90d") return new Date(Date.now() - 90 * 86_400_000);
  if (period === "12m") return new Date(Date.now() - 365 * 86_400_000);
  return null;
}

export async function getCoverageSummary(userId: string, input: { libraryId?: string | null; period?: CoveragePeriod } = {}) {
  const period = input.period || "all_time";
  const [snapshot, job, settings] = await Promise.all([
    prisma.libraryCoverageSnapshot.findFirst({ where: { userId, libraryId: input.libraryId || null, period: "all_time" }, orderBy: { createdAt: "desc" }, include: { segments: { where: { dimension: { in: ["genre_primary", "mood_primary", "decade"] } }, orderBy: { eligibleTracks: "desc" }, take: 60 } } }),
    prisma.coverageCalculationJob.findFirst({ where: { userId, libraryId: input.libraryId || null }, orderBy: { createdAt: "desc" } }),
    getCoverageSettings(userId),
  ]);
  if (!snapshot) return { status: job?.status || "not_calculated", snapshot: null, job, settings, period };
  if (period === "all_time") return { status: "ready", snapshot, job, settings, period };
  const start = periodStart(period);
  const baseWhere: Prisma.TrackRotationStatisticWhereInput = { userId, eligible: true, analyzed: true, ...(input.libraryId ? { track: { libraryId: input.libraryId } } : {}) };
  const usedWhere = period === "active" ? { currentlySelected: true } : { lastSelectedAt: { gte: start! } };
  const [eligible, used] = await prisma.$transaction([prisma.trackRotationStatistic.count({ where: baseWhere }), prisma.trackRotationStatistic.count({ where: { ...baseWhere, ...usedWhere } })]);
  return { status: "ready", snapshot: { ...snapshot, usedTracks: used, neverSelectedTracks: Math.max(0, eligible - used), coveragePercentage: eligible ? used / eligible * 100 : 0 }, job, settings, period };
}

export async function getCoverageTracks(userId: string, input: { libraryId?: string | null; view?: CoverageTrackView; search?: string; page?: number; pageSize?: number; sort?: string; direction?: "asc" | "desc"; genre?: string; mood?: string; decade?: string }) {
  const settings = await getCoverageSettings(userId);
  const page = Math.max(1, input.page || 1); const pageSize = Math.min(COVERAGE_MAX_PAGE_SIZE, Math.max(1, input.pageSize || 50));
  const view = input.view || "all"; const direction = input.direction === "asc" ? "asc" : "desc";
  const trackWhere: Prisma.TrackWhereInput = {
    ...(input.libraryId ? { libraryId: input.libraryId } : {}),
    ...(input.search ? { OR: [{ title: { contains: input.search, mode: "insensitive" } }, { artist: { title: { contains: input.search, mode: "insensitive" } } }, { album: { title: { contains: input.search, mode: "insensitive" } } }] } : {}),
    ...(input.genre ? { tags: { some: { type: "genre", name: { equals: input.genre, mode: "insensitive" } } } } : {}),
    ...(input.mood ? { AND: [{ tags: { some: { type: "mood", name: { equals: input.mood, mode: "insensitive" } } } }] } : {}),
    ...(input.decade === "unknown" ? { album: { year: null } } : input.decade && /^\d{4}$/.test(input.decade) ? { album: { year: { gte: Number(input.decade), lte: Number(input.decade) + 9 } } } : {}),
  };
  const where: Prisma.TrackRotationStatisticWhereInput = {
    userId, ...(Object.keys(trackWhere).length ? { track: trackWhere } : {}),
    ...(view === "never_selected" ? { eligible: true, analyzed: true, selectionCount: 0 } : {}),
    ...(view === "opportunities" ? { eligible: true, analyzed: true, opportunityScore: { gte: settings.minimumOpportunityScore } } : {}),
    ...(view === "overused" ? { eligible: true, overuseScore: { gte: settings.overuseThreshold } } : {}),
  };
  const sortMap: Record<string, Prisma.TrackRotationStatisticOrderByWithRelationInput> = {
    opportunity: { opportunityScore: direction }, overuse: { overuseScore: direction }, usage: { selectionCount: direction }, lastSelected: { lastSelectedAt: direction }, quality: { baseQualityScore: direction }, title: { track: { title: direction } }, artist: { track: { artist: { title: direction } } }, added: { track: { addedAt: direction } },
  };
  const [total, items] = await prisma.$transaction([
    prisma.trackRotationStatistic.count({ where }),
    prisma.trackRotationStatistic.findMany({ where, orderBy: [sortMap[input.sort || "opportunity"] || sortMap.opportunity, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { track: { include: { artist: true, album: true, tags: true, popularity: true, audioFeature: true } } } }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), view, thresholds: { opportunity: settings.minimumOpportunityScore, overuse: settings.overuseThreshold } };
}

export async function getRecentlyAddedCoverage(userId: string, input: { libraryId?: string | null; days?: number } = {}) {
  const settings = await getCoverageSettings(userId);
  const days = [7, 30, 90, 180, 365].includes(Number(input.days)) ? Number(input.days) : settings.recentlyAddedWindowDays;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const trackWhere: Prisma.TrackWhereInput = { ...(input.libraryId ? { libraryId: input.libraryId } : {}), OR: [{ plexAddedAt: { gte: cutoff } }, { addedAt: { gte: cutoff } }] };
  const where: Prisma.TrackRotationStatisticWhereInput = { userId, track: trackWhere };
  const [tracksAdded, eligibleTracks, analyzedTracks, selectedTracks, quarantinedTracks, highConfidenceNeglected, waitingForAnalysis] = await prisma.$transaction([
    prisma.trackRotationStatistic.count({ where }),
    prisma.trackRotationStatistic.count({ where: { ...where, eligible: true } }),
    prisma.trackRotationStatistic.count({ where: { ...where, analyzed: true } }),
    prisma.trackRotationStatistic.count({ where: { ...where, selectionCount: { gt: 0 } } }),
    prisma.trackRotationStatistic.count({ where: { ...where, track: { ...trackWhere, recentlyAddedState: { quarantineReason: { not: null } } } } }),
    prisma.trackRotationStatistic.count({ where: { ...where, selectionCount: 0, opportunityScore: { gte: settings.minimumOpportunityScore } } }),
    prisma.trackRotationStatistic.count({ where: { ...where, analyzed: false } }),
  ]);
  const firstSelections = await prisma.trackRotationStatistic.findMany({ where: { ...where, firstSelectedAt: { not: null } }, select: { firstSelectedAt: true, track: { select: { plexAddedAt: true, addedAt: true } } }, take: 10_000 });
  const delays = firstSelections.map((row) => {
    const added = row.track.plexAddedAt || row.track.addedAt;
    return added && row.firstSelectedAt ? Math.max(0, (row.firstSelectedAt.getTime() - added.getTime()) / 86_400_000) : null;
  }).filter((value): value is number => value != null);
  return { days, tracksAdded, eligibleTracks, analyzedTracks, selectedTracks, selectionPercentage: analyzedTracks ? selectedTracks / analyzedTracks * 100 : 0, quarantinedTracks, highConfidenceNeglected, waitingForAnalysis, averageDaysToFirstSelection: delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null };
}

export async function getCoverageSegments(userId: string, input: { libraryId?: string | null; dimension?: string; search?: string; page?: number; pageSize?: number }) {
  const snapshot = await prisma.libraryCoverageSnapshot.findFirst({ where: { userId, libraryId: input.libraryId || null }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
  if (!snapshot) return { items: [], total: 0, page: 1, pageSize: input.pageSize || 50, snapshot: null };
  const page = Math.max(1, input.page || 1); const pageSize = Math.min(COVERAGE_MAX_PAGE_SIZE, Math.max(1, input.pageSize || 50));
  const where: Prisma.LibrarySegmentCoverageWhereInput = { snapshotId: snapshot.id, ...(input.dimension ? { dimension: input.dimension } : {}), ...(input.search ? { label: { contains: input.search, mode: "insensitive" } } : {}) };
  const [total, items] = await prisma.$transaction([prisma.librarySegmentCoverage.count({ where }), prisma.librarySegmentCoverage.findMany({ where, orderBy: [{ eligibleTracks: "desc" }, { label: "asc" }], skip: (page - 1) * pageSize, take: pageSize })]);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), snapshot };
}

export async function getCoverageHistory(userId: string, input: { libraryId?: string | null; limit?: number } = {}) {
  return prisma.libraryCoverageSnapshot.findMany({ where: { userId, libraryId: input.libraryId || null }, orderBy: { createdAt: "desc" }, take: Math.min(500, Math.max(1, input.limit || 90)) });
}

export async function getArtistCoverage(userId: string, input: { libraryId?: string | null; search?: string; page?: number; pageSize?: number; usage?: "all" | "never" | "underused" | "overused" }) {
  const page = Math.max(1, input.page || 1); const pageSize = Math.min(100, Math.max(1, input.pageSize || 50)); const offset = (page - 1) * pageSize;
  const search = input.search ? `%${input.search}%` : null; const libraryId = input.libraryId || null; const usage = input.usage || "all";
  const condition = usage === "never" ? Prisma.sql`AND SUM(CASE WHEN s."selectionCount" > 0 THEN 1 ELSE 0 END) = 0` : usage === "underused" ? Prisma.sql`AND AVG(s."selectionCount") < 1` : usage === "overused" ? Prisma.sql`AND MAX(s."overuseScore") >= 70` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<any>>(Prisma.sql`
    SELECT a."id", a."title", COUNT(*)::int AS "eligibleTrackCount", SUM(CASE WHEN s."analyzed" THEN 1 ELSE 0 END)::int AS "analyzedTrackCount",
      SUM(CASE WHEN s."selectionCount" > 0 THEN 1 ELSE 0 END)::int AS "selectedTrackCount", AVG(s."metadataConfidence")::float AS "averageMetadataConfidence",
      MAX(s."opportunityScore")::float AS "bestCandidateScore", MAX(t."addedAt") AS "lastLibraryAdditionDate", MAX(s."lastSelectedAt") AS "lastSelectedAt"
    FROM "TrackRotationStatistic" s JOIN "Track" t ON t."id"=s."trackId" JOIN "Artist" a ON a."id"=t."artistId"
    WHERE s."userId"=${userId} AND s."eligible"=true AND (${libraryId}::text IS NULL OR t."libraryId"=${libraryId}) AND (${search}::text IS NULL OR a."title" ILIKE ${search})
    GROUP BY a."id", a."title" ${condition}
    ORDER BY "bestCandidateScore" DESC, a."title" ASC LIMIT ${pageSize} OFFSET ${offset}`);
  const countRows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`SELECT COUNT(*)::int AS count FROM (SELECT a."id" FROM "TrackRotationStatistic" s JOIN "Track" t ON t."id"=s."trackId" JOIN "Artist" a ON a."id"=t."artistId" WHERE s."userId"=${userId} AND s."eligible"=true AND (${libraryId}::text IS NULL OR t."libraryId"=${libraryId}) AND (${search}::text IS NULL OR a."title" ILIKE ${search}) GROUP BY a."id" ${condition}) q`);
  const total = Number(countRows[0]?.count || 0);
  return { items: rows.map((row) => ({ ...row, coveragePercentage: row.eligibleTrackCount ? row.selectedTrackCount / row.eligibleTrackCount * 100 : 0 })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getAlbumCoverage(userId: string, input: { libraryId?: string | null; search?: string; page?: number; pageSize?: number; usage?: "all" | "never" | "partial" | "heavy" }) {
  const page = Math.max(1, input.page || 1); const pageSize = Math.min(100, Math.max(1, input.pageSize || 50)); const offset = (page - 1) * pageSize;
  const search = input.search ? `%${input.search}%` : null; const libraryId = input.libraryId || null; const usage = input.usage || "all";
  const condition = usage === "never" ? Prisma.sql`AND SUM(CASE WHEN s."selectionCount" > 0 THEN 1 ELSE 0 END) = 0` : usage === "partial" ? Prisma.sql`AND SUM(CASE WHEN s."selectionCount" > 0 THEN 1 ELSE 0 END) BETWEEN 1 AND COUNT(*) - 1` : usage === "heavy" ? Prisma.sql`AND SUM(CASE WHEN s."selectionCount" > 0 THEN 1 ELSE 0 END)::float / COUNT(*) >= 0.7` : Prisma.empty;
  const base = Prisma.sql`FROM "TrackRotationStatistic" s JOIN "Track" t ON t."id"=s."trackId" JOIN "Album" al ON al."id"=t."albumId" JOIN "Artist" a ON a."id"=al."artistId" WHERE s."userId"=${userId} AND s."eligible"=true AND (${libraryId}::text IS NULL OR t."libraryId"=${libraryId}) AND (${search}::text IS NULL OR al."title" ILIKE ${search} OR a."title" ILIKE ${search})`;
  const rows = await prisma.$queryRaw<Array<any>>(Prisma.sql`SELECT al."id", al."title", a."title" AS "artist", al."year", COUNT(*)::int AS "eligibleTrackCount", SUM(CASE WHEN s."analyzed" THEN 1 ELSE 0 END)::int AS "analyzedTrackCount", SUM(CASE WHEN s."selectionCount" > 0 THEN 1 ELSE 0 END)::int AS "selectedTrackCount", AVG(s."metadataConfidence")::float AS "averageMetadataQuality", MAX(s."opportunityScore")::float AS "bestCandidateScore", MAX(s."lastSelectedAt") AS "lastSelectedAt" ${base} GROUP BY al."id", al."title", a."title", al."year" ${condition} ORDER BY "bestCandidateScore" DESC, al."title" ASC LIMIT ${pageSize} OFFSET ${offset}`);
  const countRows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`SELECT COUNT(*)::int AS count FROM (SELECT al."id" ${base} GROUP BY al."id" ${condition}) q`);
  const total = Number(countRows[0]?.count || 0);
  return { items: rows.map((row) => ({ ...row, coveragePercentage: row.eligibleTrackCount ? row.selectedTrackCount / row.eligibleTrackCount * 100 : 0 })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function buildNeglectedMixDraft(userId: string, input: Record<string, unknown>) {
  const presetKey = String(input.preset || "safe_discovery") as keyof typeof NEGLECTED_MIX_PRESETS;
  const preset = NEGLECTED_MIX_PRESETS[presetKey] || NEGLECTED_MIX_PRESETS.safe_discovery;
  const targetTrackCount = Math.min(250, Math.max(5, Number(input.targetTrackCount) || 50));
  const minimumOpportunityScore = Math.max(Number(input.minimumOpportunityScore) || preset.minimumOpportunityScore, 0);
  const minimumMetadataConfidence = Math.max(Number(input.minimumMetadataConfidence) || preset.minimumMetadataConfidence, 0);
  const candidates = await prisma.trackRotationStatistic.findMany({
    where: { userId, eligible: true, analyzed: true, opportunityScore: { gte: minimumOpportunityScore }, metadataConfidence: { gte: minimumMetadataConfidence }, ...(input.neverSelectedOnly !== false ? { selectionCount: 0 } : { selectionCount: { lte: Number(input.neglectThreshold) || 2 } }), ...(input.libraryId ? { track: { libraryId: String(input.libraryId) } } : {}) },
    orderBy: [{ opportunityScore: "desc" }, { personalizedQualityScore: "desc" }, { id: "asc" }], take: targetTrackCount,
    include: { track: { include: { artist: true, album: true, tags: true, audioFeature: true } } },
  });
  return {
    draftId: `coverage-${Date.now()}`, previewOnly: true, preset: { key: presetKey, ...preset },
    configuration: { playlistName: String(input.playlistName || `${preset.label} Mix`), targetTrackCount, minimumOpportunityScore, minimumMetadataConfidence, neverSelectedOnly: input.neverSelectedOnly !== false, previewBeforeSaving: true, usePersonalization: input.usePersonalization !== false, applyBpmFlow: input.applyBpmFlow !== false, applyMoodBlending: input.applyMoodBlending !== false, familiarAnchorPercentage: Number(input.familiarAnchorPercentage) || preset.familiarAnchorPercentage },
    tracks: candidates.map((candidate) => ({ ...candidate.track, coverage: { opportunityScore: candidate.opportunityScore, selectionCount: candidate.selectionCount, explanation: candidate.explanationJson } })),
    handoff: { route: "/smart-builder", query: { coverageDraft: "true", preset: presetKey }, message: "Review these candidates, then continue through Smart Builder preview before saving to Plex." },
  };
}

export async function exportCoverage(userId: string, type: string, filters: Record<string, unknown>) {
  const search = filters.search ? String(filters.search) : undefined;
  if (type === "history") return getCoverageHistory(userId, { libraryId: filters.libraryId ? String(filters.libraryId) : null, limit: 500 });
  if (["genres", "moods", "decades", "segments"].includes(type)) return (await getCoverageSegments(userId, { libraryId: filters.libraryId ? String(filters.libraryId) : null, dimension: type === "genres" ? "genre_primary" : type === "moods" ? "mood_primary" : type === "decades" ? "decade" : filters.dimension ? String(filters.dimension) : undefined, search, pageSize: 200 })).items;
  if (type === "artists") return (await getArtistCoverage(userId, { libraryId: filters.libraryId ? String(filters.libraryId) : null, search, usage: filters.view === "never_selected" ? "never" : filters.view as "all" | "never" | "underused" | "overused" | undefined, pageSize: 100 })).items;
  if (type === "albums") return (await getAlbumCoverage(userId, { libraryId: filters.libraryId ? String(filters.libraryId) : null, search, usage: filters.view === "never_selected" ? "never" : filters.view as "all" | "never" | "partial" | "heavy" | undefined, pageSize: 100 })).items;
  const view: CoverageTrackView = type === "overused" ? "overused" : type === "opportunities" ? "opportunities" : type === "never-selected" ? "never_selected" : "all";
  return (await getCoverageTracks(userId, { libraryId: filters.libraryId ? String(filters.libraryId) : null, view, search, genre: filters.genre ? String(filters.genre) : undefined, mood: filters.mood ? String(filters.mood) : undefined, decade: filters.decade ? String(filters.decade) : undefined, pageSize: 200 })).items;
}
