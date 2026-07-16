import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { safeFinishJobHistory, safeStartJobHistory } from "../jobHistory";
import type { PersonalizationScoringContext } from "../personalization/types";
import type { PlaylistIdentityScoringContext } from "../playlistIdentity/types";
import {
  ADAPTIVE_COMPONENT_KEYS,
  ADAPTIVE_SCORING_VERSION,
  type AdaptiveComponentKey,
  type AdaptiveScoringContext,
  type AdaptiveScoringSettings,
} from "./types";

const MAX_EVENTS = 20_000;
const EVENT_BATCH = 500;
const HALF_LIFE_DAYS = 120;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

export const DEFAULT_ADAPTIVE_SCORING_SETTINGS: AdaptiveScoringSettings = {
  enabled: true,
  preset: "balanced",
  maximumInfluence: 0.5,
  showExplanationsByDefault: false,
  includeInferredBehavior: true,
  includePlaylistHistory: true,
  includePlaylistIdentity: true,
  includeArtistPreferences: true,
  includeMoodPreferences: true,
  includeDiscoveryTolerance: true,
  includeRepeatTolerance: true,
  minimumConfidence: "low",
  preferExplicitFeedback: true,
  reduceOldFeedback: true,
  positiveAdjustmentLimit: 10,
  negativeAdjustmentLimit: 10,
  componentWeights: Object.fromEntries(ADAPTIVE_COMPONENT_KEYS.map((key) => [key, 1])) as Record<AdaptiveComponentKey, number>,
};

export const ADAPTIVE_PRESETS = {
  off: { enabled: false, maximumInfluence: 0, includeInferredBehavior: false, minimumConfidence: "high" },
  light: { enabled: true, maximumInfluence: 0.25, includeInferredBehavior: false, minimumConfidence: "medium", positiveAdjustmentLimit: 5, negativeAdjustmentLimit: 5 },
  balanced: {
    enabled: true, maximumInfluence: 0.5, includeInferredBehavior: true, includePlaylistHistory: true,
    includePlaylistIdentity: true, includeArtistPreferences: true, includeMoodPreferences: true,
    includeDiscoveryTolerance: true, includeRepeatTolerance: true, minimumConfidence: "low",
    preferExplicitFeedback: true, reduceOldFeedback: true, positiveAdjustmentLimit: 10, negativeAdjustmentLimit: 10,
  },
  strong: { enabled: true, maximumInfluence: 0.75, includeInferredBehavior: true, minimumConfidence: "low", positiveAdjustmentLimit: 15, negativeAdjustmentLimit: 15 },
  maximum: { enabled: true, maximumInfluence: 1, includeInferredBehavior: true, minimumConfidence: "very_low", positiveAdjustmentLimit: 20, negativeAdjustmentLimit: 20 },
} as const;

const componentWeightShape = Object.fromEntries(
  ADAPTIVE_COMPONENT_KEYS.map((key) => [key, z.coerce.number().min(0).max(2)]),
) as Record<AdaptiveComponentKey, z.ZodNumber>;

export const adaptiveScoringSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  preset: z.enum(["off", "light", "balanced", "strong", "maximum", "custom"]).optional(),
  maximumInfluence: z.coerce.number().min(0).max(1).optional(),
  showExplanationsByDefault: z.boolean().optional(),
  includeInferredBehavior: z.boolean().optional(),
  includePlaylistHistory: z.boolean().optional(),
  includePlaylistIdentity: z.boolean().optional(),
  includeArtistPreferences: z.boolean().optional(),
  includeMoodPreferences: z.boolean().optional(),
  includeDiscoveryTolerance: z.boolean().optional(),
  includeRepeatTolerance: z.boolean().optional(),
  minimumConfidence: z.enum(["very_low", "low", "medium", "high"]).optional(),
  preferExplicitFeedback: z.boolean().optional(),
  reduceOldFeedback: z.boolean().optional(),
  positiveAdjustmentLimit: z.coerce.number().min(0).max(20).optional(),
  negativeAdjustmentLimit: z.coerce.number().min(0).max(20).optional(),
  componentWeights: z.object(componentWeightShape).partial().optional(),
  playlistId: z.string().uuid().nullable().optional(),
  playlistInfluenceOverride: z.coerce.number().min(0).max(1).nullable().optional(),
});

function rowSettings(row: any): AdaptiveScoringSettings {
  const weights = row.componentWeightsJson && typeof row.componentWeightsJson === "object" ? row.componentWeightsJson : {};
  return {
    enabled: row.enabled,
    preset: row.preset,
    maximumInfluence: row.maximumInfluence,
    showExplanationsByDefault: row.showExplanationsByDefault,
    includeInferredBehavior: row.includeInferredBehavior,
    includePlaylistHistory: row.includePlaylistHistory,
    includePlaylistIdentity: row.includePlaylistIdentity,
    includeArtistPreferences: row.includeArtistPreferences,
    includeMoodPreferences: row.includeMoodPreferences,
    includeDiscoveryTolerance: row.includeDiscoveryTolerance,
    includeRepeatTolerance: row.includeRepeatTolerance,
    minimumConfidence: row.minimumConfidence,
    preferExplicitFeedback: row.preferExplicitFeedback,
    reduceOldFeedback: row.reduceOldFeedback,
    positiveAdjustmentLimit: row.positiveAdjustmentLimit,
    negativeAdjustmentLimit: row.negativeAdjustmentLimit,
    componentWeights: { ...DEFAULT_ADAPTIVE_SCORING_SETTINGS.componentWeights, ...weights },
  };
}

export async function ensureAdaptiveScoringProfile(userId: string) {
  return prisma.adaptiveScoringProfile.upsert({
    where: { userId },
    create: { userId, componentWeightsJson: json(DEFAULT_ADAPTIVE_SCORING_SETTINGS.componentWeights) },
    update: {},
  });
}

export async function getAdaptiveScoringSettings(userId: string, playlistId?: string | null) {
  const [profile, playlistSetting] = await Promise.all([
    ensureAdaptiveScoringProfile(userId),
    playlistId ? prisma.adaptivePlaylistScoringSetting.findFirst({ where: { userId, playlistId } }) : Promise.resolve(null),
  ]);
  const settings = rowSettings(profile);
  if (playlistSetting?.maximumInfluenceOverride != null) settings.maximumInfluence = playlistSetting.maximumInfluenceOverride;
  if (playlistSetting?.enabledOverride != null) settings.enabled = playlistSetting.enabledOverride;
  return {
    settings,
    profile: {
      id: profile.id,
      lastRecalculatedAt: profile.lastRecalculatedAt,
      needsRecalculation: profile.needsRecalculation,
      scoringVersion: profile.scoringVersion,
      observationCount: profile.observationCount,
      statisticCount: profile.statisticCount,
    },
    playlistOverride: playlistSetting,
    presets: ADAPTIVE_PRESETS,
  };
}

export async function updateAdaptiveScoringSettings(userId: string, raw: unknown) {
  const value = adaptiveScoringSettingsSchema.parse(raw);
  const profile = await ensureAdaptiveScoringProfile(userId);
  const preset = value.preset && value.preset !== "custom" ? ADAPTIVE_PRESETS[value.preset] : {};
  const data: Record<string, unknown> = {
    ...preset,
    preset: value.preset || "custom",
  };
  const explicitUpdates = {
    enabled: value.enabled,
    maximumInfluence: value.maximumInfluence,
    showExplanationsByDefault: value.showExplanationsByDefault,
    includeInferredBehavior: value.includeInferredBehavior,
    includePlaylistHistory: value.includePlaylistHistory,
    includePlaylistIdentity: value.includePlaylistIdentity,
    includeArtistPreferences: value.includeArtistPreferences,
    includeMoodPreferences: value.includeMoodPreferences,
    includeDiscoveryTolerance: value.includeDiscoveryTolerance,
    includeRepeatTolerance: value.includeRepeatTolerance,
    minimumConfidence: value.minimumConfidence,
    preferExplicitFeedback: value.preferExplicitFeedback,
    reduceOldFeedback: value.reduceOldFeedback,
    positiveAdjustmentLimit: value.positiveAdjustmentLimit,
    negativeAdjustmentLimit: value.negativeAdjustmentLimit,
  };
  for (const [key, item] of Object.entries(explicitUpdates)) if (item !== undefined) data[key] = item;
  if (value.preset === "balanced") data.componentWeightsJson = json(DEFAULT_ADAPTIVE_SCORING_SETTINGS.componentWeights);
  else if (value.componentWeights) data.componentWeightsJson = json({ ...((profile.componentWeightsJson || {}) as any), ...value.componentWeights });
  await prisma.adaptiveScoringProfile.update({ where: { userId }, data });
  if (value.playlistId) {
    const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: value.playlistId, userId }, select: { id: true } });
    if (!playlist) throw new Error("Playlist not found");
    await prisma.adaptivePlaylistScoringSetting.upsert({
      where: { playlistId: value.playlistId },
      create: { userId, playlistId: value.playlistId, maximumInfluenceOverride: value.playlistInfluenceOverride },
      update: { maximumInfluenceOverride: value.playlistInfluenceOverride },
    });
  }
  return getAdaptiveScoringSettings(userId, value.playlistId);
}

export async function markAdaptiveScoringDirty(userId: string) {
  await prisma.adaptiveScoringProfile.upsert({
    where: { userId },
    create: { userId, needsRecalculation: true, componentWeightsJson: json(DEFAULT_ADAPTIVE_SCORING_SETTINGS.componentWeights) },
    update: { needsRecalculation: true },
  });
}

function recencyFactor(date: Date) {
  const days = Math.max(0, Date.now() - date.getTime()) / 86_400_000;
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

function statisticConfidence(positive: number, negative: number, count: number, explicitCount: number) {
  if (!count) return 0;
  const consistency = Math.max(positive, negative) / Math.max(0.001, positive + negative);
  const evidence = Math.min(1, Math.log1p(count) / Math.log(21));
  return clamp(evidence * (0.45 + consistency * 0.55) + Math.min(0.25, explicitCount * 0.08), 0, 1);
}

export async function recalculateAdaptiveScoringProfile(userId: string, trigger: "manual" | "system" = "manual") {
  const job = await safeStartJobHistory({ userId, type: "adaptive_scoring", name: "Adaptive scoring profile recalculation", trigger });
  try {
    const adaptiveProfile = await ensureAdaptiveScoringProfile(userId);
    const rows: any[] = [];
    let cursor: string | undefined;
    while (rows.length < MAX_EVENTS) {
      const batch = await prisma.trackInteractionEvent.findMany({
        where: { userId },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: Math.min(EVENT_BATCH, MAX_EVENTS - rows.length),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          track: {
            select: {
              id: true,
              artistId: true,
              tags: { select: { type: true, name: true } },
              artist: { select: { tags: { select: { type: true, name: true } } } },
              popularity: { select: { score: true } },
            },
          },
        },
      });
      rows.push(...batch);
      if (batch.length < EVENT_BATCH) break;
      cursor = batch.at(-1)?.id;
    }

    type Aggregate = {
      userId: string;
      playlistId: string | null;
      scopeKey: string;
      dimension: string;
      featureKey: string;
      positiveWeight: number;
      negativeWeight: number;
      observationCount: number;
      explicitCount: number;
      lastObservedAt: Date;
      sourceSummaryJson: Prisma.InputJsonValue;
    };
    const aggregates = new Map<string, Aggregate>();
    const add = (event: any, playlistId: string | null, dimension: string, featureKey: string) => {
      if (!featureKey) return;
      const scopeKey = playlistId ? `playlist:${playlistId}` : "global";
      const key = `${scopeKey}:${dimension}:${featureKey}`;
      const current = aggregates.get(key) || {
        userId,
        playlistId,
        scopeKey,
        dimension,
        featureKey,
        positiveWeight: 0,
        negativeWeight: 0,
        observationCount: 0,
        explicitCount: 0,
        lastObservedAt: event.occurredAt,
        sourceSummaryJson: {},
      };
      const weight = Math.abs(event.weight) * (adaptiveProfile.reduceOldFeedback ? recencyFactor(event.occurredAt) : 1);
      if (event.weight >= 0) current.positiveWeight += weight;
      else current.negativeWeight += weight;
      current.observationCount += 1;
      if (["MANUAL_ACTION", "PLAYLIST_EDITOR", "REGENERATION_PREVIEW"].includes(event.eventSource)) current.explicitCount += 1;
      if (event.occurredAt > current.lastObservedAt) current.lastObservedAt = event.occurredAt;
      current.sourceSummaryJson = { latestEventType: event.eventType, latestEventSource: event.eventSource };
      aggregates.set(key, current);
    };

    for (const event of rows) {
      const scopes = [null, ...(event.playlistId ? [event.playlistId] : [])];
      const tags = [...(event.track.tags || []), ...(event.track.artist?.tags || [])];
      for (const scope of scopes) {
        add(event, scope, "track", event.trackId);
        add(event, scope, "artist", event.track.artistId);
        for (const tag of tags.filter((item: any) => String(item.type).toLowerCase() === "mood")) {
          add(event, scope, "mood", String(tag.name).trim().toLowerCase());
        }
        for (const tag of tags.filter((item: any) => ["genre", "style", "subgenre"].includes(String(item.type).toLowerCase()))) {
          add(event, scope, "genre", String(tag.name).trim().toLowerCase());
        }
        const popularity = event.track.popularity?.score;
        if (typeof popularity === "number") add(event, scope, "discovery", popularity <= 40 ? "deep-cut" : popularity >= 70 ? "familiar" : "balanced");
      }
    }

    const data = Array.from(aggregates.values()).map((item) => ({
      ...item,
      positiveWeight: round(item.positiveWeight),
      negativeWeight: round(item.negativeWeight),
      confidence: statisticConfidence(item.positiveWeight, item.negativeWeight, item.observationCount, item.explicitCount),
    }));
    await prisma.$transaction(async (tx) => {
      await tx.adaptivePreferenceStatistic.deleteMany({ where: { userId } });
      for (let index = 0; index < data.length; index += 500) {
        await tx.adaptivePreferenceStatistic.createMany({ data: data.slice(index, index + 500) });
      }
      await tx.adaptiveScoringProfile.update({
        where: { userId },
        data: {
          lastRecalculatedAt: new Date(),
          needsRecalculation: false,
          observationCount: rows.length,
          statisticCount: data.length,
          scoringVersion: ADAPTIVE_SCORING_VERSION,
        },
      });
    });
    await safeFinishJobHistory({
      job,
      status: "completed",
      counts: { attempted: rows.length, processed: rows.length },
      summary: `Processed ${rows.length} feedback and history events and updated ${data.length} adaptive statistics.`,
    });
    console.info("[AdaptiveScoring] profile recalculated", { userId, eventsProcessed: rows.length, statisticsUpdated: data.length, scoringVersion: ADAPTIVE_SCORING_VERSION });
    return { eventsProcessed: rows.length, statisticsUpdated: data.length, truncated: rows.length >= MAX_EVENTS };
  } catch (error) {
    await safeFinishJobHistory({ job, status: "failed", error, summary: "Adaptive scoring profile recalculation failed." });
    throw error;
  }
}

export async function loadAdaptiveScoringContext(input: {
  userId: string;
  playlistId?: string | null;
  personalization?: PersonalizationScoringContext;
  playlistIdentity?: PlaylistIdentityScoringContext;
}): Promise<AdaptiveScoringContext | undefined> {
  try {
    const { settings, profile } = await getAdaptiveScoringSettings(input.userId, input.playlistId);
    if (!input.personalization?.profile.enabled) settings.enabled = false;
    const statistics = settings.includeInferredBehavior
      ? await prisma.adaptivePreferenceStatistic.findMany({
          where: {
            userId: input.userId,
            OR: [{ playlistId: null }, ...(input.playlistId ? [{ playlistId: input.playlistId }] : [])],
          },
          orderBy: [{ playlistId: "desc" }, { confidence: "desc" }],
          take: 10_000,
        })
      : [];
    return {
      settings,
      personalization: input.personalization,
      playlistIdentity: input.playlistIdentity,
      statistics: Object.fromEntries(statistics.map((row) => [`${row.playlistId || "global"}:${row.dimension}:${row.featureKey}`, row])),
      playlistId: input.playlistId,
      modelVersion: profile.scoringVersion || ADAPTIVE_SCORING_VERSION,
    };
  } catch (error) {
    console.warn("[AdaptiveScoring] context loading failed; base scoring will be used", {
      userId: input.userId,
      playlistId: input.playlistId,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return undefined;
  }
}

export async function previewAdaptiveReset(userId: string, scope: string, playlistId?: string | null) {
  const [statistics, overrides] = await Promise.all([
    prisma.adaptivePreferenceStatistic.count({ where: { userId, ...(playlistId ? { playlistId } : {}) } }),
    playlistId
      ? prisma.adaptivePlaylistScoringSetting.count({ where: { userId, playlistId } })
      : prisma.adaptivePlaylistScoringSetting.count({ where: { userId } }),
  ]);
  return {
    scope,
    playlistId: playlistId || null,
    statistics,
    playlistOverrides: overrides,
    preservesExplicitFeedback: scope !== "all",
    preservesPlaylistIdentity: true,
    preservesPlaylistHistory: true,
  };
}

export async function resetAdaptiveScoring(userId: string, scope: string, playlistId?: string | null) {
  return prisma.$transaction(async (tx) => {
    const statistics = await tx.adaptivePreferenceStatistic.deleteMany({ where: { userId, ...(playlistId ? { playlistId } : {}) } });
    if (playlistId) await tx.adaptivePlaylistScoringSetting.deleteMany({ where: { userId, playlistId } });
    if (scope === "settings" || scope === "all") {
      await tx.adaptiveScoringProfile.deleteMany({ where: { userId } });
      await tx.adaptiveScoringProfile.create({ data: { userId, componentWeightsJson: json(DEFAULT_ADAPTIVE_SCORING_SETTINGS.componentWeights) } });
    } else {
      await tx.adaptiveScoringProfile.update({
        where: { userId },
        data: { needsRecalculation: true, lastRecalculatedAt: null, observationCount: 0, statisticCount: 0 },
      });
    }
    return { scope, playlistId: playlistId || null, statisticsRemoved: statistics.count };
  });
}
