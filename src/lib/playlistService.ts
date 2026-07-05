import axios from "axios";
import { z } from "zod";
import prisma from "./prisma";
import { effectiveBpmTrackWhere, getEffectiveBpm } from "./bpm";
import { audioFeatureFilterGuardWhere, type AudioFeatureFilterOptions } from "./audioFeatures";
import { activeSyncStatusWhere } from "./syncStatus";
import { getUserSyncSettings } from "./syncSettings";
import { safeFinishJobHistory, safeRecordJobHistory, safeStartJobHistory } from "./jobHistory";
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
  const omittedIds = config.excludedTrackIds
    .concat(blockedTracks.map((track) => track.trackId))
    .concat(pinnedTracks.map((track) => track.id));
  const syncSettings = await getUserSyncSettings(userId);
  const audioFeatureFilterOptions = {
    includeEstimated: syncSettings.includeEstimatedAudioFeaturesInFilters === true,
    minimumConfidence: syncSettings.audioFeatureMinimumConfidence ?? null,
  };

  return { pinnedTracks, blockedTrackIds: blockedTracks.map((track) => track.trackId), omittedIds, audioFeatureFilterOptions };
}

export async function generatePlaylistTracks({
  userId,
  config,
}: {
  userId: string;
  config: PlaylistConfigInput;
}) {
  const endTimer = playlistGenerationDurationSeconds.startTimer();
  let result: "success" | "failed" = "success";
  try {
    const { pinnedTracks, omittedIds, audioFeatureFilterOptions } = await resolvePlaylistGenerationInputs(userId, config);
    const remainingLimit = Math.max(0, config.limit - pinnedTracks.length);
    const take = config.duplicateStrategy === "allow" ? remainingLimit : Math.max(remainingLimit * 5, remainingLimit + 25);
    const candidates = remainingLimit > 0 ? await queryCandidateTracks(userId, config, omittedIds, take, audioFeatureFilterOptions) : [];
    const generatedTracks = applyDuplicatePolicy(candidates, config, remainingLimit);
    const reasons = collectRuleReasons(config.ruleTree, config.rules);

    return pinnedTracks.concat(generatedTracks).slice(0, config.limit).map((track) => annotateTrack(track, reasons));
  } catch (error) {
    result = "failed";
    throw error;
  } finally {
    endTimer();
    playlistGenerationsTotal.inc({ result });
  }
}

function numericRangeLabel(rules: PlaylistRuleInput[], field: string, emptyLabel = "Any") {
  const relevant = rules.filter((rule) => rule.field === field);
  if (relevant.length === 0) return emptyLabel;
  const eq = relevant.find((rule) => rule.operator === "eq");
  if (eq) return eq.value;
  const lower = relevant.find((rule) => rule.operator === "gte" || rule.operator === "gt");
  const upper = relevant.find((rule) => rule.operator === "lte" || rule.operator === "lt");
  if (lower || upper) {
    return `${lower ? `${lower.operator === "gt" ? ">" : ""}${lower.value}` : "Any"}-${upper ? `${upper.operator === "lt" ? "<" : ""}${upper.value}` : "Any"}`;
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
}: {
  tracks: any[];
  matchedTrackCount: number;
  requestedLimit: number;
}) {
  const warnings: string[] = [];
  if (matchedTrackCount === 0 || tracks.length === 0) {
    warnings.push("No tracks matched this playlist recipe. Adjust your filters and preview again.");
    warnings.push("Some filters may be too restrictive. Try widening BPM, energy, mood, genre, or popularity filters.");
    return warnings;
  }

  if (matchedTrackCount < requestedLimit) {
    warnings.push(`Only ${matchedTrackCount} tracks matched your filters. Try widening the BPM range, removing a genre filter, or allowing tracks with missing audio features.`);
  }
  if (tracks.length < requestedLimit) {
    warnings.push(`Playlist has fewer tracks than requested: ${tracks.length} of ${requestedLimit}.`);
  }

  const missingBpm = tracks.filter((track) => !track.effectiveBpm && !track.bpm && !track.audioFeature?.tempo).length;
  if (missingBpm >= Math.max(3, Math.ceil(tracks.length * 0.25))) {
    warnings.push(`Many tracks are missing BPM data (${missingBpm} of ${tracks.length}).`);
  }

  const missingAudio = tracks.filter((track) => !track.audioFeature || (track.audioFeature.energy == null && track.audioFeature.valence == null && track.audioFeature.effectiveEnergy == null && track.audioFeature.effectiveMood == null)).length;
  if (missingAudio >= Math.max(3, Math.ceil(tracks.length * 0.25))) {
    warnings.push(`Many tracks are missing audio features (${missingAudio} of ${tracks.length}).`);
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
  const { blockedTrackIds, audioFeatureFilterOptions } = await resolvePlaylistGenerationInputs(userId, config);
  const matchedTrackCount = await prisma.track.count({
    where: buildTrackWhereClause(userId, config, config.excludedTrackIds.concat(blockedTrackIds), audioFeatureFilterOptions),
  });
  const tracks = await generatePlaylistTracks({ userId, config });
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
    { label: "Server", value: server?.name || (config.serverId ? "Selected server" : "Any connected server") },
    { label: "Library", value: library?.name || (config.libraryId ? "Selected library" : "Any music library") },
    { label: "Genres", value: summary.genreFilters },
    { label: "BPM", value: summary.bpmRange },
    { label: "Energy", value: summary.energyRange },
    { label: "Mood", value: summary.moodRange },
    { label: "Popularity", value: summary.popularityRange },
    { label: "Limit", value: `${config.limit} tracks` },
    { label: "Sort", value: summary.sortMode },
    { label: "Duplicate control", value: summary.duplicateStrategy },
    { label: "Negative filters", value: formatNegativeFilters(config.negativeFilters) },
    { label: "Rules", value: collectRuleReasons(config.ruleTree, config.rules).join("; ") || "All active tracks" },
  ];

  return {
    previewId: Buffer.from(`${Date.now()}:${previewTracks.map((track) => track.id).join(",")}`).toString("base64url").slice(0, 48),
    trackIds: previewTracks.map((track) => track.id),
    tracks: previewTracks.map(publicPreviewTrack),
    totalPreviewTrackCount: tracks.length,
    summary,
    filterSummary,
    warnings: buildPreviewWarnings({ tracks: previewTracks, matchedTrackCount, requestedLimit: config.limit }),
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
  const tracks = await fetchOwnedTracksInOrder(userId, trackIds);
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
    const tracks = await generatePlaylistTracks({
      userId: rule.userId,
      config: parsed,
    });
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
    await safeFinishJobHistory({
      job: history,
      status: refreshResult,
      summary: refreshResult === "success"
        ? `Playlist refresh completed. attempted=${trackCount}, processed=${trackCount}, skipped=0, failed=0.`
        : "Playlist refresh failed.",
      counts: { attempted: trackCount, processed: refreshResult === "success" ? trackCount : 0, skipped: 0, failed: refreshResult === "success" ? 0 : 1 },
      error: refreshError,
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
