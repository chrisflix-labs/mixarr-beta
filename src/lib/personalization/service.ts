import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { safeFinishJobHistory, safeRecordJobHistory, safeStartJobHistory } from "../jobHistory";
import {
  TRACK_INTERACTION_SOURCES,
  TRACK_INTERACTION_TYPES,
  type PersonalizationConfidenceState,
  type PersonalizationScoringContext,
  type PlaylistPreferenceSnapshot,
  type RecommendationProfileSnapshot,
  type TrackInteractionContext,
  type TrackInteractionSource,
  type TrackInteractionType,
} from "./types";
import { getAdaptiveScoringSettings, markAdaptiveScoringDirty, resetAdaptiveScoring } from "../adaptiveScoring";

const MAX_CONTEXT_BYTES = 2_000;
const PROFILE_BATCH_SIZE = 250;
const MAX_PROFILE_EVENTS = 10_000;
const RECENCY_HALF_LIFE_DAYS = 90;

function invalidateDashboard(userId: string) {
  void import("./dashboard").then(({ invalidatePersonalizationDashboardCache }) => invalidatePersonalizationDashboardCache(userId)).catch(() => undefined);
}

export const personalizationSettingsSchema = z.object({
  enabled: z.boolean(),
  learningEnabled: z.boolean(),
}).superRefine((value, context) => {
  if (!value.enabled && value.learningEnabled) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["learningEnabled"], message: "Enable personalization before behavior learning." });
  }
});

export const playlistPreferenceSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  enabled: z.boolean().default(true),
  mode: z.enum(["GENERAL_PROFILE", "PLAYLIST_SPECIFIC", "GLOBAL_ONLY"]),
  source: z.enum(["MANUAL", "LEARNED", "GENERATION_PRESET", "DEFAULT_USER"]).default("MANUAL"),
  energyMin: z.number().min(0).max(1).nullable().optional(),
  energyMax: z.number().min(0).max(1).nullable().optional(),
  bpmMin: z.number().min(20).max(300).nullable().optional(),
  bpmMax: z.number().min(20).max(300).nullable().optional(),
  discoveryPreference: z.number().min(0).max(1).nullable().optional(),
  deepCutPreference: z.number().min(0).max(1).nullable().optional(),
  artistVarietyPreference: z.number().min(0).max(1).nullable().optional(),
  albumVarietyPreference: z.number().min(0).max(1).nullable().optional(),
  repetitionTolerance: z.number().min(0).max(1).nullable().optional(),
  avoidLiveRecordings: z.boolean().nullable().optional(),
  avoidLowConfidenceMetadata: z.boolean().nullable().optional(),
  avoidRecentlyPlayedTracks: z.boolean().nullable().optional(),
}).superRefine((value, context) => {
  if (value.energyMin != null && value.energyMax != null && value.energyMin > value.energyMax) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["energyMax"], message: "Maximum energy must be at least the minimum." });
  }
  if (value.bpmMin != null && value.bpmMax != null && value.bpmMin > value.bpmMax) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bpmMax"], message: "Maximum BPM must be at least the minimum." });
  }
});

const interactionContextSchema = z.object({
  baseScore: z.number().finite().min(-1000).max(1000).optional(),
  energy: z.number().finite().min(0).max(1).optional(),
  bpm: z.number().finite().min(0).max(400).optional(),
  discoveryScore: z.number().finite().min(-100).max(100).optional(),
  popularity: z.number().finite().min(0).max(100).optional(),
  metadataConfidence: z.number().finite().min(0).max(1).optional(),
  isLive: z.boolean().optional(),
  artistId: z.string().max(80).optional(),
}).strict();

function profileSnapshot(profile: any): RecommendationProfileSnapshot {
  return {
    enabled: profile.enabled,
    learningEnabled: profile.learningEnabled,
    confidence: profile.confidence,
    confidenceState: profile.confidenceState as PersonalizationConfidenceState,
    minimumEventsRequired: profile.minimumEventsRequired,
    interactionCount: profile.interactionCount,
    preferredEnergyMin: profile.preferredEnergyMin,
    preferredEnergyMax: profile.preferredEnergyMax,
    preferredBpmMin: profile.preferredBpmMin,
    preferredBpmMax: profile.preferredBpmMax,
    preferredDiscoveryLevel: profile.preferredDiscoveryLevel,
    preferredDeepCutWeight: profile.preferredDeepCutWeight,
    preferredPopularityWeight: profile.preferredPopularityWeight,
    preferredArtistVariety: profile.preferredArtistVariety,
    preferredAlbumVariety: profile.preferredAlbumVariety,
    avoidRecentlyPlayed: profile.avoidRecentlyPlayed,
    avoidRecentlyUsedArtists: profile.avoidRecentlyUsedArtists,
    avoidLiveRecordings: profile.avoidLiveRecordings,
    avoidLowConfidenceMetadata: profile.avoidLowConfidenceMetadata,
  };
}

function playlistSnapshot(profile: any): PlaylistPreferenceSnapshot {
  return {
    enabled: profile.enabled,
    mode: profile.mode,
    source: profile.source,
    isLearned: profile.isLearned,
    confidence: profile.confidence,
    evidenceCount: profile.evidenceCount,
    energyMin: profile.energyMin,
    energyMax: profile.energyMax,
    bpmMin: profile.bpmMin,
    bpmMax: profile.bpmMax,
    discoveryPreference: profile.discoveryPreference,
    deepCutPreference: profile.deepCutPreference,
    artistVarietyPreference: profile.artistVarietyPreference,
    albumVarietyPreference: profile.albumVarietyPreference,
    repetitionTolerance: profile.repetitionTolerance,
    avoidLiveRecordings: profile.avoidLiveRecordings,
    avoidLowConfidenceMetadata: profile.avoidLowConfidenceMetadata,
    avoidRecentlyPlayedTracks: profile.avoidRecentlyPlayedTracks,
  };
}

export async function ensureRecommendationProfile(userId: string) {
  return prisma.userRecommendationProfile.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function updatePersonalizationSettings(userId: string, input: unknown) {
  const value = personalizationSettingsSchema.parse(input);
  const profile = await prisma.userRecommendationProfile.upsert({
    where: { userId },
    create: { userId, enabled: value.enabled, learningEnabled: value.learningEnabled },
    update: { enabled: value.enabled, learningEnabled: value.learningEnabled },
  });
  invalidateDashboard(userId);
  return profile;
}

function confidenceLabel(state: string) {
  if (state === "ESTABLISHED") return "Established";
  if (state === "DEVELOPING") return "Developing";
  if (state === "LEARNING") return "Learning";
  return "Not enough data";
}

function preferenceSummary(profile: any) {
  const prefers: Array<{ key: string; label: string; learned: boolean; confidence: number; evidenceCount: number; active: boolean }> = [];
  const avoids: Array<{ key: string; label: string; learned: boolean; confidence: number; evidenceCount: number; active: boolean }> = [];
  if (profile.preferredEnergyMin != null || profile.preferredEnergyMax != null) prefers.push({ key: "energy", label: "Preferred energy range", learned: true, confidence: profile.confidence, evidenceCount: profile.interactionCount, active: profile.enabled });
  if (profile.preferredBpmMin != null || profile.preferredBpmMax != null) prefers.push({ key: "bpm", label: "Preferred BPM range", learned: true, confidence: profile.confidence, evidenceCount: profile.interactionCount, active: profile.enabled });
  if ((profile.preferredDeepCutWeight || 0) >= 0.55) prefers.push({ key: "deep_cuts", label: "More deep cuts", learned: true, confidence: profile.confidence, evidenceCount: profile.interactionCount, active: profile.enabled });
  if ((profile.preferredArtistVariety || 0) >= 0.55) prefers.push({ key: "artist_variety", label: "Fewer repeated artists", learned: true, confidence: profile.confidence, evidenceCount: profile.interactionCount, active: profile.enabled });
  if (profile.avoidLiveRecordings) avoids.push({ key: "live", label: "Live recordings", learned: true, confidence: profile.confidence, evidenceCount: profile.interactionCount, active: profile.enabled });
  if (profile.avoidLowConfidenceMetadata) avoids.push({ key: "metadata", label: "Low-confidence metadata", learned: true, confidence: profile.confidence, evidenceCount: profile.interactionCount, active: profile.enabled });
  if (profile.avoidRecentlyPlayed) avoids.push({ key: "recent", label: "Recently used tracks", learned: true, confidence: profile.confidence, evidenceCount: profile.interactionCount, active: profile.enabled });
  return { prefers, avoids };
}

export async function getPersonalizationProfileSummary(userId: string) {
  const profile = await ensureRecommendationProfile(userId);
  const [interactionCount, recentSignals, playlistProfiles, adaptiveScoring] = await Promise.all([
    prisma.trackInteractionEvent.count({ where: { userId } }),
    prisma.trackInteractionEvent.findMany({
      where: { userId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 8,
      select: { id: true, eventType: true, eventSource: true, occurredAt: true, weight: true, track: { select: { title: true, artist: { select: { title: true } } } } },
    }),
    prisma.generatedPlaylist.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, plexPlaylistTitle: true, updatedAt: true, preferenceProfile: true, adaptiveScoringSetting: true },
    }),
    getAdaptiveScoringSettings(userId),
  ]);
  const summary = preferenceSummary(profile);
  return {
    profile: { ...profileSnapshot(profile), id: profile.id, profileVersion: profile.profileVersion, lastCalculatedAt: profile.lastCalculatedAt, updatedAt: profile.updatedAt },
    status: confidenceLabel(profile.confidenceState),
    confidencePercent: Math.round(profile.confidence * 100),
    interactionCount,
    summary,
    recentSignals,
    playlistProfiles: playlistProfiles.map((item) => item.preferenceProfile
      ? { ...playlistSnapshot(item.preferenceProfile), id: item.preferenceProfile.id, playlistId: item.id, name: item.preferenceProfile.name || item.plexPlaylistTitle, updatedAt: item.preferenceProfile.updatedAt, adaptiveInfluenceOverride: item.adaptiveScoringSetting?.maximumInfluenceOverride ?? null }
      : { id: null, playlistId: item.id, name: item.plexPlaylistTitle, enabled: true, mode: "GENERAL_PROFILE", source: "DEFAULT_USER", isLearned: false, confidence: 0, evidenceCount: 0, updatedAt: item.updatedAt, adaptiveInfluenceOverride: item.adaptiveScoringSetting?.maximumInfluenceOverride ?? null }),
    adaptiveScoring,
    privacy: "Adaptive Smart Mix scoring uses locally stored likes, dislikes, playlist history, artist preferences, and playlist identities to adjust track rankings. Your original Smart Mix score remains available, and you control how much personalization may influence the final result. No personalization data is sent to an external service.",
  };
}

function sanitizeContext(context: TrackInteractionContext | undefined, fallback: TrackInteractionContext) {
  const parsed = interactionContextSchema.parse({ ...fallback, ...(context || {}) });
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > MAX_CONTEXT_BYTES) throw new Error("Interaction context is too large");
  return parsed;
}

const eventWeights: Record<TrackInteractionType, number> = {
  TRACK_SELECTED: 1,
  TRACK_REJECTED: -1,
  TRACK_REMOVED: -1.25,
  TRACK_LOCKED: 1.75,
  TRACK_LIKED: 2,
  TRACK_DISLIKED: -2,
  TRACK_SKIPPED: -0.75,
  TRACK_REPLACED: -1.5,
  TRACK_ACCEPTED_FROM_PREVIEW: 1.5,
  TRACK_REJECTED_FROM_PREVIEW: -1.25,
  PLAYLIST_RESTORED: 0.5,
  MANUAL_TRACK_ADDITION: 1.25,
};

export async function recordTrackInteraction(input: {
  userId: string;
  trackId: string;
  playlistId?: string | null;
  playlistVersionId?: string | null;
  eventType: TrackInteractionType;
  eventSource: TrackInteractionSource;
  generationId?: string | null;
  idempotencyKey?: string | null;
  context?: TrackInteractionContext;
  occurredAt?: Date;
}) {
  if (!TRACK_INTERACTION_TYPES.includes(input.eventType) || !TRACK_INTERACTION_SOURCES.includes(input.eventSource)) throw new Error("Unsupported interaction event");
  const profile = await prisma.userRecommendationProfile.findUnique({ where: { userId: input.userId } });
  if (!profile?.enabled || !profile.learningEnabled) return { recorded: false, reason: "learning_disabled" as const };
  const [track, playlist] = await Promise.all([
    prisma.track.findFirst({
      where: { id: input.trackId, library: { server: { userId: input.userId } } },
      select: { id: true, isLive: true, effectiveBpm: true, bpm: true, bpmConfidence: true, artistId: true, audioFeature: { select: { effectiveEnergy: true, energy: true, audioFeatureConfidence: true, confidence: true } }, popularity: { select: { score: true, confidence: true } } },
    }),
    input.playlistId ? prisma.generatedPlaylist.findFirst({ where: { id: input.playlistId, userId: input.userId }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (!track) throw new Error("Track not found");
  if (input.playlistId && !playlist) throw new Error("Playlist not found");
  const rawConfidence = track.audioFeature?.audioFeatureConfidence ?? track.audioFeature?.confidence ?? track.bpmConfidence ?? track.popularity?.confidence;
  const fallbackContext = {
    energy: track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy ?? undefined,
    bpm: track.effectiveBpm ?? track.bpm ?? undefined,
    popularity: track.popularity?.score ?? undefined,
    metadataConfidence: rawConfidence == null ? undefined : rawConfidence > 1 ? rawConfidence / 100 : rawConfidence,
    isLive: track.isLive,
    artistId: track.artistId,
  };
  const context = sanitizeContext(input.context, fallbackContext);
  try {
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.trackInteractionEvent.create({
        data: {
          userId: input.userId,
          trackId: input.trackId,
          playlistId: input.playlistId || undefined,
          playlistVersionId: input.playlistVersionId || undefined,
          eventType: input.eventType,
          eventSource: input.eventSource,
          generationId: input.generationId || undefined,
          idempotencyKey: input.idempotencyKey || undefined,
          contextJson: context as Prisma.InputJsonValue,
          weight: eventWeights[input.eventType],
          occurredAt: input.occurredAt || new Date(),
        },
      });
      await tx.userRecommendationProfile.update({ where: { userId: input.userId }, data: { interactionCount: { increment: 1 } } });
      await tx.personalScoringAdjustment.updateMany({ where: { userId: input.userId, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
      return created;
    });
    await markAdaptiveScoringDirty(input.userId);
    invalidateDashboard(input.userId);
    return { recorded: true, eventId: event.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && input.idempotencyKey) return { recorded: false, reason: "duplicate" as const };
    throw error;
  }
}

export function recordTrackInteractionInBackground(input: Parameters<typeof recordTrackInteraction>[0]) {
  void recordTrackInteraction(input).catch((error) => {
    console.warn("[Personalization] interaction event was not recorded", { userId: input.userId, trackId: input.trackId, eventType: input.eventType, message: error instanceof Error ? error.message : "unknown error" });
  });
}

function recencyFactor(occurredAt: Date, now = Date.now()) {
  const ageDays = Math.max(0, now - occurredAt.getTime()) / 86_400_000;
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

function confidenceState(count: number, minimum: number): { state: PersonalizationConfidenceState; confidence: number } {
  if (count < minimum) return { state: "NOT_ENOUGH_DATA", confidence: Math.min(0.14, count / Math.max(1, minimum) * 0.14) };
  if (count < minimum * 2) return { state: "LEARNING", confidence: 0.2 + (count - minimum) / minimum * 0.2 };
  if (count < minimum * 5) return { state: "DEVELOPING", confidence: 0.4 + (count - minimum * 2) / (minimum * 3) * 0.35 };
  return { state: "ESTABLISHED", confidence: Math.min(0.95, 0.75 + Math.log10(count / (minimum * 5) + 1) * 0.2) };
}

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const denominator = values.reduce((sum, item) => sum + item.weight, 0);
  return denominator > 0 ? values.reduce((sum, item) => sum + item.value * item.weight, 0) / denominator : null;
}

export async function recalculatePersonalizationProfile(userId: string, trigger: "manual" | "system" = "manual") {
  const job = await safeStartJobHistory({ userId, type: "personalization", name: "Personalization profile rebuild", trigger });
  try {
    const profile = await ensureRecommendationProfile(userId);
    const totalEventCount = await prisma.trackInteractionEvent.count({ where: { userId } });
    const events: Array<{ id: string; weight: number; occurredAt: Date; contextJson: unknown }> = [];
    let cursor: string | undefined;
    while (events.length < MAX_PROFILE_EVENTS) {
      const batch = await prisma.trackInteractionEvent.findMany({
        where: { userId },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: Math.min(PROFILE_BATCH_SIZE, MAX_PROFILE_EVENTS - events.length),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, weight: true, occurredAt: true, contextJson: true },
      });
      events.push(...batch);
      if (batch.length < PROFILE_BATCH_SIZE) break;
      cursor = batch[batch.length - 1]?.id;
    }
    const evidence = confidenceState(totalEventCount, profile.minimumEventsRequired);
    const positiveEnergy: Array<{ value: number; weight: number }> = [];
    const positiveBpm: Array<{ value: number; weight: number }> = [];
    let positiveWeight = 0;
    let deepCutWeight = 0;
    let negativeWeight = 0;
    let negativeLiveWeight = 0;
    let negativeMetadataWeight = 0;
    const negativeArtistCounts = new Map<string, number>();
    for (const event of events) {
      const context = interactionContextSchema.safeParse(event.contextJson).success ? event.contextJson as TrackInteractionContext : {};
      const recency = recencyFactor(event.occurredAt);
      const magnitude = Math.abs(event.weight) * recency;
      if (event.weight > 0) {
        positiveWeight += magnitude;
        if (typeof context.energy === "number") positiveEnergy.push({ value: context.energy, weight: magnitude });
        if (typeof context.bpm === "number") positiveBpm.push({ value: context.bpm, weight: magnitude });
        if (typeof context.popularity === "number" && context.popularity <= 40) deepCutWeight += magnitude;
      } else if (event.weight < 0) {
        negativeWeight += magnitude;
        if (context.isLive) negativeLiveWeight += magnitude;
        if (context.metadataConfidence == null || context.metadataConfidence < 0.5) negativeMetadataWeight += magnitude;
        if (context.artistId) negativeArtistCounts.set(context.artistId, (negativeArtistCounts.get(context.artistId) || 0) + magnitude);
      }
    }
    const energy = weightedAverage(positiveEnergy);
    const bpm = weightedAverage(positiveBpm);
    const deepCutAffinity = positiveWeight ? deepCutWeight / positiveWeight : null;
    const artistRepeatEvidence = Array.from(negativeArtistCounts.values()).filter((count) => count >= 2).reduce((sum, count) => sum + count, 0);
    const enoughEvidence = totalEventCount >= profile.minimumEventsRequired;
    const learned = enoughEvidence ? {
      preferredEnergyMin: energy == null ? null : Math.max(0, energy - 0.15),
      preferredEnergyMax: energy == null ? null : Math.min(1, energy + 0.15),
      preferredBpmMin: bpm == null ? null : Math.max(20, bpm - 15),
      preferredBpmMax: bpm == null ? null : Math.min(300, bpm + 15),
      preferredDiscoveryLevel: deepCutAffinity,
      preferredDeepCutWeight: deepCutAffinity,
      preferredArtistVariety: negativeWeight && artistRepeatEvidence >= 3 ? Math.min(1, artistRepeatEvidence / negativeWeight) : null,
      avoidLiveRecordings: negativeWeight >= 3 && negativeLiveWeight / negativeWeight >= 0.25,
      avoidLowConfidenceMetadata: negativeWeight >= 3 && negativeMetadataWeight / negativeWeight >= 0.35,
      avoidRecentlyPlayed: positiveWeight + negativeWeight >= profile.minimumEventsRequired,
      avoidRecentlyUsedArtists: artistRepeatEvidence >= 3,
    } : {
      preferredEnergyMin: null, preferredEnergyMax: null, preferredBpmMin: null, preferredBpmMax: null,
      preferredDiscoveryLevel: null, preferredDeepCutWeight: null, preferredArtistVariety: null,
      avoidLiveRecordings: false, avoidLowConfidenceMetadata: false, avoidRecentlyPlayed: false, avoidRecentlyUsedArtists: false,
    };
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.userRecommendationProfile.update({
        where: { userId },
        data: { ...learned, interactionCount: totalEventCount, confidence: evidence.confidence, confidenceState: evidence.state, lastCalculatedAt: new Date() },
      });
      await tx.personalScoringAdjustment.deleteMany({ where: { userId } });
      const adjustments = [
        energy == null ? null : { featureType: "ENERGY_RANGE", featureKey: `${learned.preferredEnergyMin?.toFixed(2)}-${learned.preferredEnergyMax?.toFixed(2)}`, adjustment: 1.6 },
        learned.avoidLiveRecordings ? { featureType: "TRACK_TYPE", featureKey: "live", adjustment: -2.5 } : null,
        learned.avoidLowConfidenceMetadata ? { featureType: "METADATA_CONFIDENCE", featureKey: "low", adjustment: -2 } : null,
        deepCutAffinity != null && deepCutAffinity >= 0.55 ? { featureType: "DISCOVERY_LEVEL", featureKey: "deep-cut", adjustment: 1.25 } : null,
      ].filter((item): item is { featureType: string; featureKey: string; adjustment: number } => Boolean(item));
      if (adjustments.length) await tx.personalScoringAdjustment.createMany({ data: adjustments.map((item) => ({ ...item, userId, confidence: evidence.confidence, sampleSize: events.length })) });
      return { row, adjustmentCount: adjustments.length };
    });
    await safeFinishJobHistory({ job, status: "completed", counts: { attempted: events.length, processed: events.length }, summary: `Processed ${events.length} interaction events and updated ${updated.adjustmentCount} learned preferences. Confidence is ${confidenceLabel(evidence.state)}.` });
    invalidateDashboard(userId);
    return { profile: updated.row, processed: events.length, totalEvents: totalEventCount, preferenceCount: updated.adjustmentCount, truncated: totalEventCount > events.length };
  } catch (error) {
    await safeFinishJobHistory({ job, status: "failed", error, summary: "Personalization profile rebuild failed." });
    throw error;
  }
}

export async function getInteractionHistory(userId: string, input: { page?: number; pageSize?: number; eventType?: string } = {}) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize || 25));
  const where = { userId, ...(input.eventType && TRACK_INTERACTION_TYPES.includes(input.eventType as TrackInteractionType) ? { eventType: input.eventType } : {}) };
  const [items, total] = await Promise.all([
    prisma.trackInteractionEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, eventType: true, eventSource: true, playlistId: true, generationId: true, weight: true, occurredAt: true, track: { select: { id: true, title: true, artist: { select: { title: true } } } } },
    }),
    prisma.trackInteractionEvent.count({ where }),
  ]);
  return { items, page, pageSize, total, pageCount: Math.ceil(total / pageSize) };
}

export async function resetPersonalizationData(userId: string, mode: "learned" | "all") {
  const startedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const events = await tx.trackInteractionEvent.deleteMany({ where: { userId } });
    const adjustments = await tx.personalScoringAdjustment.deleteMany({ where: { userId } });
    const playlistProfiles = await tx.playlistPreferenceProfile.deleteMany({ where: { userId, ...(mode === "learned" ? { isLearned: true } : {}) } });
    const trackPreferences = mode === "all" ? await tx.userTrackPreference.deleteMany({ where: { userId } }) : { count: 0 };
    const artistPreferences = mode === "all" ? await tx.userArtistPreference.deleteMany({ where: { userId } }) : { count: 0 };
    const playlistFits = mode === "all" ? await tx.playlistFitFeedback.deleteMany({ where: { userId } }) : { count: 0 };
    const transitionFeedback = mode === "all" ? await tx.transitionFeedback.deleteMany({ where: { userId } }) : { count: 0 };
    const feedbackEvents = mode === "all" ? await tx.feedbackEvent.deleteMany({ where: { userId } }) : { count: 0 };
    if (mode === "all") {
      await tx.userRecommendationProfile.deleteMany({ where: { userId } });
      await tx.userRecommendationProfile.create({ data: { userId } });
    } else {
      await tx.userRecommendationProfile.upsert({
        where: { userId },
        create: { userId },
        update: {
          confidence: 0, confidenceState: "NOT_ENOUGH_DATA", interactionCount: 0, lastCalculatedAt: null,
          preferredEnergyMin: null, preferredEnergyMax: null, preferredBpmMin: null, preferredBpmMax: null,
          preferredDiscoveryLevel: null, preferredDeepCutWeight: null, preferredPopularityWeight: null,
          preferredMoodWeight: null, preferredEnergyWeight: null, preferredBpmWeight: null,
          preferredArtistVariety: null, preferredAlbumVariety: null, avoidRecentlyPlayed: false,
          avoidRecentlyUsedArtists: false, avoidLiveRecordings: false, avoidLowConfidenceMetadata: false,
          secondaryTraits: Prisma.DbNull,
        },
      });
    }
    return { events: events.count, adjustments: adjustments.count, playlistProfiles: playlistProfiles.count, trackPreferences: trackPreferences.count, artistPreferences: artistPreferences.count, playlistFits: playlistFits.count, transitionFeedback: transitionFeedback.count, feedbackEvents: feedbackEvents.count };
  });
  await resetAdaptiveScoring(userId, mode === "all" ? "all" : "inferred");
  await safeRecordJobHistory({ userId, type: "personalization", name: "Personalization data reset", status: "completed", trigger: "manual", startedAt, summary: `Removed ${result.events} interaction events and ${result.adjustments} derived adjustments.`, counts: { attempted: result.events + result.adjustments, processed: result.events + result.adjustments } });
  invalidateDashboard(userId);
  return { mode, ...result };
}

export async function getPlaylistPreferenceProfile(userId: string, playlistId: string) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, select: { id: true, plexPlaylistTitle: true } });
  if (!playlist) throw new Error("Generated playlist not found");
  const profile = await prisma.playlistPreferenceProfile.findUnique({ where: { playlistId } });
  return { playlist, profile: profile ? { ...playlistSnapshot(profile), id: profile.id, playlistId: profile.playlistId, name: profile.name, updatedAt: profile.updatedAt } : null, effectiveMode: profile?.mode || "GENERAL_PROFILE" };
}

export async function updatePlaylistPreferenceProfile(userId: string, playlistId: string, input: unknown) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, select: { id: true } });
  if (!playlist) throw new Error("Generated playlist not found");
  const value = playlistPreferenceSchema.parse(input);
  const data = { ...value, isLearned: value.source === "LEARNED" };
  return prisma.playlistPreferenceProfile.upsert({ where: { playlistId }, create: { playlistId, userId, ...data }, update: data });
}

export async function resetPlaylistLearnedProfile(userId: string, playlistId: string) {
  const result = await prisma.playlistPreferenceProfile.deleteMany({ where: { playlistId, userId, isLearned: true } });
  const adaptive = await resetAdaptiveScoring(userId, "inferred", playlistId);
  return { reset: result.count > 0 || adaptive.statisticsRemoved > 0, adaptive };
}

export async function loadPersonalizationScoringContext(userId: string, playlistId?: string | null): Promise<PersonalizationScoringContext | undefined> {
  try {
    const profile = await prisma.userRecommendationProfile.findUnique({ where: { userId } });
    if (!profile?.enabled) return undefined;
    const [playlistProfile, recentEvents] = await Promise.all([
      playlistId ? prisma.playlistPreferenceProfile.findFirst({ where: { playlistId, userId } }) : Promise.resolve(null),
      prisma.trackInteractionEvent.findMany({
        where: { userId, occurredAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, weight: { gt: 0 } },
        orderBy: { occurredAt: "desc" },
        take: 250,
        select: { trackId: true, contextJson: true },
      }),
    ]);
    return {
      profile: profileSnapshot(profile),
      playlistProfile: playlistProfile ? playlistSnapshot(playlistProfile) : null,
      recentlyUsedTrackIds: Array.from(new Set(recentEvents.map((event) => event.trackId))),
      recentlyUsedArtistIds: Array.from(new Set(recentEvents.map((event) => (event.contextJson as any)?.artistId).filter(Boolean))),
      maxAdjustment: 8,
    };
  } catch (error) {
    console.warn("[Personalization] profile loading failed; global scoring will be used", { userId, message: error instanceof Error ? error.message : "unknown error" });
    return undefined;
  }
}

export async function getPersonalizationDiagnostics() {
  const [orphanProfiles, orphanEvents, invalidAdjustments] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "UserRecommendationProfile" p LEFT JOIN "User" u ON u.id = p."userId" WHERE u.id IS NULL`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "TrackInteractionEvent" e LEFT JOIN "Track" t ON t.id = e."trackId" WHERE t.id IS NULL`,
    prisma.personalScoringAdjustment.count({ where: { OR: [{ adjustment: { gt: 8 } }, { adjustment: { lt: -8 } }, { confidence: { gt: 1 } }, { confidence: { lt: 0 } }] } }),
  ]);
  return { available: true, orphanProfiles: Number(orphanProfiles[0]?.count || 0), orphanEvents: Number(orphanEvents[0]?.count || 0), invalidAdjustments };
}
