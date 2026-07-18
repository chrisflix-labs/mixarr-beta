import axios from "axios";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { metadataCorrectionRelations, resolveEffectiveTrackMetadata } from "./metadataCorrections";
import { effectiveBpmTrackWhere, getBpmDisplayMetadata } from "./bpm";
import { audioFeatureFilterGuardWhere, type AudioFeatureFilterOptions } from "./audioFeatures";
import { getMoodEnergyDisplayMetadata } from "./moodEnergy";
import { activeSyncStatusWhere } from "./syncStatus";
import { getUserSyncSettings } from "./syncSettings";
import { safeFinishJobHistory, safeRecordJobHistory, safeStartJobHistory } from "./jobHistory";
import { recordPlaylistHistoryEntry } from "./playlistHistory";
import { filterManualTrackExclusions, getManualTrackExclusionIds } from "./trackExclusions";
import { scorePlaylist, type PlaylistScoreSummary } from "./playlistScoring";
import { resolveScoringModel, STABLE_SCORING_MODEL_ID } from "./scoringModels";
import { getBetaStatus, getFeatureState, recordBetaUsage } from "./featureFlagService";
import { loadExplicitFeedbackScoringContext, loadPersonalizationScoringContext, recordTrackInteractionInBackground } from "./personalization";
import { ensurePlaylistIdentity, loadPlaylistIdentityScoringContext, recordPlaylistIdentityEvent, rememberPlaylistRejection, trainPlaylistIdentity, updatePlaylistTrackMemory } from "./playlistIdentity";
import { loadAdaptiveScoringContext } from "./adaptiveScoring";
import { loadPlaybackScoringContext } from "./playbackAwareness";
import { contextSelectionSchema } from "./contextualMixes";
import { createPlaylistRelationship, loadCoordinationScoringContext, updateCoordinationSettings } from "./playlistCoordination";
import { buildDecisionExplanation, buildGenerationInsights, type TraceableSmartMixTrack } from "./smartMixExplanations/collector";
import { attachGenerationExplanationsToPlaylist, getExplanationPreference, persistGenerationExplanations } from "./smartMixExplanations/service";
import {
  runSmartMixEngineV2,
  runSmartMixEngineV2Async,
  smartMixEngineLabel,
  SMART_MIX_ENGINE_V1,
  SMART_MIX_ENGINE_V2,
  DEFAULT_SMART_MIX_TUNING,
  normalizeSmartMixTuningConfig,
  SMART_MIX_RECENTLY_USED_WINDOW_DAYS,
  moodBlendModeLabel,
  normalizeMoodBlendConfig,
  summarizeMoodBlend,
  type SmartMixEngineVersion,
  scoreDiscoveryCandidatePool,
  summarizeDiscovery,
  analyzePlaylistWeakness,
  regeneratePlaylist,
  playlistRegenerationRequestSchema,
  REGENERATION_ENGINE_VERSION,
  type PlaylistRegenerationRequest,
  type PlaylistTrackState,
  type SmartMixEngineV2Config,
  type SmartMixEngineV2RunInput,
  scoreSmartMixTrack,
} from "./smartMixEngine/v2";
import {
  playlistExportDurationSeconds,
  playlistExportsTotal,
  playlistGenerationDurationSeconds,
  playlistGenerationsTotal,
  playlistRefreshDurationSeconds,
  playlistRefreshesTotal,
} from "./metrics";
import type { PlaylistGenerationControl } from "./playlistGenerationControl";
import { PLAYLIST_GENERATION_LIMITS } from "./playlistGenerationLimits";
import { chunkValues, queryInBatches } from "./databaseBatching";

const numericFields = ["popularity", "energy", "valence", "tempo", "year", "duration", "rating", "playCount"] as const;
const booleanFields = ["isLive", "isRemaster", "isExplicit", "hasPopularity"] as const;
const fields = ["popularity", "energy", "valence", "tempo", "year", "duration", "rating", "playCount", "isLive", "isRemaster", "isExplicit", "hasPopularity", "genre", "title", "artist", "album"] as const;
const operators = ["eq", "contains", "not_contains", "gt", "lt", "gte", "lte"] as const;
const combinators = ["AND", "OR"] as const;
const duplicateStrategies = ["allow", "song_artist", "avoid_recordings", "allow_alternate_copies", "prefer_highest_quality", "prefer_existing_playlist_copy"] as const;
const smartMixEngineVersions = [SMART_MIX_ENGINE_V1, SMART_MIX_ENGINE_V2] as const;
const moodBlendModes = ["off", "smooth_transition", "strict_matching", "mixed_mood"] as const;
const v2SoftMetadataFilterFields = new Set<string>(["popularity", "energy", "valence", "tempo"]);

const maxPlaylistSize = Math.min(Number(process.env.MAX_PLAYLIST_SIZE || 5000), PLAYLIST_GENERATION_LIMITS.maxTracks);
const supportedRegenerationModes = ["replace_all", "keep_some"] as const;
const supportedKeepPercents = [25, 50] as const;
const moodBlendSliderSchema = z.coerce.number().int().min(0).max(100);

export type RegenerationMode = typeof supportedRegenerationModes[number];
export type RegenerationKeepPercent = typeof supportedKeepPercents[number];

export const playlistSafetyRulesSchema = z.object({
  avoidSameArtistBackToBack: z.boolean().default(true),
  limitTracksPerArtist: z.boolean().default(false),
  maxTracksPerArtist: z.coerce.number().int().min(1).max(maxPlaylistSize).default(3),
  limitTracksPerAlbum: z.boolean().default(false),
  maxTracksPerAlbum: z.coerce.number().int().min(1).max(maxPlaylistSize).default(2),
  warnIfFewerThan: z.boolean().default(true),
  minimumTrackCount: z.coerce.number().int().min(1).max(maxPlaylistSize).default(10),
}).default({});

export const playlistRuleSchema = z.object({
  type: z.literal("rule").optional(),
  field: z.enum(fields),
  operator: z.enum(operators),
  value: z.string().trim().min(1).max(200),
});

type RuleNode = z.infer<typeof playlistRuleSchema> | {
  type: "group";
  combinator: "AND" | "OR";
  children: RuleNode[];
};

let ruleNodeSchema: z.ZodType<RuleNode>;
ruleNodeSchema = z.lazy(() => z.union([
  playlistRuleSchema,
  z.object({
    type: z.literal("group"),
    combinator: z.enum(combinators),
    children: z.array(ruleNodeSchema).min(1).max(25),
  }),
]));
export const playlistRuleNodeSchema = ruleNodeSchema;

export const negativeFiltersSchema = z.object({
  excludeHoliday: z.boolean().default(false),
  excludeLive: z.boolean().default(false),
  excludeRemasters: z.boolean().default(false),
  excludeExplicit: z.boolean().default(false),
  excludeIntroOutro: z.boolean().default(false),
  minRating: z.coerce.number().min(0).max(10).optional().nullable(),
  excludePlayedWithinDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  minDurationMinutes: z.coerce.number().min(0).max(120).optional().nullable(),
  maxDurationMinutes: z.coerce.number().min(0).max(120).optional().nullable(),
}).default({});

export const playlistOptionsSchema = z.object({
  duplicateStrategy: z.enum(duplicateStrategies).default("song_artist"),
  preferNonLive: z.boolean().default(true),
  excludeRemasters: z.boolean().default(false),
  negativeFilters: negativeFiltersSchema,
  safetyRules: playlistSafetyRulesSchema,
});

export const playlistConfigSchema = z.object({
  rules: z.array(playlistRuleSchema).max(25).default([]),
  ruleTree: playlistRuleNodeSchema.optional(),
  limit: z.preprocess(
    (value) => Number(value) === 0 ? 100 : value,
    z.coerce.number().int().min(1).max(maxPlaylistSize).default(100),
  ),
  serverId: z.string().optional().nullable(),
  libraryId: z.string().optional().nullable(),
  pinnedTrackIds: z.array(z.string()).max(maxPlaylistSize).default([]),
  excludedTrackIds: z.array(z.string()).max(maxPlaylistSize).default([]),
  smartPresetId: z.string().trim().max(80).optional(),
  smartPresetName: z.string().trim().max(120).optional(),
  smartPresetVersion: z.string().trim().max(40).optional(),
  moodPresetId: z.string().trim().max(80).optional(),
  moodPresetName: z.string().trim().max(120).optional(),
  moodPresetVersion: z.string().trim().max(40).optional(),
  moodPresetModified: z.boolean().default(false),
  bpmPresetId: z.string().trim().max(80).optional(),
  bpmPresetName: z.string().trim().max(120).optional(),
  bpmPresetVersion: z.string().trim().max(40).optional(),
  bpmPresetModified: z.boolean().default(false),
  tuningConfig: z.unknown().optional().transform((value) => normalizeSmartMixTuningConfig(value ?? DEFAULT_SMART_MIX_TUNING)),
  moodBlendMode: z.enum(moodBlendModes).default("off"),
  selectedMoodPath: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  allowedMoods: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  moodStrength: moodBlendSliderSchema.default(65),
  transitionSmoothness: moodBlendSliderSchema.default(70),
  moodStrictness: moodBlendSliderSchema.default(60),
  fallbackTolerance: moodBlendSliderSchema.default(35),
  bridgeTrackPreference: moodBlendSliderSchema.default(60),
  moodVariety: moodBlendSliderSchema.default(45),
  conflictSensitivity: moodBlendSliderSchema.default(70),
  selectedMoodPreset: z.string().trim().max(80).default("balanced_flow"),
  contextSelection: contextSelectionSchema.optional().nullable(),
  engineVersion: z.enum(smartMixEngineVersions).default(SMART_MIX_ENGINE_V1),
  scoringModel: z.string().trim().min(1).max(80).optional(),
  allowStableFallback: z.boolean().optional(),
  coordinationSetup: z.object({
    enabled: z.boolean().default(false),
    relationshipType: z.enum(["SISTER", "RELATED", "DISTINCT_FROM"]).default("SISTER"),
    relatedPlaylistIds: z.array(z.string().uuid()).max(20).default([]),
    maximumSharedTrackPercentage: z.coerce.number().min(0).max(100).default(20),
    overlapEnforcement: z.enum(["OFF", "WARNING_ONLY", "SOFT_TARGET", "HARD_MAXIMUM"]).default("SOFT_TARGET"),
    allowSharedCoreTracks: z.boolean().default(false),
    preferGloballyUnusedTracks: z.boolean().default(false),
    unusedTrackPreferenceStrength: z.coerce.number().min(0).max(1).default(0.5),
    crossPlaylistArtistBalancingEnabled: z.boolean().default(true),
    keepDistinct: z.boolean().default(false),
  }).optional(),
}).merge(playlistOptionsSchema);

export const savedPlaylistSchema = playlistConfigSchema.extend({
  name: z.string().trim().min(1).max(120),
  autoRefresh: z.boolean().default(false),
});

export type PlaylistRuleInput = z.infer<typeof playlistRuleSchema>;
export type PlaylistConfigInput = z.infer<typeof playlistConfigSchema>;
export type PreviewMessageSeverity = "info" | "warning" | "error";
export type PlaylistPreviewMessage = {
  severity: PreviewMessageSeverity;
  message: string;
};

const previewDisplayLimit = Number(process.env.PLAYLIST_PREVIEW_DISPLAY_LIMIT || 100);

const isNumericField = (field: string) => numericFields.includes(field as any);
const isBooleanField = (field: string) => booleanFields.includes(field as any);

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/\([^)]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^)]*\)/gi, "")
    .replace(/\[[^\]]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^\]]*\]/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readableRule(rule: PlaylistRuleInput) {
  const field = rule.field === "playCount" ? "play count" : rule.field;
  const operatorMap: Record<string, string> = {
    eq: "is",
    contains: "contains",
    not_contains: "does not contain",
    gt: ">",
    lt: "<",
    gte: ">=",
    lte: "<=",
  };
  return `${field} ${operatorMap[rule.operator] || rule.operator} ${rule.value}`;
}

function collectRuleReasons(node: RuleNode | undefined, fallbackRules: PlaylistRuleInput[]): string[] {
  if (!node) return fallbackRules.map(readableRule);
  if (node.type !== "group") return [readableRule(node)];
  const childReasons = node.children.reduce<string[]>((reasons, child) => reasons.concat(collectRuleReasons(child, [])), []);
  return childReasons.length ? [`${node.combinator}: ${childReasons.join("; ")}`] : [];
}

function collectRules(node: RuleNode | undefined, fallbackRules: PlaylistRuleInput[]): PlaylistRuleInput[] {
  if (!node) return fallbackRules;
  if (node.type !== "group") return [node];
  return node.children.reduce<PlaylistRuleInput[]>((rules, child) => rules.concat(collectRules(child, [])), []);
}

function buildRuleCondition(
  rule: PlaylistRuleInput,
  audioFeatureFilterOptions: AudioFeatureFilterOptions = {},
  softMetadataFilters = false,
) {
  const { field, operator, value } = rule;
  if (softMetadataFilters && v2SoftMetadataFilterFields.has(field)) {
    return null;
  }

  let prismaCondition: any;

  if (isNumericField(field)) {
    const numValue = Number(value);
    if (!Number.isFinite(numValue)) {
      throw new Error(`Invalid numeric value for ${field}`);
    }

    if (operator === "eq" || operator === "contains" || operator === "not_contains") prismaCondition = numValue;
    else if (operator === "gt") prismaCondition = { gt: numValue };
    else if (operator === "lt") prismaCondition = { lt: numValue };
    else if (operator === "gte") prismaCondition = { gte: numValue };
    else if (operator === "lte") prismaCondition = { lte: numValue };
  } else if (isBooleanField(field)) {
    prismaCondition = ["true", "1", "yes"].includes(value.toLowerCase());
  } else {
    if (operator === "eq") prismaCondition = value;
    else if (operator === "contains" || operator === "not_contains") prismaCondition = { contains: value, mode: "insensitive" };
    else if (operator === "gt") prismaCondition = { gt: value };
    else if (operator === "lt") prismaCondition = { lt: value };
    else if (operator === "gte") prismaCondition = { gte: value };
    else if (operator === "lte") prismaCondition = { lte: value };
  }

  if (field === "popularity") return { popularity: { score: prismaCondition } };
  if (field === "energy") {
    return {
      audioFeature: {
        is: {
          energy: prismaCondition,
          ...audioFeatureFilterGuardWhere("energySource", audioFeatureFilterOptions),
        },
      },
    };
  }
  if (field === "valence") {
    return {
      audioFeature: {
        is: {
          valence: prismaCondition,
          ...audioFeatureFilterGuardWhere("valenceSource", audioFeatureFilterOptions),
        },
      },
    };
  }
  if (field === "tempo") return effectiveBpmTrackWhere(prismaCondition);
  if (field === "year") return { album: { year: prismaCondition } };
  if (field === "duration") return { duration: prismaCondition };
  if (field === "rating") return { rating: prismaCondition };
  if (field === "playCount") return { viewCount: prismaCondition };
  if (field === "isLive") return { isLive: prismaCondition };
  if (field === "isRemaster") return { isRemaster: prismaCondition };
  if (field === "isExplicit") return { isExplicit: prismaCondition };
  if (field === "hasPopularity") return prismaCondition ? { popularity: { isNot: null } } : { popularity: null };
  if (field === "genre") {
    return {
      OR: [
        { artist: { tags: { some: { type: "genre", name: prismaCondition } } } },
        { tags: { some: { type: "genre", name: prismaCondition } } },
      ],
    };
  }
  if (field === "title") return { title: prismaCondition };
  if (field === "artist") return { artist: { title: prismaCondition } };
  if (field === "album") return { album: { title: prismaCondition } };

  throw new Error(`Unsupported field ${field}`);
}

function buildRuleNodeCondition(
  node: RuleNode,
  audioFeatureFilterOptions: AudioFeatureFilterOptions = {},
  softMetadataFilters = false,
): any | null {
  if (node.type === "group") {
    const childConditions = node.children
      .map((child) => buildRuleNodeCondition(child, audioFeatureFilterOptions, softMetadataFilters))
      .filter(Boolean);
    if (childConditions.length === 0) return null;
    if (softMetadataFilters && node.combinator === "OR" && childConditions.length < node.children.length) {
      return null;
    }
    return { [node.combinator]: childConditions };
  }

  const condition = buildRuleCondition(node, audioFeatureFilterOptions, softMetadataFilters);
  if (!condition) return null;
  return node.operator === "not_contains" ? { NOT: condition } : condition;
}

function buildNegativeConditions(config: PlaylistConfigInput) {
  const filters = config.negativeFilters || {};
  const conditions: any[] = [];

  if (filters.excludeHoliday) conditions.push({ isHoliday: false });
  if (filters.excludeLive) conditions.push({ isLive: false });
  if (filters.excludeRemasters || config.excludeRemasters) conditions.push({ isRemaster: false });
  if (filters.excludeExplicit) conditions.push({ isExplicit: false });
  if (filters.excludeIntroOutro) conditions.push({ isIntroOutro: false });
  if (filters.minRating != null) conditions.push({ rating: { gte: filters.minRating } });
  if (filters.excludePlayedWithinDays != null) {
    const threshold = new Date(Date.now() - filters.excludePlayedWithinDays * 24 * 60 * 60 * 1000);
    conditions.push({ OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: threshold } }] });
  }
  if (filters.minDurationMinutes != null) conditions.push({ duration: { gte: Math.round(filters.minDurationMinutes * 60 * 1000) } });
  if (filters.maxDurationMinutes != null) conditions.push({ duration: { lte: Math.round(filters.maxDurationMinutes * 60 * 1000) } });

  return conditions;
}

export function buildTrackWhereClause(
  userId: string,
  config: PlaylistConfigInput,
  omitIds: string[] = [],
  audioFeatureFilterOptions: AudioFeatureFilterOptions = {},
  options: { softMetadataFilters?: boolean } = {},
) {
  const scope: any = {
    library: {
      server: {
        userId,
        ...(config.serverId ? { id: config.serverId } : {}),
      },
      ...(config.libraryId ? { id: config.libraryId } : {}),
    },
  };

  const softMetadataFilters = options.softMetadataFilters === true;
  const ruleCondition = config.ruleTree
    ? buildRuleNodeCondition(config.ruleTree, audioFeatureFilterOptions, softMetadataFilters)
    : (() => {
      const conditions = config.rules
        .map((rule) => {
          const condition = buildRuleCondition(rule, audioFeatureFilterOptions, softMetadataFilters);
          if (!condition) return null;
          return rule.operator === "not_contains" ? { NOT: condition } : condition;
        })
        .filter(Boolean);
      return conditions.length ? { AND: conditions } : null;
    })();

  const conditions = [activeSyncStatusWhere(), scope]
    .concat(ruleCondition ? [ruleCondition] : [])
    .concat(buildNegativeConditions(config));
  if (omitIds.length > 0) conditions.push({ id: { notIn: omitIds } });

  return { AND: conditions };
}

function duplicateKey(track: any) {
  return track.canonicalRecordingId ? `canonical:${track.canonicalRecordingId}` : `${track.artistId}:${track.normalizedTitle || normalizeTitle(track.title)}`;
}

function duplicateScore(track: any, index: number, config: PlaylistConfigInput) {
  let score = 100000 - index;
  if (track.preferredDuplicateCopy) score += 1_000_000;
  if (track.syncStatus === "active" && track.localFileStatus !== "missing") score += 100_000;
  const formatRank: Record<string, number> = { flac: 9, alac: 8, wav: 8, aiff: 8, opus: 6, aac: 5, m4a: 5, mp3: 4, ogg: 4 };
  score += (formatRank[String(track.fileFormat || "").toLowerCase()] || 0) * 5_000;
  score += Math.min(4_000, Math.max(0, Number(track.bitrate) || 0));
  if (track.plexGuid && track.mediaPath) score += 1_500;
  if (config.pinnedTrackIds?.includes(track.id)) score += 250_000;
  if (config.duplicateStrategy === "prefer_existing_playlist_copy" && config.pinnedTrackIds?.includes(track.id)) score += 750_000;
  if (config.preferNonLive && !track.isLive) score += 10000;
  if (!track.isRemaster) score += 5000;
  if (track.popularity?.score) score += track.popularity.score;
  if (track.rating) score += track.rating;
  return score;
}

export function applyDuplicatePolicy(tracks: any[], config: PlaylistConfigInput, limit: number) {
  if (config.duplicateStrategy === "allow" || config.duplicateStrategy === "allow_alternate_copies") return tracks.slice(0, limit);

  const selected: any[] = [];
  const selectedIndexByKey = new Map<string, number>();
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const key = duplicateKey(track);
    const existingIndex = selectedIndexByKey.get(key);
    if (existingIndex == null) {
      selectedIndexByKey.set(key, selected.length);
      selected.push(track);
    } else if (duplicateScore(track, index, config) > duplicateScore(selected[existingIndex], existingIndex, config)) {
      selected[existingIndex] = track;
    }
  }

  return selected.slice(0, limit);
}

function artistSafetyKey(track: any) {
  return (track.artistId || track.artist?.id || track.artist?.title || "Unknown artist").toString().trim().toLowerCase() || "unknown artist";
}

function albumSafetyKey(track: any) {
  return (track.albumId || track.album?.id || track.album?.title || "Unknown album").toString().trim().toLowerCase() || "unknown album";
}

function hasBackToBackArtistRepeat(tracks: any[]) {
  for (let index = 1; index < tracks.length; index += 1) {
    if (artistSafetyKey(tracks[index - 1]) === artistSafetyKey(tracks[index])) return true;
  }
  return false;
}

export function enforceArtistSpacing(tracks: any[]) {
  const remaining = [...tracks];
  const spaced: any[] = [];

  while (remaining.length > 0) {
    const previousArtist = spaced.length > 0 ? artistSafetyKey(spaced[spaced.length - 1]) : "";
    const nextIndex = previousArtist
      ? remaining.findIndex((track) => artistSafetyKey(track) !== previousArtist)
      : 0;
    const selectedIndex = nextIndex === -1 ? 0 : nextIndex;
    const [track] = remaining.splice(selectedIndex, 1);
    spaced.push(track);
  }

  const rearrangedTrackCount = spaced.reduce((count, track, index) => count + (track.id !== tracks[index]?.id ? 1 : 0), 0);
  return {
    tracks: spaced,
    rearrangedTrackCount,
    fullyApplied: !hasBackToBackArtistRepeat(spaced),
  };
}

export function limitTracksPerArtist(tracks: any[], maxTracksPerArtist: number) {
  const counts = new Map<string, number>();
  const kept: any[] = [];
  let removed = 0;

  for (const track of tracks) {
    const key = artistSafetyKey(track);
    const nextCount = (counts.get(key) || 0) + 1;
    if (nextCount > maxTracksPerArtist) {
      removed += 1;
      continue;
    }
    counts.set(key, nextCount);
    kept.push(track);
  }

  return { tracks: kept, removed };
}

export function limitTracksPerAlbum(tracks: any[], maxTracksPerAlbum: number) {
  const counts = new Map<string, number>();
  const kept: any[] = [];
  let removed = 0;

  for (const track of tracks) {
    const key = albumSafetyKey(track);
    const nextCount = (counts.get(key) || 0) + 1;
    if (nextCount > maxTracksPerAlbum) {
      removed += 1;
      continue;
    }
    counts.set(key, nextCount);
    kept.push(track);
  }

  return { tracks: kept, removed };
}

export function summarizePlaylistSafetyRules(config: Pick<PlaylistConfigInput, "safetyRules">) {
  const safetyRules = playlistSafetyRulesSchema.parse(config.safetyRules || {});
  const parts: string[] = [];

  if (safetyRules.avoidSameArtistBackToBack) parts.push("avoid back-to-back artists");
  if (safetyRules.limitTracksPerArtist) parts.push(`max ${safetyRules.maxTracksPerArtist} per artist`);
  if (safetyRules.limitTracksPerAlbum) parts.push(`max ${safetyRules.maxTracksPerAlbum} per album`);
  if (safetyRules.warnIfFewerThan) parts.push(`warn below ${safetyRules.minimumTrackCount} tracks`);

  return parts.length ? `Safety rules: ${parts.join(", ")}` : "Safety rules: off";
}

function safetyRulesAreEnabled(config: PlaylistConfigInput) {
  const safetyRules = config.safetyRules;
  return Boolean(
    safetyRules.avoidSameArtistBackToBack
    || safetyRules.limitTracksPerArtist
    || safetyRules.limitTracksPerAlbum
    || safetyRules.warnIfFewerThan,
  );
}

export function applyPlaylistSafetyRules(tracks: any[], config: PlaylistConfigInput) {
  const safetyRules = config.safetyRules;
  const warnings: string[] = [];
  const infos: string[] = [];
  let nextTracks = [...tracks];
  let removedBySafetyRules = 0;
  let rearrangedTrackCount = 0;
  let artistLimitApplied = false;
  let albumLimitApplied = false;
  let artistSpacingApplied = false;

  if (safetyRules.limitTracksPerArtist) {
    const beforeCount = nextTracks.length;
    const result = limitTracksPerArtist(nextTracks, safetyRules.maxTracksPerArtist);
    nextTracks = result.tracks;
    removedBySafetyRules += result.removed;
    artistLimitApplied = true;
    if (beforeCount >= config.limit && nextTracks.length < config.limit) {
      warnings.push(`Max tracks per artist reduced the playlist from ${Math.min(beforeCount, config.limit)} to ${nextTracks.length} tracks. Try increasing the limit or widening your filters.`);
    }
  }

  if (safetyRules.limitTracksPerAlbum) {
    const beforeCount = nextTracks.length;
    const result = limitTracksPerAlbum(nextTracks, safetyRules.maxTracksPerAlbum);
    nextTracks = result.tracks;
    removedBySafetyRules += result.removed;
    albumLimitApplied = true;
    if (beforeCount >= config.limit && nextTracks.length < config.limit) {
      warnings.push(`Max tracks per album reduced the playlist from ${Math.min(beforeCount, config.limit)} to ${nextTracks.length} tracks. Try increasing the limit or widening your filters.`);
    }
  }

  if (safetyRules.avoidSameArtistBackToBack) {
    const result = enforceArtistSpacing(nextTracks);
    nextTracks = result.tracks;
    rearrangedTrackCount = result.rearrangedTrackCount;
    artistSpacingApplied = true;
    if (!result.fullyApplied) {
      warnings.push("Artist spacing could not be fully applied because there were not enough unique artists.");
    }
  }

  const finalTracks = nextTracks.slice(0, config.limit);
  if (safetyRules.limitTracksPerArtist && finalTracks.length > 0) {
    infos.push(`Artist variety rules applied. Max ${safetyRules.maxTracksPerArtist} tracks per artist.`);
  }
  if (removedBySafetyRules > 0 && finalTracks.length < config.limit) {
    warnings.push("Safety rules reduced the preview below the requested target count.");
  }
  if (safetyRules.warnIfFewerThan && finalTracks.length > 0 && finalTracks.length < safetyRules.minimumTrackCount) {
    warnings.push(`This playlist only has ${finalTracks.length} tracks. You may want to loosen your filters before creating it.`);
  }

  return {
    tracks: finalTracks,
    metadata: {
      safetyRulesApplied: safetyRulesAreEnabled(config),
      removedBySafetyRules,
      rearrangedTrackCount,
      infos: infos.filter((info, index, list) => list.indexOf(info) === index),
      warnings: warnings.filter((warning, index, list) => list.indexOf(warning) === index),
      artistLimitApplied,
      albumLimitApplied,
      artistSpacingApplied,
      summary: summarizePlaylistSafetyRules(config),
      enabledRules: {
        avoidSameArtistBackToBack: safetyRules.avoidSameArtistBackToBack,
        limitTracksPerArtist: safetyRules.limitTracksPerArtist,
        maxTracksPerArtist: safetyRules.maxTracksPerArtist,
        limitTracksPerAlbum: safetyRules.limitTracksPerAlbum,
        maxTracksPerAlbum: safetyRules.maxTracksPerAlbum,
        warnIfFewerThan: safetyRules.warnIfFewerThan,
        minimumTrackCount: safetyRules.minimumTrackCount,
      },
    },
  };
}

const playlistTrackInclude = {
  artist: { include: { tags: true } },
  album: true,
  popularity: true,
  audioFeature: true,
  tags: true,
  library: { include: { server: true } },
  ...metadataCorrectionRelations,
} as const;

function annotateTrack(track: any, reasons: string[], engineVersion: SmartMixEngineVersion = SMART_MIX_ENGINE_V1) {
  const effectiveMetadata = resolveEffectiveTrackMetadata(track);
  const effectiveBpm = effectiveMetadata.bpm.value;
  const bpmDisplay = getBpmDisplayMetadata(track);
  const moodEnergyDisplay = getMoodEnergyDisplayMetadata(track);

  return {
    ...track,
    engineVersion,
    bpm: effectiveBpm,
    effectiveBpm,
    bpmDisplay,
    moodEnergyDisplay,
    matchReasons: reasons,
    metadataConfidence: {
      popularity: track.popularity ? {
        provider: track.popularity.provider,
        confidence: track.popularity.confidence,
      } : null,
      audio: track.audioFeature ? {
        source: track.audioFeature.source,
        confidence: track.audioFeature.confidence,
        tempoSource: track.audioFeature.tempoSource,
        tempoConfidence: track.audioFeature.tempoConfidence,
        tempoLabel: effectiveBpm ? (track.audioFeature.tempoConfidence && track.audioFeature.tempoConfidence >= 0.75 ? "exact" : "estimated") : null,
      } : null,
    },
    effectiveMetadata,
    metadataResolutionExplanations: [effectiveMetadata.bpm.explanation, effectiveMetadata.mood.explanation, effectiveMetadata.energy.explanation],
  };
}

function publicPreviewTrack(track: any) {
  const moodEnergy = track.moodEnergyDisplay || getMoodEnergyDisplayMetadata(track);
  const effectiveMetadata = track.effectiveMetadata || resolveEffectiveTrackMetadata(track);
  return {
    id: track.id,
    title: track.title,
    artist: track.artist ? { id: track.artist.id, title: track.artist.title } : null,
    album: track.album ? { id: track.album.id, title: track.album.title, year: track.album.year } : null,
    duration: track.duration,
    bpm: track.bpm,
    effectiveBpm: track.effectiveBpm,
    bpmSource: effectiveMetadata.bpm.source,
    bpmConfidence: track.bpmDisplay?.confidence || null,
    bpmConflictStatus: track.bpmDisplay?.conflictStatus || "none",
    popularity: track.popularity ? {
      score: track.popularity.score,
      provider: track.popularity.provider,
      confidence: track.popularity.confidence,
    } : null,
    audioFeature: track.audioFeature ? {
      energy: effectiveMetadata.energy.value,
      valence: effectiveMetadata.moodScore.value,
      effectiveEnergy: effectiveMetadata.energy.value,
      effectiveMood: effectiveMetadata.moodScore.value,
      energySource: effectiveMetadata.energy.source,
      energyConfidence: moodEnergy.energy.confidence,
      moodSource: effectiveMetadata.mood.source,
      moodConfidence: moodEnergy.mood.confidence,
      moodEnergyStatus: moodEnergy.status,
      moodEnergyReason: moodEnergy.reason,
      tempo: track.audioFeature.tempo,
      source: track.audioFeature.source,
      confidence: track.audioFeature.confidence,
      tempoSource: track.audioFeature.tempoSource,
      tempoConfidence: track.audioFeature.tempoConfidence,
    } : null,
    genres: [
      ...((track.tags || []).filter((tag: any) => tag.type === "genre").map((tag: any) => tag.name)),
      ...((track.artist?.tags || []).filter((tag: any) => tag.type === "genre").map((tag: any) => tag.name)),
    ].filter((name, index, names) => name && names.indexOf(name) === index).slice(0, 4),
    isLive: track.isLive,
    isRemaster: track.isRemaster,
    isExplicit: track.isExplicit,
    matchReasons: track.matchReasons,
    metadataConfidence: track.metadataConfidence,
    engineVersion: track.engineVersion || SMART_MIX_ENGINE_V1,
    score: typeof track.score === "number" ? track.score : undefined,
    scoreBreakdown: track.scoreBreakdown || undefined,
    metadataStatus: track.metadataStatus || undefined,
    effectiveMetadata: track.effectiveMetadata || resolveEffectiveTrackMetadata(track),
    metadataResolutionExplanations: track.metadataResolutionExplanations || undefined,
    fallbacksApplied: track.fallbacksApplied || undefined,
    moodTags: track.moodBlend?.moodTags || resolveEffectiveTrackMetadata(track).mood.value || [],
    moodBlend: track.moodBlend || undefined,
    bpmTransitionFromPrevious: track.bpmTransitionFromPrevious || null,
    discoveryMetrics: track.discoveryMetrics || undefined,
    personalizationScore: track.personalizationScore || undefined,
    playlistIdentityScore: track.playlistIdentityScore || undefined,
    adaptiveScore: track.adaptiveScore || undefined,
    playbackScore: track.playbackScore || undefined,
    contextScore: track.contextScore || undefined,
    coordinationScore: track.coordinationScore || undefined,
    decisionExplanation: track.decisionExplanation || undefined,
    baseScore: typeof track.baseScore === "number" ? track.baseScore : undefined,
    personalizedScore: typeof track.personalizedScore === "number" ? track.personalizedScore : undefined,
  };
}

async function queryCandidateTracks(
  userId: string,
  config: PlaylistConfigInput,
  omitIds: string[],
  take: number,
  audioFeatureFilterOptions: AudioFeatureFilterOptions,
  softMetadataFilters = false,
) {
  return prisma.track.findMany({
    where: buildTrackWhereClause(userId, config, omitIds, audioFeatureFilterOptions, { softMetadataFilters }),
    include: playlistTrackInclude,
    take,
    orderBy: softMetadataFilters ? [{ popularity: { score: "desc" } }, { updatedAt: "desc" }] : { popularity: { score: "desc" } },
  });
}

async function resolvePlaylistGenerationInputs(userId: string, config: PlaylistConfigInput) {
  const pinnedTracks = config.pinnedTrackIds.length
    ? await fetchOwnedTracksInOrder(userId, config.pinnedTrackIds)
    : [];
  const blockedTracks = await prisma.blockedTrack.findMany({
    where: { userId },
    select: { trackId: true },
  });
  const manualExcludedTrackIds = await getManualTrackExclusionIds(userId);
  const personalizationProfile = await prisma.userRecommendationProfile.findUnique({ where: { userId }, select: { enabled: true } });
  const feedbackExcludedTrackIds = personalizationProfile?.enabled
    ? (await prisma.userTrackPreference.findMany({ where: { userId, state: "NEVER_RECOMMEND" }, select: { trackId: true } })).map((row) => row.trackId)
    : [];
  const hardExcludedTrackIdSet = new Set([...manualExcludedTrackIds, ...feedbackExcludedTrackIds]);
  const eligiblePinnedTracks = pinnedTracks.filter((track) => !hardExcludedTrackIdSet.has(track.id));
  const omittedIds = config.excludedTrackIds
    .concat(blockedTracks.map((track) => track.trackId))
    .concat(manualExcludedTrackIds)
    .concat(feedbackExcludedTrackIds)
    .concat(eligiblePinnedTracks.map((track) => track.id));
  const syncSettings = await getUserSyncSettings(userId);
  const audioFeatureFilterOptions = {
    includeEstimated: syncSettings.includeEstimatedAudioFeaturesInFilters === true,
    minimumConfidence: syncSettings.audioFeatureMinimumConfidence ?? null,
  };

  return {
    pinnedTracks: eligiblePinnedTracks,
    blockedTrackIds: blockedTracks.map((track) => track.trackId),
    manualExcludedTrackIds,
    feedbackExcludedTrackIds,
    omittedIds,
    audioFeatureFilterOptions,
  };
}

async function getRecentlyGeneratedTrackIds(userId: string, windowDays = SMART_MIX_RECENTLY_USED_WINDOW_DAYS) {
  const since = new Date(Date.now() - Math.max(1, windowDays) * 24 * 60 * 60 * 1000);
  const recentTracks = await prisma.generatedPlaylistTrack.findMany({
    where: {
      trackId: { not: null },
      generatedPlaylist: {
        userId,
        lastGeneratedAt: { gte: since },
      },
    },
    select: { trackId: true },
    take: maxPlaylistSize,
  });

  return recentTracks
    .map((track) => track.trackId)
    .filter((trackId): trackId is string => Boolean(trackId))
    .filter((trackId, index, ids) => ids.indexOf(trackId) === index);
}

async function getRecentPlaylistUsage(userId: string, lookback: string) {
  const playlistMatch = /^playlists_(3|5|10|20)$/.exec(lookback);
  const dayMatch = /^days_(30|60|90)$/.exec(lookback);
  let rows: Array<{ trackId: string; usageCount: bigint | number }> = [];
  if (playlistMatch) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT t."trackId", COUNT(*) AS "usageCount"
       FROM "PlaylistHistoryTrack" t
       WHERE t."trackId" IS NOT NULL AND t."historyEntryId" IN (
         SELECT h."id" FROM "PlaylistHistoryEntry" h
         WHERE h."userId" = $1 AND h."eventType" IN ('created', 'regenerated', 'created_copy')
         ORDER BY h."createdAt" DESC LIMIT $2
       ) GROUP BY t."trackId"`,
      userId,
      Number(playlistMatch[1]),
    );
  } else if (dayMatch) {
    const since = new Date(Date.now() - Number(dayMatch[1]) * 24 * 60 * 60 * 1000);
    rows = await prisma.$queryRawUnsafe(
      `SELECT t."trackId", COUNT(*) AS "usageCount"
       FROM "PlaylistHistoryTrack" t JOIN "PlaylistHistoryEntry" h ON h."id" = t."historyEntryId"
       WHERE h."userId" = $1 AND h."createdAt" >= $2 AND t."trackId" IS NOT NULL
         AND h."eventType" IN ('created', 'regenerated', 'created_copy')
       GROUP BY t."trackId"`,
      userId,
      since,
    );
  }
  return Object.fromEntries(rows.map((row) => [row.trackId, Number(row.usageCount)]));
}

type PlaylistGenerationSafetyMetadata = ReturnType<typeof applyPlaylistSafetyRules>["metadata"] & {
  manualExclusionsRemoved: number;
};

type PlaylistGenerationStats = {
  tracks: any[];
  manualExclusionsApplied: number;
  safety: PlaylistGenerationSafetyMetadata;
  qualityScore: PlaylistScoreSummary | null;
  engineVersion: SmartMixEngineVersion;
  scoringModel: string;
  scoringModelVersion: string;
  betaFeatures: string[];
  stableFallbackUsed: boolean;
  fallbackReason: string | null;
  engine: {
    version: SmartMixEngineVersion;
    label: string;
    diagnostics: any;
  };
  explanationContext: null | {
    decisionTrace: ReturnType<typeof runSmartMixEngineV2>["decisionTrace"];
    prefilteredHardCandidates: Array<{ track: TraceableSmartMixTrack; rejectionCode: string }>;
    identitySnapshot: unknown;
    personalizationSnapshot: unknown;
  };
};

export async function generatePlaylistTracksWithStats({
  userId,
  config,
  personalizationPlaylistId,
  control,
}: {
  userId: string;
  config: PlaylistConfigInput;
  personalizationPlaylistId?: string | null;
  control?: PlaylistGenerationControl;
}): Promise<PlaylistGenerationStats> {
  const endTimer = playlistGenerationDurationSeconds.startTimer();
  let result: "success" | "failed" = "success";
  try {
    if (control?.stage === "queued") await control.setStage("loading", "Loading library metadata", { selectedTracks: 0 });
    const { pinnedTracks, omittedIds, blockedTrackIds, manualExcludedTrackIds, feedbackExcludedTrackIds, audioFeatureFilterOptions } = await resolvePlaylistGenerationInputs(userId, config);
    const engineVersion = config.engineVersion || SMART_MIX_ENGINE_V1;
    const useSmartMixV2 = engineVersion === SMART_MIX_ENGINE_V2;
    const scoringResolution = useSmartMixV2
      ? await resolveScoringModel({ userId, requestedModel: config.scoringModel, allowStableFallback: config.allowStableFallback !== false })
      : { requestedModel: STABLE_SCORING_MODEL_ID, model: { id: STABLE_SCORING_MODEL_ID, version: "2", apply: normalizeSmartMixTuningConfig, requiredFeature: null }, fallbackUsed: false, fallbackReason: null };
    const tuningConfig = scoringResolution.model.apply(normalizeSmartMixTuningConfig(config.tuningConfig));
    const betaStatus = useSmartMixV2 ? await getBetaStatus({ userId }) : null;
    const moodFeatureState = useSmartMixV2 && config.moodBlendMode !== "off" ? await getFeatureState("smartMix.experimentalMoodGraph", { userId }) : null;
    const betaFeatures = [
      ...(scoringResolution.model.requiredFeature ? [scoringResolution.model.requiredFeature] : []),
      ...(moodFeatureState?.enabled ? [moodFeatureState.key] : []),
    ];
    const stableFallbackUsed = scoringResolution.fallbackUsed || Boolean(moodFeatureState && !moodFeatureState.enabled);
    const fallbackReason = scoringResolution.fallbackReason || (moodFeatureState && !moodFeatureState.enabled ? moodFeatureState.reason : null);
    const recentlyUsedTrackIds = useSmartMixV2 && tuningConfig.avoidRecentlyUsedTracks
      ? await getRecentlyGeneratedTrackIds(userId)
      : [];
    const recentPlaylistUsage = useSmartMixV2 && tuningConfig.discovery.avoidRecentlyUsedPlaylistTracks
      ? await getRecentPlaylistUsage(userId, tuningConfig.discovery.recentPlaylistLookback)
      : {};
    const personalization = useSmartMixV2
      ? await loadPersonalizationScoringContext(userId, personalizationPlaylistId)
      : undefined;
    const playlistIdentity = useSmartMixV2
      ? await loadPlaylistIdentityScoringContext(userId, personalizationPlaylistId)
      : undefined;
    const adaptiveScoring = useSmartMixV2
      ? await loadAdaptiveScoringContext({ userId, playlistId: personalizationPlaylistId, personalization, playlistIdentity })
      : undefined;
    let runConfig: SmartMixEngineV2Config = useSmartMixV2
      ? { ...config, scoringModel: scoringResolution.model.id, tuningConfig, ...(moodFeatureState && !moodFeatureState.enabled ? { moodBlendMode: "off" as const, selectedMoodPath: [], allowedMoods: [] } : {}), recentlyUsedTrackIds, recentPlaylistUsage, ...(personalization ? { personalization } : {}), ...(playlistIdentity ? { playlistIdentity } : {}), ...(adaptiveScoring ? { adaptiveScoring } : {}) }
      : config;
    let remainingLimit = Math.max(0, config.limit - pinnedTracks.length);
    let safetyCandidateLimit = safetyRulesAreEnabled(config)
      ? Math.min(maxPlaylistSize, Math.max(remainingLimit * 5, remainingLimit + 25))
      : remainingLimit;
    const take = Math.min(
      maxPlaylistSize,
      useSmartMixV2
        ? Math.max(safetyCandidateLimit * 8, safetyCandidateLimit + 50)
        : config.duplicateStrategy === "allow" || config.duplicateStrategy === "allow_alternate_copies"
        ? safetyCandidateLimit
        : Math.max(safetyCandidateLimit * 5, safetyCandidateLimit + 25),
    );
    await control?.setStage("filtering", "Applying filters", { initialCandidates: take, selectedTracks: pinnedTracks.length });
    let candidates = remainingLimit > 0
      ? await queryCandidateTracks(userId, config, omittedIds, take, audioFeatureFilterOptions, useSmartMixV2)
      : [];
    let effectivePinnedTracks = pinnedTracks;
    if (useSmartMixV2 && playlistIdentity) {
      candidates = candidates.filter((track) => {
        const memory = playlistIdentity.trackMemory[track.id];
        return !memory?.permanentRejection && memory?.rejectionState !== "NEVER_USE";
      });
    }
    if (useSmartMixV2 && personalization) {
      const feedback = await loadExplicitFeedbackScoringContext(
        userId,
        [...pinnedTracks, ...candidates].map((track) => track.id),
        [...pinnedTracks, ...candidates].map((track) => track.artistId).filter(Boolean),
        personalizationPlaylistId,
      );
      const excluded = new Set(feedback.hardExcludedTrackIds);
      candidates = candidates.filter((track) => !excluded.has(track.id));
      effectivePinnedTracks = pinnedTracks.filter((track) => !excluded.has(track.id));
      remainingLimit = Math.max(0, config.limit - effectivePinnedTracks.length);
      safetyCandidateLimit = safetyRulesAreEnabled(config)
        ? Math.min(maxPlaylistSize, Math.max(remainingLimit * 5, remainingLimit + 25))
        : remainingLimit;
      const personalizationWithFeedback = { ...personalization, explicitFeedback: feedback };
      runConfig = {
        ...runConfig,
        personalization: personalizationWithFeedback,
        ...(adaptiveScoring ? { adaptiveScoring: { ...adaptiveScoring, personalization: personalizationWithFeedback } } : {}),
      };
    }
    if (useSmartMixV2) {
      const importantTrackIds = playlistIdentity
        ? Object.entries(playlistIdentity.trackMemory)
            .filter(([, memory]: any) => ["LOCKED", "ANCHOR", "IMPORTANT"].includes(memory.importance))
            .map(([trackId]) => trackId)
        : [];
      const playbackScoring = await loadPlaybackScoringContext({
        userId,
        trackIds: [...effectivePinnedTracks, ...candidates].map((track) => track.id),
        protectedTrackIds: [...effectivePinnedTracks.map((track) => track.id), ...importantTrackIds],
        maximumPersonalizationInfluence: adaptiveScoring?.settings.maximumInfluence ?? 1,
      });
      if (playbackScoring) runConfig = { ...runConfig, playbackScoring };
    }
    if (useSmartMixV2) {
      const coordination = await loadCoordinationScoringContext({
        userId,
        playlistId: personalizationPlaylistId,
        candidateTrackIds: [...effectivePinnedTracks, ...candidates].map((track) => track.id),
        targetPlaylistSize: config.limit,
        draft: config.coordinationSetup,
      });
      if (coordination) runConfig = { ...runConfig, coordination };
    }
    const reasons = collectRuleReasons(config.ruleTree, config.rules);
    await control?.progress("Applying filters", { initialCandidates: candidates.length, eligibleCandidates: candidates.length, selectedTracks: effectivePinnedTracks.length }, true);

    const baseOmittedIds = config.excludedTrackIds
      .concat(blockedTrackIds)
      .concat(pinnedTracks.map((track) => track.id))
      .filter((id, index, ids) => id && ids.indexOf(id) === index);
    const matchedBeforeManualExclusions = await prisma.track.count({
      where: buildTrackWhereClause(userId, config, baseOmittedIds, audioFeatureFilterOptions, { softMetadataFilters: useSmartMixV2 }),
    });
    const matchedAfterManualExclusions = await prisma.track.count({
      where: buildTrackWhereClause(userId, config, baseOmittedIds.concat(manualExcludedTrackIds), audioFeatureFilterOptions, { softMetadataFilters: useSmartMixV2 }),
    });
    const manualExclusionsApplied = Math.max(0, matchedBeforeManualExclusions - matchedAfterManualExclusions);
    const hardCodeByTrackId = new Map<string, string>([
      ...config.excludedTrackIds.map((trackId) => [trackId, "EXPLICIT_USER_RULE"] as const),
      ...blockedTrackIds.map((trackId) => [trackId, "BLOCKED_TRACK"] as const),
      ...manualExcludedTrackIds.map((trackId) => [trackId, "MANUAL_EXCLUSION"] as const),
      ...feedbackExcludedTrackIds.map((trackId) => [trackId, "NEVER_RECOMMEND"] as const),
    ]);
    const hardTraceTracks = useSmartMixV2 && hardCodeByTrackId.size
      ? await prisma.track.findMany({
          where: { AND: [{ id: { in: Array.from(hardCodeByTrackId.keys()).slice(0, PLAYLIST_GENERATION_LIMITS.explanationRejectedSampleLimit) } }, buildTrackWhereClause(userId, config, [], audioFeatureFilterOptions, { softMetadataFilters: true })] },
          include: playlistTrackInclude,
          take: 100,
        })
      : [];
    const prefilteredHardCandidates = hardTraceTracks.map((track) => {
      const metadata = resolveEffectiveTrackMetadata(track);
      return {
        rejectionCode: hardCodeByTrackId.get(track.id) || "HARD_FILTER",
        track: {
          ...track,
          engineVersion: SMART_MIX_ENGINE_V2,
          score: 0,
          baseScore: 0,
          personalizedScore: 0,
          scoreBreakdown: { base: 0 },
          metadataStatus: {
            hasBpm: metadata.bpm.value != null,
            hasMood: metadata.moodScore.value != null,
            hasEnergy: metadata.energy.value != null,
            hasPopularity: Boolean(track.popularity),
            missingFields: [
              ...(metadata.bpm.value == null ? ["bpm" as const] : []),
              ...(metadata.moodScore.value == null ? ["mood" as const] : []),
              ...(metadata.energy.value == null ? ["energy" as const] : []),
              ...(!track.popularity ? ["popularity" as const] : []),
            ],
          },
          fallbacksApplied: [],
          exclusionReason: hardCodeByTrackId.get(track.id) || "HARD_FILTER",
        } as TraceableSmartMixTrack,
      };
    });

    if (useSmartMixV2) {
      const engineInput: SmartMixEngineV2RunInput<any> = {
        config: runConfig,
        pinnedTracks: effectivePinnedTracks,
        candidates,
        safetyCandidateLimit,
        applyDuplicatePolicy: (tracks, runConfig, limit) => applyDuplicatePolicy(tracks, runConfig as PlaylistConfigInput, limit),
        applyPlaylistSafetyRules: (tracks, runConfig) => applyPlaylistSafetyRules(tracks, runConfig as PlaylistConfigInput),
      };
      const engineResult = control
        ? await runSmartMixEngineV2Async({ ...engineInput, control })
        : runSmartMixEngineV2(engineInput);

      const tracks = engineResult.tracks.map((track) => annotateTrack(track, reasons, SMART_MIX_ENGINE_V2));
      return {
        tracks,
        manualExclusionsApplied,
        safety: {
          ...engineResult.safety.metadata,
          warnings: [
            ...(engineResult.safety.metadata.warnings || []),
            ...engineResult.diagnostics.tuningWarnings,
            ...engineResult.diagnostics.moodWarnings,
            ...engineResult.diagnostics.bpmFlow.warnings,
            ...engineResult.diagnostics.discovery.warnings,
            ...(moodFeatureState && !moodFeatureState.enabled ? [`Experimental mood graph was unavailable (${moodFeatureState.reason}); standard mood compatibility rules were used.`] : []),
          ].filter((warning, index, list) => list.indexOf(warning) === index),
          manualExclusionsRemoved: manualExclusionsApplied,
        } as PlaylistGenerationSafetyMetadata,
        qualityScore: scorePlaylist(tracks, tuningConfig, engineResult.diagnostics.discovery),
        engineVersion: SMART_MIX_ENGINE_V2,
        scoringModel: scoringResolution.model.id,
        scoringModelVersion: scoringResolution.model.version,
        betaFeatures,
        stableFallbackUsed,
        fallbackReason,
        engine: {
          version: SMART_MIX_ENGINE_V2,
          label: smartMixEngineLabel(SMART_MIX_ENGINE_V2),
          diagnostics: { ...engineResult.diagnostics, scoringModel: scoringResolution.model.id, scoringModelVersion: scoringResolution.model.version, requestedScoringModel: scoringResolution.requestedModel, betaFeatures, betaAccessLevel: betaStatus?.accessLevel || "STABLE", stableFallbackUsed, fallbackReason },
        },
        explanationContext: {
          decisionTrace: engineResult.decisionTrace,
          prefilteredHardCandidates,
          identitySnapshot: playlistIdentity ? { identityId: playlistIdentity.identityId, mode: playlistIdentity.mode, strength: playlistIdentity.strength, confidence: playlistIdentity.confidence, profile: playlistIdentity.profile } : null,
          personalizationSnapshot: personalization ? { profile: personalization.profile, playlistProfile: personalization.playlistProfile || null, maxAdjustment: personalization.maxAdjustment ?? null } : null,
        },
      };
    }

    const generatedTracks = applyDuplicatePolicy(candidates, config, safetyCandidateLimit);
    const safetyResult = applyPlaylistSafetyRules(pinnedTracks.concat(generatedTracks), config);

    return {
      tracks: safetyResult.tracks.map((track) => annotateTrack(track, reasons, SMART_MIX_ENGINE_V1)),
      manualExclusionsApplied,
      safety: {
        ...safetyResult.metadata,
        manualExclusionsRemoved: manualExclusionsApplied,
      } as PlaylistGenerationSafetyMetadata,
      qualityScore: null,
      engineVersion: SMART_MIX_ENGINE_V1,
      scoringModel: STABLE_SCORING_MODEL_ID,
      scoringModelVersion: "2",
      betaFeatures: [],
      stableFallbackUsed: false,
      fallbackReason: null,
      engine: {
        version: SMART_MIX_ENGINE_V1,
        label: smartMixEngineLabel(SMART_MIX_ENGINE_V1),
        diagnostics: null,
      },
      explanationContext: null,
    };
  } catch (error) {
    result = "failed";
    throw error;
  } finally {
    endTimer();
    playlistGenerationsTotal.inc({ result });
  }
}

export async function generatePlaylistTracks({
  userId,
  config,
}: {
  userId: string;
  config: PlaylistConfigInput;
}) {
  const result = await generatePlaylistTracksWithStats({ userId, config });
  return result.tracks;
}

function numericRangeLabel(rules: PlaylistRuleInput[], field: string, emptyLabel = "Any") {
  const relevant = rules.filter((rule) => rule.field === field);
  if (relevant.length === 0) return emptyLabel;
  const eq = relevant.find((rule) => rule.operator === "eq");
  if (eq) return eq.value;
  const lower = relevant.find((rule) => rule.operator === "gte" || rule.operator === "gt");
  const upper = relevant.find((rule) => rule.operator === "lte" || rule.operator === "lt");
  if (lower || upper) {
    return `${lower ? `${lower.operator === "gt" ? ">" : ""}${lower.value}` : "Any"}–${upper ? `${upper.operator === "lt" ? "<" : ""}${upper.value}` : "Any"}`;
  }
  return relevant.map(readableRule).join(", ");
}

function genreFilterLabel(rules: PlaylistRuleInput[]) {
  const genres = rules.filter((rule) => rule.field === "genre").map((rule) => rule.value);
  return genres.length ? genres.join(", ") : "Any";
}

function formatNegativeFilters(filters: PlaylistConfigInput["negativeFilters"]) {
  const enabled: string[] = [];
  if (filters.excludeHoliday) enabled.push("Exclude holiday tracks");
  if (filters.excludeLive) enabled.push("Exclude live tracks");
  if (filters.excludeRemasters) enabled.push("Exclude remasters");
  if (filters.excludeExplicit) enabled.push("Exclude explicit tracks");
  if (filters.excludeIntroOutro) enabled.push("Exclude intros/outros");
  if (filters.minRating != null) enabled.push(`Rating >= ${filters.minRating}`);
  if (filters.excludePlayedWithinDays != null) enabled.push(`Not played in ${filters.excludePlayedWithinDays} days`);
  if (filters.minDurationMinutes != null) enabled.push(`Duration >= ${filters.minDurationMinutes} min`);
  if (filters.maxDurationMinutes != null) enabled.push(`Duration <= ${filters.maxDurationMinutes} min`);
  return enabled.length ? enabled.join(", ") : "None";
}

function uniquePreviewMessages(messages: PlaylistPreviewMessage[]) {
  return messages.filter((message, index, list) => (
    list.findIndex((candidate) => candidate.severity === message.severity && candidate.message === message.message) === index
  ));
}

export function buildPreviewMessages({
  tracks,
  matchedTrackCount,
  requestedLimit,
  safetyRules,
  smartPresetName,
  moodPresetName,
  moodPresetModified,
  bpmPresetName,
  bpmPresetModified,
}: {
  tracks: any[];
  matchedTrackCount: number;
  requestedLimit: number;
  safetyRules: PlaylistConfigInput["safetyRules"];
  smartPresetName?: string;
  moodPresetName?: string;
  moodPresetModified?: boolean;
  bpmPresetName?: string;
  bpmPresetModified?: boolean;
}) {
  const messages: PlaylistPreviewMessage[] = [];
  const moodPresetLabel = moodPresetName ? `${moodPresetName}${moodPresetModified ? " modified" : ""}` : "";
  const bpmPresetLabel = bpmPresetName ? `${bpmPresetName}${bpmPresetModified ? " modified" : ""}` : "";
  if (matchedTrackCount === 0 || tracks.length === 0) {
    messages.push({ severity: "error", message: bpmPresetName
      ? `No tracks matched the ${bpmPresetLabel} BPM preset. Try choosing Medium, Wide Open, or widening the BPM range.`
      : moodPresetLabel
      ? `No tracks matched the ${moodPresetLabel} mood preset. Try widening BPM, energy, or mood ranges.`
      : smartPresetName
      ? `No tracks matched the ${smartPresetName} preset. Try widening the BPM range, allowing more genres, or disabling popularity limits.`
      : "No tracks matched this playlist recipe. Adjust your filters and preview again." });
    if (bpmPresetName) {
      messages.push({ severity: "warning", message: "This BPM preset depends on BPM data. Run BPM analysis or choose Wide Open if too few tracks match." });
    }
    if (moodPresetName) {
      messages.push({ severity: "warning", message: "This preset depends on mood and energy data. Run audio feature analysis or widen your filters if too few tracks match." });
    }
    messages.push({ severity: "warning", message: "Some filters may be too restrictive. Try widening BPM, energy, mood, genre, or popularity filters." });
    return uniquePreviewMessages(messages);
  }

  if (matchedTrackCount < requestedLimit) {
    messages.push({ severity: "warning", message: bpmPresetName
      ? `Only ${matchedTrackCount} tracks matched the ${bpmPresetLabel} BPM preset. Try choosing Medium, Wide Open, or widening the BPM range.`
      : moodPresetLabel
      ? `Only ${matchedTrackCount} tracks matched the ${moodPresetLabel} mood preset. Try widening BPM or energy ranges.`
      : smartPresetName
      ? `Only ${matchedTrackCount} tracks matched the ${smartPresetName} preset. Try widening the BPM range, allowing more genres, or disabling popularity limits.`
      : `Only ${matchedTrackCount} tracks matched your filters. Try widening the BPM range, removing a genre filter, or allowing tracks with missing audio features.` });
  }
  if (tracks.length < requestedLimit) {
    messages.push({ severity: "warning", message: `Playlist has fewer tracks than requested: ${tracks.length} of ${requestedLimit}.` });
  }

  const missingBpm = tracks.filter((track) => resolveEffectiveTrackMetadata(track).bpm.value == null).length;
  if (missingBpm >= Math.max(3, Math.ceil(tracks.length * 0.25))) {
    messages.push({ severity: "warning", message: `Many tracks are missing BPM data (${missingBpm} of ${tracks.length}).` });
    if (bpmPresetName) {
      messages.push({ severity: "warning", message: "This BPM preset depends on BPM data. Run BPM analysis or choose Wide Open if too few tracks match." });
    }
  }

  const missingAudio = tracks.filter((track) => {
    const metadata = resolveEffectiveTrackMetadata(track);
    return metadata.energy.value === null || metadata.moodScore.value === null;
  }).length;
  if (missingAudio >= Math.max(3, Math.ceil(tracks.length * 0.25))) {
    messages.push({ severity: "warning", message: `${missingAudio} previewed tracks are missing mood or energy values. Run audio feature analysis for better Smart Builder results.` });
    if (moodPresetName) {
      messages.push({ severity: "warning", message: `Only ${matchedTrackCount} tracks matched this mood preset. Some tracks may be missing mood or energy data.` });
    }
  }

  const artistCounts = new Map<string, number>();
  for (const track of tracks) {
    const artist = track.artist?.title || "Unknown artist";
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
  }
  const repeatedArtistTracks = Array.from(artistCounts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const repeatedArtists = Array.from(artistCounts.entries())
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1]);

  if (safetyRules.limitTracksPerArtist) {
    const artistsOverLimit = repeatedArtists.filter(([, count]) => count > safetyRules.maxTracksPerArtist);
    if (artistsOverLimit.length > 0) {
      const mostRepeated = artistsOverLimit
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([artist, count]) => `${artist} (${count})`);
      messages.push({ severity: "warning", message: `Some artists exceed the max ${safetyRules.maxTracksPerArtist} tracks per artist rule.${mostRepeated.length ? ` Most repeated: ${mostRepeated.join(", ")}.` : ""}` });
    }
  } else if (repeatedArtistTracks >= Math.max(6, Math.ceil(tracks.length * 0.35))) {
    const mostRepeated = repeatedArtists
      .slice(0, 3)
      .map(([artist, count]) => `${artist} (${count})`);
    messages.push({ severity: "warning", message: `Preview has heavy artist repetition. ${artistCounts.size} artists appear across ${tracks.length} tracks.${mostRepeated.length ? ` Most repeated: ${mostRepeated.join(", ")}.` : ""} Try enabling max tracks per artist or widening your filters.` });
  }

  if (safetyRules.avoidSameArtistBackToBack && hasBackToBackArtistRepeat(tracks)) {
    messages.push({ severity: "warning", message: "Same-artist back-to-back spacing could not be fully applied to this preview." });
  }

  return uniquePreviewMessages(messages);
}

export async function previewPlaylistTracks({
  userId,
  config,
  displayLimit = previewDisplayLimit,
  control,
}: {
  userId: string;
  config: PlaylistConfigInput;
  displayLimit?: number;
  control?: PlaylistGenerationControl;
}) {
  await control?.setStage("loading", "Loading library metadata", { selectedTracks: 0 });
  const { blockedTrackIds, manualExcludedTrackIds, audioFeatureFilterOptions } = await resolvePlaylistGenerationInputs(userId, config);
  const baseOmittedIds = config.excludedTrackIds.concat(blockedTrackIds);
  const useSmartMixV2 = config.engineVersion === SMART_MIX_ENGINE_V2;
  const matchedBeforeManualExclusions = await prisma.track.count({
    where: buildTrackWhereClause(userId, config, baseOmittedIds, audioFeatureFilterOptions, { softMetadataFilters: useSmartMixV2 }),
  });
  const matchedTrackCount = await prisma.track.count({
    where: buildTrackWhereClause(userId, config, baseOmittedIds.concat(manualExcludedTrackIds), audioFeatureFilterOptions, { softMetadataFilters: useSmartMixV2 }),
  });
  const libraryTrackCount = await prisma.track.count({ where: { syncStatus: "active", library: { server: { userId, ...(config.serverId ? { id: config.serverId } : {}) }, ...(config.libraryId ? { id: config.libraryId } : {}) } } });
  await control?.setStage("filtering", "Applying filters", { libraryTracks: libraryTrackCount, initialCandidates: matchedBeforeManualExclusions, eligibleCandidates: matchedTrackCount, selectedTracks: 0 });
  const generation = await generatePlaylistTracksWithStats({ userId, config, control });
  const tracks = generation.tracks;
  const rules = collectRules(config.ruleTree, config.rules);
  const server = config.serverId ? await prisma.server.findFirst({ where: { id: config.serverId, userId }, select: { name: true } }) : null;
  const library = config.libraryId ? await prisma.library.findFirst({ where: { id: config.libraryId, server: { userId } }, select: { name: true } }) : null;
  const previewTracks = tracks.slice(0, displayLimit);
  const tuningConfig = normalizeSmartMixTuningConfig(config.tuningConfig);
  const moodBlend = normalizeMoodBlendConfig(config);
  const moodDiagnostics = generation.engine.diagnostics || {};
  const bpmFlow = moodDiagnostics.bpmFlow || generation.qualityScore?.bpmFlow || null;

  const summary = {
    targetTrackCount: config.limit,
    matchingTrackCount: matchedTrackCount,
    finalTrackCount: tracks.length,
    displayedTrackCount: previewTracks.length,
    estimatedDurationMs: tracks.reduce((sum, track) => sum + (track.duration || 0), 0),
    estimatedDurationMinutes: Math.round(tracks.reduce((sum, track) => sum + (track.duration || 0), 0) / 60000),
    bpmRange: numericRangeLabel(rules, "tempo"),
    energyRange: numericRangeLabel(rules, "energy"),
    moodRange: numericRangeLabel(rules, "valence"),
    popularityRange: numericRangeLabel(rules, "popularity"),
    manualExclusionsRemoved: generation.safety.manualExclusionsRemoved,
    safetyRulesApplied: generation.safety.safetyRulesApplied,
    removedBySafetyRules: generation.safety.removedBySafetyRules,
    safetyRearrangedTrackCount: generation.safety.rearrangedTrackCount,
    safetyRuleSummary: generation.safety.summary,
    smartPresetId: config.smartPresetId || null,
    smartPresetName: config.smartPresetName || null,
    smartPresetVersion: config.smartPresetVersion || null,
    moodPresetId: config.moodPresetId || null,
    moodPresetName: config.moodPresetName || null,
    moodPresetVersion: config.moodPresetVersion || null,
    moodPresetModified: config.moodPresetModified || false,
    bpmPresetId: config.bpmPresetId || null,
    bpmPresetName: config.bpmPresetName || null,
    bpmPresetVersion: config.bpmPresetVersion || null,
    bpmPresetModified: config.bpmPresetModified || false,
    engineVersion: generation.engineVersion,
    scoringModel: generation.scoringModel,
    scoringModelVersion: generation.scoringModelVersion,
    betaFeatures: generation.betaFeatures,
    stableFallbackUsed: generation.stableFallbackUsed,
    stableFallbackReason: generation.fallbackReason,
    engineLabel: generation.engine.label,
    engineDiagnostics: generation.engine.diagnostics,
    tuningPresetName: tuningConfig.presetName || null,
    tuningConfig,
    context: config.contextSelection || null,
    contextMatches: config.contextSelection ? {
      strong: previewTracks.filter((track) => Number(track.contextScore?.adjustment) >= 4).length,
      moderate: previewTracks.filter((track) => Number(track.contextScore?.adjustment) > 0 && Number(track.contextScore?.adjustment) < 4).length,
      poor: previewTracks.filter((track) => Number(track.contextScore?.adjustment) < 0).length,
      lowConfidence: previewTracks.filter((track) => track.contextScore?.confidence === "LOW").length,
    } : null,
    moodBlendMode: moodDiagnostics.moodBlendMode || moodBlend.moodBlendMode,
    moodBlendLabel: moodBlendModeLabel(moodDiagnostics.moodBlendMode || moodBlend.moodBlendMode),
    selectedMoodPath: moodDiagnostics.selectedMoodPath || moodBlend.selectedMoodPath,
    allowedMoods: moodDiagnostics.allowedMoods || moodBlend.allowedMoods,
    moodCurve: moodDiagnostics.moodCurve || null,
    moodCoverage: moodDiagnostics.moodCoverage || null,
    moodWarnings: moodDiagnostics.moodWarnings || [],
    moodStrength: moodDiagnostics.moodStrength || config.moodStrength,
    transitionSmoothness: moodDiagnostics.transitionSmoothness || config.transitionSmoothness,
    moodStrictness: moodDiagnostics.moodStrictness || config.moodStrictness,
    fallbackTolerance: moodDiagnostics.fallbackTolerance || config.fallbackTolerance,
    bridgeTrackPreference: moodDiagnostics.bridgeTrackPreference || config.bridgeTrackPreference,
    moodVariety: moodDiagnostics.moodVariety || config.moodVariety,
    conflictSensitivity: moodDiagnostics.conflictSensitivity || config.conflictSensitivity,
    selectedMoodPreset: moodDiagnostics.selectedMoodPreset || config.selectedMoodPreset,
    moodFallbackCount: moodDiagnostics.moodFallbackCount || 0,
    moodConflictCount: moodDiagnostics.moodConflictCount || 0,
    multiMoodBridgeTracks: moodDiagnostics.multiMoodBridgeTracks || [],
    missingMoodCount: moodDiagnostics.missingMoodCount || 0,
    bpmFlow,
    bpmFlowScore: bpmFlow?.bpmFlowScore ?? generation.qualityScore?.bpmFlowScore ?? null,
    bpmFlowMode: bpmFlow?.config?.mode || tuningConfig.bpmFlow.mode,
    bpmFlowWarnings: bpmFlow?.warnings || [],
    discovery: moodDiagnostics.discovery || null,
    qualityScore: generation.qualityScore,
    artistLimitApplied: generation.safety.artistLimitApplied,
    albumLimitApplied: generation.safety.albumLimitApplied,
    artistSpacingApplied: generation.safety.artistSpacingApplied,
    genreFilters: genreFilterLabel(rules),
    sortMode: tuningConfig.bpmFlow.enabled && tuningConfig.bpmFlow.mode !== "DISABLED"
      ? `BPM ${tuningConfig.bpmFlow.mode.replace("_", " ").toLowerCase()} flow`
      : "Popularity score descending",
    duplicateStrategy: config.duplicateStrategy === "allow" || config.duplicateStrategy === "allow_alternate_copies" ? "Allow alternate copies" : config.duplicateStrategy === "prefer_highest_quality" ? "Prefer highest-quality copy" : config.duplicateStrategy === "prefer_existing_playlist_copy" ? "Prefer the Plex copy already in the playlist" : "Avoid duplicate recordings",
    diversity: {
      artistCount: new Set(previewTracks.map((track) => track.artist?.title).filter(Boolean)).size,
      albumCount: new Set(previewTracks.map((track) => track.album?.title).filter(Boolean)).size,
      repeatedArtistTracks: Math.max(0, previewTracks.length - new Set(previewTracks.map((track) => track.artist?.title).filter(Boolean)).size),
    },
    missing: {
      bpm: previewTracks.filter((track) => resolveEffectiveTrackMetadata(track).bpm.value == null).length,
      audioFeatures: previewTracks.filter((track) => {
        const metadata = resolveEffectiveTrackMetadata(track);
        return metadata.energy.value === null || metadata.moodScore.value === null;
      }).length,
      popularity: previewTracks.filter((track) => !track.popularity).length,
    },
  };

  const filterSummary = [
    ...(config.smartPresetName ? [{ label: "Smart preset", value: config.smartPresetName }] : []),
    ...(config.moodPresetName ? [{ label: "Mood preset", value: `${config.moodPresetName}${config.moodPresetModified ? " modified" : ""}` }] : []),
    ...(config.bpmPresetName ? [{ label: "BPM preset", value: `${config.bpmPresetName}${config.bpmPresetModified ? " modified" : ""}` }] : []),
    ...(useSmartMixV2 ? [{ label: "Tuning preset", value: tuningConfig.presetName || "Custom" }] : []),
    ...(config.contextSelection ? [{ label: "Selected context", value: `${config.contextSelection.profileName} (${config.contextSelection.influence.toLowerCase()} influence)` }] : []),
    ...(useSmartMixV2 ? [{ label: "BPM flow", value: tuningConfig.bpmFlow.enabled ? `${tuningConfig.bpmFlow.mode.replace("_", " ")} (${tuningConfig.bpmFlow.maxPreferredGap} BPM gap)` : "No BPM ordering" }] : []),
    ...(useSmartMixV2 ? [{ label: "Discovery", value: tuningConfig.discovery.level === "custom" ? "Custom Discovery" : tuningConfig.discovery.level === "low" ? "Mostly Familiar" : tuningConfig.discovery.level === "high" ? "Deep Discovery" : "Balanced Discovery" }] : []),
    ...(moodBlend.enabled ? [{ label: "Mood blend", value: moodBlendModeLabel(moodBlend.moodBlendMode) }] : []),
    ...(moodBlend.moodBlendMode === "smooth_transition" || moodBlend.moodBlendMode === "strict_matching"
      ? [{ label: "Mood path", value: moodBlend.selectedMoodPath.join(" > ") || "None" }]
      : []),
    ...(moodBlend.moodBlendMode === "mixed_mood" ? [{ label: "Allowed moods", value: moodBlend.allowedMoods.join(", ") || "None" }] : []),
    { label: "Server", value: server?.name || (config.serverId ? "Selected server" : "Any connected server") },
    { label: "Library", value: library?.name || (config.libraryId ? "Selected library" : "Any music library") },
    { label: "Genres", value: summary.genreFilters },
    { label: config.bpmPresetName ? "BPM range" : "BPM", value: summary.bpmRange },
    { label: "Energy", value: summary.energyRange },
    { label: "Mood", value: summary.moodRange },
    { label: "Popularity", value: summary.popularityRange },
    { label: "Limit", value: `${config.limit} tracks` },
    { label: "Sort", value: summary.sortMode },
    { label: "Duplicate control", value: summary.duplicateStrategy },
    { label: "Negative filters", value: formatNegativeFilters(config.negativeFilters) },
    ...(summary.manualExclusionsRemoved > 0 ? [{ label: "Manual exclusions", value: `${summary.manualExclusionsRemoved} removed` }] : []),
    { label: "Safety rules", value: summary.safetyRuleSummary },
    { label: "Smart Mix Engine", value: generation.engine.label.replace(/^Smart Mix Engine: /, "") },
    { label: "Rules", value: collectRuleReasons(config.ruleTree, config.rules).join("; ") || "All active tracks" },
  ];

  const messages = uniquePreviewMessages([
    ...buildPreviewMessages({
      tracks,
      matchedTrackCount,
      requestedLimit: config.limit,
      safetyRules: config.safetyRules,
      smartPresetName: config.smartPresetName,
      moodPresetName: config.moodPresetName,
      moodPresetModified: config.moodPresetModified,
      bpmPresetName: config.bpmPresetName,
      bpmPresetModified: config.bpmPresetModified,
    }),
    ...generation.safety.infos.map((message) => ({ severity: "info" as const, message })),
    ...generation.safety.warnings.map((message) => ({ severity: "warning" as const, message })),
  ]);
  const warnings = messages
    .filter((message) => message.severity !== "info")
    .map((message) => message.message);

  const previewId = Buffer.from(`${Date.now()}:${previewTracks.map((track) => track.id).join(",")}`).toString("base64url").slice(0, 48);
  let generationInsights = null;
  let rejectedCandidates: any[] = [];
  if (useSmartMixV2 && generation.explanationContext) {
    await control?.setStage("persisting", "Saving generation diagnostics", { eligibleCandidates: generation.explanationContext.decisionTrace.eligibleCandidateCount, selectedTracks: previewTracks.length });
    const traceStartedAt = Date.now();
    const preference = await getExplanationPreference(userId);
    const selectedExplanations = previewTracks.map((track, index) => buildDecisionExplanation({ track: track as TraceableSmartMixTrack, generationId: previewId, decision: "selected", rank: index + 1 }));
    const selectedByScore = [...previewTracks].sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
    const retainedRejected = [
      ...generation.explanationContext.prefilteredHardCandidates.map((candidate, index) => ({ ...candidate, rank: index + 1 })),
      ...generation.explanationContext.decisionTrace.rejectedCandidates,
    ].slice(0, preference.rejectedCandidateLimit);
    const rejectedExplanations = retainedRejected.map((candidate) => {
      const winner = selectedByScore.find((track) => Number(track.score || 0) >= Number(candidate.track.score || 0)) || selectedByScore[0] || null;
      return buildDecisionExplanation({ track: candidate.track as TraceableSmartMixTrack, generationId: previewId, decision: "rejected", rank: candidate.rank, rejectionCode: candidate.rejectionCode, winner: winner as TraceableSmartMixTrack | null });
    });
    const persisted = await persistGenerationExplanations({
      userId,
      generationId: previewId,
      engineVersion: SMART_MIX_ENGINE_V2,
      selected: selectedExplanations,
      rejected: rejectedExplanations,
      counts: {
        evaluated: generation.explanationContext.decisionTrace.evaluatedCandidateCount + generation.manualExclusionsApplied + generation.explanationContext.prefilteredHardCandidates.filter((candidate) => candidate.rejectionCode === "NEVER_RECOMMEND").length,
        eligible: generation.explanationContext.decisionTrace.eligibleCandidateCount,
        hardRejected: generation.explanationContext.decisionTrace.hardRejectedCount + generation.manualExclusionsApplied + generation.explanationContext.prefilteredHardCandidates.filter((candidate) => candidate.rejectionCode === "NEVER_RECOMMEND").length,
      },
      rejectionCounts: {
        ...generation.explanationContext.decisionTrace.hardRejectionSummary,
        ...(generation.manualExclusionsApplied ? { MANUAL_EXCLUSION: generation.manualExclusionsApplied } : {}),
        ...(generation.explanationContext.prefilteredHardCandidates.some((candidate) => candidate.rejectionCode === "NEVER_RECOMMEND") ? { NEVER_RECOMMEND: generation.explanationContext.prefilteredHardCandidates.filter((candidate) => candidate.rejectionCode === "NEVER_RECOMMEND").length } : {}),
        RANKED_BELOW_CUTOFF: generation.explanationContext.decisionTrace.rejectedCandidates.filter((candidate) => candidate.rejectionCode === "RANKED_BELOW_CUTOFF").length,
      },
      settingsSnapshot: config,
      identitySnapshot: generation.explanationContext.identitySnapshot,
      personalizationSnapshot: generation.explanationContext.personalizationSnapshot,
      traceDurationMs: Date.now() - traceStartedAt,
    });
    generationInsights = persisted?.insights || null;
    rejectedCandidates = rejectedExplanations.map((explanation) => ({ trackId: explanation.trackId, title: explanation.trackTitle, artist: explanation.artistName, finalScore: explanation.scores.finalScore, confidence: explanation.confidence, rejectionStage: explanation.rejectionStage, rejectionCode: explanation.rejectionCode, summary: explanation.summary }));
    for (let index = 0; index < previewTracks.length; index += 1) previewTracks[index].decisionExplanation = selectedExplanations[index];
  }

  await control?.setStage("completed", "Generation complete", { eligibleCandidates: matchedTrackCount, selectedTracks: previewTracks.length });

  return {
    previewId,
    trackIds: tracks.map((track) => track.id),
    tracks: previewTracks.map(publicPreviewTrack),
    totalPreviewTrackCount: tracks.length,
    summary,
    filterSummary,
    manualExclusionsApplied: summary.manualExclusionsRemoved,
    safetyRulesApplied: generation.safety.safetyRulesApplied,
    removedBySafetyRules: generation.safety.removedBySafetyRules,
    manualExclusionsRemoved: summary.manualExclusionsRemoved,
    warnings,
    messages,
    safety: generation.safety,
    engineVersion: generation.engineVersion,
    engine: generation.engine,
    qualityScore: generation.qualityScore,
    generationInsights,
    rejectedCandidates,
  };
}

async function fetchOwnedTracksInOrder(userId: string, trackIds: string[]) {
  const uniqueIds = trackIds.filter((id, index) => trackIds.indexOf(id) === index);
  const tracks = await queryInBatches(uniqueIds, (batch) => prisma.track.findMany({
    where: { id: { in: batch }, syncStatus: "active", library: { server: { userId } } },
    include: playlistTrackInclude,
  }));

  if (tracks.length !== uniqueIds.length) {
    throw new Error("Some tracks were not found or are not owned by this user");
  }

  const trackById = new Map(tracks.map((track) => [track.id, track]));
  return uniqueIds.map((id) => trackById.get(id)!);
}

function assertSingleServer(tracks: Awaited<ReturnType<typeof fetchOwnedTracksInOrder>>) {
  const targetServer = tracks[0]?.library.server;
  if (!targetServer) throw new Error("No tracks were provided");

  const mixedServer = tracks.some((track) => track.library.server.id !== targetServer.id);
  if (mixedServer) {
    throw new Error("Plex playlists cannot span multiple servers");
  }

  return targetServer;
}

function plexHeaders(accessToken: string) {
  return {
    Accept: "application/json",
    "X-Plex-Token": accessToken,
    "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr").trim(),
  };
}

async function pushTracksToPlex({
  server,
  name,
  ratingKeys,
  playlistId,
}: {
  server: { uri: string; accessToken: string; machineIdentifier: string };
  name: string;
  ratingKeys: string[];
  playlistId?: string | null;
}) {
  const uniqueRatingKeys = ratingKeys.map(String).filter(Boolean).filter((key, index, keys) => keys.indexOf(key) === index);
  if (uniqueRatingKeys.length === 0) throw new Error("Mixarr will not create an empty Plex playlist.");
  const headers = plexHeaders(server.accessToken);
  const batches = chunkValues(uniqueRatingKeys, PLAYLIST_GENERATION_LIMITS.queryBatchSize);
  const uriFor = (batch: string[]) => `server://${server.machineIdentifier}/com.plexapp.plugins.library/library/metadata/${batch.join(",")}`;

  if (playlistId) {
    const previousRatingKeys = await fetchPlexPlaylistItemRatingKeys({ server, playlistId });
    try {
      await axios.put(`${server.uri}/playlists/${playlistId}`, null, { params: { title: name }, headers });
      await axios.delete(`${server.uri}/playlists/${playlistId}/items`, { headers });
      for (const batch of batches) await axios.put(`${server.uri}/playlists/${playlistId}/items`, null, { params: { uri: uriFor(batch) }, headers });
      return playlistId;
    } catch (error) {
      const rollbackBatches = chunkValues(previousRatingKeys, PLAYLIST_GENERATION_LIMITS.queryBatchSize);
      await axios.delete(`${server.uri}/playlists/${playlistId}/items`, { headers }).catch(() => undefined);
      for (const batch of rollbackBatches) await axios.put(`${server.uri}/playlists/${playlistId}/items`, null, { params: { uri: uriFor(batch) }, headers }).catch(() => undefined);
      throw error;
    }
  }

  let createdPlaylistId: string | null = null;
  try {
    const response = await axios.post(`${server.uri}/playlists`, null, { params: { type: "audio", title: name, smart: 0, uri: uriFor(batches[0]) }, headers });
    createdPlaylistId = response.data?.MediaContainer?.Metadata?.[0]?.ratingKey || null;
    if (!createdPlaylistId) throw new Error("Plex did not confirm playlist creation.");
    for (const batch of batches.slice(1)) await axios.put(`${server.uri}/playlists/${createdPlaylistId}/items`, null, { params: { uri: uriFor(batch) }, headers });
    return createdPlaylistId;
  } catch (error) {
    if (createdPlaylistId) await axios.delete(`${server.uri}/playlists/${createdPlaylistId}`, { headers }).catch(() => undefined);
    throw error;
  }
}

async function assertPlexPlaylistExists({
  server,
  playlistId,
}: {
  server: { uri: string; accessToken: string };
  playlistId: string;
}) {
  try {
    await axios.get(`${server.uri}/playlists/${playlistId}`, {
      headers: plexHeaders(server.accessToken),
    });
  } catch {
    throw new Error("Mixarr could not find the existing Plex playlist. Create a new playlist instead?");
  }
}

async function fetchPlexPlaylistItemRatingKeys({
  server,
  playlistId,
}: {
  server: { uri: string; accessToken: string };
  playlistId: string;
}) {
  try {
    const response = await axios.get(`${server.uri}/playlists/${playlistId}/items`, {
      headers: plexHeaders(server.accessToken),
    });
    const metadata = response.data?.MediaContainer?.Metadata;
    if (!Array.isArray(metadata)) return [];
    return metadata
      .map((item: any) => String(item.ratingKey || item.key?.split("/").filter(Boolean).at(-1) || "").trim())
      .filter(Boolean);
  } catch {
    throw new Error("Mixarr could not find the existing Plex playlist. Create a new playlist instead?");
  }
}

async function fetchPlexPlaylistTracksInOrder({
  userId,
  server,
  playlistId,
}: {
  userId: string;
  server: { id: string; uri: string; accessToken: string };
  playlistId: string;
}) {
  const ratingKeys = await fetchPlexPlaylistItemRatingKeys({ server, playlistId });
  if (ratingKeys.length === 0) {
    return { ratingKeys, tracks: [] as any[], missingTrackCount: 0 };
  }

  const tracks = await prisma.track.findMany({
    where: {
      syncStatus: "active",
      library: { server: { id: server.id, userId } },
      OR: [
        { ratingKey: { in: ratingKeys } },
        { plexId: { in: ratingKeys } },
      ],
    },
    include: playlistTrackInclude,
  });
  const trackByPlexKey = new Map<string, any>();
  for (const track of tracks) {
    if (track.ratingKey) trackByPlexKey.set(track.ratingKey, track);
    if (track.plexId) trackByPlexKey.set(track.plexId, track);
  }

  const seenTrackIds = new Set<string>();
  const orderedTracks: any[] = [];
  for (const ratingKey of ratingKeys) {
    const track = trackByPlexKey.get(ratingKey);
    if (!track || seenTrackIds.has(track.id)) continue;
    seenTrackIds.add(track.id);
    orderedTracks.push(track);
  }

  return {
    ratingKeys,
    tracks: orderedTracks,
    missingTrackCount: Math.max(0, ratingKeys.length - orderedTracks.length),
  };
}

export type GeneratedPlaylistSourceType = "manual_builder" | "recipe" | "smart_builder" | "recently_added" | "unknown";

function generatedPlaylistSourceType(config: Partial<PlaylistConfigInput>, fallback?: string | null): GeneratedPlaylistSourceType {
  if (fallback === "manual_builder" || fallback === "recipe" || fallback === "smart_builder" || fallback === "recently_added" || fallback === "unknown") {
    return fallback;
  }
  if ((config as any).recipeId) return "recipe";
  if (config.smartPresetId || config.smartPresetName || config.moodPresetId || config.bpmPresetId) return "smart_builder";
  return "manual_builder";
}

function normalizeGeneratedPlaylistConfig(filters: unknown, engineVersion?: string | null) {
  const source = filters && typeof filters === "object" && !Array.isArray(filters)
    ? filters as Record<string, unknown>
    : {};
  return playlistConfigSchema.parse({
    ...source,
    engineVersion: source.engineVersion || engineVersion || SMART_MIX_ENGINE_V1,
  });
}

function applyPlaylistGroupSettings(config: PlaylistConfigInput, value: unknown): PlaylistConfigInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return config;
  const settings = value as Record<string, any>;
  const tuning = { ...config.tuningConfig } as Record<string, any>;
  const discovery = { ...(tuning.discovery || {}) } as Record<string, any>;
  const safetyRules = { ...config.safetyRules };
  const negativeFilters = { ...config.negativeFilters };
  if (["low", "balanced", "high"].includes(settings.discoveryLevel)) discovery.level = settings.discoveryLevel === "balanced" ? "medium" : settings.discoveryLevel;
  if (typeof settings.deepCutPercentage === "number") discovery.deepCutTarget = settings.deepCutPercentage;
  if (typeof settings.recommendationStrength === "number") tuning.recommendationStrength = settings.recommendationStrength;
  if (typeof settings.preferArtistVariety === "boolean") tuning.artistVariety = settings.preferArtistVariety ? Math.max(Number(tuning.artistVariety || 0), 70) : tuning.artistVariety;
  if (typeof settings.recentlyUsedPlaylistExclusionDays === "number") tuning.avoidRecentlyUsedTracks = settings.recentlyUsedPlaylistExclusionDays > 0;
  if (typeof settings.maximumTracksPerArtist === "number" && settings.maximumTracksPerArtist > 0) {
    safetyRules.limitTracksPerArtist = true;
    safetyRules.maxTracksPerArtist = settings.maximumTracksPerArtist;
  }
  if (typeof settings.albumLimit === "number" && settings.albumLimit > 0) {
    safetyRules.limitTracksPerAlbum = true;
    safetyRules.maxTracksPerAlbum = settings.albumLimit;
  }
  if (typeof settings.recentlyPlayedExclusionDays === "number" && settings.recentlyPlayedExclusionDays > 0) negativeFilters.excludePlayedWithinDays = settings.recentlyPlayedExclusionDays;
  if (settings.liveTrackHandling === "exclude") negativeFilters.excludeLive = true;
  tuning.discovery = discovery;
  return playlistConfigSchema.parse({ ...config, tuningConfig: tuning, safetyRules, negativeFilters });
}

export async function syncGeneratedPlaylistToPlex(userId: string, generatedPlaylistId: string) {
  const playlist = await prisma.generatedPlaylist.findFirst({
    where: { id: generatedPlaylistId, userId },
    include: { tracks: { orderBy: { position: "asc" } } },
  });
  if (!playlist) throw new Error("Generated playlist not found");
  if (!playlist.serverId || !playlist.plexPlaylistRatingKey) throw new Error("The Plex playlist is unavailable for synchronization.");
  const server = await prisma.server.findFirst({ where: { id: playlist.serverId, userId } });
  if (!server) throw new Error("The Plex server is unavailable for synchronization.");
  const ratingKeys = playlist.tracks.map((track) => track.plexTrackRatingKey).filter((key): key is string => Boolean(key));
  if (ratingKeys.length !== playlist.tracks.length) throw new Error("Some restored tracks do not have a Plex identifier.");
  await assertPlexPlaylistExists({ server, playlistId: playlist.plexPlaylistRatingKey });
  await pushTracksToPlex({ server, name: playlist.plexPlaylistTitle, ratingKeys, playlistId: playlist.plexPlaylistRatingKey });
}

function rulesJsonFromConfig(config: PlaylistConfigInput) {
  return JSON.stringify(config.ruleTree || config.rules || []);
}

async function replaceGeneratedPlaylistSnapshot(generatedPlaylistId: string, tracks: any[], db: typeof prisma | Prisma.TransactionClient = prisma) {
  const previousStates = await db.generatedPlaylistTrack.findMany({
    where: { generatedPlaylistId, trackId: { not: null } },
    select: { trackId: true, locked: true, liked: true, regenerationExcluded: true },
  });
  const stateByTrackId = new Map(previousStates.map((state) => [state.trackId, state]));
  await db.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId } });
  await db.generatedPlaylistTrack.createMany({
      data: tracks.map((track, index) => {
        const previous = stateByTrackId.get(track.id);
        return {
          generatedPlaylistId,
          trackId: track.id,
          plexTrackRatingKey: track.ratingKey || track.plexId || null,
          position: index + 1,
          title: track.title || "Unknown track",
          artist: track.artist?.title || null,
          album: track.album?.title || null,
          locked: Boolean(previous?.locked),
          liked: Boolean(previous?.liked || Number(track.rating) >= 8),
          regenerationExcluded: Boolean(previous?.regenerationExcluded),
          adaptiveScoreJson: track.adaptiveScore || undefined,
          playbackScoreJson: track.playbackScore || undefined,
          coordinationScoreJson: track.coordinationScore || undefined,
          explanationJson: track.decisionExplanation || undefined,
        };
      }),
    });
}

export async function recordGeneratedPlaylist({
  userId,
  serverId,
  plexPlaylistRatingKey,
  plexPlaylistTitle,
  sourceType,
  recipeId,
  recipeName,
  filters,
  trackIds,
  discoveryResult: suppliedDiscoveryResult,
  previewId,
}: {
  userId: string;
  serverId?: string | null;
  plexPlaylistRatingKey?: string | null;
  plexPlaylistTitle: string;
  sourceType?: GeneratedPlaylistSourceType | string | null;
  recipeId?: string | null;
  recipeName?: string | null;
  filters: unknown;
  trackIds: string[];
  discoveryResult?: unknown;
  previewId?: string | null;
}) {
  const config = normalizeGeneratedPlaylistConfig(filters);
  const tracks = trackIds.length ? await fetchOwnedTracksInOrder(userId, trackIds) : [];
  const resolvedSourceType = generatedPlaylistSourceType(config, sourceType);
  const scoringResolution = config.engineVersion === SMART_MIX_ENGINE_V2
    ? await resolveScoringModel({ userId, requestedModel: config.scoringModel, allowStableFallback: true })
    : { model: { id: STABLE_SCORING_MODEL_ID, version: "2", apply: normalizeSmartMixTuningConfig, requiredFeature: null }, fallbackUsed: false, fallbackReason: null };
  const tuningConfig = scoringResolution.model.apply(normalizeSmartMixTuningConfig(config.tuningConfig));
  const betaStatus = await getBetaStatus({ userId });
  const moodFeatureState = config.engineVersion === SMART_MIX_ENGINE_V2 && config.moodBlendMode !== "off" ? await getFeatureState("smartMix.experimentalMoodGraph", { userId }) : null;
  const betaFeatures = [...(scoringResolution.model.requiredFeature ? [scoringResolution.model.requiredFeature] : []), ...(moodFeatureState?.enabled ? [moodFeatureState.key] : [])];
  const stableFallbackUsed = scoringResolution.fallbackUsed || Boolean(moodFeatureState && !moodFeatureState.enabled);
  const fallbackReason = scoringResolution.fallbackReason || (moodFeatureState && !moodFeatureState.enabled ? moodFeatureState.reason : null);
  let discoveryResult = suppliedDiscoveryResult && typeof suppliedDiscoveryResult === "object" && Number.isFinite((suppliedDiscoveryResult as any).targetSatisfaction)
    ? suppliedDiscoveryResult as any
    : null;
  if (config.engineVersion === SMART_MIX_ENGINE_V2 && !discoveryResult) {
    const recentPlaylistUsage = tuningConfig.discovery.avoidRecentlyUsedPlaylistTracks
      ? await getRecentPlaylistUsage(userId, tuningConfig.discovery.recentPlaylistLookback)
      : {};
    const discoveryScoring = scoreDiscoveryCandidatePool({
      candidates: tracks.map((track) => ({ ...track, score: 75 })),
      config: tuningConfig.discovery,
      recentUsage: recentPlaylistUsage,
    });
    discoveryResult = summarizeDiscovery(discoveryScoring.tracks, discoveryScoring.tracks, tuningConfig.discovery, discoveryScoring.executionTimeMs);
  }
  const existing = plexPlaylistRatingKey
    ? await prisma.generatedPlaylist.findFirst({ where: { userId, plexPlaylistRatingKey } })
    : null;
  let scoredTracks = tracks;
  let adaptiveSettingsSnapshot: unknown = null;
  let playbackSettingsSnapshot: unknown = null;
  if (config.engineVersion === SMART_MIX_ENGINE_V2 && tracks.length) {
    const personalization = await loadPersonalizationScoringContext(userId, existing?.id);
    const playlistIdentity = await loadPlaylistIdentityScoringContext(userId, existing?.id);
    if (personalization) {
      personalization.explicitFeedback = await loadExplicitFeedbackScoringContext(
        userId,
        tracks.map((track) => track.id),
        tracks.map((track) => track.artistId).filter(Boolean),
        existing?.id,
      );
    }
    const adaptiveScoring = await loadAdaptiveScoringContext({ userId, playlistId: existing?.id, personalization, playlistIdentity });
    const lockedTrackIds = existing
      ? (await prisma.generatedPlaylistTrack.findMany({ where: { generatedPlaylistId: existing.id, locked: true, trackId: { not: null } }, select: { trackId: true } }))
          .map((row) => row.trackId)
          .filter((trackId): trackId is string => Boolean(trackId))
      : [];
    const importantTrackIds = playlistIdentity
      ? Object.entries(playlistIdentity.trackMemory)
          .filter(([, memory]) => ["LOCKED", "ANCHOR", "IMPORTANT"].includes(memory.importance))
          .map(([trackId]) => trackId)
      : [];
    const playbackScoring = await loadPlaybackScoringContext({
      userId,
      trackIds: tracks.map((track) => track.id),
      protectedTrackIds: [...lockedTrackIds, ...importantTrackIds],
      maximumPersonalizationInfluence: adaptiveScoring?.settings.maximumInfluence ?? 1,
    });
    adaptiveSettingsSnapshot = adaptiveScoring?.settings || null;
    playbackSettingsSnapshot = playbackScoring?.settings || null;
    scoredTracks = tracks.map((track) => scoreSmartMixTrack(track, {
      ...config,
      tuningConfig,
      ...(personalization ? { personalization } : {}),
      ...(playlistIdentity ? { playlistIdentity } : {}),
      ...(adaptiveScoring ? { adaptiveScoring } : {}),
      ...(playbackScoring ? { playbackScoring } : {}),
    }));
  }
  const qualityScore = config.engineVersion === SMART_MIX_ENGINE_V2 ? scorePlaylist(scoredTracks, tuningConfig, discoveryResult || undefined) : null;
  const feedbackProfile = config.engineVersion === SMART_MIX_ENGINE_V2 ? await prisma.userRecommendationProfile.findUnique({ where: { userId }, select: { enabled: true } }) : null;
  const [appliedTrackFeedback, appliedArtistFeedback] = feedbackProfile?.enabled ? await Promise.all([
    prisma.userTrackPreference.findMany({ where: { userId, trackId: { in: tracks.map((track) => track.id) } }, select: { state: true } }),
    prisma.userArtistPreference.findMany({ where: { userId, artistId: { in: Array.from(new Set(tracks.map((track) => track.artistId))) } }, select: { state: true } }),
  ]) : [[], []];
  const feedbackTypesApplied = Array.from(new Set([...appliedTrackFeedback.map((row) => row.state), ...appliedArtistFeedback.map((row) => row.state)]));
  const data = {
    userId,
    serverId: serverId || tracks[0]?.library?.server?.id || null,
    plexPlaylistRatingKey: plexPlaylistRatingKey || null,
    plexPlaylistTitle,
    sourceType: resolvedSourceType,
    recipeId: recipeId || null,
    recipeName: recipeName || null,
    smartPresetId: config.smartPresetId || null,
    smartPresetName: config.smartPresetName || null,
    moodPresetId: config.moodPresetId || null,
    moodPresetName: config.moodPresetName || null,
    bpmPresetId: config.bpmPresetId || null,
    bpmPresetName: config.bpmPresetName || null,
    tuningPresetName: tuningConfig.presetName || null,
    tuningConfigJson: tuningConfig as any,
    discoveryConfigJson: config.engineVersion === SMART_MIX_ENGINE_V2 ? tuningConfig.discovery as any : undefined,
    discoveryResultJson: config.engineVersion === SMART_MIX_ENGINE_V2 ? discoveryResult as any : undefined,
    engineVersion: config.engineVersion || SMART_MIX_ENGINE_V1,
    scoringModel: scoringResolution.model.id,
    scoringModelVersion: scoringResolution.model.version,
    betaMetadataJson: config.engineVersion === SMART_MIX_ENGINE_V2 || betaFeatures.length || stableFallbackUsed ? {
      accessLevel: betaStatus.accessLevel,
      enabledFeatureFlags: betaFeatures,
      scoringModel: scoringResolution.model.id,
      scoringModelVersion: scoringResolution.model.version,
      smartMixEngineVersion: config.engineVersion || SMART_MIX_ENGINE_V1,
      betaWarningAcknowledged: Boolean(betaStatus.warningAcceptedAt),
      stableFallbackUsed,
      fallbackReason,
      generationSettings: config,
      personalizationScoringVersion: "2.1.2-feedback-1",
      feedbackTypesApplied,
      feedbackInfluencedGeneration: feedbackTypesApplied.length > 0,
    } as any : undefined,
    adaptiveScoringVersion: config.engineVersion === SMART_MIX_ENGINE_V2 ? "1" : null,
    adaptiveSettingsJson: adaptiveSettingsSnapshot as any,
    playbackSettingsJson: playbackSettingsSnapshot as any,
    contextProfileId: config.contextSelection?.profileId || null,
    contextProfileName: config.contextSelection?.profileName || null,
    contextInfluence: config.contextSelection?.influence || null,
    contextSnapshotJson: config.contextSelection as any,
    contextOverridesJson: config.contextSelection?.manualOverrides as any,
    filtersJson: config as any,
    safetyRulesJson: config.safetyRules as any,
    qualityScoreJson: qualityScore as any,
    trackCount: tracks.length,
    lastGeneratedAt: new Date(),
  };

  if (previewId && config.engineVersion === SMART_MIX_ENGINE_V2) {
    const previewTraces = await prisma.smartMixDecisionTrace.findMany({ where: { userId, generationId: previewId, decision: "selected" }, select: { trackId: true, explanationJson: true } });
    const explanationByTrackId = new Map(previewTraces.map((trace) => [trace.trackId, trace.explanationJson]));
    scoredTracks = scoredTracks.map((track) => ({ ...track, decisionExplanation: explanationByTrackId.get(track.id) || undefined }));
  }

  const { createPlaylistVersionInTransaction } = await import("./playlists/versions/playlist-version-service");
  const generatedPlaylist = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.generatedPlaylist.update({ where: { id: existing.id }, data })
      : await tx.generatedPlaylist.create({ data });
    await replaceGeneratedPlaylistSnapshot(saved.id, scoredTracks, tx);
    await tx.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: saved.id }, { playlistBId: saved.id }] }, data: { stale: true } });
    await tx.playlistCoordinationSetting.updateMany({ where: { playlistId: saved.id }, data: { analysisStale: true } });
    await createPlaylistVersionInTransaction(tx, {
      generatedPlaylistId: saved.id,
      reason: existing ? "full_regeneration" : "initial_generation",
      description: existing ? "Regenerated entire playlist" : "Initial playlist generation",
    });
    return saved;
  });
  if (config.engineVersion === SMART_MIX_ENGINE_V2) {
    if (previewId) {
      await attachGenerationExplanationsToPlaylist(userId, previewId, generatedPlaylist.id);
    } else if (scoredTracks.length) {
      const generationId = generatedPlaylist.id;
      const selected = scoredTracks.map((track, index) => buildDecisionExplanation({ track: track as TraceableSmartMixTrack, generationId, playlistId: generatedPlaylist.id, decision: "selected", rank: index + 1 }));
      await persistGenerationExplanations({ userId, generationId, engineVersion: SMART_MIX_ENGINE_V2, selected, rejected: [], counts: { evaluated: scoredTracks.length, eligible: scoredTracks.length, hardRejected: 0 }, settingsSnapshot: config });
      await attachGenerationExplanationsToPlaylist(userId, generationId, generatedPlaylist.id);
    }
  }
  if (betaFeatures.length || stableFallbackUsed) {
    for (const featureKey of betaFeatures.length ? betaFeatures : [moodFeatureState?.key || "smartMix.experimentalScoring"]) {
      await recordBetaUsage({ userId, featureKey, playlistId: generatedPlaylist.id, action: existing ? "playlist_regeneration" : "playlist_generation", success: true, fallbackUsed: stableFallbackUsed, engineVersion: config.engineVersion, scoringModel: scoringResolution.model.id, errorCode: fallbackReason });
    }
  }
  await ensurePlaylistIdentity(userId, generatedPlaylist.id, existing ? "REGENERATION" : "GENERATED");
  if (config.coordinationSetup?.enabled) {
    const setup = config.coordinationSetup;
    await updateCoordinationSettings(userId, generatedPlaylist.id, {
      coordinationEnabled: true,
      maximumSharedTrackPercentage: setup.maximumSharedTrackPercentage,
      overlapEnforcement: setup.overlapEnforcement,
      keepDistinct: setup.keepDistinct,
      allowSharedCoreTracks: setup.allowSharedCoreTracks,
      preferGloballyUnusedTracks: setup.preferGloballyUnusedTracks,
      unusedTrackPreferenceStrength: setup.unusedTrackPreferenceStrength,
      crossPlaylistArtistBalancingEnabled: setup.crossPlaylistArtistBalancingEnabled,
      maximumCoordinationInfluence: 12,
      maximumSharedArtistPercentage: 40,
      maximumTracksPerArtistAcrossGroup: 6,
      featuredArtistMatching: "PRIMARY_ONLY",
      warnBeforeExceedingOverlap: true,
      excludedPlaylistIds: setup.relationshipType === "DISTINCT_FROM" ? setup.relatedPlaylistIds : [],
    });
    for (const targetPlaylistId of setup.relatedPlaylistIds.filter((id) => id !== generatedPlaylist.id)) {
      try {
        await createPlaylistRelationship(userId, generatedPlaylist.id, {
          targetPlaylistId,
          relationshipType: setup.relationshipType,
          coordinationEnabled: true,
          sharedCoreAllowed: setup.allowSharedCoreTracks,
          maximumSharedTrackPercentage: setup.maximumSharedTrackPercentage,
          maximumSharedArtistPercentage: 40,
        });
      } catch (error: any) {
        if (!String(error?.message || "").includes("already exists")) throw error;
      }
    }
  }
  trainPlaylistIdentity({ userId, playlistId: generatedPlaylist.id, source: existing ? "REGENERATION" : "GENERATION" }).catch((error: unknown) => {
    console.warn("[PlaylistIdentity] automatic training failed; playlist remains available", { playlistId: generatedPlaylist.id, message: error instanceof Error ? error.message : "unknown error" });
  });
  if (!existing && generatedPlaylist.plexPlaylistRatingKey) {
    const { getOrchestrationSettings } = await import("./orchestration/settings");
    const orchestrationSettings = await getOrchestrationSettings().catch(() => null);
    if (orchestrationSettings?.autoRegisterGeneratedPlaylists) {
      const libraryId = tracks[0]?.libraryId || (await prisma.library.findFirst({ where: { server: { userId }, type: "artist" }, select: { id: true } }))?.id;
      if (libraryId) {
        const { registerManagedPlaylist } = await import("./orchestration/service");
        await registerManagedPlaylist({ userId, libraryId, generatedPlaylistId: generatedPlaylist.id }).catch((error: unknown) => {
          console.warn("[Orchestration] Automatic playlist registration failed; playlist generation remains successful", { playlistId: generatedPlaylist.id, message: error instanceof Error ? error.message : "unknown error" });
        });
      }
    }
  }
  return generatedPlaylist;
}

function uniqueTrackIds(ids: Array<string | null | undefined>) {
  return ids.filter((id): id is string => Boolean(id)).filter((id, index, list) => list.indexOf(id) === index);
}

function validateRegenerationMode(mode: string): RegenerationMode {
  if (supportedRegenerationModes.includes(mode as RegenerationMode)) return mode as RegenerationMode;
  throw new Error(`Unsupported regeneration mode: ${mode}`);
}

function validateKeepPercent(keepPercent: number): RegenerationKeepPercent {
  if (supportedKeepPercents.includes(keepPercent as RegenerationKeepPercent)) return keepPercent as RegenerationKeepPercent;
  throw new Error("Unsupported keep percentage. Choose 25 or 50.");
}

function uniqueTracksById(tracks: any[]) {
  const seen = new Set<string>();
  const uniqueTracks: any[] = [];
  for (const track of tracks) {
    if (!track?.id || seen.has(track.id)) continue;
    seen.add(track.id);
    uniqueTracks.push(track);
  }
  return uniqueTracks;
}

function combineSafetyMetadata(primary: any, secondary?: any) {
  if (!secondary) return primary;
  return {
    ...primary,
    manualExclusionsRemoved: (primary?.manualExclusionsRemoved || 0) + (secondary?.manualExclusionsRemoved || 0),
    removedBySafetyRules: (primary?.removedBySafetyRules || 0) + (secondary?.removedBySafetyRules || 0),
    rearrangedTrackCount: (primary?.rearrangedTrackCount || 0) + (secondary?.rearrangedTrackCount || 0),
    warnings: [...(primary?.warnings || []), ...(secondary?.warnings || [])].filter((warning, index, list) => list.indexOf(warning) === index),
    safetyRulesApplied: Boolean(primary?.safetyRulesApplied || secondary?.safetyRulesApplied),
  };
}

async function resolveGeneratedPlaylistServer({
  userId,
  generatedPlaylist,
  config,
}: {
  userId: string;
  generatedPlaylist: { serverId?: string | null };
  config: PlaylistConfigInput;
}) {
  if (generatedPlaylist.serverId) {
    const server = await prisma.server.findFirst({ where: { id: generatedPlaylist.serverId, userId } });
    if (server) return server;
  }
  if (config.serverId) {
    const server = await prisma.server.findFirst({ where: { id: config.serverId, userId } });
    if (server) return server;
  }
  return null;
}

async function filterCurrentTracksForKeep({
  userId,
  config,
  tracks,
}: {
  userId: string;
  config: PlaylistConfigInput;
  tracks: any[];
}) {
  if (tracks.length === 0) {
    return { tracks: [] as any[], manualExcludedCurrentTrackCount: 0 };
  }

  const { blockedTrackIds, manualExcludedTrackIds, audioFeatureFilterOptions } = await resolvePlaylistGenerationInputs(userId, config);
  const currentTrackIds = tracks.map((track) => track.id);
  const useSmartMixV2 = config.engineVersion === SMART_MIX_ENGINE_V2;
  const eligibleTracks = await prisma.track.findMany({
    where: {
      AND: [
        { id: { in: currentTrackIds } },
        buildTrackWhereClause(
          userId,
          config,
          uniqueTrackIds([...(config.excludedTrackIds || []), ...blockedTrackIds, ...manualExcludedTrackIds]),
          audioFeatureFilterOptions,
          { softMetadataFilters: useSmartMixV2 },
        ),
      ],
    },
    select: { id: true },
  });
  const eligibleTrackIds = new Set(eligibleTracks.map((track) => track.id));
  const manualExcludedTrackIdSet = new Set(manualExcludedTrackIds);

  return {
    tracks: tracks.filter((track) => eligibleTrackIds.has(track.id)),
    manualExcludedCurrentTrackCount: tracks.filter((track) => manualExcludedTrackIdSet.has(track.id)).length,
  };
}

async function generateRegenerationReplacementTracks({
  userId,
  config,
  targetCount,
  personalizationPlaylistId,
  omitTrackIds = [],
  preferDifferentTrackIds = [],
}: {
  userId: string;
  config: PlaylistConfigInput;
  targetCount: number;
  personalizationPlaylistId?: string | null;
  omitTrackIds?: string[];
  preferDifferentTrackIds?: string[];
}) {
  if (targetCount <= 0) {
    return {
      tracks: [] as any[],
      safety: {
        ...applyPlaylistSafetyRules([], playlistConfigSchema.parse({ ...config, limit: 1 })).metadata,
        manualExclusionsRemoved: 0,
      },
      preferredTracksAvoided: 0,
    };
  }

  const preferredTrackIdSet = new Set(preferDifferentTrackIds);
  const primaryConfig = playlistConfigSchema.parse({
    ...config,
    limit: targetCount,
    pinnedTrackIds: [],
    excludedTrackIds: uniqueTrackIds([...(config.excludedTrackIds || []), ...omitTrackIds, ...preferDifferentTrackIds]),
  });
  const primary = await generatePlaylistTracksWithStats({ userId, config: primaryConfig, personalizationPlaylistId });
  let selectedTracks = uniqueTracksById(primary.tracks).slice(0, targetCount);
  let safety = primary.safety;

  if (preferDifferentTrackIds.length > 0 && selectedTracks.length < targetCount) {
    const fallbackConfig = playlistConfigSchema.parse({
      ...config,
      limit: targetCount - selectedTracks.length,
      pinnedTrackIds: [],
      excludedTrackIds: uniqueTrackIds([...(config.excludedTrackIds || []), ...omitTrackIds, ...selectedTracks.map((track) => track.id)]),
    });
    const fallback = await generatePlaylistTracksWithStats({ userId, config: fallbackConfig, personalizationPlaylistId });
    selectedTracks = uniqueTracksById([...selectedTracks, ...fallback.tracks]).slice(0, targetCount);
    safety = combineSafetyMetadata(safety, fallback.safety);
  }

  const reusedPreferredTracks = selectedTracks.filter((track) => preferredTrackIdSet.has(track.id)).length;
  return {
    tracks: selectedTracks,
    safety,
    preferredTracksAvoided: Math.max(0, preferDifferentTrackIds.length - reusedPreferredTracks),
  };
}

function buildRegenerationPreviewPayload({
  tracks,
  config,
  warnings,
  safety,
  matchingTrackCount,
  regeneration,
}: {
  tracks: any[];
  config: PlaylistConfigInput;
  warnings: string[];
  safety: any;
  matchingTrackCount: number;
  regeneration: any;
}) {
  const previewTracks = tracks.slice(0, previewDisplayLimit);
  const previewId = Buffer.from(`${Date.now()}:${previewTracks.map((track) => track.id).join(",")}`).toString("base64url").slice(0, 48);
  const selectedExplanations = config.engineVersion === SMART_MIX_ENGINE_V2
    ? previewTracks.map((track, index) => buildDecisionExplanation({ track: track as TraceableSmartMixTrack, generationId: previewId, decision: "selected", rank: index + 1 }))
    : [];
  for (let index = 0; index < selectedExplanations.length; index += 1) previewTracks[index].decisionExplanation = selectedExplanations[index];
  const tuningConfig = normalizeSmartMixTuningConfig(config.tuningConfig);
  const qualityScore = config.engineVersion === SMART_MIX_ENGINE_V2 ? scorePlaylist(tracks, tuningConfig) : null;
  const moodBlend = normalizeMoodBlendConfig(config);
  const moodBlendSummary = config.engineVersion === SMART_MIX_ENGINE_V2
    ? summarizeMoodBlend({ tracks, candidates: tracks, config })
    : null;
  const finalTrackCount = previewTracks.length;
  const estimatedDurationMs = previewTracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  const bpmFlow = qualityScore?.bpmFlow || null;
  return {
    previewId,
    trackIds: previewTracks.map((track) => track.id),
    tracks: previewTracks.map(publicPreviewTrack),
    totalPreviewTrackCount: tracks.length,
    summary: {
      targetTrackCount: config.limit,
      matchingTrackCount,
      finalTrackCount,
      displayedTrackCount: finalTrackCount,
      estimatedDurationMs,
      estimatedDurationMinutes: Math.round(estimatedDurationMs / 60000),
      manualExclusionsRemoved: safety.manualExclusionsRemoved || 0,
      safetyRulesApplied: safety.safetyRulesApplied,
      removedBySafetyRules: safety.removedBySafetyRules || 0,
      safetyRearrangedTrackCount: safety.rearrangedTrackCount || 0,
      safetyRuleSummary: safety.summary || summarizePlaylistSafetyRules(config),
      engineVersion: config.engineVersion || SMART_MIX_ENGINE_V1,
      engineLabel: smartMixEngineLabel(config.engineVersion),
      tuningPresetName: tuningConfig.presetName || null,
      tuningConfig,
      moodBlendMode: moodBlendSummary?.moodBlendMode || moodBlend.moodBlendMode,
      moodBlendLabel: moodBlendModeLabel(moodBlendSummary?.moodBlendMode || moodBlend.moodBlendMode),
      selectedMoodPath: moodBlendSummary?.selectedMoodPath || moodBlend.selectedMoodPath,
      allowedMoods: moodBlendSummary?.allowedMoods || moodBlend.allowedMoods,
      moodCurve: moodBlendSummary?.moodCurve || null,
      moodCoverage: moodBlendSummary?.moodCoverage || null,
      moodWarnings: moodBlendSummary?.moodWarnings || [],
      moodStrength: moodBlendSummary?.moodStrength || config.moodStrength,
      transitionSmoothness: moodBlendSummary?.transitionSmoothness || config.transitionSmoothness,
      moodStrictness: moodBlendSummary?.moodStrictness || config.moodStrictness,
      fallbackTolerance: moodBlendSummary?.fallbackTolerance || config.fallbackTolerance,
      bridgeTrackPreference: moodBlendSummary?.bridgeTrackPreference || config.bridgeTrackPreference,
      moodVariety: moodBlendSummary?.moodVariety || config.moodVariety,
      conflictSensitivity: moodBlendSummary?.conflictSensitivity || config.conflictSensitivity,
      selectedMoodPreset: moodBlendSummary?.selectedMoodPreset || config.selectedMoodPreset,
      moodFallbackCount: moodBlendSummary?.moodFallbackCount || 0,
      moodConflictCount: moodBlendSummary?.moodConflictCount || 0,
      missingMoodCount: moodBlendSummary?.missingMoodCount || 0,
      bpmFlow,
      bpmFlowScore: bpmFlow?.bpmFlowScore ?? null,
      bpmFlowMode: bpmFlow?.config.mode || tuningConfig.bpmFlow.mode,
      bpmFlowWarnings: bpmFlow?.warnings || [],
      qualityScore,
    },
    filterSummary: [
      { label: "Limit", value: `${config.limit} tracks` },
      { label: "Safety rules", value: safety.summary || summarizePlaylistSafetyRules(config) },
      { label: "Smart Mix Engine", value: smartMixEngineLabel(config.engineVersion).replace(/^Smart Mix Engine: /, "") },
      ...(config.engineVersion === SMART_MIX_ENGINE_V2 ? [{ label: "Tuning preset", value: tuningConfig.presetName || "Custom" }] : []),
      ...(config.engineVersion === SMART_MIX_ENGINE_V2 ? [{ label: "BPM flow", value: tuningConfig.bpmFlow.enabled ? `${tuningConfig.bpmFlow.mode.replace("_", " ")} (${tuningConfig.bpmFlow.maxPreferredGap} BPM gap)` : "No BPM ordering" }] : []),
      ...(moodBlend.enabled ? [{ label: "Mood blend", value: moodBlendModeLabel(moodBlend.moodBlendMode) }] : []),
    ],
    manualExclusionsApplied: safety.manualExclusionsRemoved || 0,
    safetyRulesApplied: safety.safetyRulesApplied,
    removedBySafetyRules: safety.removedBySafetyRules || 0,
    manualExclusionsRemoved: safety.manualExclusionsRemoved || 0,
    warnings: [...warnings, ...(moodBlendSummary?.moodWarnings || []), ...(bpmFlow?.warnings || [])].filter((warning, index, list) => list.indexOf(warning) === index),
    safety,
    engineVersion: config.engineVersion || SMART_MIX_ENGINE_V1,
    qualityScore,
    regeneration,
    generationInsights: config.engineVersion === SMART_MIX_ENGINE_V2 ? buildGenerationInsights(previewId, selectedExplanations, { evaluated: matchingTrackCount, eligible: matchingTrackCount, hardRejected: 0 }) : null,
    rejectedCandidates: [],
  };
}

export async function previewGeneratedPlaylistRegeneration({
  userId,
  generatedPlaylistId,
  mode = "replace_all",
  keepPercent = 25,
  preferDifferentTracks = false,
  effectiveGroupSettings,
  groupContext,
}: {
  userId: string;
  generatedPlaylistId: string;
  mode?: string;
  keepPercent?: number;
  preferDifferentTracks?: boolean;
  effectiveGroupSettings?: Record<string, unknown>;
  groupContext?: { id: string; name: string } | null;
}) {
  const regenerationMode = validateRegenerationMode(mode);
  const normalizedKeepPercent = regenerationMode === "keep_some" ? validateKeepPercent(keepPercent) : 25;
  const generatedPlaylist = await prisma.generatedPlaylist.findFirst({
    where: { id: generatedPlaylistId, userId },
    include: { tracks: { orderBy: { position: "asc" } } },
  });

  if (!generatedPlaylist) {
    throw new Error("Generated playlist not found");
  }

  const savedConfig = applyPlaylistGroupSettings(normalizeGeneratedPlaylistConfig(generatedPlaylist.filtersJson, generatedPlaylist.engineVersion), effectiveGroupSettings);
  const snapshotTrackIds = generatedPlaylist.tracks.map((track) => track.trackId).filter((trackId): trackId is string => Boolean(trackId));
  const previousIds = new Set(snapshotTrackIds);
  const server = await resolveGeneratedPlaylistServer({ userId, generatedPlaylist, config: savedConfig });
  const currentPlaylist = generatedPlaylist.plexPlaylistRatingKey && server
    ? await fetchPlexPlaylistTracksInOrder({ userId, server, playlistId: generatedPlaylist.plexPlaylistRatingKey })
    : null;
  const currentPlaylistTrackCount = currentPlaylist?.ratingKeys.length ?? generatedPlaylist.trackCount;
  const recipe = generatedPlaylist.recipeId
    ? await prisma.playlistRecipe.findFirst({ where: { id: generatedPlaylist.recipeId, userId, isArchived: false }, select: { id: true } })
    : null;

  const baseRegenerationWarnings = [
    "This will replace the tracks in the existing Plex playlist after confirmation.",
    ...(generatedPlaylist.plexPlaylistRatingKey ? [] : ["The original Plex playlist could not be found because no Plex playlist identifier was saved."]),
    ...(snapshotTrackIds.length === 0 ? ["Original playlist snapshot is not available. Mixarr will regenerate using the saved filters."] : []),
    ...(preferDifferentTracks && snapshotTrackIds.length === 0 ? ["Previous track snapshot is not available yet. Mixarr will save one after this regeneration."] : []),
    ...(generatedPlaylist.recipeId && !recipe ? ["Original recipe no longer exists. Using saved playlist settings from the last generation."] : []),
    ...(generatedPlaylist.recipeId && recipe ? ["This regeneration uses the settings saved when the playlist was created."] : []),
    ...(groupContext ? [`Group settings inherited from ${groupContext.name}.`] : []),
  ].filter((warning, index, list) => list.indexOf(warning) === index);

  if (regenerationMode === "replace_all") {
    const replacement = await generateRegenerationReplacementTracks({
      userId,
      config: savedConfig,
      targetCount: savedConfig.limit,
      personalizationPlaylistId: generatedPlaylistId,
      preferDifferentTrackIds: preferDifferentTracks ? snapshotTrackIds : [],
    });
    const safetyResult = applyPlaylistSafetyRules(replacement.tracks, savedConfig);
    const finalTracks = safetyResult.tracks;
    const finalIds = new Set(finalTracks.map((track) => track.id));
    const reused = finalTracks.filter((track) => previousIds.has(track.id)).length;
    const removed = snapshotTrackIds.filter((trackId) => !finalIds.has(trackId)).length;
    const warnings = [
      ...baseRegenerationWarnings,
      ...(replacement.tracks.length < savedConfig.limit
        ? [`Only ${replacement.tracks.length} replacement tracks were available. The regenerated playlist may be shorter than expected.`]
        : []),
      ...replacement.safety.warnings,
      ...safetyResult.metadata.warnings,
    ];

    return {
      generatedPlaylist,
      preview: buildRegenerationPreviewPayload({
        tracks: finalTracks,
        config: savedConfig,
        warnings,
        safety: combineSafetyMetadata(replacement.safety, safetyResult.metadata),
        matchingTrackCount: replacement.tracks.length,
        regeneration: {
          mode: "replace_all",
          currentPlaylistTrackCount,
          previousSnapshotTrackCount: snapshotTrackIds.length,
          newPreviewTrackCount: finalTracks.length,
          tracksKept: 0,
          tracksReplaced: currentPlaylistTrackCount,
          tracksReused: reused,
          newTracks: finalTracks.length - reused,
          removedTracks: removed,
          manualExclusionsApplied: (replacement.safety as any).manualExclusionsRemoved || 0,
          safetyRulesApplied: safetyResult.metadata.safetyRulesApplied,
          previousTracksAvoided: preferDifferentTracks && snapshotTrackIds.length > 0 ? replacement.preferredTracksAvoided : 0,
          preferDifferentTracks,
          keepPercent: null,
          smartPresetName: generatedPlaylist.smartPresetName,
          moodPresetName: generatedPlaylist.moodPresetName,
          bpmPresetName: generatedPlaylist.bpmPresetName,
          tuningPresetName: normalizeSmartMixTuningConfig(savedConfig.tuningConfig).presetName || generatedPlaylist.tuningPresetName,
          recipeName: generatedPlaylist.recipeName,
          snapshotAvailable: snapshotTrackIds.length > 0,
        },
      }),
    };
  }

  if (!generatedPlaylist.plexPlaylistRatingKey) {
    throw new Error("Mixarr could not find the existing Plex playlist. Create a new playlist instead?");
  }
  if (!server) {
    throw new Error("No Plex server was available for this playlist");
  }

  const currentTracks = currentPlaylist || await fetchPlexPlaylistTracksInOrder({ userId, server, playlistId: generatedPlaylist.plexPlaylistRatingKey });
  const keepTarget = Math.floor(currentTracks.ratingKeys.length * (normalizedKeepPercent / 100));
  const keepable = await filterCurrentTracksForKeep({ userId, config: savedConfig, tracks: currentTracks.tracks });
  const keptTracks = uniqueTracksById(keepable.tracks).slice(0, keepTarget);
  const replacementTarget = Math.max(0, savedConfig.limit - keptTracks.length);
  const replacement = await generateRegenerationReplacementTracks({
    userId,
    config: savedConfig,
    targetCount: replacementTarget,
    personalizationPlaylistId: generatedPlaylistId,
    omitTrackIds: keptTracks.map((track) => track.id),
    preferDifferentTrackIds: preferDifferentTracks ? snapshotTrackIds.filter((trackId) => !keptTracks.some((track) => track.id === trackId)) : [],
  });
  const combinedTracks = uniqueTracksById([...keptTracks, ...replacement.tracks]);
  const safetyResult = applyPlaylistSafetyRules(combinedTracks, savedConfig);
  const finalTracks = safetyResult.tracks;
  const finalTrackIds = new Set(finalTracks.map((track) => track.id));
  const finalKeptTrackCount = keptTracks.filter((track) => finalTrackIds.has(track.id)).length;
  const newTracksAdded = finalTracks.filter((track) => !keptTracks.some((keptTrack) => keptTrack.id === track.id)).length;
  const replacedTrackCount = Math.max(0, currentTracks.ratingKeys.length - finalKeptTrackCount);
  const reused = finalTracks.filter((track) => previousIds.has(track.id)).length;
  const removed = snapshotTrackIds.filter((trackId) => !finalTrackIds.has(trackId)).length;
  const totalManualExclusionsRemoved = ((replacement.safety as any).manualExclusionsRemoved || 0) + keepable.manualExcludedCurrentTrackCount;
  const warnings = [
    ...baseRegenerationWarnings,
    ...(currentTracks.missingTrackCount > 0 ? [`${currentTracks.missingTrackCount} current Plex playlist track${currentTracks.missingTrackCount === 1 ? "" : "s"} could not be matched to active Mixarr tracks and will be replaced.`] : []),
    ...(replacement.tracks.length < replacementTarget ? [`Only ${replacement.tracks.length} replacement tracks were available. The regenerated playlist may be shorter than expected.`] : []),
    ...replacement.safety.warnings,
    ...safetyResult.metadata.warnings,
  ];
  const safety = combineSafetyMetadata(
    {
      ...replacement.safety,
      manualExclusionsRemoved: totalManualExclusionsRemoved,
    },
    safetyResult.metadata,
  );

  return {
    generatedPlaylist,
    preview: buildRegenerationPreviewPayload({
      tracks: finalTracks,
      config: savedConfig,
      warnings,
      safety,
      matchingTrackCount: replacement.tracks.length,
      regeneration: {
        mode: "keep_some",
        currentPlaylistTrackCount: currentTracks.ratingKeys.length,
        previousSnapshotTrackCount: snapshotTrackIds.length,
        newPreviewTrackCount: finalTracks.length,
        tracksKept: finalKeptTrackCount,
        tracksReplaced: replacedTrackCount,
        tracksReused: reused,
        newTracks: newTracksAdded,
        newTracksAdded,
        removedTracks: removed,
        keepPercent: normalizedKeepPercent,
        manualExclusionsApplied: totalManualExclusionsRemoved,
        manualExclusionsRemoved: totalManualExclusionsRemoved,
        safetyRulesApplied: safetyResult.metadata.safetyRulesApplied,
        previousTracksAvoided: preferDifferentTracks && snapshotTrackIds.length > 0 ? replacement.preferredTracksAvoided : 0,
        preferDifferentTracks,
        smartPresetName: generatedPlaylist.smartPresetName,
        moodPresetName: generatedPlaylist.moodPresetName,
        bpmPresetName: generatedPlaylist.bpmPresetName,
        tuningPresetName: normalizeSmartMixTuningConfig(savedConfig.tuningConfig).presetName || generatedPlaylist.tuningPresetName,
        recipeName: generatedPlaylist.recipeName,
        snapshotAvailable: snapshotTrackIds.length > 0,
      },
    }),
  };
}

export async function regenerateGeneratedPlaylistFromPreview({
  userId,
  generatedPlaylistId,
  trackIds,
  previewId,
  mode = "replace_all",
  keepPercent,
  preferDifferentTracks = false,
  regeneration,
  warnings = [],
}: {
  userId: string;
  generatedPlaylistId: string;
  trackIds: string[];
  previewId?: string | null;
  mode?: string;
  keepPercent?: number | null;
  preferDifferentTracks?: boolean;
  regeneration?: any;
  warnings?: string[];
}) {
  const regenerationMode = validateRegenerationMode(mode);
  const normalizedKeepPercent = regenerationMode === "keep_some" ? validateKeepPercent(Number(keepPercent || regeneration?.keepPercent || 25)) : null;
  const generatedPlaylist = await prisma.generatedPlaylist.findFirst({
    where: { id: generatedPlaylistId, userId },
  });

  if (!generatedPlaylist) {
    throw new Error("Generated playlist not found");
  }
  if (!generatedPlaylist.plexPlaylistRatingKey) {
    throw new Error("Mixarr could not find the existing Plex playlist. Create a new playlist instead?");
  }
  if (!trackIds.length) {
    throw new Error("Regeneration preview must include at least one track");
  }

  const startedAt = new Date();
  let tracks: Awaited<ReturnType<typeof fetchOwnedTracksInOrder>> = [];
  let targetServer: any = null;
  try {
    const filtered = await filterManualTrackExclusions(userId, trackIds);
    if (filtered.excludedTrackCount > 0) {
      throw new Error("The regeneration preview includes tracks that are now manually excluded. Preview regeneration again.");
    }

    tracks = await fetchOwnedTracksInOrder(userId, filtered.trackIds);
    targetServer = generatedPlaylist.serverId
      ? await prisma.server.findFirst({ where: { id: generatedPlaylist.serverId, userId } })
      : null;
    if (!targetServer) targetServer = assertSingleServer(tracks);
    if (!targetServer) throw new Error("No Plex server was available for this playlist");

    await assertPlexPlaylistExists({
      server: targetServer,
      playlistId: generatedPlaylist.plexPlaylistRatingKey,
    });
    await pushTracksToPlex({
      server: targetServer,
      name: generatedPlaylist.plexPlaylistTitle,
      ratingKeys: tracks.map((track) => track.ratingKey || track.plexId),
      playlistId: generatedPlaylist.plexPlaylistRatingKey,
    });

    const config = normalizeGeneratedPlaylistConfig(generatedPlaylist.filtersJson, generatedPlaylist.engineVersion);
    const regenerationTuning = normalizeSmartMixTuningConfig(config.tuningConfig);
    let regenerationDiscovery = null;
    if (config.engineVersion === SMART_MIX_ENGINE_V2) {
      const recentPlaylistUsage = regenerationTuning.discovery.avoidRecentlyUsedPlaylistTracks
        ? await getRecentPlaylistUsage(userId, regenerationTuning.discovery.recentPlaylistLookback)
        : {};
      const discoveryScoring = scoreDiscoveryCandidatePool({ candidates: tracks.map((track) => ({ ...track, score: 75 })), config: regenerationTuning.discovery, recentUsage: recentPlaylistUsage });
      regenerationDiscovery = summarizeDiscovery(discoveryScoring.tracks, discoveryScoring.tracks, regenerationTuning.discovery, discoveryScoring.executionTimeMs);
    }
    const qualityScore = config.engineVersion === SMART_MIX_ENGINE_V2 ? scorePlaylist(tracks, regenerationTuning, regenerationDiscovery || undefined) : null;
    const { createPlaylistVersionInTransaction } = await import("./playlists/versions/playlist-version-service");
    await prisma.$transaction(async (tx) => {
      await tx.generatedPlaylist.update({
        where: { id: generatedPlaylist.id },
        data: {
          serverId: targetServer.id,
          engineVersion: config.engineVersion,
          qualityScoreJson: qualityScore as any,
          discoveryConfigJson: config.engineVersion === SMART_MIX_ENGINE_V2 ? regenerationTuning.discovery as any : undefined,
          discoveryResultJson: config.engineVersion === SMART_MIX_ENGINE_V2 ? regenerationDiscovery as any : undefined,
          trackCount: tracks.length,
          lastRegeneratedAt: new Date(),
          lastGeneratedAt: new Date(),
        },
      });
      await replaceGeneratedPlaylistSnapshot(generatedPlaylist.id, tracks, tx);
      await tx.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: generatedPlaylist.id }, { playlistBId: generatedPlaylist.id }] }, data: { stale: true } });
      await tx.playlistCoordinationSetting.updateMany({ where: { playlistId: generatedPlaylist.id }, data: { analysisStale: true } });
      await createPlaylistVersionInTransaction(tx, { generatedPlaylistId: generatedPlaylist.id, reason: "full_regeneration", description: "Regenerated entire playlist" });
    });
    await prisma.playlistHistory.create({
      data: {
        userId,
        serverId: targetServer.id,
        name: generatedPlaylist.plexPlaylistTitle,
        rulesJson: rulesJsonFromConfig(config),
        optionsJson: JSON.stringify(config),
        trackCount: tracks.length,
        plexPlaylistId: generatedPlaylist.plexPlaylistRatingKey,
        status: "success",
      },
    });
    const keptCount = Math.max(0, Number(regeneration?.tracksKept) || 0);
    const replacedCount = Math.max(0, Number(regeneration?.tracksReplaced) || Math.max(0, trackIds.length - keptCount));
    const newTrackCount = Math.max(0, Number(regeneration?.newTracksAdded ?? regeneration?.newTracks) || 0);
    const removedCount = Math.max(0, Number(regeneration?.removedTracks) || 0);
    const previousTrackCount = Math.max(0, Number(regeneration?.currentPlaylistTrackCount ?? regeneration?.previousSnapshotTrackCount) || 0);
    const manualExclusionsRemoved = Math.max(0, Number(regeneration?.manualExclusionsRemoved ?? regeneration?.manualExclusionsApplied) || 0);
    const avoidedCount = Math.max(0, Number(regeneration?.previousTracksAvoided) || 0);
    const modeSummary = regenerationMode === "keep_some" && normalizedKeepPercent
      ? `Regenerated playlist "${generatedPlaylist.plexPlaylistTitle}" keeping ${normalizedKeepPercent}% of existing tracks. Kept ${keptCount}, replaced ${replacedCount}.`
      : `Regenerated playlist "${generatedPlaylist.plexPlaylistTitle}" using Replace All Tracks with ${tracks.length} tracks.`;
    const preferDifferentSummary = preferDifferentTracks
      ? ` Regenerated playlist "${generatedPlaylist.plexPlaylistTitle}" with Prefer Different enabled. Avoided ${avoidedCount} previous tracks.`
      : "";
    await recordPlaylistHistoryEntry({
      userId,
      generatedPlaylistId: generatedPlaylist.id,
      serverId: targetServer.id,
      plexPlaylistRatingKey: generatedPlaylist.plexPlaylistRatingKey,
      playlistName: generatedPlaylist.plexPlaylistTitle,
      eventType: "regenerated",
      sourceType: "regeneration",
      recipeId: generatedPlaylist.recipeId,
      recipeName: generatedPlaylist.recipeName,
      smartPresetId: generatedPlaylist.smartPresetId,
      smartPresetName: generatedPlaylist.smartPresetName,
      moodPresetId: generatedPlaylist.moodPresetId,
      moodPresetName: generatedPlaylist.moodPresetName,
      bpmPresetId: generatedPlaylist.bpmPresetId,
      bpmPresetName: generatedPlaylist.bpmPresetName,
      engineVersion: config.engineVersion,
      regenerationMode,
      keepPercent: normalizedKeepPercent,
      preferDifferentTracks,
      trackCount: tracks.length,
      previousTrackCount,
      keptCount,
      replacedCount,
      newCount: newTrackCount,
      removedCount,
      manualExclusionsRemoved,
      safetyRulesApplied: Boolean(regeneration?.safetyRulesApplied || safetyRulesAreEnabled(config)),
      safetyRulesRemoved: Math.max(0, Number((regeneration as any)?.removedBySafetyRules) || 0),
      warnings,
      filters: config,
      safetyRules: config.safetyRules,
      qualityScore,
      summary: `${modeSummary}${preferDifferentSummary}`,
      tracks,
    });
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist regeneration",
      status: "success",
      trigger: "manual",
      startedAt,
      summary: `${modeSummary}${preferDifferentSummary}`,
      counts: { attempted: trackIds.length, processed: tracks.length, skipped: Math.max(0, trackIds.length - tracks.length), failed: 0 },
      metadata: {
        generatedPlaylistId,
        plexPlaylistRatingKey: generatedPlaylist.plexPlaylistRatingKey,
        playlistName: generatedPlaylist.plexPlaylistTitle,
        mode: regenerationMode,
        keepPercent: normalizedKeepPercent,
        preferDifferentTracks,
        tracksKept: keptCount,
        tracksReplaced: replacedCount,
        previousTracksAvoided: avoidedCount,
        sourceType: generatedPlaylist.sourceType,
        recipeId: generatedPlaylist.recipeId,
        recipeName: generatedPlaylist.recipeName,
        smartPresetId: generatedPlaylist.smartPresetId,
        smartPresetName: generatedPlaylist.smartPresetName,
        moodPresetId: generatedPlaylist.moodPresetId,
        moodPresetName: generatedPlaylist.moodPresetName,
        bpmPresetId: generatedPlaylist.bpmPresetId,
        bpmPresetName: generatedPlaylist.bpmPresetName,
        engineVersion: config.engineVersion,
        trackCount: tracks.length,
        manualExclusionsRemoved,
        safetyRules: config.safetyRules,
        qualityScore,
        warnings,
        previewId: previewId || null,
      },
    });

    return {
      success: true,
      playlistId: generatedPlaylist.plexPlaylistRatingKey,
      serverId: targetServer.id,
      trackCount: tracks.length,
    };
  } catch (error: any) {
    const message = error.message || "Failed to regenerate playlist";
    await prisma.playlistHistory.create({
      data: {
        userId,
        serverId: targetServer?.id || generatedPlaylist.serverId,
        name: generatedPlaylist.plexPlaylistTitle,
        rulesJson: JSON.stringify((generatedPlaylist.filtersJson as any)?.ruleTree || (generatedPlaylist.filtersJson as any)?.rules || []),
        optionsJson: JSON.stringify(generatedPlaylist.filtersJson || {}),
        trackCount: 0,
        plexPlaylistId: generatedPlaylist.plexPlaylistRatingKey,
        status: "failed",
        error: message,
      },
    }).catch(() => undefined);
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Playlist regeneration",
      status: "failed",
      trigger: "manual",
      startedAt,
      summary: `Failed to regenerate playlist "${generatedPlaylist.plexPlaylistTitle}". ${message}`,
      counts: { attempted: trackIds.length, processed: 0, skipped: 0, failed: 1 },
      error: message,
      metadata: {
        generatedPlaylistId,
        plexPlaylistRatingKey: generatedPlaylist.plexPlaylistRatingKey,
        playlistName: generatedPlaylist.plexPlaylistTitle,
        mode: regenerationMode,
        keepPercent: normalizedKeepPercent,
        preferDifferentTracks,
        sourceType: generatedPlaylist.sourceType,
        recipeId: generatedPlaylist.recipeId,
        recipeName: generatedPlaylist.recipeName,
        smartPresetId: generatedPlaylist.smartPresetId,
        smartPresetName: generatedPlaylist.smartPresetName,
        moodPresetId: generatedPlaylist.moodPresetId,
        moodPresetName: generatedPlaylist.moodPresetName,
        bpmPresetId: generatedPlaylist.bpmPresetId,
        bpmPresetName: generatedPlaylist.bpmPresetName,
        engineVersion: generatedPlaylist.engineVersion || SMART_MIX_ENGINE_V1,
        trackCount: 0,
        warnings,
        previewId: previewId || null,
      },
    });
    throw error;
  }
}

function advancedTrackStates(snapshot: Array<{ trackId: string | null; position: number; locked: boolean; liked: boolean; regenerationExcluded: boolean }>): PlaylistTrackState[] {
  return snapshot.filter((item): item is typeof item & { trackId: string } => Boolean(item.trackId)).map((item) => ({
    trackId: item.trackId,
    position: item.position,
    locked: item.locked,
    liked: item.liked,
    regenerationExcluded: item.regenerationExcluded,
  }));
}

async function loadAdvancedRegenerationPlaylist(userId: string, generatedPlaylistId: string) {
  const generatedPlaylist = await prisma.generatedPlaylist.findFirst({
    where: { id: generatedPlaylistId, userId },
    include: { tracks: { orderBy: { position: "asc" } } },
  });
  if (!generatedPlaylist) throw new Error("Generated playlist not found");
  if (generatedPlaylist.engineVersion !== SMART_MIX_ENGINE_V2) {
    throw new Error("Advanced regeneration is available for Smart Mix Engine v2 playlists.");
  }
  const trackIds = generatedPlaylist.tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id));
  if (trackIds.length === 0) throw new Error("This playlist does not have a track snapshot to regenerate.");
  const tracks = await fetchOwnedTracksInOrder(userId, trackIds);
  return { generatedPlaylist, tracks, states: advancedTrackStates(generatedPlaylist.tracks) };
}

function publicWeaknessTrack(track: any, state: PlaylistTrackState, weakness: any) {
  return {
    ...publicPreviewTrack(track),
    position: state.position,
    locked: state.locked,
    liked: Boolean(state.liked),
    regenerationExcluded: Boolean(state.regenerationExcluded),
    weakness,
  };
}

export async function analyzeAdvancedPlaylistRegeneration({ userId, generatedPlaylistId, input }: {
  userId: string;
  generatedPlaylistId: string;
  input?: unknown;
}) {
  const { generatedPlaylist, tracks, states } = await loadAdvancedRegenerationPlaylist(userId, generatedPlaylistId);
  const request = playlistRegenerationRequestSchema.parse({ ...(input as any || {}), playlistId: generatedPlaylistId });
  const weakness = analyzePlaylistWeakness({ tracks, states, request });
  const tuning = normalizeSmartMixTuningConfig((generatedPlaylist.filtersJson as any)?.tuningConfig || generatedPlaylist.tuningConfigJson);
  console.info("[SmartMixV2:Regeneration] playlist analyzed", {
    playlistId: generatedPlaylistId,
    engineVersion: REGENERATION_ENGINE_VERSION,
    mode: request.mode,
    tracksAnalyzed: tracks.length,
    weakTracks: weakness.filter((item) => item.overallWeakness >= REPLACEMENT_THRESHOLDS_FOR_LOG(request)).length,
  });
  return {
    playlist: {
      id: generatedPlaylist.id,
      name: generatedPlaylist.plexPlaylistTitle,
      updatedAt: generatedPlaylist.updatedAt,
      engineVersion: generatedPlaylist.engineVersion,
      qualityScore: generatedPlaylist.qualityScoreJson,
    },
    analysis: weakness,
    tracks: tracks.map((track, index) => publicWeaknessTrack(track, states[index], weakness[index])),
    qualityScore: scorePlaylist(tracks, tuning),
    settings: request,
  };
}

function REPLACEMENT_THRESHOLDS_FOR_LOG(request: PlaylistRegenerationRequest) {
  return request.replacementSensitivity === "conservative" ? 70 : request.replacementSensitivity === "aggressive" ? 35 : 50;
}

export async function previewAdvancedPlaylistRegeneration({ userId, generatedPlaylistId, input }: {
  userId: string;
  generatedPlaylistId: string;
  input: unknown;
}) {
  const startedAt = Date.now();
  const { generatedPlaylist, tracks, states } = await loadAdvancedRegenerationPlaylist(userId, generatedPlaylistId);
  const request = playlistRegenerationRequestSchema.parse({ ...(input as any || {}), playlistId: generatedPlaylistId });
  const tuning = normalizeSmartMixTuningConfig((generatedPlaylist.filtersJson as any)?.tuningConfig || generatedPlaylist.tuningConfigJson);
  const candidateCount = Math.min(500, Math.max(60, request.maximumReplacements * 30));
  const candidateConfig = playlistConfigSchema.parse({
    ...normalizeGeneratedPlaylistConfig(generatedPlaylist.filtersJson, generatedPlaylist.engineVersion),
    limit: candidateCount,
    pinnedTrackIds: [],
    excludedTrackIds: uniqueTrackIds([
      ...((generatedPlaylist.filtersJson as any)?.excludedTrackIds || []),
      ...tracks.map((track) => track.id),
    ]),
  });
  let candidatesResult = request.candidateTrackIds?.length
    ? { tracks: await fetchOwnedTracksInOrder(userId, uniqueTrackIds(request.candidateTrackIds)) }
    : await generatePlaylistTracksWithStats({ userId, config: candidateConfig, personalizationPlaylistId: generatedPlaylistId });
  if (request.candidateTrackIds?.length) {
    const profile = await prisma.userRecommendationProfile.findUnique({ where: { userId }, select: { enabled: true } });
    if (profile?.enabled) {
      const excluded = new Set((await prisma.userTrackPreference.findMany({ where: { userId, state: "NEVER_RECOMMEND", trackId: { in: candidatesResult.tracks.map((track) => track.id) } }, select: { trackId: true } })).map((row) => row.trackId));
      candidatesResult = { tracks: candidatesResult.tracks.filter((track) => !excluded.has(track.id)) };
    }
  }
  (request as any).bpmFlow = tuning.bpmFlow;
  const preview = regeneratePlaylist({
    playlistId: generatedPlaylistId,
    tracks,
    states,
    candidates: candidatesResult.tracks,
    request,
    tuningConfig: tuning,
    identity: await loadPlaylistIdentityScoringContext(userId, generatedPlaylistId),
  });
  await prisma.playlistRegeneration.updateMany({
    where: { generatedPlaylistId, status: "preview" },
    data: { status: "superseded" },
  });
  const persisted = await prisma.playlistRegeneration.create({
    data: {
      userId,
      generatedPlaylistId,
      mode: request.mode,
      status: "preview",
      settingsJson: request as any,
      warningsJson: preview.warnings as any,
      originalScore: preview.originalPlaylistScore,
      proposedScore: preview.proposedPlaylistScore,
      originalDurationMs: preview.originalDurationMs,
      proposedDurationMs: preview.proposedDurationMs,
      tracksAnalyzed: preview.analyzedTrackCount,
      tracksProposed: preview.changes.length,
      engineVersion: REGENERATION_ENGINE_VERSION,
      playlistUpdatedAt: generatedPlaylist.updatedAt,
      changes: {
        create: preview.changes.map((change) => ({
          position: change.position,
          originalTrackId: change.originalTrackId,
          proposedTrackId: change.proposedTrackId,
          originalScore: change.originalScore,
          proposedScore: change.proposedScore,
          improvement: change.improvement,
          reasonsJson: change.reasons as any,
          originalMetricsJson: change.originalMetrics as any,
          proposedMetricsJson: change.proposedMetrics as any,
        })),
      },
    },
    include: { changes: { orderBy: { position: "asc" } } },
  });
  console.info("[SmartMixV2:Regeneration] preview generated", {
    playlistId: generatedPlaylistId,
    regenerationId: persisted.id,
    engineVersion: REGENERATION_ENGINE_VERSION,
    mode: request.mode,
    candidatePoolSize: candidatesResult.tracks.length,
    proposedChanges: preview.changes.length,
    durationMs: Date.now() - startedAt,
  });
  return {
    ...preview,
    previewId: persisted.id,
    changes: preview.changes.map((change, index) => ({
      ...change,
      id: persisted.changes[index]?.id,
      originalTrack: publicPreviewTrack(change.originalTrack),
      proposedTrack: publicPreviewTrack(change.proposedTrack),
    })),
    candidatePoolSize: candidatesResult.tracks.length,
    progressStages: ["Analyzing playlist", "Finding weak tracks", "Searching replacement candidates", "Scoring transitions", "Preserving curves", "Building preview", "Ready for review"],
  };
}

type StoredTrackSnapshot = {
  trackId: string | null;
  plexTrackRatingKey: string | null;
  position: number;
  title: string;
  artist: string | null;
  album: string | null;
  locked: boolean;
  liked: boolean;
  regenerationExcluded: boolean;
};

function storedTrackSnapshot(tracks: StoredTrackSnapshot[]) {
  return tracks.map((track) => ({
    trackId: track.trackId,
    plexTrackRatingKey: track.plexTrackRatingKey,
    position: track.position,
    title: track.title,
    artist: track.artist,
    album: track.album,
    locked: track.locked,
    liked: track.liked,
    regenerationExcluded: track.regenerationExcluded,
  }));
}

export async function applyAdvancedPlaylistRegeneration({
  userId,
  generatedPlaylistId,
  previewId,
  acceptedPositions,
  lockProposedPositions = [],
}: {
  userId: string;
  generatedPlaylistId: string;
  previewId: string;
  acceptedPositions?: number[];
  lockProposedPositions?: number[];
}) {
  const regeneration = await prisma.playlistRegeneration.findFirst({
    where: { id: previewId, generatedPlaylistId, userId },
    include: {
      generatedPlaylist: { include: { tracks: { orderBy: { position: "asc" } } } },
      changes: { orderBy: { position: "asc" } },
    },
  });
  if (!regeneration) throw new Error("Regeneration preview not found");
  if (regeneration.status !== "preview") throw new Error("This regeneration preview is no longer available to apply.");
  if (regeneration.generatedPlaylist.updatedAt.getTime() !== regeneration.playlistUpdatedAt.getTime()) {
    throw new Error("Playlist changed. Generate a new preview before applying changes.");
  }
  const accepted = new Set(acceptedPositions || regeneration.changes.map((change) => change.position));
  const acceptedChanges = regeneration.changes.filter((change) => accepted.has(change.position));
  const rejectedChanges = regeneration.changes.filter((change) => !accepted.has(change.position));
  if (acceptedChanges.length === 0) {
    await prisma.playlistRegeneration.update({ where: { id: regeneration.id }, data: { status: "rejected" } });
    for (const change of regeneration.changes) {
      recordTrackInteractionInBackground({ userId, trackId: change.proposedTrackId, playlistId: generatedPlaylistId, eventType: "TRACK_REJECTED_FROM_PREVIEW", eventSource: "REGENERATION_PREVIEW", generationId: regeneration.id, idempotencyKey: `regeneration:${regeneration.id}:${change.position}:rejected`, context: { baseScore: change.proposedScore ?? undefined } });
    }
    return { success: true, rejected: true, tracksReplaced: 0 };
  }
  const snapshot = regeneration.generatedPlaylist.tracks as StoredTrackSnapshot[];
  const nextIds = snapshot.map((track) => track.trackId);
  for (const change of acceptedChanges) {
    const current = snapshot[change.position - 1];
    if (!current || current.trackId !== change.originalTrackId) {
      await prisma.playlistRegeneration.update({ where: { id: regeneration.id }, data: { status: "stale" } });
      throw new Error("Playlist changed. Generate a new preview before applying changes.");
    }
    if (current.locked || current.regenerationExcluded || current.liked && (regeneration.settingsJson as any)?.keepLikedTracks !== false) {
      await prisma.playlistRegeneration.update({ where: { id: regeneration.id }, data: { status: "stale" } });
      throw new Error(`Track at position ${change.position} is locked or preserved.`);
    }
    nextIds[change.position - 1] = change.proposedTrackId;
  }
  for (const change of rejectedChanges) {
    recordTrackInteractionInBackground({ userId, trackId: change.proposedTrackId, playlistId: generatedPlaylistId, eventType: "TRACK_REJECTED_FROM_PREVIEW", eventSource: "REGENERATION_PREVIEW", generationId: regeneration.id, idempotencyKey: `regeneration:${regeneration.id}:${change.position}:rejected`, context: { baseScore: change.proposedScore ?? undefined } });
    rememberPlaylistRejection({ userId, playlistId: generatedPlaylistId, trackId: change.proposedTrackId, source: "REGENERATION_PREVIEW", eventKey: `regeneration:${regeneration.id}:${change.position}:rejected`, strong: false }).catch(() => undefined);
  }
  const orderedIds = nextIds.filter((id): id is string => Boolean(id));
  const [tracks, targetServer] = await Promise.all([
    fetchOwnedTracksInOrder(userId, orderedIds),
    regeneration.generatedPlaylist.serverId
      ? prisma.server.findFirst({ where: { id: regeneration.generatedPlaylist.serverId, userId } })
      : Promise.resolve(null),
  ]);
  const server = targetServer || assertSingleServer(tracks);
  if (!regeneration.generatedPlaylist.plexPlaylistRatingKey) throw new Error("Mixarr could not find the existing Plex playlist.");
  const config = normalizeGeneratedPlaylistConfig(regeneration.generatedPlaylist.filtersJson, regeneration.generatedPlaylist.engineVersion);
  const tuning = normalizeSmartMixTuningConfig(config.tuningConfig);
  const qualityScore = scorePlaylist(tracks, tuning);
  const lockProposed = new Set(lockProposedPositions);
  const claimed = await prisma.playlistRegeneration.updateMany({
    where: { id: regeneration.id, status: "preview" },
    data: { status: "applying" },
  });
  if (claimed.count !== 1) throw new Error("This regeneration preview is already being applied.");
  try {
    await assertPlexPlaylistExists({ server, playlistId: regeneration.generatedPlaylist.plexPlaylistRatingKey });
    await pushTracksToPlex({
      server,
      name: regeneration.generatedPlaylist.plexPlaylistTitle,
      ratingKeys: tracks.map((track) => track.ratingKey || track.plexId),
      playlistId: regeneration.generatedPlaylist.plexPlaylistRatingKey,
    });
    await prisma.$transaction(async (tx) => {
      const revisionCounter = await tx.generatedPlaylist.update({ where: { id: generatedPlaylistId }, data: { revisionCounter: { increment: 1 } }, select: { revisionCounter: true } });
      await tx.playlistRevision.create({
        data: {
          generatedPlaylistId,
          regenerationId: regeneration.id,
          revisionNumber: revisionCounter.revisionCounter,
          reason: "manual_edit",
          description: "Automatic backup before advanced regeneration",
          engineVersion: REGENERATION_ENGINE_VERSION,
          settingsSnapshot: regeneration.generatedPlaylist.filtersJson as any,
          trackSnapshot: storedTrackSnapshot(snapshot) as any,
          scoreSnapshot: regeneration.generatedPlaylist.qualityScoreJson as any,
          trackCount: snapshot.length,
          isCurrent: false,
        },
      });
      await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId } });
      await tx.generatedPlaylistTrack.createMany({
        data: tracks.map((track, index) => {
          const previous = snapshot[index];
          const wasReplaced = acceptedChanges.some((change) => change.position === index + 1);
          return {
            generatedPlaylistId,
            trackId: track.id,
            plexTrackRatingKey: track.ratingKey || track.plexId || null,
            position: index + 1,
            title: track.title || "Unknown track",
            artist: track.artist?.title || null,
            album: track.album?.title || null,
            locked: wasReplaced ? lockProposed.has(index + 1) : Boolean(previous?.locked),
            liked: wasReplaced ? Number(track.rating) >= 8 : Boolean(previous?.liked),
            regenerationExcluded: wasReplaced ? false : Boolean(previous?.regenerationExcluded),
          };
        }),
      });
      await tx.generatedPlaylist.update({
        where: { id: generatedPlaylistId },
        data: { qualityScoreJson: qualityScore as any, trackCount: tracks.length, lastRegeneratedAt: new Date(), lastGeneratedAt: new Date() },
      });
      await tx.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: generatedPlaylistId }, { playlistBId: generatedPlaylistId }] }, data: { stale: true } });
      await tx.playlistCoordinationSetting.updateMany({ where: { playlistId: generatedPlaylistId }, data: { analysisStale: true } });
      await tx.playlistRegenerationChange.updateMany({ where: { regenerationId: regeneration.id }, data: { accepted: false } });
      await tx.playlistRegenerationChange.updateMany({ where: { regenerationId: regeneration.id, position: { in: acceptedChanges.map((change) => change.position) } }, data: { accepted: true } });
      await tx.playlistRegeneration.update({
        where: { id: regeneration.id },
        data: { status: "applied", appliedScore: qualityScore.overallScore, tracksApplied: acceptedChanges.length, appliedAt: new Date() },
      });
      const { createPlaylistVersionInTransaction } = await import("./playlists/versions/playlist-version-service");
      await createPlaylistVersionInTransaction(tx, {
        generatedPlaylistId,
        reason: "advanced_regeneration",
        regenerationId: regeneration.id,
        description: `Advanced regeneration — ${String(regeneration.mode).replaceAll("_", " ")}; replaced ${acceptedChanges.length} track${acceptedChanges.length === 1 ? "" : "s"}`,
        force: true,
      });
    });
  } catch (error) {
    console.error("[SmartMixV2:Regeneration] apply transaction failed", { playlistId: generatedPlaylistId, regenerationId: regeneration.id, engineVersion: REGENERATION_ENGINE_VERSION });
    await pushTracksToPlex({
      server,
      name: regeneration.generatedPlaylist.plexPlaylistTitle,
      ratingKeys: snapshot.map((track) => track.plexTrackRatingKey).filter((key): key is string => Boolean(key)),
      playlistId: regeneration.generatedPlaylist.plexPlaylistRatingKey,
    }).catch(() => undefined);
    await prisma.playlistRegeneration.update({ where: { id: regeneration.id }, data: { status: "failed" } }).catch(() => undefined);
    throw error;
  }
  await recordPlaylistHistoryEntry({
    userId,
    generatedPlaylistId,
    serverId: server.id,
    plexPlaylistRatingKey: regeneration.generatedPlaylist.plexPlaylistRatingKey,
    playlistName: regeneration.generatedPlaylist.plexPlaylistTitle,
    eventType: "regenerated",
    sourceType: "regeneration",
    engineVersion: SMART_MIX_ENGINE_V2,
    regenerationMode: regeneration.mode,
    trackCount: tracks.length,
    previousTrackCount: snapshot.length,
    keptCount: tracks.length - acceptedChanges.length,
    replacedCount: acceptedChanges.length,
    newCount: acceptedChanges.length,
    removedCount: acceptedChanges.length,
    warnings: regeneration.warningsJson,
    filters: config,
    safetyRules: config.safetyRules,
    qualityScore,
    summary: `Advanced regeneration replaced ${acceptedChanges.length} track${acceptedChanges.length === 1 ? "" : "s"}. Score ${regeneration.originalScore ?? "-"} to ${qualityScore.overallScore}.`,
    tracks,
  });
  for (const change of acceptedChanges) {
    recordTrackInteractionInBackground({
      userId,
      trackId: change.originalTrackId,
      playlistId: generatedPlaylistId,
      eventType: "TRACK_REPLACED",
      eventSource: "REGENERATION_PREVIEW",
      generationId: regeneration.id,
      idempotencyKey: `regeneration:${regeneration.id}:${change.position}:replaced`,
      context: { baseScore: change.originalScore ?? undefined },
    });
    recordTrackInteractionInBackground({
      userId,
      trackId: change.proposedTrackId,
      playlistId: generatedPlaylistId,
      eventType: "TRACK_ACCEPTED_FROM_PREVIEW",
      eventSource: "REGENERATION_PREVIEW",
      generationId: regeneration.id,
      idempotencyKey: `regeneration:${regeneration.id}:${change.position}:accepted`,
      context: { baseScore: change.proposedScore ?? undefined },
    });
    recordPlaylistIdentityEvent({ userId, playlistId: generatedPlaylistId, trackId: change.originalTrackId, eventType: "TRACK_REPLACED", eventSource: "REGENERATION", eventKey: `regeneration:${regeneration.id}:${change.position}:removed`, previousPosition: change.position, generationRunId: regeneration.id, engineVersion: REGENERATION_ENGINE_VERSION }).catch(() => undefined);
    recordPlaylistIdentityEvent({ userId, playlistId: generatedPlaylistId, trackId: change.proposedTrackId, eventType: "TRACK_ADDED", eventSource: "REGENERATION", eventKey: `regeneration:${regeneration.id}:${change.position}:added`, newPosition: change.position, generationRunId: regeneration.id, engineVersion: REGENERATION_ENGINE_VERSION }).catch(() => undefined);
  }
  trainPlaylistIdentity({ userId, playlistId: generatedPlaylistId, source: "REGENERATION" }).catch(() => undefined);
  console.info("[SmartMixV2:Regeneration] changes applied", { playlistId: generatedPlaylistId, regenerationId: regeneration.id, engineVersion: REGENERATION_ENGINE_VERSION, mode: regeneration.mode, replacements: acceptedChanges.length });
  return {
    success: true,
    regenerationId: regeneration.id,
    tracksReplaced: acceptedChanges.length,
    trackCount: tracks.length,
    originalScore: regeneration.originalScore,
    appliedScore: qualityScore.overallScore,
  };
}

export async function undoAdvancedPlaylistRegeneration({ userId, generatedPlaylistId }: { userId: string; generatedPlaylistId: string }) {
  const regeneration = await prisma.playlistRegeneration.findFirst({
    where: { generatedPlaylistId, userId, status: "applied" },
    orderBy: { appliedAt: "desc" },
    include: { generatedPlaylist: { include: { tracks: { orderBy: { position: "asc" } } } } },
  });
  if (!regeneration) throw new Error("No applied regeneration is available to undo.");
  const revision = await prisma.playlistRevision.findFirst({ where: { generatedPlaylistId, regenerationId: regeneration.id, reason: { in: ["regeneration", "manual_edit"] } }, orderBy: { revisionNumber: "asc" } });
  if (!revision || !Array.isArray(revision.trackSnapshot)) throw new Error("The server-side revision for this regeneration is unavailable.");
  const restoreSnapshot = revision.trackSnapshot as unknown as StoredTrackSnapshot[];
  const currentSnapshot = regeneration.generatedPlaylist.tracks as StoredTrackSnapshot[];
  const restoreIds = restoreSnapshot.map((track) => track.trackId).filter((id): id is string => Boolean(id));
  const tracks = await fetchOwnedTracksInOrder(userId, restoreIds);
  const server = regeneration.generatedPlaylist.serverId
    ? await prisma.server.findFirst({ where: { id: regeneration.generatedPlaylist.serverId, userId } })
    : assertSingleServer(tracks);
  if (!server || !regeneration.generatedPlaylist.plexPlaylistRatingKey) throw new Error("The Plex playlist is unavailable for undo.");
  const claimed = await prisma.playlistRegeneration.updateMany({ where: { id: regeneration.id, status: "applied" }, data: { status: "undoing" } });
  if (claimed.count !== 1) throw new Error("This regeneration is already being undone.");
  try {
    await pushTracksToPlex({ server, name: regeneration.generatedPlaylist.plexPlaylistTitle, ratingKeys: tracks.map((track) => track.ratingKey || track.plexId), playlistId: regeneration.generatedPlaylist.plexPlaylistRatingKey });
    await prisma.$transaction(async (tx) => {
      const revisionCounter = await tx.generatedPlaylist.update({ where: { id: generatedPlaylistId }, data: { revisionCounter: { increment: 1 } }, select: { revisionCounter: true } });
      await tx.playlistRevision.create({
        data: {
          generatedPlaylistId,
          regenerationId: regeneration.id,
          revisionNumber: revisionCounter.revisionCounter,
          reason: "manual_edit",
          description: "Automatic backup before undoing regeneration",
          engineVersion: REGENERATION_ENGINE_VERSION,
          settingsSnapshot: regeneration.generatedPlaylist.filtersJson as any,
          trackSnapshot: storedTrackSnapshot(currentSnapshot) as any,
          scoreSnapshot: regeneration.generatedPlaylist.qualityScoreJson as any,
          trackCount: currentSnapshot.length,
          isCurrent: false,
        },
      });
      await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId } });
      await tx.generatedPlaylistTrack.createMany({ data: restoreSnapshot.map((track) => ({ ...track, generatedPlaylistId, trackId: track.trackId })) });
      await tx.generatedPlaylist.update({ where: { id: generatedPlaylistId }, data: { trackCount: restoreSnapshot.length, qualityScoreJson: revision.scoreSnapshot as any, lastRegeneratedAt: new Date() } });
      await tx.playlistRegeneration.update({ where: { id: regeneration.id }, data: { status: "undone", undoneAt: new Date() } });
      const { createPlaylistVersionInTransaction } = await import("./playlists/versions/playlist-version-service");
      await createPlaylistVersionInTransaction(tx, {
        generatedPlaylistId,
        reason: "undo",
        regenerationId: regeneration.id,
        description: "Undid advanced regeneration",
        force: true,
      });
    });
  } catch (error) {
    await pushTracksToPlex({ server, name: regeneration.generatedPlaylist.plexPlaylistTitle, ratingKeys: currentSnapshot.map((track) => track.plexTrackRatingKey).filter((key): key is string => Boolean(key)), playlistId: regeneration.generatedPlaylist.plexPlaylistRatingKey }).catch(() => undefined);
    await prisma.playlistRegeneration.update({ where: { id: regeneration.id }, data: { status: "applied" } }).catch(() => undefined);
    throw error;
  }
  console.info("[SmartMixV2:Regeneration] undo completed", { playlistId: generatedPlaylistId, regenerationId: regeneration.id, engineVersion: REGENERATION_ENGINE_VERSION });
  return { success: true, regenerationId: regeneration.id, restoredTrackCount: restoreSnapshot.length };
}

export async function getAdvancedPlaylistRegenerationHistory(userId: string, generatedPlaylistId: string, limit = 25) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true } });
  if (!playlist) return null;
  return prisma.playlistRegeneration.findMany({
    where: { generatedPlaylistId, userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
    include: { changes: { orderBy: { position: "asc" } } },
  });
}

export async function setGeneratedPlaylistTrackLock({ userId, generatedPlaylistId, trackId, locked }: { userId: string; generatedPlaylistId: string; trackId: string; locked: boolean }) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true } });
  if (!playlist) throw new Error("Generated playlist not found");
  const existing = await prisma.generatedPlaylistTrack.findFirst({ where: { generatedPlaylistId, trackId }, select: { id: true, locked: true } });
  if (!existing) throw new Error("Playlist track not found");
  if (existing.locked === locked) return { success: true, trackId, locked, updated: 0 };
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.generatedPlaylistTrack.updateMany({ where: { generatedPlaylistId, trackId }, data: { locked } });
    if (updated.count === 0) throw new Error("Playlist track not found");
    await tx.generatedPlaylist.update({ where: { id: generatedPlaylistId }, data: { updatedAt: new Date() } });
    await tx.playlistRegeneration.updateMany({ where: { generatedPlaylistId, status: "preview" }, data: { status: "stale" } });
    return updated;
  });
  if (locked) recordTrackInteractionInBackground({ userId, trackId, playlistId: generatedPlaylistId, eventType: "TRACK_LOCKED", eventSource: "PLAYLIST_EDITOR" });
  updatePlaylistTrackMemory(userId, generatedPlaylistId, trackId, { importance: locked ? "LOCKED" : "NORMAL" }).catch(() => undefined);
  return { success: true, trackId, locked, updated: result.count };
}

export async function bulkSetGeneratedPlaylistTrackLocks({ userId, generatedPlaylistId, trackIds, locked, likedOnly = false }: { userId: string; generatedPlaylistId: string; trackIds?: string[]; locked: boolean; likedOnly?: boolean }) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true } });
  if (!playlist) throw new Error("Generated playlist not found");
  const uniqueIds = uniqueTrackIds(trackIds || []);
  const where = { generatedPlaylistId, ...(likedOnly ? { liked: true } : uniqueIds.length ? { trackId: { in: uniqueIds } } : {}) };
  const changedTracks = locked ? await prisma.generatedPlaylistTrack.findMany({ where: { AND: [where, { locked: false, trackId: { not: null } }] }, select: { trackId: true }, take: 500 }) : [];
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.generatedPlaylistTrack.updateMany({ where, data: { locked } });
    await tx.generatedPlaylist.update({ where: { id: generatedPlaylistId }, data: { updatedAt: new Date() } });
    await tx.playlistRegeneration.updateMany({ where: { generatedPlaylistId, status: "preview" }, data: { status: "stale" } });
    return updated;
  });
  if (locked) {
    for (const track of changedTracks) {
      if (track.trackId) recordTrackInteractionInBackground({ userId, trackId: track.trackId, playlistId: generatedPlaylistId, eventType: "TRACK_LOCKED", eventSource: "PLAYLIST_EDITOR" });
    }
  }
  return { success: true, locked, updated: result.count };
}

export async function exportTracksToPlex({
  userId,
  name,
  trackIds,
  savedRuleId,
  rulesJson,
  optionsJson,
}: {
  userId: string;
  name: string;
  trackIds: string[];
  savedRuleId?: string | null;
  rulesJson?: string;
  optionsJson?: string;
}) {
  const filtered = await filterManualTrackExclusions(userId, trackIds);
  if (filtered.trackIds.length === 0) {
    throw new Error("All selected tracks are manually excluded from Mixarr playlists");
  }

  const tracks = await fetchOwnedTracksInOrder(userId, filtered.trackIds);
  const targetServer = assertSingleServer(tracks);
  const existingRule = savedRuleId
    ? await prisma.playlistRule.findFirst({ where: { id: savedRuleId, userId } })
    : null;

  if (savedRuleId && !existingRule) {
    throw new Error("Saved playlist was not found");
  }

  const endTimer = playlistExportDurationSeconds.startTimer();
  let exportResult: "success" | "failed" = "success";
  try {
    const playlistId = await pushTracksToPlex({
      server: targetServer,
      name,
      ratingKeys: tracks.map((track) => track.ratingKey || track.plexId),
      playlistId: existingRule?.plexPlaylistId,
    });

    if (existingRule) {
      await prisma.playlistRule.update({
        where: { id: existingRule.id },
        data: {
          name,
          serverId: targetServer.id,
          plexPlaylistId: playlistId,
          lastRefreshedAt: new Date(),
          lastRefreshStatus: "success",
          lastRefreshError: null,
        },
      });
    }

    await prisma.playlistHistory.create({
      data: {
        userId,
        playlistRuleId: existingRule?.id,
        serverId: targetServer.id,
        name,
        rulesJson: existingRule?.rulesJson || rulesJson || "[]",
        optionsJson: existingRule?.optionsJson || optionsJson || "{}",
        trackCount: tracks.length,
        plexPlaylistId: playlistId,
        status: "success",
      },
    });

    return {
      playlistId,
      serverId: targetServer.id,
      createdNewPlaylist: !existingRule,
      trackCount: tracks.length,
      excludedTrackCount: filtered.excludedTrackCount,
      exportedTrackIds: tracks.map((track) => track.id),
    };
  } catch (error: any) {
    exportResult = "failed";
    await prisma.playlistHistory.create({
      data: {
        userId,
        playlistRuleId: existingRule?.id,
        serverId: targetServer.id,
        name,
        rulesJson: existingRule?.rulesJson || rulesJson || "[]",
        optionsJson: existingRule?.optionsJson || optionsJson || "{}",
        trackCount: tracks.length,
        plexPlaylistId: existingRule?.plexPlaylistId,
        status: "failed",
        error: error.message || "Failed to export playlist",
      },
    });
    throw error;
  } finally {
    endTimer();
    playlistExportsTotal.inc({ result: exportResult });
  }
}

export async function rollbackCreatedPlexPlaylist({ userId, serverId, playlistId }: { userId: string; serverId: string; playlistId: string | null | undefined }) {
  if (!playlistId) return false;
  const server = await prisma.server.findFirst({ where: { id: serverId, userId }, select: { uri: true, accessToken: true } });
  if (!server) return false;
  await axios.delete(`${server.uri}/playlists/${playlistId}`, { headers: plexHeaders(server.accessToken) });
  return true;
}

// Process-local set of PlaylistRule IDs currently being refreshed. Mirrors
// the manual-drain race guard from src/app/api/sync/start/route.ts: the
// nightly cron's refreshAutoPlaylists() and the user-facing
// POST /api/playlists/rules/[id]/refresh can otherwise both invoke this
// for the same rule, racing on the same Plex playlist mutation (PUT /items,
// DELETE /items, etc.). The end states usually converge, but the two
// concurrent runs would double-count in mixarr_playlist_refresh metrics,
// double-write PlaylistHistory rows, and in worst cases interleave the
// "delete items" + "add items" calls in a way that leaves the Plex
// playlist briefly empty or with duplicate entries.
//
// In-memory is sufficient because the Next.js server, the cron scheduler
// and the metrics process all live in the same Node process (the
// instrumentation hook); we don't have horizontal scale-out.
const inflightRefreshes = new Set<string>();

export function isRefreshInFlight(ruleId: string): boolean {
  return inflightRefreshes.has(ruleId);
}

export type RefreshMode = "manual" | "auto";

export async function refreshSavedPlaylist(ruleId: string, mode: RefreshMode = "manual") {
  if (inflightRefreshes.has(ruleId)) {
    console.warn(`[PlaylistRefresh] Skipping ${ruleId}; refresh already in flight.`);
    playlistRefreshesTotal.inc({ mode, result: "skipped_locked" });
    await safeRecordJobHistory({
      type: "playlist",
      name: "Playlist refresh",
      status: "warning",
      trigger: mode === "auto" ? "scheduled" : "manual",
      summary: "Playlist refresh skipped because this saved playlist is already refreshing.",
      counts: { attempted: 1, processed: 0, skipped: 1, failed: 0 },
      metadata: { ruleId, mode },
    });
    return null;
  }

  const rule = await prisma.playlistRule.findUnique({ where: { id: ruleId } });
  if (!rule || !rule.plexPlaylistId || !rule.serverId) {
    playlistRefreshesTotal.inc({ mode, result: "skipped_not_exported" });
    await safeRecordJobHistory({
      userId: rule?.userId,
      type: "playlist",
      name: "Playlist refresh",
      status: "warning",
      trigger: mode === "auto" ? "scheduled" : "manual",
      summary: "Playlist refresh skipped because the saved playlist has not been exported yet.",
      counts: { attempted: 1, processed: 0, skipped: 1, failed: 0 },
      metadata: { ruleId, mode },
    });
    return null;
  }

  inflightRefreshes.add(ruleId);
  const endTimer = playlistRefreshDurationSeconds.startTimer({ mode });
  let refreshResult: "success" | "failed" = "success";
  const history = await safeStartJobHistory({
    userId: rule.userId,
    type: "playlist",
    name: "Playlist refresh",
    trigger: mode === "auto" ? "scheduled" : "manual",
    metadata: { ruleId, mode },
  });
  let trackCount = 0;
  let manualExclusionsApplied = 0;
  let safetyMetadata: Awaited<ReturnType<typeof generatePlaylistTracksWithStats>>["safety"] | null = null;
  let refreshEngineVersion: SmartMixEngineVersion = SMART_MIX_ENGINE_V1;
  let refreshQualityScore: PlaylistScoreSummary | null = null;
  let refreshError: string | undefined;
  try {
    const savedRules = JSON.parse(rule.rulesJson);
    const parsed = playlistConfigSchema.parse({
      ...(Array.isArray(savedRules) ? { rules: savedRules } : { ruleTree: savedRules }),
      limit: rule.limit,
      serverId: rule.serverId,
      libraryId: rule.libraryId,
      ...JSON.parse(rule.optionsJson || "{}"),
    });
    refreshEngineVersion = parsed.engineVersion;
    const generation = await generatePlaylistTracksWithStats({
      userId: rule.userId,
      config: parsed,
    });
    const tracks = generation.tracks;
    manualExclusionsApplied = generation.manualExclusionsApplied;
    safetyMetadata = generation.safety;
    trackCount = tracks.length;

    if (tracks.length === 0) {
      throw new Error("No tracks matched this saved playlist");
    }

    const targetServer = assertSingleServer(tracks);
    await pushTracksToPlex({
      server: targetServer,
      name: rule.name,
      ratingKeys: tracks.map((track) => track.ratingKey || track.plexId),
      playlistId: rule.plexPlaylistId,
    });

    await prisma.playlistHistory.create({
      data: {
        userId: rule.userId,
        playlistRuleId: rule.id,
        serverId: targetServer.id,
        name: rule.name,
        rulesJson: rule.rulesJson,
        optionsJson: rule.optionsJson,
        trackCount: tracks.length,
        plexPlaylistId: rule.plexPlaylistId,
        status: "success",
      },
    });

    const generatedPlaylist = await recordGeneratedPlaylist({
      userId: rule.userId,
      serverId: targetServer.id,
      plexPlaylistRatingKey: rule.plexPlaylistId,
      plexPlaylistTitle: rule.name,
      sourceType: parsed.smartPresetName || parsed.moodPresetName || parsed.bpmPresetName ? "smart_builder" : "manual_builder",
      filters: parsed,
      trackIds: tracks.map((track) => track.id),
    });
    refreshQualityScore = (generatedPlaylist.qualityScoreJson as any) || null;
    await recordPlaylistHistoryEntry({
      userId: rule.userId,
      generatedPlaylistId: generatedPlaylist.id,
      serverId: targetServer.id,
      plexPlaylistRatingKey: rule.plexPlaylistId,
      playlistName: rule.name,
      eventType: "regenerated",
      sourceType: "regeneration",
      smartPresetId: generatedPlaylist.smartPresetId,
      smartPresetName: generatedPlaylist.smartPresetName,
      moodPresetId: generatedPlaylist.moodPresetId,
      moodPresetName: generatedPlaylist.moodPresetName,
      bpmPresetId: generatedPlaylist.bpmPresetId,
      bpmPresetName: generatedPlaylist.bpmPresetName,
      engineVersion: parsed.engineVersion,
      regenerationMode: "replace_all",
      trackCount: tracks.length,
      previousTrackCount: rule.plexPlaylistId ? null : 0,
      manualExclusionsRemoved: manualExclusionsApplied,
      safetyRulesApplied: Boolean(safetyMetadata?.safetyRulesApplied),
      safetyRulesRemoved: safetyMetadata?.removedBySafetyRules || 0,
      warnings: safetyMetadata?.warnings || [],
      filters: parsed,
      safetyRules: parsed.safetyRules,
      qualityScore: refreshQualityScore,
      summary: `Regenerated "${rule.name}" from saved playlist refresh with ${tracks.length} track${tracks.length === 1 ? "" : "s"}.`,
      tracks,
    });

    return prisma.playlistRule.update({
      where: { id: rule.id },
      data: {
        lastRefreshedAt: new Date(),
        lastRefreshStatus: "success",
        lastRefreshError: null,
      },
    });
  } catch (error: any) {
    refreshResult = "failed";
    refreshError = error.message || "Refresh failed";
    await prisma.playlistHistory.create({
      data: {
        userId: rule.userId,
        playlistRuleId: rule.id,
        serverId: rule.serverId,
        name: rule.name,
        rulesJson: rule.rulesJson,
        optionsJson: rule.optionsJson,
        trackCount: 0,
        plexPlaylistId: rule.plexPlaylistId,
        status: "failed",
        error: refreshError,
      },
    });

    return prisma.playlistRule.update({
      where: { id: rule.id },
      data: {
        lastRefreshedAt: new Date(),
        lastRefreshStatus: "failed",
        lastRefreshError: refreshError,
      },
    });
  } finally {
    const exclusionSummary = manualExclusionsApplied > 0
      ? ` Manual exclusions removed ${manualExclusionsApplied} track${manualExclusionsApplied === 1 ? "" : "s"} from the candidate pool.`
      : "";
    const safetySummary = safetyMetadata?.safetyRulesApplied
      ? ` Safety rules applied: ${safetyMetadata.summary.replace(/^Safety rules: /, "")}.`
      : "";
    await safeFinishJobHistory({
      job: history,
      status: refreshResult,
      summary: refreshResult === "success"
        ? `Playlist refresh completed. attempted=${trackCount}, processed=${trackCount}, skipped=0, failed=0.${exclusionSummary}${safetySummary}`
        : "Playlist refresh failed.",
      counts: { attempted: trackCount, processed: refreshResult === "success" ? trackCount : 0, skipped: 0, failed: refreshResult === "success" ? 0 : 1 },
      error: refreshError,
      metadata: {
        ruleId,
        mode,
        manualExclusionsApplied: manualExclusionsApplied > 0,
        excludedTrackCount: manualExclusionsApplied,
        manualExclusionsRemoved: manualExclusionsApplied,
        safetyRules: safetyMetadata?.enabledRules || null,
        safetyRuleSummary: safetyMetadata?.summary || "Safety rules: off",
        removedBySafetyRules: safetyMetadata?.removedBySafetyRules || 0,
        qualityScore: refreshQualityScore,
        finalTrackCount: trackCount,
        engineVersion: refreshEngineVersion,
      },
    });
    inflightRefreshes.delete(ruleId);
    endTimer();
    playlistRefreshesTotal.inc({ mode, result: refreshResult });
  }
}

export async function refreshAutoPlaylists() {
  const rules = await prisma.playlistRule.findMany({
    where: {
      autoRefresh: true,
      plexPlaylistId: { not: null },
      serverId: { not: null },
    },
    select: { id: true },
  });

  for (const rule of rules) {
    await refreshSavedPlaylist(rule.id, "auto");
  }

  return rules.length;
}
