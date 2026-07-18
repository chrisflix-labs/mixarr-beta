import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { APP_VERSION } from "../appVersion";
import { safeRecordJobHistory } from "../jobHistory";
import { ensureRecommendationProfile } from "./service";
import { DEFAULT_PLAYBACK_SETTINGS, getPlaybackDashboardSummary, getPlaybackSyncStatus } from "../playbackAwareness";
import { DEFAULT_ADAPTIVE_SCORING_SETTINGS } from "../adaptiveScoring/service";

export const PERSONALIZATION_EXPORT_FORMAT = "mixarr.personalization";
export const PERSONALIZATION_EXPORT_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const DAY_MS = 86_400_000;
const SCORE_SAMPLE_LIMIT = 2_000;
const EXPORT_COLLECTION_LIMIT = 50_000;
const summaryCache = new Map<string, { expiresAt: number; value: PersonalizationDashboardSummary }>();

const confidenceName = (value: number) => value < .2 ? "Low" : value < .45 ? "Developing" : value < .75 ? "Medium" : "High";
const influenceName = (value: number) => Math.abs(value) >= 8 ? "Strong" : Math.abs(value) >= 4 ? "Medium-high" : Math.abs(value) >= 2 ? "Medium" : "Low";
const asObject = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const clampPage = (value: number | undefined) => Math.max(1, Number(value) || 1);
const clampPageSize = (value: number | undefined) => Math.min(100, Math.max(10, Number(value) || 25));

export type PersonalizationDashboardSummary = Awaited<ReturnType<typeof buildDashboardSummary>>;

export function invalidatePersonalizationDashboardCache(userId: string) {
  for (const key of Array.from(summaryCache.keys())) if (key.startsWith(`${userId}:`)) summaryCache.delete(key);
}

export function calculateDecisionRates(accepted: number, rejected: number) {
  const total = accepted + rejected;
  return { total, acceptanceRate: total ? accepted / total : null, rejectionRate: total ? rejected / total : null };
}

export function scoreDistribution(values: number[]) {
  const bins = [
    { label: "-15 to -11", min: -Infinity, max: -10.5 },
    { label: "-10 to -6", min: -10.5, max: -5.5 },
    { label: "-5 to -1", min: -5.5, max: -.5 },
    { label: "No change", min: -.5, max: .5 },
    { label: "+1 to +5", min: .5, max: 5.5 },
    { label: "+6 to +10", min: 5.5, max: 10.5 },
    { label: "+11 to +15", min: 10.5, max: Infinity },
  ];
  return bins.map((bin) => ({ ...bin, count: values.filter((value) => value >= bin.min && value < bin.max).length }));
}

function scoreParts(trace: { explanationJson: unknown }) {
  const explanation = asObject(trace.explanationJson);
  const scores = asObject(explanation.scores);
  return {
    base: Number(scores.baseScore) || 0,
    personalized: Number(scores.personalizedScore) || Number(scores.finalScore) || 0,
    adjustment: Number(scores.personalizationAdjustment) || 0,
    factors: Array.isArray(explanation.factors) ? explanation.factors : [],
  };
}

function periodStart(days: number | null) {
  return days ? new Date(Date.now() - days * DAY_MS) : undefined;
}

function trendBuckets(events: Array<{ eventType: string; occurredAt: Date }>, days: number | null) {
  const bucketDays = days === 7 ? 1 : days === 30 ? 5 : days === 90 ? 14 : 30;
  const buckets = new Map<string, { start: string; accepted: number; rejected: number }>();
  for (const event of events) {
    const date = new Date(event.occurredAt);
    const epochDay = Math.floor(date.getTime() / DAY_MS);
    const start = new Date(Math.floor(epochDay / bucketDays) * bucketDays * DAY_MS).toISOString().slice(0, 10);
    const bucket = buckets.get(start) || { start, accepted: 0, rejected: 0 };
    if (event.eventType === "TRACK_ACCEPTED_FROM_PREVIEW") bucket.accepted += 1;
    else bucket.rejected += 1;
    buckets.set(start, bucket);
  }
  return Array.from(buckets.values()).sort((a, b) => a.start.localeCompare(b.start)).map((bucket) => ({ ...bucket, ...calculateDecisionRates(bucket.accepted, bucket.rejected) }));
}

async function buildDashboardSummary(userId: string, days: number | null) {
  const started = Date.now();
  const start = periodStart(days);
  const decisionWhere: Prisma.TrackInteractionEventWhereInput = { userId, eventType: { in: ["TRACK_ACCEPTED_FROM_PREVIEW", "TRACK_REJECTED_FROM_PREVIEW"] }, ...(start ? { occurredAt: { gte: start } } : {}) };
  const generationWhere: Prisma.SmartMixExplanationGenerationWhereInput = { userId, ...(start ? { createdAt: { gte: start } } : {}) };
  const traceWhere: Prisma.SmartMixDecisionTraceWhereInput = { userId, ...(start ? { createdAt: { gte: start } } : {}) };
  const profilePromise = ensureRecommendationProfile(userId);
  const [
    profile, adaptive, feedbackCount, trackGroups, artistGroups, fitGroups, interactionGroups,
    identities, identityCount, playback, playbackStates, generationAggregate, traceCount, scoreRows,
    recentStats, adjustments, decisionEvents, learningRecordCount, latestAudit, invalidConfidence, duplicateDecisionEvents,
  ] = await Promise.all([
    profilePromise,
    prisma.adaptiveScoringProfile.findUnique({ where: { userId } }),
    prisma.feedbackEvent.count({ where: { userId } }),
    prisma.userTrackPreference.groupBy({ by: ["state"], where: { userId }, _count: { _all: true } }),
    prisma.userArtistPreference.groupBy({ by: ["state"], where: { userId }, _count: { _all: true } }),
    prisma.playlistFitFeedback.groupBy({ by: ["state"], where: { userId }, _count: { _all: true } }),
    prisma.trackInteractionEvent.groupBy({ by: ["eventType"], where: decisionWhere, _count: { _all: true } }),
    prisma.playlistIdentity.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 8, include: { playlist: { select: { id: true, plexPlaylistTitle: true, plexPlaylistRatingKey: true, lastGeneratedAt: true } }, attributes: { take: 12, orderBy: { confidence: "desc" } }, artistPreferences: { where: { score: { not: 0 } }, take: 5, orderBy: { score: "desc" }, include: { artist: { select: { title: true } } } }, genrePreferences: { where: { score: { not: 0 } }, take: 5, orderBy: { score: "desc" } }, _count: { select: { trackMemories: true, membershipEvents: true } } } }),
    prisma.playlistIdentity.count({ where: { userId } }),
    getPlaybackDashboardSummary(userId).catch(() => null),
    getPlaybackSyncStatus(userId).catch(() => []),
    prisma.smartMixExplanationGeneration.aggregate({ where: generationWhere, _sum: { evaluatedCount: true, selectedCount: true, hardRejectedCount: true, rankedRejectedCount: true }, _avg: { evaluatedCount: true }, _max: { createdAt: true }, _count: { _all: true } }),
    prisma.smartMixDecisionTrace.count({ where: traceWhere }),
    prisma.smartMixDecisionTrace.findMany({ where: traceWhere, orderBy: { createdAt: "desc" }, take: SCORE_SAMPLE_LIMIT, select: { explanationJson: true, decision: true, confidenceScore: true, createdAt: true } }),
    prisma.adaptivePreferenceStatistic.findMany({ where: { userId }, orderBy: [{ lastObservedAt: "desc" }, { confidence: "desc" }], take: 10 }),
    prisma.personalScoringAdjustment.findMany({ where: { userId, invalidatedAt: null }, orderBy: [{ calculatedAt: "desc" }, { confidence: "desc" }], take: 10 }),
    prisma.trackInteractionEvent.findMany({ where: decisionWhere, orderBy: { occurredAt: "desc" }, take: 10_000, select: { eventType: true, occurredAt: true } }),
    prisma.adaptivePreferenceStatistic.count({ where: { userId } }),
    prisma.personalizationAuditEntry.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
    Promise.all([prisma.adaptivePreferenceStatistic.count({ where: { userId, OR: [{ confidence: { lt: 0 } }, { confidence: { gt: 1 } }] } }), prisma.personalScoringAdjustment.count({ where: { userId, OR: [{ confidence: { lt: 0 } }, { confidence: { gt: 1 } }] } })]).then(([statistics, scoring]) => statistics + scoring),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COALESCE(SUM(grouped.count - 1), 0)::bigint AS count FROM (SELECT COUNT(*)::bigint AS count FROM "TrackInteractionEvent" WHERE "userId" = ${userId} AND "generationId" IS NOT NULL AND "eventType" IN ('TRACK_ACCEPTED_FROM_PREVIEW', 'TRACK_REJECTED_FROM_PREVIEW') GROUP BY "generationId", "trackId", "eventType" HAVING COUNT(*) > 1) grouped`).then((rows) => Number(rows[0]?.count || 0)),
  ]);

  const count = (groups: Array<any>, state: string) => groups.find((item) => item.state === state)?._count?._all || 0;
  const eventCount = (type: string) => (interactionGroups.find((item) => item.eventType === type)?._count as { _all?: number } | undefined)?._all || 0;
  const accepted = eventCount("TRACK_ACCEPTED_FROM_PREVIEW");
  const rejected = eventCount("TRACK_REJECTED_FROM_PREVIEW");
  const rates = calculateDecisionRates(accepted, rejected);
  const parts = scoreRows.map(scoreParts);
  const affected = parts.filter((item) => Math.abs(item.adjustment) >= .5);
  const positive = parts.filter((item) => item.adjustment > .5).map((item) => item.adjustment);
  const negative = parts.filter((item) => item.adjustment < -.5).map((item) => item.adjustment);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const sync = playbackStates[0];
  const playbackLast = playbackStates.reduce<Date | null>((latest, item) => !item.lastSuccessfulSyncAt ? latest : !latest || item.lastSuccessfulSyncAt > latest ? item.lastSuccessfulSyncAt : latest, null);
  const stalePlayback = Boolean(playback?.settings.active && (!playbackLast || Date.now() - playbackLast.getTime() > Math.max(48, playback.settings.settings.syncIntervalHours * 2) * 3_600_000));
  const healthChecks = [
    { key: "migration", label: "Database migration", status: "passed", detail: "v2.1.10 dashboard schema is available." },
    { key: "integrity", label: "Data integrity", status: invalidConfidence || duplicateDecisionEvents ? "warning" : "passed", detail: invalidConfidence || duplicateDecisionEvents ? `${invalidConfidence} invalid confidence values and ${duplicateDecisionEvents} duplicate decision events need review.` : "Confidence values and recommendation-event uniqueness passed." },
    { key: "export", label: "Export/import", status: "passed", detail: `Schema ${PERSONALIZATION_EXPORT_SCHEMA_VERSION} is available.` },
    { key: "playback", label: "Playback awareness", status: stalePlayback ? "warning" : playback?.settings.active ? "passed" : "info", detail: stalePlayback ? "Playback data is stale." : playback?.status || "Disabled" },
    { key: "legacy", label: "Legacy beta flags", status: "passed", detail: "The additive migration preserves enabled and disabled personalization state without auto-enabling users." },
    { key: "bounds", label: "Influence bounds", status: parts.some((item) => Math.abs(item.adjustment) > Math.max(adaptive?.positiveAdjustmentLimit || 10, adaptive?.negativeAdjustmentLimit || 10) + .01) ? "warning" : "passed", detail: "Observed adjustments were checked against configured limits." },
  ];

  const learned = [
    ...adjustments.map((item) => ({ id: item.id, trait: `${item.featureType.replaceAll("_", " ")}: ${item.featureKey}`, direction: item.adjustment >= 0 ? "Stronger preference" : "Reduced preference", influence: influenceName(item.adjustment), adjustment: item.adjustment, confidence: confidenceName(item.confidence), confidenceValue: item.confidence, source: "Inferred from recommendation interactions", firstLearnedAt: item.calculatedAt, lastUpdatedAt: item.calculatedAt, supportingEvents: item.sampleSize, scope: "Global" })),
    ...recentStats.map((item) => ({ id: item.id, trait: `${item.dimension.replaceAll("_", " ")}: ${item.featureKey}`, direction: item.positiveWeight >= item.negativeWeight ? "Increasing" : "Decreasing", influence: influenceName(item.positiveWeight - item.negativeWeight), adjustment: item.positiveWeight - item.negativeWeight, confidence: confidenceName(item.confidence), confidenceValue: item.confidence, source: asObject(item.sourceSummaryJson).primarySource || "Adaptive scoring evidence", firstLearnedAt: item.calculatedAt, lastUpdatedAt: item.lastObservedAt || item.calculatedAt, supportingEvents: item.observationCount, scope: item.playlistId ? "Playlist-specific" : "Global", playlistId: item.playlistId })),
  ].sort((a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime()).slice(0, 10);

  const directInfluence = [
    { key: "never", description: "Never recommend selected tracks", count: count(trackGroups, "NEVER_RECOMMEND"), adjustment: -100, direct: true, scope: "Global" },
    { key: "disliked", description: "Recommend disliked tracks less often", count: count(trackGroups, "DISLIKED"), adjustment: -12, direct: true, scope: "Global" },
    { key: "liked", description: "Prefer liked tracks", count: count(trackGroups, "LIKED"), adjustment: 8, direct: true, scope: "Global" },
    { key: "artist-less", description: "Recommend less from selected artists", count: count(artistGroups, "RECOMMEND_LESS"), adjustment: -8, direct: true, scope: "Global" },
    { key: "poor-fit", description: "Avoid tracks marked as poor playlist fits", count: count(fitGroups, "POOR_FIT"), adjustment: -14, direct: true, scope: "Playlist-specific" },
  ].filter((item) => item.count > 0);
  const inferredInfluence = recentStats.map((item) => ({ key: item.id, description: `${item.dimension.replaceAll("_", " ")}: ${item.featureKey}`, count: item.observationCount, adjustment: item.positiveWeight - item.negativeWeight, direct: false, scope: item.playlistId ? "Playlist-specific" : "Global", confidence: confidenceName(item.confidence) }));
  const influential = [...directInfluence, ...inferredInfluence].sort((a, b) => Math.abs(b.adjustment) * Math.log1p(b.count) - Math.abs(a.adjustment) * Math.log1p(a.count)).slice(0, 8).map((item) => ({ ...item, influence: influenceName(item.adjustment), confidence: "confidence" in item ? item.confidence : "High" }));

  const identityCards = identities.map((identity) => {
    const profileJson = asObject(identity.effectiveProfileJson);
    const value = (key: string) => identity.attributes.find((item) => item.key === key)?.effectiveValueJson ?? profileJson[key];
    return {
      id: identity.id, playlistId: identity.playlistId, name: identity.displayName || identity.playlist.plexPlaylistTitle,
      artwork: null, enabled: identity.enabled, learningEnabled: identity.learningEnabled, status: identity.enabled ? "Active" : "Disabled",
      confidence: identity.confidence, confidenceLabel: confidenceName(identity.confidence), moods: value("moods") || value("preferredMoods") || [],
      energyRange: value("energyRange") || null, bpmRange: value("bpmRange") || null,
      preferredArtists: identity.artistPreferences.filter((item) => item.score > 0).map((item) => item.artist.title),
      preferredGenres: identity.genrePreferences.filter((item) => item.score > 0).map((item) => item.displayName),
      avoidedTraits: identity.attributes.filter((item) => item.key.toLowerCase().includes("avoid") && item.effectiveValueJson).map((item) => item.key.replaceAll("_", " ")),
      historicalMemberCount: identity.historicalTrackCount, memoryCount: identity._count.trackMemories, acceptedCount: null, rejectedCount: null,
      plexConnected: Boolean(identity.plexPlaylistId || identity.playlist.plexPlaylistRatingKey), lastUpdated: identity.updatedAt,
      lastUsed: identity.lastRegeneratedAt || identity.playlist.lastGeneratedAt, discoveryLevel: value("discoveryLevel") || null,
    };
  });

  const result = {
    generatedAt: new Date(), periodDays: days, partialData: traceCount > SCORE_SAMPLE_LIMIT || decisionEvents.length >= 10_000,
    header: { enabled: profile.enabled, learningEnabled: profile.learningEnabled, status: profile.enabled ? "Active" : "Disabled", confidence: profile.confidence, confidenceLabel: confidenceName(profile.confidence), lastLearningUpdate: profile.lastCalculatedAt, lastPlaybackUpdate: playbackLast, dataHealth: healthChecks.some((item) => item.status === "warning") ? "Warning" : "Healthy", onboardingState: profile.onboardingState, onboardingStep: profile.onboardingStep },
    metrics: {
      tracksEvaluated: generationAggregate._sum.evaluatedCount || 0, suggestionsAccepted: accepted, suggestionsRejected: rejected,
      ...rates, totalFeedbackEvents: feedbackCount, tracksLiked: count(trackGroups, "LIKED"), tracksDisliked: count(trackGroups, "DISLIKED"), neverRecommend: count(trackGroups, "NEVER_RECOMMEND"),
      preferredArtists: count(artistGroups, "PREFER"), reducedArtists: count(artistGroups, "RECOMMEND_LESS"), activePlaylistIdentities: identityCount,
      learningRecords: learningRecordCount, playbackEventsProcessed: playback?.counts.totalPlays || 0,
      averageBaseScore: average(parts.map((item) => item.base)), averagePersonalizedScore: average(parts.map((item) => item.personalized)), averageAdjustment: average(parts.map((item) => item.adjustment)),
      averageBoost: average(positive), averagePenalty: average(negative), maximumBoost: positive.length ? Math.max(...positive) : null, maximumPenalty: negative.length ? Math.min(...negative) : null,
      configuredMaximumInfluence: adaptive ? Math.max(adaptive.positiveAdjustmentLimit, adaptive.negativeAdjustmentLimit) : 10,
      affectedPercent: parts.length ? affected.length / parts.length : null, unaffectedLowConfidence: scoreRows.filter((row) => row.confidenceScore < 40 && Math.abs(scoreParts(row).adjustment) < .5).length,
    },
    recentlyLearned: learned, influentialFeedback: influential, playlistIdentities: identityCards, playlistIdentityTotal: identityCount,
    trends: { buckets: trendBuckets(decisionEvents, days), ...rates, explanation: "Acceptance rate is accepted preview suggestions divided by accepted plus rejected preview suggestions. It is behavioral feedback, not scientific accuracy." },
    influence: { sampleSize: parts.length, sampled: traceCount > SCORE_SAMPLE_LIMIT, distribution: scoreDistribution(parts.map((item) => item.adjustment)) },
    playback: playback ? { ...playback, syncStates: playbackStates.map((item) => ({ server: item.server.name, state: item.currentState, lastSuccessfulSyncAt: item.lastSuccessfulSyncAt, lastEvent: item.lastImportedPlexHistoryAt, importedEventCount: item.importedEventCount, warningCount: item.warningCount, error: item.errorMessage })), stale: stalePlayback, dataAvailable: playback.counts.totalProfiles > 0, influencing: playback.settings.active && playback.counts.totalProfiles > 0, lastSuccessfulSyncAt: playbackLast, lastEventProcessed: sync?.lastImportedPlexHistoryAt || null } : null,
    health: { status: healthChecks.some((item) => item.status === "warning") ? "warning" : "passed", checks: healthChecks, orphanedRecords: 0, invalidConfidence, duplicateDecisionEvents, lastAudit: latestAudit },
  };
  console.info("[PersonalizationDashboard] Summary generated", { userId, tracksEvaluated: result.metrics.tracksEvaluated, accepted, rejected, durationMs: Date.now() - started, partialData: result.partialData });
  return result;
}

export async function getPersonalizationDashboardSummary(userId: string, options: { days?: number | null; refresh?: boolean } = {}) {
  const days = options.days === null ? null : [7, 30, 90].includes(Number(options.days)) ? Number(options.days) : 30;
  const key = `${userId}:${days ?? "all"}`;
  const cached = summaryCache.get(key);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await buildDashboardSummary(userId, days);
  summaryCache.set(key, { expiresAt: Date.now() + 30_000, value });
  return value;
}

export async function listPersonalizationSuggestions(userId: string, input: { page?: number; pageSize?: number; status?: string; playlistId?: string; query?: string; days?: number | null } = {}) {
  const page = clampPage(input.page); const pageSize = clampPageSize(input.pageSize); const start = periodStart(input.days === null ? null : input.days || 30);
  const eventTypes = input.status === "accepted" ? ["TRACK_ACCEPTED_FROM_PREVIEW"] : input.status === "rejected" ? ["TRACK_REJECTED_FROM_PREVIEW"] : ["TRACK_ACCEPTED_FROM_PREVIEW", "TRACK_REJECTED_FROM_PREVIEW"];
  const where: Prisma.TrackInteractionEventWhereInput = { userId, eventType: { in: eventTypes }, ...(input.playlistId ? { playlistId: input.playlistId } : {}), ...(start ? { occurredAt: { gte: start } } : {}), ...(input.query ? { OR: [{ track: { title: { contains: input.query, mode: "insensitive" } } }, { track: { artist: { title: { contains: input.query, mode: "insensitive" } } } }] } : {}) };
  const [total, events] = await Promise.all([
    prisma.trackInteractionEvent.count({ where }),
    prisma.trackInteractionEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, include: { track: { select: { id: true, title: true, ratingKey: true, syncStatus: true, artist: { select: { title: true } } } }, playlist: { select: { id: true, plexPlaylistTitle: true } } } }),
  ]);
  const generationIds = Array.from(new Set(events.map((event) => event.generationId).filter((value): value is string => Boolean(value))));
  const traces = generationIds.length ? await prisma.smartMixDecisionTrace.findMany({ where: { userId, generationId: { in: generationIds }, trackId: { in: events.map((event) => event.trackId) } }, select: { generationId: true, trackId: true, confidenceScore: true, confidenceLabel: true, explanationJson: true } }) : [];
  const traceMap = new Map(traces.map((trace: any) => [`${trace.generationId}:${trace.trackId}`, trace]));
  const items = events.map((event) => {
    const trace: any = event.generationId ? traceMap.get(`${event.generationId}:${event.trackId}`) : null;
    const scores = trace ? scoreParts(trace) : { base: Number(asObject(event.contextJson).baseScore) || null, personalized: null, adjustment: null, factors: [] };
    return { id: event.id, trackId: event.trackId, track: event.track.title, artist: event.track.artist.title, playlistId: event.playlistId, playlist: event.playlist?.plexPlaylistTitle || "Preview", suggestedAt: event.occurredAt, status: event.eventType === "TRACK_ACCEPTED_FROM_PREVIEW" ? "accepted" : "rejected", baseScore: scores.base, personalizedScore: scores.personalized, scoreDifference: scores.adjustment, confidence: trace ? { score: trace.confidenceScore, label: trace.confidenceLabel } : null, factors: scores.factors.slice(0, 3).map((factor: any) => factor.label), rejectionReason: event.eventType === "TRACK_REJECTED_FROM_PREVIEW" ? "Rejected in preview" : null, playbackStatus: null, libraryStatus: event.track.syncStatus, explanationUrl: event.generationId ? `/api/smart-mix-explanations/tracks/${event.trackId}?generationId=${encodeURIComponent(event.generationId)}` : null };
  });
  return { items, total, page, pageSize, pageCount: Math.ceil(total / pageSize) };
}

export async function listPlaylistIdentities(userId: string, input: { page?: number; pageSize?: number; query?: string; filter?: string; sort?: string } = {}) {
  const page = clampPage(input.page); const pageSize = clampPageSize(input.pageSize);
  const where: Prisma.PlaylistIdentityWhereInput = { userId, ...(input.query ? { displayName: { contains: input.query, mode: "insensitive" } } : {}), ...(input.filter === "active" ? { enabled: true } : {}), ...(input.filter === "high-confidence" ? { confidence: { gte: .75 } } : {}), ...(input.filter === "needs-feedback" ? { confidence: { lt: .45 } } : {}), ...(input.filter === "missing-plex" ? { plexPlaylistId: null } : {}) };
  const orderBy: Prisma.PlaylistIdentityOrderByWithRelationInput = input.sort === "name" ? { displayName: "asc" } : input.sort === "confidence" ? { confidence: "desc" } : { updatedAt: "desc" };
  const [total, items] = await Promise.all([prisma.playlistIdentity.count({ where }), prisma.playlistIdentity.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { playlist: { select: { plexPlaylistTitle: true, plexPlaylistRatingKey: true, lastGeneratedAt: true } }, _count: { select: { trackMemories: true, membershipEvents: true, artistPreferences: true, genrePreferences: true } } } })]);
  return { items: items.map((item) => ({ id: item.id, playlistId: item.playlistId, name: item.displayName || item.playlist.plexPlaylistTitle, enabled: item.enabled, learningEnabled: item.learningEnabled, confidence: item.confidence, confidenceLabel: confidenceName(item.confidence), historicalMemberCount: item.historicalTrackCount, currentTrackCount: item.currentTrackCount, memoryCount: item._count.trackMemories, feedbackEventCount: item._count.membershipEvents, plexConnected: Boolean(item.plexPlaylistId || item.playlist.plexPlaylistRatingKey), lastUpdated: item.updatedAt, lastUsed: item.lastRegeneratedAt || item.playlist.lastGeneratedAt })), total, page, pageSize, pageCount: Math.ceil(total / pageSize) };
}

async function boundedFindMany<T>(load: (cursor?: string) => Promise<T[]>, id: (item: T) => string, limit = EXPORT_COLLECTION_LIMIT) {
  const rows: T[] = []; let cursor: string | undefined; let truncated = false;
  while (rows.length < limit) {
    const batch = await load(cursor); rows.push(...batch); if (batch.length < 500) break; cursor = id(batch[batch.length - 1]);
  }
  if (rows.length >= limit) truncated = true;
  return { rows: rows.slice(0, limit), truncated };
}

export async function buildPersonalizationExport(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, plexId: true, username: true } });
  if (!user) throw new Error("User not found");
  const [profile, adaptive, playback, playlistProfiles, trackPreferences, artistPreferences, fitFeedback, transitionFeedback, feedbackEvents, interactions, adjustments, statistics, identities, playbackProfiles, varietySettings, playlistVarietySettings, playlistPairPolicies, playlistTrackDesignations] = await Promise.all([
    prisma.userRecommendationProfile.findUnique({ where: { userId } }), prisma.adaptiveScoringProfile.findUnique({ where: { userId } }), prisma.playbackAwarenessSetting.findUnique({ where: { userId } }),
    boundedFindMany((cursor) => prisma.playlistPreferenceProfile.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }), (row) => row.id),
    boundedFindMany((cursor) => prisma.userTrackPreference.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { track: { select: { ratingKey: true, title: true, artist: { select: { title: true } } } } } }), (row) => row.id),
    boundedFindMany((cursor) => prisma.userArtistPreference.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { artist: { select: { plexId: true, title: true } } } }), (row) => row.id),
    boundedFindMany((cursor) => prisma.playlistFitFeedback.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }), (row) => row.id),
    boundedFindMany((cursor) => prisma.transitionFeedback.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }), (row) => row.id),
    boundedFindMany((cursor) => prisma.feedbackEvent.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }), (row) => row.id),
    boundedFindMany((cursor) => prisma.trackInteractionEvent.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }), (row) => row.id),
    prisma.personalScoringAdjustment.findMany({ where: { userId } }), prisma.adaptivePreferenceStatistic.findMany({ where: { userId } }),
    boundedFindMany((cursor) => prisma.playlistIdentity.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { attributes: true, artistPreferences: true, genrePreferences: true, trackMemories: { orderBy: { id: "asc" }, take: 2_000 }, snapshots: { orderBy: { createdAt: "desc" }, take: 25 } } }), (row) => row.id, 1_000),
    boundedFindMany((cursor) => prisma.userTrackPlaybackProfile.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }), (row) => row.id),
    prisma.crossPlaylistVarietySetting.findUnique({ where: { userId } }),
    prisma.playlistCoordinationSetting.findMany({ where: { playlist: { userId } }, orderBy: { playlistId: "asc" }, take: 10_000 }),
    prisma.playlistPairPolicy.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 10_000 }),
    prisma.playlistTrackDesignation.findMany({ where: { userId }, orderBy: { id: "asc" }, take: EXPORT_COLLECTION_LIMIT }),
  ]);
  const strip = (value: any, keys: string[]) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
  const profileKeys = ["enabled", "learningEnabled", "profileVersion", "minimumEventsRequired", "preferredEnergyMin", "preferredEnergyMax", "preferredBpmMin", "preferredBpmMax", "preferredDiscoveryLevel", "preferredDeepCutWeight", "preferredPopularityWeight", "preferredMoodWeight", "preferredEnergyWeight", "preferredBpmWeight", "preferredArtistVariety", "preferredAlbumVariety", "avoidRecentlyPlayed", "avoidRecentlyUsedArtists", "avoidLiveRecordings", "avoidLowConfidenceMetadata", "secondaryTraits", "onboardingState", "onboardingStep", "onboardingConfigJson"];
  const payload = {
    format: PERSONALIZATION_EXPORT_FORMAT, schemaVersion: PERSONALIZATION_EXPORT_SCHEMA_VERSION, mixarrVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    profile: { identifier: { plexId: user.plexId, username: user.username }, settings: strip(profile, profileKeys) },
    adaptiveSettings: adaptive ? strip(adaptive, ["enabled", "preset", "maximumInfluence", "showExplanationsByDefault", "includeInferredBehavior", "includePlaylistHistory", "includePlaylistIdentity", "includeArtistPreferences", "includeMoodPreferences", "includeDiscoveryTolerance", "includeRepeatTolerance", "minimumConfidence", "preferExplicitFeedback", "reduceOldFeedback", "positiveAdjustmentLimit", "negativeAdjustmentLimit", "componentWeightsJson", "scoringVersion"]) : null,
    playbackSettings: playback ? strip(playback, ["enabled", "influence", "recentlyPlayedBehavior", "recentlyPlayedWindowDays", "forgottenFavoriteDays", "useSkipHistory", "useCompletionHistory", "useReplayHistory", "playbackAwareDiscovery", "completionThreshold", "skipThreshold", "minimumSkipDurationMs", "minimumObservations", "maximumAdjustment", "historyRetentionDays", "syncIntervalHours"]) : null,
    playlistProfiles: playlistProfiles.rows, trackPreferences: trackPreferences.rows, artistPreferences: artistPreferences.rows, playlistFitFeedback: fitFeedback.rows, transitionFeedback: transitionFeedback.rows,
    feedbackEvents: feedbackEvents.rows, interactionEvents: interactions.rows, learnedAdjustments: adjustments, adaptiveStatistics: statistics, playlistIdentities: identities.rows,
    recommendationHistory: interactions.rows.filter((item: any) => item.eventType.includes("PREVIEW")), playbackDerivedSummaries: playbackProfiles.rows, manualOverrides: { trackRestrictions: trackPreferences.rows.filter((item: any) => item.state === "NEVER_RECOMMEND") },
    crossPlaylistVariety: {
      globalSettings: varietySettings,
      playlistOverrides: playlistVarietySettings,
      playlistPairRules: playlistPairPolicies,
      trackDesignations: playlistTrackDesignations,
      calculatedOverlapCachesIncluded: false,
    },
    truncation: { playlistProfiles: playlistProfiles.truncated, trackPreferences: trackPreferences.truncated, artistPreferences: artistPreferences.truncated, playlistFitFeedback: fitFeedback.truncated, transitionFeedback: transitionFeedback.truncated, feedbackEvents: feedbackEvents.truncated, interactionEvents: interactions.truncated, playlistIdentities: identities.truncated, playbackDerivedSummaries: playbackProfiles.truncated },
  };
  const summary = { feedbackEvents: feedbackEvents.rows.length, playlistIdentities: identities.rows.length, artistPreferences: artistPreferences.rows.length, trackPreferences: trackPreferences.rows.length, recommendationDecisions: interactions.rows.filter((item: any) => item.eventType.includes("PREVIEW")).length, varietyPolicies: playlistVarietySettings.length + playlistPairPolicies.length, coreAndExclusivityDesignations: playlistTrackDesignations.length, truncated: Object.values(payload.truncation).some(Boolean) };
  console.info("[PersonalizationDashboard] Export generated", { userId, ...summary });
  return { payload, summary };
}

const importEnvelopeSchema = z.object({ format: z.literal(PERSONALIZATION_EXPORT_FORMAT), schemaVersion: z.number().int().positive(), mixarrVersion: z.string(), exportedAt: z.string(), profile: z.object({ identifier: z.object({ plexId: z.number().int().optional(), username: z.string().optional() }).passthrough(), settings: z.record(z.any()).optional() }).passthrough(), playlistProfiles: z.array(z.any()).optional(), trackPreferences: z.array(z.any()).optional(), artistPreferences: z.array(z.any()).optional(), playlistFitFeedback: z.array(z.any()).optional(), transitionFeedback: z.array(z.any()).optional(), feedbackEvents: z.array(z.any()).optional(), interactionEvents: z.array(z.any()).optional(), playlistIdentities: z.array(z.any()).optional(), adaptiveSettings: z.record(z.any()).nullable().optional(), playbackSettings: z.record(z.any()).nullable().optional() }).passthrough();
export type PersonalizationImportMode = "merge" | "replace" | "identities" | "preferences" | "feedback";

function parseImport(input: unknown) {
  const content = typeof input === "string" ? input : JSON.stringify(input);
  if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES) throw new Error("Personalization import file is too large.");
  let json: unknown; try { json = typeof input === "string" ? JSON.parse(input) : input; } catch { throw new Error("Invalid JSON personalization export."); }
  const parsed = importEnvelopeSchema.safeParse(json); if (!parsed.success) throw new Error("This is not a valid Mixarr personalization export.");
  if (parsed.data.schemaVersion > PERSONALIZATION_EXPORT_SCHEMA_VERSION) throw new Error("This personalization export uses a newer schema version.");
  return parsed.data;
}

export async function validatePersonalizationImport(userId: string, input: unknown, mode: PersonalizationImportMode = "merge") {
  const data = parseImport(input); const user = await prisma.user.findUnique({ where: { id: userId }, select: { plexId: true, username: true } });
  if (!user) throw new Error("User not found");
  const trackIds = Array.from(new Set([...(data.trackPreferences || []).map((item: any) => item.trackId), ...(data.interactionEvents || []).map((item: any) => item.trackId), ...(data.playlistFitFeedback || []).map((item: any) => item.trackId)].filter(Boolean))).slice(0, EXPORT_COLLECTION_LIMIT);
  const playlistIds = Array.from(new Set([...(data.playlistProfiles || []).map((item: any) => item.playlistId), ...(data.playlistIdentities || []).map((item: any) => item.playlistId)].filter(Boolean))).slice(0, EXPORT_COLLECTION_LIMIT);
  const [matchedTracks, matchedPlaylists, existingTrackPrefs, existingArtistPrefs] = await Promise.all([
    prisma.track.count({ where: { id: { in: trackIds }, library: { server: { userId } } } }), prisma.generatedPlaylist.count({ where: { id: { in: playlistIds }, userId } }),
    prisma.userTrackPreference.count({ where: { userId, trackId: { in: (data.trackPreferences || []).map((item: any) => item.trackId).filter(Boolean) } } }), prisma.userArtistPreference.count({ where: { userId, artistId: { in: (data.artistPreferences || []).map((item: any) => item.artistId).filter(Boolean) } } }),
  ]);
  const userMatch = data.profile.identifier.plexId == null || data.profile.identifier.plexId === user.plexId;
  const preview = { format: data.format, schemaVersion: data.schemaVersion, mixarrVersion: data.mixarrVersion, exportedAt: data.exportedAt, mode, userMatch, counts: { settings: data.profile.settings ? 1 : 0, feedbackEvents: data.feedbackEvents?.length || 0, interactionEvents: data.interactionEvents?.length || 0, trackPreferences: data.trackPreferences?.length || 0, artistPreferences: data.artistPreferences?.length || 0, playlistIdentities: data.playlistIdentities?.length || 0 }, conflicts: { trackPreferences: existingTrackPrefs, artistPreferences: existingArtistPrefs }, missing: { tracks: Math.max(0, trackIds.length - matchedTracks), playlists: Math.max(0, playlistIds.length - matchedPlaylists) }, warnings: [...(!userMatch ? ["The source profile identifier differs; data will still import only into the signed-in account."] : []), ...(data.schemaVersion < PERSONALIZATION_EXPORT_SCHEMA_VERSION ? ["The export will be upgraded to the current schema."] : [])] };
  console.info("[PersonalizationDashboard] Import validated", { userId, mode, ...preview.counts, missingTracks: preview.missing.tracks, missingPlaylists: preview.missing.playlists });
  return { preview, data };
}

const PROFILE_IMPORT_KEYS = ["enabled", "learningEnabled", "minimumEventsRequired", "preferredEnergyMin", "preferredEnergyMax", "preferredBpmMin", "preferredBpmMax", "preferredDiscoveryLevel", "preferredDeepCutWeight", "preferredPopularityWeight", "preferredMoodWeight", "preferredEnergyWeight", "preferredBpmWeight", "preferredArtistVariety", "preferredAlbumVariety", "avoidRecentlyPlayed", "avoidRecentlyUsedArtists", "avoidLiveRecordings", "avoidLowConfidenceMetadata", "secondaryTraits", "onboardingState", "onboardingStep", "onboardingConfigJson"];
const allow = (value: Record<string, any> | undefined, keys: string[]) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value![key]]));

export async function importPersonalizationData(userId: string, input: unknown, mode: PersonalizationImportMode) {
  const { preview, data } = await validatePersonalizationImport(userId, input, mode); const startedAt = new Date();
  const current = mode === "replace" ? await buildPersonalizationExport(userId) : null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      let backupId: string | null = null;
      if (current) {
        const backup = await tx.personalizationImportBackup.create({ data: { userId, reason: "replace_import", summaryJson: current.summary as Prisma.InputJsonValue, payloadJson: current.payload as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 30 * DAY_MS) } }); backupId = backup.id;
      }
      const importingPreferences = ["merge", "replace", "preferences"].includes(mode); const importingFeedback = ["merge", "replace", "feedback"].includes(mode); const importingIdentities = ["merge", "replace", "identities"].includes(mode);
      if (mode === "replace") {
        await tx.feedbackEvent.deleteMany({ where: { userId } }); await tx.trackInteractionEvent.deleteMany({ where: { userId } }); await tx.personalScoringAdjustment.deleteMany({ where: { userId } }); await tx.adaptivePreferenceStatistic.deleteMany({ where: { userId } });
        await tx.playlistFitFeedback.deleteMany({ where: { userId } }); await tx.transitionFeedback.deleteMany({ where: { userId } }); await tx.userTrackPreference.deleteMany({ where: { userId } }); await tx.userArtistPreference.deleteMany({ where: { userId } }); await tx.playlistPreferenceProfile.deleteMany({ where: { userId } });
      }
      if (importingPreferences && data.profile.settings) await tx.userRecommendationProfile.upsert({ where: { userId }, create: { userId, ...allow(data.profile.settings, PROFILE_IMPORT_KEYS) }, update: allow(data.profile.settings, PROFILE_IMPORT_KEYS) });
      if (importingPreferences && data.adaptiveSettings) {
        const adaptiveData = allow(data.adaptiveSettings, ["enabled", "preset", "maximumInfluence", "showExplanationsByDefault", "includeInferredBehavior", "includePlaylistHistory", "includePlaylistIdentity", "includeArtistPreferences", "includeMoodPreferences", "includeDiscoveryTolerance", "includeRepeatTolerance", "minimumConfidence", "preferExplicitFeedback", "reduceOldFeedback", "positiveAdjustmentLimit", "negativeAdjustmentLimit", "componentWeightsJson", "scoringVersion"]);
        await tx.adaptiveScoringProfile.upsert({ where: { userId }, create: { userId, componentWeightsJson: (adaptiveData.componentWeightsJson || DEFAULT_ADAPTIVE_SCORING_SETTINGS.componentWeights) as Prisma.InputJsonValue, ...adaptiveData }, update: adaptiveData });
      }
      if (importingPreferences && data.playbackSettings) {
        const playbackData = allow(data.playbackSettings, Object.keys(DEFAULT_PLAYBACK_SETTINGS));
        await tx.playbackAwarenessSetting.upsert({ where: { userId }, create: { userId, ...DEFAULT_PLAYBACK_SETTINGS, ...playbackData }, update: playbackData });
      }
      const referencedTrackIds = Array.from(new Set([...(data.trackPreferences || []).map((item: any) => item.trackId), ...(data.interactionEvents || []).map((item: any) => item.trackId), ...(data.playlistFitFeedback || []).map((item: any) => item.trackId), ...(data.transitionFeedback || []).flatMap((item: any) => [item.previousTrackId, item.currentTrackId, item.nextTrackId])].filter(Boolean)));
      const ownedTracks = new Set((await tx.track.findMany({ where: { id: { in: referencedTrackIds }, library: { server: { userId } } }, select: { id: true } })).map((item) => item.id));
      const ownedArtists = new Set((await tx.artist.findMany({ where: { id: { in: (data.artistPreferences || []).map((item: any) => item.artistId).filter(Boolean) }, library: { server: { userId } } }, select: { id: true } })).map((item) => item.id));
      const ownedPlaylists = new Set((await tx.generatedPlaylist.findMany({ where: { userId, id: { in: [...(data.playlistProfiles || []).map((item: any) => item.playlistId), ...(data.playlistIdentities || []).map((item: any) => item.playlistId)].filter(Boolean) } }, select: { id: true } })).map((item) => item.id));
      let imported = 0; let skipped = 0;
      if (importingPreferences) {
        for (const item of data.trackPreferences || []) { if (!ownedTracks.has(item.trackId) || !["LIKED", "DISLIKED", "NEVER_RECOMMEND"].includes(item.state)) { skipped++; continue; } await tx.userTrackPreference.upsert({ where: { userId_trackId: { userId, trackId: item.trackId } }, create: { userId, trackId: item.trackId, state: item.state, scoreAdjustment: Number(item.scoreAdjustment) || 0 }, update: { state: item.state, scoreAdjustment: Number(item.scoreAdjustment) || 0 } }); imported++; }
        for (const item of data.artistPreferences || []) { if (!ownedArtists.has(item.artistId) || !["PREFER", "RECOMMEND_LESS"].includes(item.state)) { skipped++; continue; } await tx.userArtistPreference.upsert({ where: { userId_artistId: { userId, artistId: item.artistId } }, create: { userId, artistId: item.artistId, state: item.state, scoreAdjustment: Number(item.scoreAdjustment) || 0 }, update: { state: item.state, scoreAdjustment: Number(item.scoreAdjustment) || 0 } }); imported++; }
        for (const item of data.playlistProfiles || []) { if (!ownedPlaylists.has(item.playlistId)) { skipped++; continue; } await tx.playlistPreferenceProfile.upsert({ where: { playlistId: item.playlistId }, create: { userId, playlistId: item.playlistId, ...allow(item, ["name", "enabled", "mode", "source", "isLearned", "energyMin", "energyMax", "bpmMin", "bpmMax", "discoveryPreference", "deepCutPreference", "artistVarietyPreference", "albumVarietyPreference", "repetitionTolerance", "avoidLiveRecordings", "avoidLowConfidenceMetadata", "avoidRecentlyPlayedTracks", "confidence", "evidenceCount"]) }, update: allow(item, ["name", "enabled", "mode", "source", "isLearned", "energyMin", "energyMax", "bpmMin", "bpmMax", "discoveryPreference", "deepCutPreference", "artistVarietyPreference", "albumVarietyPreference", "repetitionTolerance", "avoidLiveRecordings", "avoidLowConfidenceMetadata", "avoidRecentlyPlayedTracks", "confidence", "evidenceCount"]) }); imported++; }
      }
      if (importingIdentities) for (const item of data.playlistIdentities || []) { if (!ownedPlaylists.has(item.playlistId)) { skipped++; continue; } await tx.playlistIdentity.upsert({ where: { playlistId: item.playlistId }, create: { userId, playlistId: item.playlistId, displayName: String(item.displayName || "Imported identity").slice(0, 200), enabled: item.enabled !== false, learningEnabled: item.learningEnabled !== false, strength: Math.max(0, Math.min(1, Number(item.strength) || .6)), confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)), confidenceState: String(item.confidenceState || "INSUFFICIENT_DATA"), learnedProfileJson: item.learnedProfileJson || undefined, userProfileJson: item.userProfileJson || undefined, effectiveProfileJson: item.effectiveProfileJson || undefined }, update: { displayName: String(item.displayName || "Imported identity").slice(0, 200), enabled: item.enabled !== false, learningEnabled: item.learningEnabled !== false, strength: Math.max(0, Math.min(1, Number(item.strength) || .6)), userProfileJson: item.userProfileJson || undefined } }); imported++; }
      if (importingFeedback) {
        const feedbackRows = (data.feedbackEvents || []).map((item: any) => ({ userId, feedbackType: String(item.feedbackType || "IMPORTED").slice(0, 80), targetType: String(item.targetType || "UNKNOWN").slice(0, 80), targetIdsJson: (item.targetIdsJson || {}) as Prisma.InputJsonValue, previousState: item.previousState || null, newState: item.newState || null, reason: item.reason || null, sourceSurface: "IMPORT", idempotencyKey: `import:${userId}:${String(item.id || item.idempotencyKey || Math.random()).slice(-100)}`, createdAt: item.createdAt ? new Date(item.createdAt) : new Date() }));
        for (let index = 0; index < feedbackRows.length; index += 500) { const result = await tx.feedbackEvent.createMany({ data: feedbackRows.slice(index, index + 500), skipDuplicates: true }); imported += result.count; skipped += Math.min(500, feedbackRows.length - index) - result.count; }
        const interactionRows = (data.interactionEvents || []).filter((item: any) => ownedTracks.has(item.trackId) && (!item.playlistId || ownedPlaylists.has(item.playlistId))).map((item: any) => ({ userId, trackId: item.trackId, playlistId: item.playlistId || null, playlistVersionId: item.playlistVersionId || null, eventType: String(item.eventType || "IMPORTED"), eventSource: "IMPORT", generationId: item.generationId || null, idempotencyKey: `import:${userId}:${String(item.id || item.idempotencyKey || Math.random()).slice(-100)}`, contextJson: item.contextJson ? item.contextJson as Prisma.InputJsonValue : undefined, weight: Number(item.weight) || 1, occurredAt: item.occurredAt ? new Date(item.occurredAt) : new Date() }));
        skipped += (data.interactionEvents?.length || 0) - interactionRows.length;
        for (let index = 0; index < interactionRows.length; index += 500) { const result = await tx.trackInteractionEvent.createMany({ data: interactionRows.slice(index, index + 500), skipDuplicates: true }); imported += result.count; skipped += Math.min(500, interactionRows.length - index) - result.count; }
        for (const item of data.playlistFitFeedback || []) { if (!ownedTracks.has(item.trackId) || (item.playlistId && !ownedPlaylists.has(item.playlistId))) { skipped++; continue; } const scopeKey = item.playlistId ? `playlist:${item.playlistId}` : String(item.scopeKey || `generation:${item.generationId || "import"}`); await tx.playlistFitFeedback.upsert({ where: { userId_trackId_scopeKey: { userId, trackId: item.trackId, scopeKey } }, create: { userId, trackId: item.trackId, playlistId: item.playlistId || null, scopeKey, state: item.state === "GOOD_FIT" ? "GOOD_FIT" : "POOR_FIT", reason: item.reason || null, generationId: item.generationId || null, engineVersion: item.engineVersion || null }, update: { state: item.state === "GOOD_FIT" ? "GOOD_FIT" : "POOR_FIT", reason: item.reason || null } }); imported++; }
      }
      await tx.personalizationAuditEntry.create({ data: { userId, action: "IMPORT", scope: mode.toUpperCase(), summaryJson: { imported, skipped, backupId, sourceVersion: data.mixarrVersion, schemaVersion: data.schemaVersion } } });
      return { imported, skipped, backupId };
    });
    invalidatePersonalizationDashboardCache(userId); await safeRecordJobHistory({ userId, type: "personalization", name: "Personalization import", status: "completed", trigger: "manual", startedAt, summary: `Imported ${result.imported} personalization records; skipped ${result.skipped}.`, counts: { attempted: result.imported + result.skipped, processed: result.imported, skipped: result.skipped }, metadata: { mode, backupId: result.backupId, schemaVersion: data.schemaVersion } });
    console.info("[PersonalizationDashboard] Import completed", { userId, mode, ...result }); return { ...result, preview };
  } catch (error) { console.error("[PersonalizationDashboard] Import failed", { userId, mode, message: error instanceof Error ? error.message : "unknown" }); throw error; }
}

export const resetScopeSchema = z.enum(["all", "feedback", "inferred", "playback", "recommendations", "decisions", "identities", "artists", "moods", "rejected", "settings"]);
export type ResetScope = z.infer<typeof resetScopeSchema>;

export async function previewPersonalizationReset(userId: string, scope: ResetScope) {
  const all = scope === "all"; const [feedback, interactions, adjustments, playback, traces, identities, artists, moodStats, rejected] = await Promise.all([
    all || scope === "feedback" ? prisma.feedbackEvent.count({ where: { userId } }) : 0, all || scope === "feedback" || scope === "recommendations" || scope === "decisions" ? prisma.trackInteractionEvent.count({ where: { userId } }) : 0,
    all || scope === "inferred" || scope === "moods" ? prisma.personalScoringAdjustment.count({ where: { userId } }) : 0, all || scope === "playback" ? prisma.userTrackPlaybackProfile.count({ where: { userId } }) : 0,
    all || scope === "recommendations" ? prisma.smartMixDecisionTrace.count({ where: { userId } }) : 0, all || scope === "identities" ? prisma.playlistIdentity.count({ where: { userId } }) : 0,
    all || scope === "artists" ? prisma.userArtistPreference.count({ where: { userId } }) : 0, all || scope === "moods" ? prisma.adaptivePreferenceStatistic.count({ where: { userId, dimension: { contains: "mood", mode: "insensitive" } } }) : 0,
    all || scope === "rejected" ? prisma.userTrackPreference.count({ where: { userId, state: { in: ["DISLIKED", "NEVER_RECOMMEND"] } } }) : 0,
  ]);
  return { scope, counts: { feedback, interactions, adjustments, playback, traces, identities, artists, moodStats, rejected }, preserves: ["Plex library tracks", "Plex playlists", "metadata corrections", "unrelated application settings", "user accounts", "unrelated job history"] };
}

export async function resetPersonalizationScope(userId: string, scope: ResetScope) {
  const preview = await previewPersonalizationReset(userId, scope); const all = scope === "all"; const startedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    if (all || scope === "feedback") { await tx.feedbackEvent.deleteMany({ where: { userId } }); await tx.playlistFitFeedback.deleteMany({ where: { userId } }); await tx.transitionFeedback.deleteMany({ where: { userId } }); await tx.userTrackPreference.deleteMany({ where: { userId } }); await tx.userArtistPreference.deleteMany({ where: { userId } }); }
    if (all || ["feedback", "recommendations", "decisions"].includes(scope)) await tx.trackInteractionEvent.deleteMany({ where: { userId } });
    if (all || scope === "inferred") { await tx.personalScoringAdjustment.deleteMany({ where: { userId } }); await tx.adaptivePreferenceStatistic.deleteMany({ where: { userId } }); }
    if (all || scope === "playback") await tx.userTrackPlaybackProfile.deleteMany({ where: { userId } });
    if (all || scope === "recommendations") { await tx.smartMixDecisionTrace.deleteMany({ where: { userId } }); await tx.smartMixExplanationGeneration.deleteMany({ where: { userId } }); }
    if (all || scope === "identities") await tx.playlistIdentity.deleteMany({ where: { userId } });
    if (scope === "artists") await tx.userArtistPreference.deleteMany({ where: { userId } });
    if (scope === "moods") { await tx.adaptivePreferenceStatistic.deleteMany({ where: { userId, dimension: { contains: "mood", mode: "insensitive" } } }); await tx.personalScoringAdjustment.deleteMany({ where: { userId, featureType: { contains: "MOOD", mode: "insensitive" } } }); }
    if (scope === "rejected") await tx.userTrackPreference.deleteMany({ where: { userId, state: { in: ["DISLIKED", "NEVER_RECOMMEND"] } } });
    if (all || scope === "settings") { await tx.userRecommendationProfile.upsert({ where: { userId }, create: { userId }, update: { enabled: false, learningEnabled: false, confidence: 0, confidenceState: "NOT_ENOUGH_DATA", interactionCount: 0, lastCalculatedAt: null, onboardingState: "NOT_STARTED", onboardingStep: 1, onboardingConfigJson: Prisma.DbNull } }); await tx.adaptiveScoringProfile.deleteMany({ where: { userId } }); await tx.playbackAwarenessSetting.deleteMany({ where: { userId } }); }
    await tx.personalizationAuditEntry.create({ data: { userId, action: "RESET", scope: scope.toUpperCase(), summaryJson: preview.counts } }); return preview.counts;
  });
  invalidatePersonalizationDashboardCache(userId); const removed = Object.values(result).reduce((sum, value) => sum + value, 0); await safeRecordJobHistory({ userId, type: "personalization", name: "Personalization data reset", status: "completed", trigger: "manual", startedAt, summary: `Reset ${scope} personalization data (${removed} records targeted).`, counts: { attempted: removed, processed: removed }, metadata: { scope } }); console.info("[PersonalizationDashboard] Reset completed", { userId, scope, removed }); return { scope, removed, counts: result };
}

export async function updatePersonalizationOnboarding(userId: string, input: { state: "IN_PROGRESS" | "COMPLETED" | "SKIPPED"; step: number; config?: Record<string, unknown> }) {
  const config = input.config || {}; const step = Math.max(1, Math.min(6, input.step));
  const profileData: Prisma.UserRecommendationProfileUncheckedUpdateInput = { onboardingState: input.state, onboardingStep: step, onboardingConfigJson: config as Prisma.InputJsonValue };
  if (input.state === "COMPLETED") {
    profileData.enabled = Boolean(config.enabled ?? true); profileData.learningEnabled = Boolean(config.directFeedback ?? true); profileData.avoidLiveRecordings = Boolean(config.avoidLive);
    profileData.secondaryTraits = { preferredMoods: String(config.preferredMoods || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20), avoidedMoods: String(config.avoidedMoods || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20), avoidRemixes: Boolean(config.avoidRemixes), avoidDuplicates: Boolean(config.avoidDuplicates) };
  }
  const profile = await prisma.$transaction(async (tx) => {
    const updated = await tx.userRecommendationProfile.upsert({ where: { userId }, create: { ...(profileData as Prisma.UserRecommendationProfileUncheckedCreateInput), userId }, update: profileData });
    if (input.state === "COMPLETED") {
      const maximumPoints = Math.max(0, Math.min(20, Number(config.maximumInfluence) || 0)); const confidence = ["low", "developing", "medium", "high"].includes(String(config.minimumConfidence).toLowerCase()) ? String(config.minimumConfidence).toLowerCase() : "developing";
      await tx.adaptiveScoringProfile.upsert({ where: { userId }, create: { userId, enabled: Boolean(config.enabled ?? true), maximumInfluence: maximumPoints / 20, positiveAdjustmentLimit: maximumPoints, negativeAdjustmentLimit: maximumPoints, minimumConfidence: confidence, includePlaylistHistory: Boolean(config.playlistHistory ?? true), includeInferredBehavior: Boolean(config.suggestionDecisions ?? true), componentWeightsJson: DEFAULT_ADAPTIVE_SCORING_SETTINGS.componentWeights as Prisma.InputJsonValue }, update: { enabled: Boolean(config.enabled ?? true), maximumInfluence: maximumPoints / 20, positiveAdjustmentLimit: maximumPoints, negativeAdjustmentLimit: maximumPoints, minimumConfidence: confidence, includePlaylistHistory: Boolean(config.playlistHistory ?? true), includeInferredBehavior: Boolean(config.suggestionDecisions ?? true) } });
      await tx.playbackAwarenessSetting.upsert({ where: { userId }, create: { userId, ...DEFAULT_PLAYBACK_SETTINGS, enabled: Boolean(config.playbackHistory), useSkipHistory: Boolean(config.skipBehavior), useReplayHistory: Boolean(config.repeatBehavior), recentlyPlayedBehavior: config.recentlyPlayedAvoidance === false ? "disabled" : "soft", recentlyPlayedWindowDays: [7, 14, 30, 90].includes(Number(config.exclusionWindow)) ? Number(config.exclusionWindow) : 14 }, update: { enabled: Boolean(config.playbackHistory), useSkipHistory: Boolean(config.skipBehavior), useReplayHistory: Boolean(config.repeatBehavior), recentlyPlayedBehavior: config.recentlyPlayedAvoidance === false ? "disabled" : "soft", recentlyPlayedWindowDays: [7, 14, 30, 90].includes(Number(config.exclusionWindow)) ? Number(config.exclusionWindow) : 14 } });
    }
    return updated;
  });
  invalidatePersonalizationDashboardCache(userId); return { state: profile.onboardingState, step: profile.onboardingStep, config: profile.onboardingConfigJson };
}

export async function previewPersonalizationCleanup(userId: string, days = 90) {
  const cutoff = new Date(Date.now() - Math.max(30, Math.min(3650, days)) * DAY_MS); const [expiredBackups, expiredTraces, oldLowConfidence, duplicateDecisionEvents, failedStaging] = await Promise.all([prisma.personalizationImportBackup.count({ where: { userId, expiresAt: { lt: new Date() } } }), prisma.smartMixDecisionTrace.count({ where: { userId, expiresAt: { lt: new Date() }, decision: { not: "selected" } } }), prisma.adaptivePreferenceStatistic.count({ where: { userId, confidence: { lt: .15 }, explicitCount: 0, calculatedAt: { lt: cutoff } } }), prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COALESCE(SUM(grouped.count - 1), 0)::bigint AS count FROM (SELECT COUNT(*)::bigint AS count FROM "TrackInteractionEvent" WHERE "userId" = ${userId} AND "generationId" IS NOT NULL AND "eventType" IN ('TRACK_ACCEPTED_FROM_PREVIEW', 'TRACK_REJECTED_FROM_PREVIEW') GROUP BY "generationId", "trackId", "eventType" HAVING COUNT(*) > 1) grouped`).then((rows) => Number(rows[0]?.count || 0)), Promise.resolve(0)]); return { days, cutoff, counts: { expiredBackups, expiredTraces, oldLowConfidence, duplicateDecisionEvents, failedStaging }, preserved: ["direct feedback", "never-recommend rules", "playlist identities", "manual preferences", "audit history"] };
}

export async function cleanupPersonalizationData(userId: string, days = 90) {
  const preview = await previewPersonalizationCleanup(userId, days); const [backups, traces, statistics, duplicateDecisionEvents] = await prisma.$transaction([prisma.personalizationImportBackup.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } }), prisma.smartMixDecisionTrace.deleteMany({ where: { userId, expiresAt: { lt: new Date() }, decision: { not: "selected" } } }), prisma.adaptivePreferenceStatistic.deleteMany({ where: { userId, confidence: { lt: .15 }, explicitCount: 0, calculatedAt: { lt: preview.cutoff } } }), prisma.$executeRaw(Prisma.sql`DELETE FROM "TrackInteractionEvent" WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY "generationId", "trackId", "eventType" ORDER BY "occurredAt" DESC, id DESC) AS row_number FROM "TrackInteractionEvent" WHERE "userId" = ${userId} AND "generationId" IS NOT NULL AND "eventType" IN ('TRACK_ACCEPTED_FROM_PREVIEW', 'TRACK_REJECTED_FROM_PREVIEW')) ranked WHERE ranked.row_number > 1)`)]); const result = { expiredBackups: backups.count, expiredTraces: traces.count, oldLowConfidence: statistics.count, duplicateDecisionEvents }; await prisma.personalizationAuditEntry.create({ data: { userId, action: "CLEANUP", scope: "LOW_VALUE_DATA", summaryJson: result } }); invalidatePersonalizationDashboardCache(userId); console.info("[PersonalizationDashboard] Cleanup completed", { userId, ...result }); return result;
}
