import {
  getTrackBpm,
  getTrackEnergy,
  getTrackMood,
  getTrackPopularity,
  NEUTRAL_POPULARITY_SCORE,
} from "./metadataFallbacks";

export const SMART_MIX_TUNING_VERSION = "2.0.2";
export const SMART_MIX_RECENTLY_USED_WINDOW_DAYS = 30;

export type SmartMixTuningConfig = {
  recommendationStrength: number;
  familiarityDiscoveryBalance: number;
  popularityWeight: number;
  moodWeight: number;
  energyWeight: number;
  bpmWeight: number;
  artistVariety: number;
  albumVariety: number;
  avoidRecentlyUsedTracks: boolean;
  presetName?: string;
  tuningVersion: string;
};

export type SmartMixTuningPreset = {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  config: SmartMixTuningConfig;
};

export const DEFAULT_SMART_MIX_TUNING: SmartMixTuningConfig = {
  recommendationStrength: 50,
  familiarityDiscoveryBalance: 50,
  popularityWeight: 50,
  moodWeight: 50,
  energyWeight: 50,
  bpmWeight: 50,
  artistVariety: 50,
  albumVariety: 50,
  avoidRecentlyUsedTracks: true,
  presetName: "Balanced",
  tuningVersion: SMART_MIX_TUNING_VERSION,
};

const builtInPresetDefinitions: Array<Omit<SmartMixTuningPreset, "builtIn" | "config"> & { config: Partial<SmartMixTuningConfig> }> = [
  {
    id: "balanced",
    name: "Balanced",
    description: "A steady all-purpose mix with moderate matching and variety.",
    config: {},
  },
  {
    id: "more_familiar",
    name: "More Familiar",
    description: "Safer, more recognizable tracks with stronger popularity influence.",
    config: {
      recommendationStrength: 62,
      familiarityDiscoveryBalance: 78,
      popularityWeight: 76,
      moodWeight: 54,
      energyWeight: 54,
      bpmWeight: 45,
      artistVariety: 42,
      albumVariety: 42,
      avoidRecentlyUsedTracks: false,
    },
  },
  {
    id: "more_discovery",
    name: "More Discovery",
    description: "Fresh, less obvious picks while keeping compatibility checks active.",
    config: {
      recommendationStrength: 58,
      familiarityDiscoveryBalance: 22,
      popularityWeight: 64,
      moodWeight: 52,
      energyWeight: 52,
      bpmWeight: 42,
      artistVariety: 62,
      albumVariety: 58,
    },
  },
  {
    id: "high_energy",
    name: "High-Energy",
    description: "Upbeat tracks with stronger energy flow and fewer energy drops.",
    config: {
      recommendationStrength: 68,
      familiarityDiscoveryBalance: 58,
      popularityWeight: 56,
      moodWeight: 48,
      energyWeight: 86,
      bpmWeight: 62,
      artistVariety: 48,
      albumVariety: 46,
    },
  },
  {
    id: "chill",
    name: "Chill",
    description: "Relaxed, smoother mood and energy movement.",
    config: {
      recommendationStrength: 64,
      familiarityDiscoveryBalance: 46,
      popularityWeight: 46,
      moodWeight: 78,
      energyWeight: 72,
      bpmWeight: 66,
      artistVariety: 54,
      albumVariety: 52,
    },
  },
  {
    id: "dj_friendly",
    name: "DJ-Friendly",
    description: "Smoother tempo and energy transitions for more mixable playlists.",
    config: {
      recommendationStrength: 78,
      familiarityDiscoveryBalance: 52,
      popularityWeight: 50,
      moodWeight: 62,
      energyWeight: 84,
      bpmWeight: 92,
      artistVariety: 58,
      albumVariety: 56,
    },
  },
  {
    id: "deep_cuts",
    name: "Deep Cuts",
    description: "Discovery-heavy selections with stronger artist and album variety.",
    config: {
      recommendationStrength: 62,
      familiarityDiscoveryBalance: 10,
      popularityWeight: 82,
      moodWeight: 56,
      energyWeight: 56,
      bpmWeight: 50,
      artistVariety: 82,
      albumVariety: 82,
    },
  },
];

export const builtInSmartMixTuningPresets: SmartMixTuningPreset[] = builtInPresetDefinitions.map((preset) => ({
  ...preset,
  builtIn: true,
  config: normalizeSmartMixTuningConfig({
    ...DEFAULT_SMART_MIX_TUNING,
    ...preset.config,
    presetName: preset.name,
  }),
}));

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function normalizedSlider(value: number) {
  return clamp(value) / 100;
}

function sliderFactor(value: number, low = 0.2, high = 1.8) {
  return low + normalizedSlider(value) * (high - low);
}

export function normalizeSmartMixTuningConfig(value: unknown): SmartMixTuningConfig {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<SmartMixTuningConfig>
    : {};

  return {
    recommendationStrength: clamp(finiteNumber(source.recommendationStrength) ?? DEFAULT_SMART_MIX_TUNING.recommendationStrength),
    familiarityDiscoveryBalance: clamp(finiteNumber(source.familiarityDiscoveryBalance) ?? DEFAULT_SMART_MIX_TUNING.familiarityDiscoveryBalance),
    popularityWeight: clamp(finiteNumber(source.popularityWeight) ?? DEFAULT_SMART_MIX_TUNING.popularityWeight),
    moodWeight: clamp(finiteNumber(source.moodWeight) ?? DEFAULT_SMART_MIX_TUNING.moodWeight),
    energyWeight: clamp(finiteNumber(source.energyWeight) ?? DEFAULT_SMART_MIX_TUNING.energyWeight),
    bpmWeight: clamp(finiteNumber(source.bpmWeight) ?? DEFAULT_SMART_MIX_TUNING.bpmWeight),
    artistVariety: clamp(finiteNumber(source.artistVariety) ?? DEFAULT_SMART_MIX_TUNING.artistVariety),
    albumVariety: clamp(finiteNumber(source.albumVariety) ?? DEFAULT_SMART_MIX_TUNING.albumVariety),
    avoidRecentlyUsedTracks: source.avoidRecentlyUsedTracks ?? DEFAULT_SMART_MIX_TUNING.avoidRecentlyUsedTracks,
    presetName: typeof source.presetName === "string" && source.presetName.trim()
      ? source.presetName.trim().slice(0, 120)
      : undefined,
    tuningVersion: SMART_MIX_TUNING_VERSION,
  };
}

export function smartMixTuningPresetLabel(config: unknown) {
  const tuning = normalizeSmartMixTuningConfig(config);
  return tuning.presetName || "Custom";
}

export function tuningWeightFactor(value: number) {
  return sliderFactor(value);
}

function targetEnergyForPreset(presetName?: string) {
  const normalized = (presetName || "").toLowerCase();
  if (normalized.includes("high-energy")) return 0.88;
  if (normalized.includes("chill")) return 0.28;
  if (normalized.includes("dj-friendly")) return 0.68;
  return null;
}

function targetMoodForPreset(presetName?: string) {
  const normalized = (presetName || "").toLowerCase();
  if (normalized.includes("chill")) return 0.62;
  return null;
}

function normalizedFeature(value: number | null) {
  if (value == null) return null;
  return value > 1 ? clamp(value, 0, 100) / 100 : clamp(value, 0, 1);
}

export function applyTuningToCandidateScore({
  track,
  baseScore,
  tuningConfig,
  recentlyUsedTrackIds = new Set<string>(),
}: {
  track: any;
  baseScore: number;
  tuningConfig: SmartMixTuningConfig;
  recentlyUsedTrackIds?: Set<string>;
}) {
  const tuning = normalizeSmartMixTuningConfig(tuningConfig);
  const strengthFactor = 0.65 + normalizedSlider(tuning.recommendationStrength) * 0.7;
  const popularity = getTrackPopularity(track) ?? NEUTRAL_POPULARITY_SCORE;
  const popularityWeight = sliderFactor(tuning.popularityWeight, 0, 1.45);
  const familiarityDirection = (tuning.familiarityDiscoveryBalance - 50) / 50;
  const discoveryLean = Math.max(0, -familiarityDirection);
  const familiarOrDiscoveryBonus = ((clamp(popularity) - 50) / 10) * familiarityDirection * popularityWeight * 1.4;
  const popularityBaseline = (clamp(popularity) / 10) * (0.35 + popularityWeight * 0.65) * (1 - discoveryLean * 0.6);
  const energy = normalizedFeature(getTrackEnergy(track));
  const mood = normalizedFeature(getTrackMood(track));
  const targetEnergy = targetEnergyForPreset(tuning.presetName);
  const targetMood = targetMoodForPreset(tuning.presetName);
  const energyShapeBonus = energy == null || targetEnergy == null
    ? 0
    : (1 - Math.abs(energy - targetEnergy)) * tuningWeightFactor(tuning.energyWeight) * 3.5;
  const moodShapeBonus = mood == null || targetMood == null
    ? 0
    : (1 - Math.abs(mood - targetMood)) * tuningWeightFactor(tuning.moodWeight) * 2.5;
  const recentlyUsedPenalty = tuning.avoidRecentlyUsedTracks && track.id && recentlyUsedTrackIds.has(track.id)
    ? 8 + normalizedSlider(tuning.recommendationStrength) * 6
    : 0;

  return roundScore(50 + (baseScore - 50) * strengthFactor + popularityBaseline + familiarOrDiscoveryBonus + energyShapeBonus + moodShapeBonus - recentlyUsedPenalty);
}

export function applyTuningToTransitionScore({
  leftTrack,
  rightTrack,
  tuningConfig,
}: {
  leftTrack: any;
  rightTrack: any;
  tuningConfig: SmartMixTuningConfig;
}) {
  const tuning = normalizeSmartMixTuningConfig(tuningConfig);
  let score = 0;
  const leftBpm = getTrackBpm(leftTrack);
  const rightBpm = getTrackBpm(rightTrack);
  const leftEnergy = normalizedFeature(getTrackEnergy(leftTrack));
  const rightEnergy = normalizedFeature(getTrackEnergy(rightTrack));
  const leftMood = normalizedFeature(getTrackMood(leftTrack));
  const rightMood = normalizedFeature(getTrackMood(rightTrack));

  if (leftBpm != null && rightBpm != null) {
    score -= Math.min(45, Math.abs(leftBpm - rightBpm)) * tuningWeightFactor(tuning.bpmWeight) * 0.18;
  } else if (tuning.bpmWeight >= 70) {
    score -= 2;
  }

  if (leftEnergy != null && rightEnergy != null) {
    const energyDiff = Math.abs(leftEnergy - rightEnergy);
    score -= energyDiff * tuningWeightFactor(tuning.energyWeight) * 10;
    if (tuning.presetName?.toLowerCase().includes("high-energy") && rightEnergy < leftEnergy - 0.25) score -= 4;
  } else if (tuning.energyWeight >= 70) {
    score -= 1.5;
  }

  if (leftMood != null && rightMood != null) {
    score -= Math.abs(leftMood - rightMood) * tuningWeightFactor(tuning.moodWeight) * 8;
  } else if (tuning.moodWeight >= 70) {
    score -= 1.25;
  }

  return roundScore(score);
}

export function tuningVarietyPenalty({
  track,
  selectedTracks,
  tuningConfig,
}: {
  track: any;
  selectedTracks: any[];
  tuningConfig: SmartMixTuningConfig;
}) {
  const tuning = normalizeSmartMixTuningConfig(tuningConfig);
  const artistKey = String(track.artistId || track.artist?.id || track.artist?.title || "").toLowerCase();
  const albumKey = String(track.albumId || track.album?.id || track.album?.title || "").toLowerCase();
  const artistRepeats = artistKey
    ? selectedTracks.filter((selected) => String(selected.artistId || selected.artist?.id || selected.artist?.title || "").toLowerCase() === artistKey).length
    : 0;
  const albumRepeats = albumKey
    ? selectedTracks.filter((selected) => String(selected.albumId || selected.album?.id || selected.album?.title || "").toLowerCase() === albumKey).length
    : 0;

  return roundScore(
    artistRepeats * tuningWeightFactor(tuning.artistVariety) * 3.5
    + albumRepeats * tuningWeightFactor(tuning.albumVariety) * 2.75,
  );
}

export function buildTuningWarnings({
  tracks,
  tuningConfig,
}: {
  tracks: any[];
  tuningConfig: SmartMixTuningConfig;
}) {
  const tuning = normalizeSmartMixTuningConfig(tuningConfig);
  const warnings: string[] = [];
  if (tracks.length === 0) return warnings;

  const missingBpm = tracks.filter((track) => getTrackBpm(track) == null).length;
  if (tuning.bpmWeight >= 75 && missingBpm >= Math.max(3, Math.ceil(tracks.length * 0.3))) {
    warnings.push(`BPM tuning was softened because ${missingBpm} selected tracks are missing BPM data.`);
  }

  if (tuning.avoidRecentlyUsedTracks) {
    const recentlyUsed = tracks.filter((track) => Array.isArray(track.fallbacksApplied) && track.fallbacksApplied.includes("recently used: softened ranking")).length;
    if (recentlyUsed > 0) warnings.push(`Avoid recently used tracks fell back softly for ${recentlyUsed} track${recentlyUsed === 1 ? "" : "s"}.`);
  }

  return warnings;
}

function roundScore(value: number) {
  return Math.round(value * 1000) / 1000;
}
