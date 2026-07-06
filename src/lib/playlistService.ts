import axios from "axios";
import { z } from "zod";
import prisma from "./prisma";
import { effectiveBpmTrackWhere, getEffectiveBpm } from "./bpm";
import { audioFeatureFilterGuardWhere, type AudioFeatureFilterOptions } from "./audioFeatures";
import { activeSyncStatusWhere } from "./syncStatus";
import { getUserSyncSettings } from "./syncSettings";
import { safeFinishJobHistory, safeRecordJobHistory, safeStartJobHistory } from "./jobHistory";
import { filterManualTrackExclusions, getManualTrackExclusionIds } from "./trackExclusions";
import {
  playlistExportDurationSeconds,
  playlistExportsTotal,
  playlistGenerationDurationSeconds,
  playlistGenerationsTotal,
  playlistRefreshDurationSeconds,
  playlistRefreshesTotal,
} from "./metrics";

const numericFields = ["popularity", "energy", "valence", "tempo", "year", "duration", "rating", "playCount"] as const;
const booleanFields = ["isLive", "isRemaster", "isExplicit", "hasPopularity"] as const;
const fields = ["popularity", "energy", "valence", "tempo", "year", "duration", "rating", "playCount", "isLive", "isRemaster", "isExplicit", "hasPopularity", "genre", "title", "artist", "album"] as const;
const operators = ["eq", "contains", "not_contains", "gt", "lt", "gte", "lte"] as const;
const combinators = ["AND", "OR"] as const;
const duplicateStrategies = ["allow", "song_artist"] as const;

const maxPlaylistSize = Number(process.env.MAX_PLAYLIST_SIZE || 5000);

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
}).merge(playlistOptionsSchema);

export const savedPlaylistSchema = playlistConfigSchema.extend({
  name: z.string().trim().min(1).max(120),
  autoRefresh: z.boolean().default(false),
});

export type PlaylistRuleInput = z.infer<typeof playlistRuleSchema>;
export type PlaylistConfigInput = z.infer<typeof playlistConfigSchema>;

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

function buildRuleCondition(rule: PlaylistRuleInput, audioFeatureFilterOptions: AudioFeatureFilterOptions = {}) {
  const { field, operator, value } = rule;
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

function buildRuleNodeCondition(node: RuleNode, audioFeatureFilterOptions: AudioFeatureFilterOptions = {}): any {
  if (node.type === "group") {
    const childConditions = node.children.map((child) => buildRuleNodeCondition(child, audioFeatureFilterOptions));
    return { [node.combinator]: childConditions };
  }

  const condition = buildRuleCondition(node, audioFeatureFilterOptions);
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

  const ruleCondition = config.ruleTree
    ? buildRuleNodeCondition(config.ruleTree, audioFeatureFilterOptions)
    : { AND: config.rules.map((rule) => {
      const condition = buildRuleCondition(rule, audioFeatureFilterOptions);
      return rule.operator === "not_contains" ? { NOT: condition } : condition;
    }) };

  const conditions = [activeSyncStatusWhere(), scope, ruleCondition].concat(buildNegativeConditions(config));
  if (omitIds.length > 0) conditions.push({ id: { notIn: omitIds } });

  return { AND: conditions };
}

function duplicateKey(track: any) {
  return `${track.artistId}:${track.normalizedTitle || normalizeTitle(track.title)}`;
}

function duplicateScore(track: any, index: number, config: PlaylistConfigInput) {
  let score = 100000 - index;
  if (config.preferNonLive && !track.isLive) score += 10000;
  if (!track.isRemaster) score += 5000;
  if (track.popularity?.score) score += track.popularity.score;
  if (track.rating) score += track.rating;
  return score;
}

function applyDuplicatePolicy(tracks: any[], config: PlaylistConfigInput, limit: number) {
  if (config.duplicateStrategy === "allow") return tracks.slice(0, limit);

  const selected: any[] = [];
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const key = duplicateKey(track);
    const existingIndex = selected.findIndex((candidate) => duplicateKey(candidate) === key);
    if (existingIndex === -1) {
      selected.push(track);
    } else if (duplicateScore(track, index, config) > duplicateScore(selected[existingIndex], existingIndex, config)) {
      selected[existingIndex] = track;
    }

    if (selected.length >= limit && tracks.length - index > limit) {
      continue;
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

  return parts.length ? `Safety: ${parts.join(", ")}` : "Safety: off";
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
} as const;

function annotateTrack(track: any, reasons: string[]) {
  const effectiveBpm = getEffectiveBpm(track);

  return {
    ...track,
    bpm: effectiveBpm,
    effectiveBpm,
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
  };
}

function publicPreviewTrack(track: any) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist ? { id: track.artist.id, title: track.artist.title } : null,
    album: track.album ? { id: track.album.id, title: track.album.title, year: track.album.year } : null,
    duration: track.duration,
    bpm: track.bpm,
    effectiveBpm: track.effectiveBpm,
    popularity: track.popularity ? {
      score: track.popularity.score,
      provider: track.popularity.provider,
      confidence: track.popularity.confidence,
    } : null,
    audioFeature: track.audioFeature ? {
      energy: track.audioFeature.energy,
      valence: track.audioFeature.valence,
      effectiveEnergy: track.audioFeature.effectiveEnergy,
      effectiveMood: track.audioFeature.effectiveMood,
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
  };
}

async function queryCandidateTracks(
  userId: string,
  config: PlaylistConfigInput,
  omitIds: string[],
  take: number,
  audioFeatureFilterOptions: AudioFeatureFilterOptions,
) {
  return prisma.track.findMany({
    where: buildTrackWhereClause(userId, config, omitIds, audioFeatureFilterOptions),
    include: playlistTrackInclude,
    take,
    orderBy: { popularity: { score: "desc" } },
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
  const manualExcludedTrackIdSet = new Set(manualExcludedTrackIds);
  const eligiblePinnedTracks = pinnedTracks.filter((track) => !manualExcludedTrackIdSet.has(track.id));
  const omittedIds = config.excludedTrackIds
    .concat(blockedTracks.map((track) => track.trackId))
    .concat(manualExcludedTrackIds)
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
    omittedIds,
    audioFeatureFilterOptions,
  };
}

export async function generatePlaylistTracksWithStats({
  userId,
  config,
}: {
  userId: string;
  config: PlaylistConfigInput;
}) {
  const endTimer = playlistGenerationDurationSeconds.startTimer();
  let result: "success" | "failed" = "success";
  try {
    const { pinnedTracks, omittedIds, blockedTrackIds, manualExcludedTrackIds, audioFeatureFilterOptions } = await resolvePlaylistGenerationInputs(userId, config);
    const remainingLimit = Math.max(0, config.limit - pinnedTracks.length);
    const safetyCandidateLimit = safetyRulesAreEnabled(config)
      ? Math.min(maxPlaylistSize, Math.max(remainingLimit * 5, remainingLimit + 25))
      : remainingLimit;
    const take = Math.min(
      maxPlaylistSize,
      config.duplicateStrategy === "allow" ? safetyCandidateLimit : Math.max(safetyCandidateLimit * 5, safetyCandidateLimit + 25),
    );
    const candidates = remainingLimit > 0 ? await queryCandidateTracks(userId, config, omittedIds, take, audioFeatureFilterOptions) : [];
    const generatedTracks = applyDuplicatePolicy(candidates, config, safetyCandidateLimit);
    const safetyResult = applyPlaylistSafetyRules(pinnedTracks.concat(generatedTracks), config);
    const reasons = collectRuleReasons(config.ruleTree, config.rules);

    const baseOmittedIds = config.excludedTrackIds
      .concat(blockedTrackIds)
      .concat(pinnedTracks.map((track) => track.id))
      .filter((id, index, ids) => id && ids.indexOf(id) === index);
    const matchedBeforeManualExclusions = await prisma.track.count({
      where: buildTrackWhereClause(userId, config, baseOmittedIds, audioFeatureFilterOptions),
    });
    const matchedAfterManualExclusions = await prisma.track.count({
      where: buildTrackWhereClause(userId, config, baseOmittedIds.concat(manualExcludedTrackIds), audioFeatureFilterOptions),
    });

    return {
      tracks: safetyResult.tracks.map((track) => annotateTrack(track, reasons)),
      manualExclusionsApplied: Math.max(0, matchedBeforeManualExclusions - matchedAfterManualExclusions),
      safety: {
        ...safetyResult.metadata,
        manualExclusionsRemoved: Math.max(0, matchedBeforeManualExclusions - matchedAfterManualExclusions),
      },
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

function buildPreviewWarnings({
  tracks,
  matchedTrackCount,
  requestedLimit,
  smartPresetName,
  moodPresetName,
  moodPresetModified,
  bpmPresetName,
}: {
  tracks: any[];
  matchedTrackCount: number;
  requestedLimit: number;
  smartPresetName?: string;
  moodPresetName?: string;
  moodPresetModified?: boolean;
  bpmPresetName?: string;
}) {
  const warnings: string[] = [];
  const moodPresetLabel = moodPresetName ? `${moodPresetName}${moodPresetModified ? " modified" : ""}` : "";
  if (matchedTrackCount === 0 || tracks.length === 0) {
    warnings.push(bpmPresetName
      ? `No tracks matched the ${bpmPresetName} BPM preset. Try choosing Medium, Wide Open, or widening the BPM range.`
      : moodPresetLabel
      ? `No tracks matched the ${moodPresetLabel} mood preset. Try widening BPM, energy, or mood ranges.`
      : smartPresetName
      ? `No tracks matched the ${smartPresetName} preset. Try widening the BPM range, allowing more genres, or disabling popularity limits.`
      : "No tracks matched this playlist recipe. Adjust your filters and preview again.");
    if (bpmPresetName) {
      warnings.push("This BPM preset depends on BPM data. Run BPM analysis or choose Wide Open if too few tracks match.");
    }
    if (moodPresetName) {
      warnings.push("This preset depends on mood and energy data. Run audio feature analysis or widen your filters if too few tracks match.");
    }
    warnings.push("Some filters may be too restrictive. Try widening BPM, energy, mood, genre, or popularity filters.");
    return warnings;
  }

  if (matchedTrackCount < requestedLimit) {
    warnings.push(bpmPresetName
      ? `Only ${matchedTrackCount} tracks matched the ${bpmPresetName} BPM preset. Try choosing Medium, Wide Open, or widening the BPM range.`
      : moodPresetLabel
      ? `Only ${matchedTrackCount} tracks matched the ${moodPresetLabel} mood preset. Try widening BPM or energy ranges.`
      : smartPresetName
      ? `Only ${matchedTrackCount} tracks matched the ${smartPresetName} preset. Try widening the BPM range, allowing more genres, or disabling popularity limits.`
      : `Only ${matchedTrackCount} tracks matched your filters. Try widening the BPM range, removing a genre filter, or allowing tracks with missing audio features.`);
  }
  if (tracks.length < requestedLimit) {
    warnings.push(`Playlist has fewer tracks than requested: ${tracks.length} of ${requestedLimit}.`);
  }

  const missingBpm = tracks.filter((track) => !track.effectiveBpm && !track.bpm && !track.audioFeature?.tempo).length;
  if (missingBpm >= Math.max(3, Math.ceil(tracks.length * 0.25))) {
    warnings.push(`Many tracks are missing BPM data (${missingBpm} of ${tracks.length}).`);
    if (bpmPresetName) {
      warnings.push("This BPM preset depends on BPM data. Run BPM analysis or choose Wide Open if too few tracks match.");
    }
  }

  const missingAudio = tracks.filter((track) => !track.audioFeature || (track.audioFeature.energy == null && track.audioFeature.valence == null && track.audioFeature.effectiveEnergy == null && track.audioFeature.effectiveMood == null)).length;
  if (missingAudio >= Math.max(3, Math.ceil(tracks.length * 0.25))) {
    warnings.push(`Many tracks are missing audio features (${missingAudio} of ${tracks.length}).`);
    if (moodPresetName) {
      warnings.push("This preset depends on mood and energy data. Run audio feature analysis or widen your filters if too few tracks match.");
    }
  }

  const artistCounts = new Map<string, number>();
  for (const track of tracks) {
    const artist = track.artist?.title || "Unknown artist";
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
  }
  const repeatedArtistTracks = Array.from(artistCounts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  if (repeatedArtistTracks >= Math.max(4, Math.ceil(tracks.length * 0.25))) {
    const repeatedArtists = Array.from(artistCounts.entries())
      .filter(([, count]) => count > 1)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([artist, count]) => `${artist} (${count})`);
    warnings.push(`Preview contains repeated artists. ${artistCounts.size} artists appear across ${tracks.length} tracks.${repeatedArtists.length ? ` Most repeated: ${repeatedArtists.join(", ")}.` : ""} Try adjusting filters or refreshing the preview.`);
  }

  return warnings;
}

export async function previewPlaylistTracks({
  userId,
  config,
  displayLimit = previewDisplayLimit,
}: {
  userId: string;
  config: PlaylistConfigInput;
  displayLimit?: number;
}) {
  const { blockedTrackIds, manualExcludedTrackIds, audioFeatureFilterOptions } = await resolvePlaylistGenerationInputs(userId, config);
  const baseOmittedIds = config.excludedTrackIds.concat(blockedTrackIds);
  const matchedBeforeManualExclusions = await prisma.track.count({
    where: buildTrackWhereClause(userId, config, baseOmittedIds, audioFeatureFilterOptions),
  });
  const matchedTrackCount = await prisma.track.count({
    where: buildTrackWhereClause(userId, config, baseOmittedIds.concat(manualExcludedTrackIds), audioFeatureFilterOptions),
  });
  const generation = await generatePlaylistTracksWithStats({ userId, config });
  const tracks = generation.tracks;
  const rules = collectRules(config.ruleTree, config.rules);
  const server = config.serverId ? await prisma.server.findFirst({ where: { id: config.serverId, userId }, select: { name: true } }) : null;
  const library = config.libraryId ? await prisma.library.findFirst({ where: { id: config.libraryId, server: { userId } }, select: { name: true } }) : null;
  const previewTracks = tracks.slice(0, displayLimit);

  const summary = {
    targetTrackCount: config.limit,
    matchingTrackCount: matchedTrackCount,
    finalTrackCount: previewTracks.length,
    displayedTrackCount: previewTracks.length,
    estimatedDurationMs: previewTracks.reduce((sum, track) => sum + (track.duration || 0), 0),
    estimatedDurationMinutes: Math.round(previewTracks.reduce((sum, track) => sum + (track.duration || 0), 0) / 60000),
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
    artistLimitApplied: generation.safety.artistLimitApplied,
    albumLimitApplied: generation.safety.albumLimitApplied,
    artistSpacingApplied: generation.safety.artistSpacingApplied,
    genreFilters: genreFilterLabel(rules),
    sortMode: "Popularity score descending",
    duplicateStrategy: config.duplicateStrategy === "allow" ? "Allow duplicates" : "One version per song",
    diversity: {
      artistCount: new Set(previewTracks.map((track) => track.artist?.title).filter(Boolean)).size,
      albumCount: new Set(previewTracks.map((track) => track.album?.title).filter(Boolean)).size,
      repeatedArtistTracks: Math.max(0, previewTracks.length - new Set(previewTracks.map((track) => track.artist?.title).filter(Boolean)).size),
    },
    missing: {
      bpm: previewTracks.filter((track) => !track.effectiveBpm && !track.bpm && !track.audioFeature?.tempo).length,
      audioFeatures: previewTracks.filter((track) => !track.audioFeature || (track.audioFeature.energy == null && track.audioFeature.valence == null && track.audioFeature.effectiveEnergy == null && track.audioFeature.effectiveMood == null)).length,
      popularity: previewTracks.filter((track) => !track.popularity).length,
    },
  };

  const filterSummary = [
    ...(config.smartPresetName ? [{ label: "Smart preset", value: config.smartPresetName }] : []),
    ...(config.moodPresetName ? [{ label: "Mood preset", value: `${config.moodPresetName}${config.moodPresetModified ? " modified" : ""}` }] : []),
    ...(config.bpmPresetName ? [{ label: "BPM preset", value: config.bpmPresetName }] : []),
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
    { label: "Rules", value: collectRuleReasons(config.ruleTree, config.rules).join("; ") || "All active tracks" },
  ];

  const warnings = [
    ...buildPreviewWarnings({
      tracks: previewTracks,
      matchedTrackCount,
      requestedLimit: config.limit,
      smartPresetName: config.smartPresetName,
      moodPresetName: config.moodPresetName,
      moodPresetModified: config.moodPresetModified,
      bpmPresetName: config.bpmPresetName,
    }),
    ...generation.safety.warnings,
  ].filter((warning, index, list) => list.indexOf(warning) === index);

  return {
    previewId: Buffer.from(`${Date.now()}:${previewTracks.map((track) => track.id).join(",")}`).toString("base64url").slice(0, 48),
    trackIds: previewTracks.map((track) => track.id),
    tracks: previewTracks.map(publicPreviewTrack),
    totalPreviewTrackCount: tracks.length,
    summary,
    filterSummary,
    manualExclusionsApplied: summary.manualExclusionsRemoved,
    safetyRulesApplied: generation.safety.safetyRulesApplied,
    removedBySafetyRules: generation.safety.removedBySafetyRules,
    manualExclusionsRemoved: summary.manualExclusionsRemoved,
    warnings,
    safety: generation.safety,
  };
}

async function fetchOwnedTracksInOrder(userId: string, trackIds: string[]) {
  const uniqueIds = trackIds.filter((id, index) => trackIds.indexOf(id) === index);
  const tracks = await prisma.track.findMany({
    where: {
      id: { in: uniqueIds },
      syncStatus: "active",
      library: { server: { userId } },
    },
    include: playlistTrackInclude,
  });

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
  const uri = `server://${server.machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(",")}`;
  const headers = plexHeaders(server.accessToken);

  if (playlistId) {
    await axios.put(`${server.uri}/playlists/${playlistId}`, null, {
      params: { title: name },
      headers,
    }).catch(() => undefined);
    await axios.delete(`${server.uri}/playlists/${playlistId}/items`, { headers });
    await axios.put(`${server.uri}/playlists/${playlistId}/items`, null, {
      params: { uri },
      headers,
    });
    return playlistId;
  }

  const response = await axios.post(`${server.uri}/playlists`, null, {
    params: {
      type: "audio",
      title: name,
      smart: 0,
      uri,
    },
    headers,
  });

  return response.data?.MediaContainer?.Metadata?.[0]?.ratingKey || null;
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
      trackCount: tracks.length,
      excludedTrackCount: filtered.excludedTrackCount,
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
      ? ` Safety rules applied: ${safetyMetadata.summary.replace(/^Safety: /, "")}.`
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
        safetyRuleSummary: safetyMetadata?.summary || "Safety: off",
        removedBySafetyRules: safetyMetadata?.removedBySafetyRules || 0,
        finalTrackCount: trackCount,
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
