import axios from "axios";
import { z } from "zod";
import prisma from "./prisma";
import { effectiveBpmTrackWhere, getBpmDisplayMetadata, getEffectiveBpm } from "./bpm";
import { audioFeatureFilterGuardWhere, type AudioFeatureFilterOptions } from "./audioFeatures";
import { activeSyncStatusWhere } from "./syncStatus";
import { getUserSyncSettings } from "./syncSettings";
import { safeFinishJobHistory, safeRecordJobHistory, safeStartJobHistory } from "./jobHistory";
import { recordPlaylistHistoryEntry } from "./playlistHistory";
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
const supportedRegenerationModes = ["replace_all", "keep_some"] as const;
const supportedKeepPercents = [25, 50] as const;

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
} as const;

function annotateTrack(track: any, reasons: string[]) {
  const effectiveBpm = getEffectiveBpm(track);
  const bpmDisplay = getBpmDisplayMetadata(track);

  return {
    ...track,
    bpm: effectiveBpm,
    effectiveBpm,
    bpmDisplay,
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
    bpmSource: track.bpmDisplay?.sourceLabel || null,
    bpmConfidence: track.bpmDisplay?.confidence || null,
    bpmConflictStatus: track.bpmDisplay?.conflictStatus || "none",
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

  const missingBpm = tracks.filter((track) => !track.effectiveBpm && !track.bpm && !track.audioFeature?.tempo).length;
  if (missingBpm >= Math.max(3, Math.ceil(tracks.length * 0.25))) {
    messages.push({ severity: "warning", message: `Many tracks are missing BPM data (${missingBpm} of ${tracks.length}).` });
    if (bpmPresetName) {
      messages.push({ severity: "warning", message: "This BPM preset depends on BPM data. Run BPM analysis or choose Wide Open if too few tracks match." });
    }
  }

  const missingAudio = tracks.filter((track) => !track.audioFeature || (track.audioFeature.energy == null && track.audioFeature.valence == null && track.audioFeature.effectiveEnergy == null && track.audioFeature.effectiveMood == null)).length;
  if (missingAudio >= Math.max(3, Math.ceil(tracks.length * 0.25))) {
    messages.push({ severity: "warning", message: `Many tracks are missing audio features (${missingAudio} of ${tracks.length}).` });
    if (moodPresetName) {
      messages.push({ severity: "warning", message: "This preset depends on mood and energy data. Run audio feature analysis or widen your filters if too few tracks match." });
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
    bpmPresetModified: config.bpmPresetModified || false,
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
    ...(config.bpmPresetName ? [{ label: "BPM preset", value: `${config.bpmPresetName}${config.bpmPresetModified ? " modified" : ""}` }] : []),
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

  const messages = uniquePreviewMessages([
    ...buildPreviewMessages({
      tracks: previewTracks,
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
    messages,
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

export type GeneratedPlaylistSourceType = "manual_builder" | "recipe" | "smart_builder" | "unknown";

function generatedPlaylistSourceType(config: Partial<PlaylistConfigInput>, fallback?: string | null): GeneratedPlaylistSourceType {
  if (fallback === "manual_builder" || fallback === "recipe" || fallback === "smart_builder" || fallback === "unknown") {
    return fallback;
  }
  if ((config as any).recipeId) return "recipe";
  if (config.smartPresetId || config.smartPresetName || config.moodPresetId || config.bpmPresetId) return "smart_builder";
  return "manual_builder";
}

function normalizeGeneratedPlaylistConfig(filters: unknown) {
  return playlistConfigSchema.parse(filters || {});
}

function rulesJsonFromConfig(config: PlaylistConfigInput) {
  return JSON.stringify(config.ruleTree || config.rules || []);
}

async function replaceGeneratedPlaylistSnapshot(generatedPlaylistId: string, tracks: any[]) {
  await prisma.$transaction([
    prisma.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId } }),
    prisma.generatedPlaylistTrack.createMany({
      data: tracks.map((track, index) => ({
        generatedPlaylistId,
        trackId: track.id,
        plexTrackRatingKey: track.ratingKey || track.plexId || null,
        position: index + 1,
        title: track.title || "Unknown track",
        artist: track.artist?.title || null,
        album: track.album?.title || null,
      })),
    }),
  ]);
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
}) {
  const config = normalizeGeneratedPlaylistConfig(filters);
  const tracks = trackIds.length ? await fetchOwnedTracksInOrder(userId, trackIds) : [];
  const resolvedSourceType = generatedPlaylistSourceType(config, sourceType);
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
    filtersJson: config as any,
    safetyRulesJson: config.safetyRules as any,
    trackCount: tracks.length,
    lastGeneratedAt: new Date(),
  };

  const existing = plexPlaylistRatingKey
    ? await prisma.generatedPlaylist.findFirst({ where: { userId, plexPlaylistRatingKey } })
    : null;
  const generatedPlaylist = existing
    ? await prisma.generatedPlaylist.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.generatedPlaylist.create({ data });

  await replaceGeneratedPlaylistSnapshot(generatedPlaylist.id, tracks);
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
  const eligibleTracks = await prisma.track.findMany({
    where: {
      AND: [
        { id: { in: currentTrackIds } },
        buildTrackWhereClause(
          userId,
          config,
          uniqueTrackIds([...(config.excludedTrackIds || []), ...blockedTrackIds, ...manualExcludedTrackIds]),
          audioFeatureFilterOptions,
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
  omitTrackIds = [],
  preferDifferentTrackIds = [],
}: {
  userId: string;
  config: PlaylistConfigInput;
  targetCount: number;
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
  const primary = await generatePlaylistTracksWithStats({ userId, config: primaryConfig });
  let selectedTracks = uniqueTracksById(primary.tracks).slice(0, targetCount);
  let safety = primary.safety;

  if (preferDifferentTrackIds.length > 0 && selectedTracks.length < targetCount) {
    const fallbackConfig = playlistConfigSchema.parse({
      ...config,
      limit: targetCount - selectedTracks.length,
      pinnedTrackIds: [],
      excludedTrackIds: uniqueTrackIds([...(config.excludedTrackIds || []), ...omitTrackIds, ...selectedTracks.map((track) => track.id)]),
    });
    const fallback = await generatePlaylistTracksWithStats({ userId, config: fallbackConfig });
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
  const finalTrackCount = previewTracks.length;
  const estimatedDurationMs = previewTracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  return {
    previewId: Buffer.from(`${Date.now()}:${previewTracks.map((track) => track.id).join(",")}`).toString("base64url").slice(0, 48),
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
    },
    filterSummary: [
      { label: "Limit", value: `${config.limit} tracks` },
      { label: "Safety rules", value: safety.summary || summarizePlaylistSafetyRules(config) },
    ],
    manualExclusionsApplied: safety.manualExclusionsRemoved || 0,
    safetyRulesApplied: safety.safetyRulesApplied,
    removedBySafetyRules: safety.removedBySafetyRules || 0,
    manualExclusionsRemoved: safety.manualExclusionsRemoved || 0,
    warnings: warnings.filter((warning, index, list) => list.indexOf(warning) === index),
    safety,
    regeneration,
  };
}

export async function previewGeneratedPlaylistRegeneration({
  userId,
  generatedPlaylistId,
  mode = "replace_all",
  keepPercent = 25,
  preferDifferentTracks = false,
}: {
  userId: string;
  generatedPlaylistId: string;
  mode?: string;
  keepPercent?: number;
  preferDifferentTracks?: boolean;
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

  const savedConfig = normalizeGeneratedPlaylistConfig(generatedPlaylist.filtersJson);
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
  ].filter((warning, index, list) => list.indexOf(warning) === index);

  if (regenerationMode === "replace_all") {
    const replacement = await generateRegenerationReplacementTracks({
      userId,
      config: savedConfig,
      targetCount: savedConfig.limit,
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

    const config = normalizeGeneratedPlaylistConfig(generatedPlaylist.filtersJson);
    await prisma.generatedPlaylist.update({
      where: { id: generatedPlaylist.id },
      data: {
        serverId: targetServer.id,
        trackCount: tracks.length,
        lastRegeneratedAt: new Date(),
        lastGeneratedAt: new Date(),
      },
    });
    await replaceGeneratedPlaylistSnapshot(generatedPlaylist.id, tracks);
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
        trackCount: tracks.length,
        manualExclusionsRemoved,
        safetyRules: config.safetyRules,
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
        trackCount: 0,
        warnings,
        previewId: previewId || null,
      },
    });
    throw error;
  }
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

    const generatedPlaylist = await recordGeneratedPlaylist({
      userId: rule.userId,
      serverId: targetServer.id,
      plexPlaylistRatingKey: rule.plexPlaylistId,
      plexPlaylistTitle: rule.name,
      sourceType: parsed.smartPresetName || parsed.moodPresetName || parsed.bpmPresetName ? "smart_builder" : "manual_builder",
      filters: parsed,
      trackIds: tracks.map((track) => track.id),
    });
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
      regenerationMode: "replace_all",
      trackCount: tracks.length,
      previousTrackCount: rule.plexPlaylistId ? null : 0,
      manualExclusionsRemoved: manualExclusionsApplied,
      safetyRulesApplied: Boolean(safetyMetadata?.safetyRulesApplied),
      safetyRulesRemoved: safetyMetadata?.removedBySafetyRules || 0,
      warnings: safetyMetadata?.warnings || [],
      filters: parsed,
      safetyRules: parsed.safetyRules,
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
