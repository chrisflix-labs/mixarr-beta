import { getTrackPopularity } from "./metadataFallbacks";

export const DISCOVERY_CONFIG_VERSION = "2.0.5";

export type DiscoveryLevel = "low" | "medium" | "high" | "custom";
export type UnderplayedBoost = "off" | "low" | "medium" | "high";
export type DiscoveryLookback = "playlists_3" | "playlists_5" | "playlists_10" | "playlists_20" | "days_30" | "days_60" | "days_90";
export type DiscoveryClassification = "popular" | "familiar" | "deep_cut" | "hidden_gem" | "unknown";

export type DiscoveryConfig = {
  level: DiscoveryLevel;
  deepCutTarget: number;
  avoidOverplayed: boolean;
  includeHiddenGems: boolean;
  limitPopularTracks: boolean;
  maxPopularTrackPercent: number;
  underplayedBoost: UnderplayedBoost;
  avoidRecentlyUsedPlaylistTracks: boolean;
  recentPlaylistLookback: DiscoveryLookback;
  configVersion: string;
};

export type TrackDiscoveryMetrics = {
  classification: DiscoveryClassification;
  discoveryValue: number;
  normalizedPopularity: number | null;
  normalizedPlayCount: number | null;
  recentPlaylistUsage: number | null;
  underplayedScore: number;
  playlistFreshnessScore: number;
  hiddenGemScore: number;
  overplayedPenalty: number;
  recentPlaylistPenalty: number;
  reasons: string[];
};

export type DiscoveryExplanation = { label: string; explanation: string };

export type DiscoveryDiagnostics = {
  candidatePoolSize: number;
  tracksWithPopularityData: number;
  tracksWithPlexPlayCountData: number;
  tracksWithPlaylistHistoryData: number;
  popularCount: number;
  familiarCount: number;
  deepCutCount: number;
  hiddenGemCount: number;
  requestedDeepCutPercent: number;
  actualDeepCutPercent: number;
  requestedPopularTrackMaximum: number | null;
  actualPopularTrackPercent: number;
  recentUsePenaltyCount: number;
  overplayedPenaltyCount: number;
  targetSatisfaction: number;
  warnings: string[];
  explanations: DiscoveryExplanation[];
  executionTimeMs: number;
};

export const DISCOVERY_PRESETS: Record<Exclude<DiscoveryLevel, "custom">, DiscoveryConfig> = {
  low: {
    level: "low", deepCutTarget: 15, avoidOverplayed: false, includeHiddenGems: false,
    limitPopularTracks: false, maxPopularTrackPercent: 70, underplayedBoost: "low",
    avoidRecentlyUsedPlaylistTracks: false, recentPlaylistLookback: "playlists_10", configVersion: DISCOVERY_CONFIG_VERSION,
  },
  medium: {
    level: "medium", deepCutTarget: 35, avoidOverplayed: true, includeHiddenGems: true,
    limitPopularTracks: true, maxPopularTrackPercent: 45, underplayedBoost: "medium",
    avoidRecentlyUsedPlaylistTracks: true, recentPlaylistLookback: "playlists_10", configVersion: DISCOVERY_CONFIG_VERSION,
  },
  high: {
    level: "high", deepCutTarget: 65, avoidOverplayed: true, includeHiddenGems: true,
    limitPopularTracks: true, maxPopularTrackPercent: 25, underplayedBoost: "high",
    avoidRecentlyUsedPlaylistTracks: true, recentPlaylistLookback: "playlists_20", configVersion: DISCOVERY_CONFIG_VERSION,
  },
};

const lookbacks = new Set<DiscoveryLookback>(["playlists_3", "playlists_5", "playlists_10", "playlists_20", "days_30", "days_60", "days_90"]);
const boosts = new Set<UnderplayedBoost>(["off", "low", "medium", "high"]);
const levels = new Set<DiscoveryLevel>(["low", "medium", "high", "custom"]);
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function discoveryPreset(level: Exclude<DiscoveryLevel, "custom">): DiscoveryConfig {
  return { ...DISCOVERY_PRESETS[level] };
}

export function migrateFamiliarityToDiscovery(value: unknown): DiscoveryConfig {
  const balance = finite(value) ?? 50;
  return discoveryPreset(balance >= 67 ? "low" : balance <= 33 ? "high" : "medium");
}

export function normalizeDiscoveryConfig(value: unknown, legacyFamiliarity?: unknown): DiscoveryConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return migrateFamiliarityToDiscovery(legacyFamiliarity);
  const source = value as Partial<DiscoveryConfig>;
  const requestedLevel = levels.has(source.level as DiscoveryLevel) ? source.level as DiscoveryLevel : "medium";
  const base = requestedLevel === "custom" ? migrateFamiliarityToDiscovery(legacyFamiliarity) : discoveryPreset(requestedLevel);
  return {
    level: requestedLevel,
    deepCutTarget: clamp(finite(source.deepCutTarget) ?? base.deepCutTarget),
    avoidOverplayed: typeof source.avoidOverplayed === "boolean" ? source.avoidOverplayed : base.avoidOverplayed,
    includeHiddenGems: typeof source.includeHiddenGems === "boolean" ? source.includeHiddenGems : base.includeHiddenGems,
    limitPopularTracks: typeof source.limitPopularTracks === "boolean" ? source.limitPopularTracks : base.limitPopularTracks,
    maxPopularTrackPercent: clamp(finite(source.maxPopularTrackPercent) ?? base.maxPopularTrackPercent),
    underplayedBoost: boosts.has(source.underplayedBoost as UnderplayedBoost) ? source.underplayedBoost as UnderplayedBoost : base.underplayedBoost,
    avoidRecentlyUsedPlaylistTracks: typeof source.avoidRecentlyUsedPlaylistTracks === "boolean" ? source.avoidRecentlyUsedPlaylistTracks : base.avoidRecentlyUsedPlaylistTracks,
    recentPlaylistLookback: lookbacks.has(source.recentPlaylistLookback as DiscoveryLookback) ? source.recentPlaylistLookback as DiscoveryLookback : base.recentPlaylistLookback,
    configVersion: DISCOVERY_CONFIG_VERSION,
  };
}

function percentileRanks(values: Array<number | null>) {
  const known = values.filter((value): value is number => value != null);
  if (known.length < 2 || known.every((value) => value === known[0])) return values.map(() => null);
  const sorted = [...known].sort((a, b) => a - b);
  return values.map((value) => value == null ? null : sorted.findLastIndex((item) => item <= value) / (sorted.length - 1));
}

function playCount(track: any) {
  return finite(track.viewCount ?? track.playCount);
}

export function scoreDiscoveryCandidatePool<T extends Record<string, any>>({
  candidates,
  config,
  recentUsage = {},
}: {
  candidates: T[];
  config: DiscoveryConfig;
  recentUsage?: Record<string, number>;
}) {
  const start = Date.now();
  const popularityRanks = percentileRanks(candidates.map((track) => finite(getTrackPopularity(track))));
  const playRanks = percentileRanks(candidates.map(playCount));
  const boostStrength = { off: 0, low: 3, medium: 6, high: 10 }[config.underplayedBoost];
  const levelStrength = config.level === "high" ? 1 : config.level === "low" ? 0.4 : 0.7;

  const tracks = candidates.map((track, index) => {
    const popularityRank = popularityRanks[index];
    const playRank = playRanks[index];
    const usage = track.id && Object.prototype.hasOwnProperty.call(recentUsage, track.id) ? recentUsage[track.id] : null;
    const underplayedScore = playRank == null ? 0 : (1 - playRank) * 100;
    const playlistFreshnessScore = usage == null ? 50 : Math.max(0, 100 - usage * 25);
    const popularityDiscovery = popularityRank == null ? null : (1 - popularityRank) * 100;
    const signals = [popularityDiscovery, playRank == null ? null : underplayedScore, usage == null ? null : playlistFreshnessScore]
      .filter((value): value is number => value != null);
    const discoveryValue = signals.length ? signals.reduce((sum, value) => sum + value, 0) / signals.length : 50;
    const compatibility = clamp(finite(track.score) ?? 50) / 100;
    const hiddenGemScore = compatibility * (underplayedScore / 100) * (playlistFreshnessScore / 100) * 100;
    const isPopular = popularityRank != null && popularityRank >= 0.8;
    const isDeepCut = signals.length >= 1 && discoveryValue >= 58 && !isPopular;
    const isHiddenGem = config.includeHiddenGems && isDeepCut && hiddenGemScore >= 25 && compatibility >= 0.55;
    const classification: DiscoveryClassification = isHiddenGem ? "hidden_gem" : isDeepCut ? "deep_cut" : isPopular ? "popular" : signals.length ? "familiar" : "unknown";
    const overplayedPenalty = config.avoidOverplayed && playRank != null && playRank >= 0.8 ? (playRank - 0.75) * 24 * levelStrength : 0;
    const recentPlaylistPenalty = config.avoidRecentlyUsedPlaylistTracks && usage ? Math.min(14, 5 + usage * 2) * levelStrength : 0;
    const underplayedBonus = underplayedScore / 100 * boostStrength;
    const hiddenGemBonus = isHiddenGem ? 7 * levelStrength : 0;
    const discoveryScore = (discoveryValue - 50) / 10 * (config.level === "high" ? 2.2 : config.level === "low" ? 0.7 : 1.35);
    const reasons = [
      ...(underplayedScore >= 65 ? ["Underplayed in Plex"] : []),
      ...(usage === 0 || (usage == null && Object.keys(recentUsage).length > 0) ? ["Not used in recent playlists"] : []),
      ...(popularityDiscovery != null && popularityDiscovery >= 60 ? ["Below-average popularity"] : []),
      ...(isHiddenGem ? ["Hidden gem match"] : []),
      ...(isDeepCut ? ["Supports deep-cut target"] : []),
      ...(recentPlaylistPenalty > 0 ? ["Frequently used in recent playlists"] : []),
      ...(overplayedPenalty > 0 ? ["High relative play count"] : []),
    ];
    const discoveryMetrics: TrackDiscoveryMetrics = {
      classification, discoveryValue: Math.round(discoveryValue),
      normalizedPopularity: popularityRank == null ? null : Math.round(popularityRank * 100),
      normalizedPlayCount: playRank == null ? null : Math.round(playRank * 100), recentPlaylistUsage: usage,
      underplayedScore: Math.round(underplayedScore), playlistFreshnessScore: Math.round(playlistFreshnessScore),
      hiddenGemScore: Math.round(hiddenGemScore), overplayedPenalty, recentPlaylistPenalty, reasons,
    };
    const delta = discoveryScore + underplayedBonus + hiddenGemBonus - overplayedPenalty - recentPlaylistPenalty;
    // Discovery may break a tie between compatible tracks, but must not promote a
    // strict mood fallback over an exact/alias match.
    const compatibleDelta = track.moodBlend?.isMoodFallback ? Math.min(0, delta) : delta;
    return {
      ...track,
      score: Math.round(((finite(track.score) ?? 50) + compatibleDelta) * 1000) / 1000,
      discoveryMetrics,
      ...(track.scoreBreakdown ? {
        scoreBreakdown: {
          ...track.scoreBreakdown,
          discoveryScore: Math.round(discoveryScore * 1000) / 1000,
          underplayedScore: Math.round(underplayedBonus * 1000) / 1000,
          playlistFreshnessScore: Math.round((playlistFreshnessScore - 50) / 20 * 1000) / 1000,
          hiddenGemScore: Math.round(hiddenGemBonus * 1000) / 1000,
          overplayedPenalty: -Math.round(overplayedPenalty * 1000) / 1000,
          recentPlaylistPenalty: -Math.round(recentPlaylistPenalty * 1000) / 1000,
        },
      } : {}),
    };
  });
  return { tracks, executionTimeMs: Date.now() - start };
}

export function discoverySelectionAdjustment(track: any, selected: any[], limit: number, config: DiscoveryConfig) {
  const metrics = track.discoveryMetrics as TrackDiscoveryMetrics | undefined;
  if (!metrics || limit <= 0) return 0;
  if (track.moodBlend?.isMoodFallback) return 0;
  const deepSelected = selected.filter((item) => ["deep_cut", "hidden_gem"].includes(item.discoveryMetrics?.classification)).length;
  const popularSelected = selected.filter((item) => item.discoveryMetrics?.classification === "popular").length;
  const desiredDeep = Math.round(limit * config.deepCutTarget / 100);
  const maxPopular = Math.floor(limit * config.maxPopularTrackPercent / 100);
  let adjustment = 0;
  if (["deep_cut", "hidden_gem"].includes(metrics.classification) && deepSelected < desiredDeep) adjustment += 12;
  if (config.limitPopularTracks && metrics.classification === "popular" && popularSelected >= maxPopular) adjustment -= 18;
  return adjustment;
}

export function summarizeDiscovery(candidates: any[], selected: any[], config: DiscoveryConfig, executionTimeMs = 0): DiscoveryDiagnostics {
  const metrics = candidates.map((track) => track.discoveryMetrics as TrackDiscoveryMetrics | undefined).filter(Boolean) as TrackDiscoveryMetrics[];
  const selectedMetrics = selected.map((track) => track.discoveryMetrics as TrackDiscoveryMetrics | undefined).filter(Boolean) as TrackDiscoveryMetrics[];
  const count = (items: TrackDiscoveryMetrics[], classifications: DiscoveryClassification[]) => items.filter((item) => classifications.includes(item.classification)).length;
  const actualDeepCutPercent = selectedMetrics.length ? Math.round(count(selectedMetrics, ["deep_cut", "hidden_gem"]) / selectedMetrics.length * 100) : 0;
  const actualPopularTrackPercent = selectedMetrics.length ? Math.round(count(selectedMetrics, ["popular"]) / selectedMetrics.length * 100) : 0;
  const hiddenGemCount = count(selectedMetrics, ["hidden_gem"]);
  const targetGap = Math.abs(actualDeepCutPercent - config.deepCutTarget);
  const popularGap = config.limitPopularTracks ? Math.max(0, actualPopularTrackPercent - config.maxPopularTrackPercent) : 0;
  const targetSatisfaction = Math.round(clamp(100 - targetGap - popularGap));
  const warnings: string[] = [];
  const popularityDataCount = candidates.filter((track) => getTrackPopularity(track) != null).length;
  const positivePlayCountPool = candidates.filter((track) => (playCount(track) ?? 0) > 0);
  const playCountDataCount = positivePlayCountPool.length ? candidates.filter((track) => playCount(track) != null).length : 0;
  const playlistHistoryDataCount = metrics.filter((item) => item.recentPlaylistUsage != null).length;
  if (actualDeepCutPercent + 5 < config.deepCutTarget) warnings.push(`Discovery Target Partially Met: requested ${config.deepCutTarget}% deep cuts, but compatible selections provided ${actualDeepCutPercent}%.`);
  if (config.limitPopularTracks && actualPopularTrackPercent > config.maxPopularTrackPercent) warnings.push(`Popular-track limit was exceeded because active rules or the available candidate pool left too few compatible alternatives.`);
  if (metrics.length && metrics.filter((item) => item.normalizedPopularity == null && item.normalizedPlayCount == null).length >= metrics.length * 0.3) warnings.push("Discovery accuracy was reduced because popularity or play-history data was unavailable for part of the library.");
  if (config.underplayedBoost !== "off" && playCountDataCount === 0) warnings.push("Plex play history is not available yet. Underplayed-track scoring remained neutral.");
  if (config.avoidRecentlyUsedPlaylistTracks && playlistHistoryDataCount === 0) warnings.push("Mixarr has not generated enough matching playlist history to calculate recent playlist usage; this factor remained neutral.");
  if (metrics.length < Math.max(10, selected.length * 2)) warnings.push("Limited Discovery Pool: the eligible candidate pool was too small to guarantee the requested mix.");
  const levelLabel = config.level === "low" ? "Mostly Familiar" : config.level === "medium" ? "Balanced Discovery" : config.level === "high" ? "Deep Discovery" : "Custom Discovery";
  const explanations: DiscoveryExplanation[] = [
    { label: levelLabel, explanation: `The generated playlist used the saved ${levelLabel.toLowerCase()} profile.` },
    { label: `${count(selectedMetrics, ["deep_cut", "hidden_gem"])} Deep Cuts Selected`, explanation: `These tracks had strong compatibility and higher relative discovery value in the eligible pool.` },
    ...(hiddenGemCount ? [{ label: `${hiddenGemCount} Hidden Gems Included`, explanation: "These tracks strongly matched the playlist while having lower play counts or fresher playlist history." }] : []),
    ...(config.limitPopularTracks ? [{ label: "Popular Track Limit Applied", explanation: `Mixarr aimed to keep top-popularity tracks at or below ${config.maxPopularTrackPercent}%.` }] : []),
    ...(config.avoidRecentlyUsedPlaylistTracks ? [{ label: "Recently Used Tracks Reduced", explanation: "Tracks from the selected Mixarr playlist-history lookback received a soft ranking penalty." }] : []),
    ...(config.underplayedBoost !== "off" ? [{ label: "Underplayed Tracks Favored", explanation: "Lower Plex play counts received a relative candidate-pool boost when usable play history existed." }] : []),
    ...(warnings.some((item) => item.startsWith("Discovery Target")) ? [{ label: "Discovery Target Partially Met", explanation: warnings.find((item) => item.startsWith("Discovery Target"))! }] : []),
  ];
  return {
    candidatePoolSize: candidates.length,
    tracksWithPopularityData: popularityDataCount,
    tracksWithPlexPlayCountData: playCountDataCount,
    tracksWithPlaylistHistoryData: playlistHistoryDataCount,
    popularCount: count(metrics, ["popular"]), familiarCount: count(metrics, ["familiar"]),
    deepCutCount: count(metrics, ["deep_cut"]), hiddenGemCount: count(metrics, ["hidden_gem"]),
    requestedDeepCutPercent: config.deepCutTarget, actualDeepCutPercent,
    requestedPopularTrackMaximum: config.limitPopularTracks ? config.maxPopularTrackPercent : null,
    actualPopularTrackPercent,
    recentUsePenaltyCount: selectedMetrics.filter((item) => item.recentPlaylistPenalty > 0).length,
    overplayedPenaltyCount: selectedMetrics.filter((item) => item.overplayedPenalty > 0).length,
    targetSatisfaction, warnings, explanations, executionTimeMs,
  };
}
