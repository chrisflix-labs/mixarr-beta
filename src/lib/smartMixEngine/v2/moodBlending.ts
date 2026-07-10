import { getTrackBpm, getTrackEnergy, getTrackMood } from "./metadataFallbacks";
import { normalizeSmartMixTuningConfig, tuningWeightFactor } from "./tuning";
import type {
  SmartMixEngineV2Config,
  SmartMixMoodBlendMode,
  SmartMixMoodBlendTrackData,
  SmartMixMoodCurve,
  SmartMixMoodCurveSection,
} from "./types";

type MoodProfile = {
  valence: number;
  energy: number;
};

type NormalizedMoodBlendConfig = {
  moodBlendMode: SmartMixMoodBlendMode;
  selectedMoodPath: string[];
  allowedMoods: string[];
  activeMoods: string[];
  enabled: boolean;
};

type MoodBlendScoreResult = {
  score: number;
  data: SmartMixMoodBlendTrackData;
};

type NormalizedMoodTag = {
  raw: string;
  canonical: string;
  isAlias: boolean;
};

type MoodMatchLevel = SmartMixMoodBlendTrackData["moodMatchLevel"];

type MoodCoverage = {
  selected: Record<string, number>;
  library: Record<string, number>;
  preview: Record<string, {
    exact: number;
    alias: number;
    adjacent: number;
    related: number;
    fallbackCompatible: number;
    missingMood: number;
  }>;
  missingMoodCount: number;
};

const moodBlendModes = new Set<SmartMixMoodBlendMode>([
  "off",
  "smooth_transition",
  "strict_matching",
  "mixed_mood",
]);

const moodProfiles: Record<string, MoodProfile> = {
  ambient: { valence: 0.5, energy: 0.15 },
  balanced: { valence: 0.5, energy: 0.5 },
  chill: { valence: 0.58, energy: 0.25 },
  dark: { valence: 0.16, energy: 0.55 },
  emotional: { valence: 0.35, energy: 0.45 },
  energetic: { valence: 0.74, energy: 0.86 },
  focus: { valence: 0.55, energy: 0.35 },
  happy: { valence: 0.9, energy: 0.62 },
  hype: { valence: 0.76, energy: 0.94 },
  intense: { valence: 0.35, energy: 0.92 },
  mellow: { valence: 0.36, energy: 0.22 },
  moody: { valence: 0.28, energy: 0.46 },
  party: { valence: 0.86, energy: 0.9 },
  relaxed: { valence: 0.62, energy: 0.22 },
  sad: { valence: 0.16, energy: 0.24 },
  upbeat: { valence: 0.84, energy: 0.76 },
  workout: { valence: 0.7, energy: 0.9 },
};

const moodAliases: Record<string, string[]> = {
  happy: ["happy", "cheerful", "fun", "upbeat", "joyful"],
  energetic: ["energetic", "high energy", "hype", "driving"],
  intense: ["intense"],
  chill: ["chill", "relaxed", "calm", "mellow", "laid back", "laidback"],
  focus: ["focus", "focused", "concentration", "work", "study"],
  ambient: ["ambient", "atmospheric", "spacey", "background"],
  dark: ["dark", "gloomy", "brooding", "ominous"],
  moody: ["moody", "emotional", "melancholic", "sad"],
  party: ["party", "dance", "club", "festive"],
};

const moodAliasLookup = Object.entries(moodAliases).reduce<Record<string, string>>((lookup, [canonical, aliases]) => {
  for (const alias of aliases) lookup[alias] = canonical;
  return lookup;
}, {});

const compatibleMoodFamilies: Record<string, string[]> = {
  happy: ["energetic", "party", "chill"],
  energetic: ["happy", "party", "intense"],
  intense: ["energetic", "dark", "moody"],
  party: ["happy", "energetic"],
  chill: ["focus", "ambient", "happy"],
  focus: ["chill", "ambient"],
  ambient: ["chill", "focus", "moody"],
  dark: ["moody", "intense", "ambient"],
  moody: ["dark", "ambient", "intense"],
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number) {
  return Math.round(value * 1000) / 1000;
}

function normalizeMoodName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}

function moodKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function canonicalMood(value: unknown) {
  if (typeof value !== "string") return "";
  const key = moodKey(value);
  if (!key) return "";
  return moodAliasLookup[key] || key;
}

function splitMoodString(value: string) {
  return value.split(/\s*(?:->|>|,|\||\n)\s*/).filter(Boolean);
}

function uniqueMoods(values: unknown) {
  const list = Array.isArray(values)
    ? values
    : typeof values === "string"
    ? splitMoodString(values)
    : [];
  const seen = new Set<string>();
  const moods: string[] = [];

  for (const value of list) {
    const mood = canonicalMood(normalizeMoodName(value));
    const key = moodKey(mood);
    if (!mood || !key || seen.has(key)) continue;
    seen.add(key);
    moods.push(mood);
  }

  return moods.slice(0, 12);
}

function normalizeMode(value: unknown): SmartMixMoodBlendMode {
  if (typeof value !== "string") return "off";
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "smooth") return "smooth_transition";
  if (normalized === "strict") return "strict_matching";
  if (normalized === "mixed") return "mixed_mood";
  return moodBlendModes.has(normalized as SmartMixMoodBlendMode)
    ? normalized as SmartMixMoodBlendMode
    : "off";
}

export function normalizeMoodBlendConfig(config: Partial<SmartMixEngineV2Config>): NormalizedMoodBlendConfig {
  const selectedMoodPath = uniqueMoods(config.selectedMoodPath ?? (config as any).moodPath);
  const allowedMoods = uniqueMoods(config.allowedMoods);
  let moodBlendMode = normalizeMode(config.moodBlendMode);

  if (moodBlendMode === "off") {
    if (selectedMoodPath.length > 1) moodBlendMode = "smooth_transition";
    else if (allowedMoods.length > 1) moodBlendMode = "mixed_mood";
  }

  const pathMoods = selectedMoodPath.length > 0 ? selectedMoodPath : allowedMoods;
  const mixedMoods = allowedMoods.length > 0 ? allowedMoods : selectedMoodPath;
  const activeMoods = moodBlendMode === "mixed_mood" ? mixedMoods : pathMoods;
  const enabled = moodBlendMode !== "off" && activeMoods.length > 0;

  return {
    moodBlendMode: enabled ? moodBlendMode : "off",
    selectedMoodPath: pathMoods,
    allowedMoods: mixedMoods,
    activeMoods,
    enabled,
  };
}

export function moodBlendModeLabel(mode: unknown) {
  const normalized = normalizeMode(mode);
  if (normalized === "smooth_transition") return "Smooth Transition";
  if (normalized === "strict_matching") return "Strict Matching";
  if (normalized === "mixed_mood") return "Mixed Mood";
  return "Off";
}

function collectMoodValues(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return splitMoodString(value);
  if (Array.isArray(value)) return value.flatMap(collectMoodValues);
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return collectMoodValues(item.name ?? item.value ?? item.label ?? item.mood);
  }
  return [];
}

export function getNormalizedTrackMoods(track: any): NormalizedMoodTag[] {
  const moodTagObjects = [
    ...(Array.isArray(track?.tags) ? track.tags.filter((tag: any) => !tag?.type || tag.type === "mood") : []),
    ...(Array.isArray(track?.artist?.tags) ? track.artist.tags.filter((tag: any) => !tag?.type || tag.type === "mood") : []),
    ...(Array.isArray(track?.album?.tags) ? track.album.tags.filter((tag: any) => !tag?.type || tag.type === "mood") : []),
  ];
  const rawValues = [
    ...collectMoodValues(track?.moodTags),
    ...collectMoodValues(track?.moods),
    ...collectMoodValues(track?.moodTag),
    ...(typeof track?.mood === "string" ? collectMoodValues(track.mood) : []),
    ...(typeof track?.valence === "string" ? collectMoodValues(track.valence) : []),
    ...collectMoodValues(track?.metadata?.mood),
    ...collectMoodValues(track?.metadata?.moods),
    ...collectMoodValues(track?.metadata?.moodTags),
    ...collectMoodValues(track?.metadata?.audioFeature?.mood),
    ...collectMoodValues(track?.metadata?.audioFeature?.moods),
    ...collectMoodValues(track?.metadata?.audioFeatures?.mood),
    ...collectMoodValues(track?.metadata?.audioFeatures?.moods),
    ...collectMoodValues(track?.audioFeature?.mood),
    ...collectMoodValues(track?.audioFeature?.moods),
    ...collectMoodValues(track?.audioFeature?.moodTag),
    ...collectMoodValues(track?.audioFeature?.moodLabel),
    ...collectMoodValues(track?.audioFeature?.moodTags),
    ...collectMoodValues(track?.audioFeatures?.mood),
    ...collectMoodValues(track?.audioFeatures?.moods),
    ...collectMoodValues(track?.audioFeatures?.moodTag),
    ...collectMoodValues(track?.audioFeatures?.moodLabel),
    ...collectMoodValues(track?.audioFeatures?.moodTags),
    ...moodTagObjects.flatMap(collectMoodValues),
  ];
  const seen = new Set<string>();
  const tags: NormalizedMoodTag[] = [];

  for (const rawValue of rawValues) {
    const raw = normalizeMoodName(rawValue);
    const canonical = canonicalMood(raw);
    if (!raw || !canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    tags.push({
      raw,
      canonical,
      isAlias: moodKey(raw) !== canonical,
    });
  }

  return tags.slice(0, 12);
}

export function getTrackMoodTags(track: any): string[] {
  return getNormalizedTrackMoods(track).map((tag) => tag.canonical);
}

function profileForMood(mood: string): MoodProfile | null {
  const key = canonicalMood(mood);
  if (moodProfiles[key]) return moodProfiles[key];
  if (key.includes("happy")) return moodProfiles.happy;
  if (key.includes("chill")) return moodProfiles.chill;
  if (key.includes("focus")) return moodProfiles.focus;
  if (key.includes("ambient")) return moodProfiles.ambient;
  if (key.includes("dark")) return moodProfiles.dark;
  if (key.includes("party")) return moodProfiles.party;
  if (key.includes("energy") || key.includes("energetic")) return moodProfiles.energetic;
  if (key.includes("intense")) return moodProfiles.intense;
  if (key.includes("sad")) return moodProfiles.sad;
  if (key.includes("relax")) return moodProfiles.relaxed;
  if (key.includes("upbeat")) return moodProfiles.upbeat;
  return null;
}

function profileForTrack(track: any, moodTags: string[]): MoodProfile | null {
  const profiles = moodTags.map(profileForMood).filter((profile): profile is MoodProfile => Boolean(profile));
  if (profiles.length > 0) {
    return {
      valence: profiles.reduce((sum, profile) => sum + profile.valence, 0) / profiles.length,
      energy: profiles.reduce((sum, profile) => sum + profile.energy, 0) / profiles.length,
    };
  }

  const mood = getTrackMood(track);
  if (mood == null) return null;
  return { valence: mood > 1 ? clamp(mood / 100) : clamp(mood), energy: 0.5 };
}

function moodDistance(left: string, right: string) {
  if (canonicalMood(left) === canonicalMood(right)) return 0;
  const leftProfile = profileForMood(left);
  const rightProfile = profileForMood(right);
  if (!leftProfile || !rightProfile) return 0.45;
  return Math.hypot(leftProfile.valence - rightProfile.valence, leftProfile.energy - rightProfile.energy);
}

function trackConflictsWithMoods(trackMoodTags: string[], activeMoods: string[]) {
  if (trackMoodTags.length === 0 || activeMoods.length === 0) return false;
  const matched = trackMoodTags.some((tag) => activeMoods.some((mood) => canonicalMood(mood) === canonicalMood(tag)));
  if (matched) return false;
  return trackMoodTags.some((tag) => activeMoods.some((mood) => moodDistance(tag, mood) >= 0.72));
}

function selectedMoodsMayConflict(moods: string[], adjacentOnly = false) {
  for (let index = 0; index < moods.length; index += 1) {
    const compareStart = adjacentOnly ? index + 1 : index + 1;
    const compareEnd = adjacentOnly ? Math.min(moods.length, index + 2) : moods.length;
    for (let compareIndex = compareStart; compareIndex < compareEnd; compareIndex += 1) {
      if (moodDistance(moods[index], moods[compareIndex]) >= 0.72) return true;
    }
  }
  return false;
}

export function moodZoneForPosition(position: number, limit: number, selectedMoodPath: string[]) {
  if (selectedMoodPath.length === 0) {
    return { targetMood: null, adjacentMoods: [] as string[], sectionIndex: 0 };
  }

  const safeLimit = Math.max(1, limit);
  const sectionIndex = Math.min(selectedMoodPath.length - 1, Math.floor((position / safeLimit) * selectedMoodPath.length));
  const sectionStart = sectionIndex / selectedMoodPath.length;
  const sectionEnd = (sectionIndex + 1) / selectedMoodPath.length;
  const progress = sectionEnd === sectionStart ? 0 : ((position + 0.5) / safeLimit - sectionStart) / (sectionEnd - sectionStart);
  const adjacentMoods = [
    ...(sectionIndex > 0 && progress < 0.35 ? [selectedMoodPath[sectionIndex - 1]] : []),
    ...(sectionIndex < selectedMoodPath.length - 1 && progress > 0.65 ? [selectedMoodPath[sectionIndex + 1]] : []),
  ];

  return {
    targetMood: selectedMoodPath[sectionIndex],
    adjacentMoods,
    sectionIndex,
  };
}

function matchingMoods(trackMoodTags: string[], moods: string[]) {
  return moods.filter((mood) => trackMoodTags.some((tag) => canonicalMood(tag) === canonicalMood(mood)));
}

function nearestMoodDistance(track: any, trackMoodTags: string[], moods: string[]) {
  const profile = profileForTrack(track, trackMoodTags);
  if (!profile || moods.length === 0) return null;
  const distances = moods
    .map(profileForMood)
    .filter((moodProfile): moodProfile is MoodProfile => Boolean(moodProfile))
    .map((moodProfile) => Math.hypot(profile.valence - moodProfile.valence, profile.energy - moodProfile.energy));
  if (distances.length === 0) return null;
  return Math.min(...distances);
}

function scoreByProfileDistance(distance: number | null, maxBonus: number) {
  if (distance == null) return 0;
  return Math.max(-2.5, (1 - Math.min(1, distance / 0.8)) * maxBonus);
}

function isCompatibleFamily(left: string, right: string) {
  const leftKey = canonicalMood(left);
  const rightKey = canonicalMood(right);
  if (!leftKey || !rightKey || leftKey === rightKey) return false;
  return (compatibleMoodFamilies[leftKey] || []).includes(rightKey)
    || (compatibleMoodFamilies[rightKey] || []).includes(leftKey);
}

function energyBpmCompatibility(track: any, targetMood: string | null) {
  if (!targetMood) return 0;
  const profile = profileForMood(targetMood);
  if (!profile) return 0;
  const energy = getTrackEnergy(track);
  const bpm = getTrackBpm(track);
  const energyScore = energy == null ? 0 : Math.max(0, 1 - Math.abs(clamp(energy) - profile.energy) / 0.35);
  const targetBpm = 72 + profile.energy * 86;
  const bpmScore = bpm == null ? 0 : Math.max(0, 1 - Math.abs(bpm - targetBpm) / 34);
  if (energyScore === 0 && bpmScore === 0) return 0;
  return energy == null || bpm == null ? Math.max(energyScore, bpmScore) * 0.75 : (energyScore * 0.6 + bpmScore * 0.4);
}

function bestMoodMatch({
  track,
  normalizedTags,
  targetMood,
  adjacentMoods,
  activeMoods,
  strict,
}: {
  track: any;
  normalizedTags: NormalizedMoodTag[];
  targetMood: string | null;
  adjacentMoods: string[];
  activeMoods: string[];
  strict: boolean;
}): { level: MoodMatchLevel; score: number; matchingMoods: string[] } {
  const target = targetMood ? canonicalMood(targetMood) : null;
  const adjacent = adjacentMoods.map(canonicalMood).filter(Boolean);
  const active = activeMoods.map(canonicalMood).filter(Boolean);
  const exactMatches = normalizedTags
    .filter((tag) => !tag.isAlias && ((target && tag.canonical === target) || active.includes(tag.canonical)))
    .map((tag) => tag.canonical);
  if (exactMatches.length > 0) return { level: "exact", score: 1, matchingMoods: Array.from(new Set(exactMatches)) };

  const aliasMatches = normalizedTags
    .filter((tag) => tag.isAlias && ((target && tag.canonical === target) || active.includes(tag.canonical)))
    .map((tag) => tag.canonical);
  if (aliasMatches.length > 0) return { level: "alias", score: 0.85, matchingMoods: Array.from(new Set(aliasMatches)) };

  if (strict) {
    return {
      level: normalizedTags.length > 0 ? "generic" : "none",
      score: 0,
      matchingMoods: [],
    };
  }

  const adjacentMatches = normalizedTags.filter((tag) => adjacent.includes(tag.canonical)).map((tag) => tag.canonical);
  if (adjacentMatches.length > 0) return { level: "adjacent", score: 0.65, matchingMoods: Array.from(new Set(adjacentMatches)) };

  const familyMatches = normalizedTags
    .filter((tag) => (target ? isCompatibleFamily(tag.canonical, target) : active.some((mood) => isCompatibleFamily(tag.canonical, mood))))
    .map((tag) => tag.canonical);
  if (familyMatches.length > 0) return { level: "family", score: 0.45, matchingMoods: Array.from(new Set(familyMatches)) };

  const compatibility = energyBpmCompatibility(track, target || active[0] || null);
  if (normalizedTags.length === 0 && compatibility >= 0.55) {
    return { level: "energy_bpm", score: 0.25, matchingMoods: [] };
  }

  return {
    level: normalizedTags.length > 0 ? "generic" : "none",
    score: 0,
    matchingMoods: [],
  };
}

function moodScoreToBonus(matchScore: number, factor: number) {
  return matchScore * 9 * factor;
}

function isFinalMoodFallback(level: MoodMatchLevel) {
  return level === "generic" || level === "none";
}

export function scoreMoodBlendForTrack<TTrack extends Record<string, any>>({
  track,
  config,
  position,
  limit,
}: {
  track: TTrack;
  config: SmartMixEngineV2Config;
  position: number;
  limit: number;
}): MoodBlendScoreResult {
  const blend = normalizeMoodBlendConfig(config);
  const normalizedMoodTags = getNormalizedTrackMoods(track);
  const moodTags = normalizedMoodTags.map((tag) => tag.canonical);
  const tuning = normalizeSmartMixTuningConfig(config.tuningConfig);
  const factor = tuningWeightFactor(tuning.moodWeight);
  const emptyData: SmartMixMoodBlendTrackData = {
    mode: blend.moodBlendMode,
    moodTags,
    targetMood: null,
    matchingMoods: [],
    adjacentMoods: [],
    moodMatchLevel: "none",
    moodMatchScore: 0,
    isMoodFallback: false,
    isMoodConflict: false,
    isMultiMoodBridge: false,
  };

  if (!blend.enabled) return { score: 0, data: emptyData };

  if (blend.moodBlendMode === "smooth_transition") {
    const zone = moodZoneForPosition(position, limit, blend.selectedMoodPath);
    const zoneMoods = [zone.targetMood, ...zone.adjacentMoods].filter((mood): mood is string => Boolean(mood));
    const match = bestMoodMatch({
      track,
      normalizedTags: normalizedMoodTags,
      targetMood: zone.targetMood,
      adjacentMoods: zone.adjacentMoods,
      activeMoods: zone.targetMood ? [zone.targetMood] : [],
      strict: false,
    });
    const targetMatches = zone.targetMood ? matchingMoods(moodTags, [zone.targetMood]) : [];
    const adjacentMatches = matchingMoods(moodTags, zone.adjacentMoods);
    const conflict = trackConflictsWithMoods(moodTags, zoneMoods);
    const profileDistance = nearestMoodDistance(track, moodTags, zoneMoods);
    const bridge = (targetMatches.length > 0 && adjacentMatches.length > 0) || match.level === "adjacent";
    let score = moodScoreToBonus(match.score, factor) + scoreByProfileDistance(profileDistance, 2.5) * factor;

    if (targetMatches.length > 0) score += 1.5 * factor;
    if (bridge) score += 3.5 * factor;
    if (match.level === "energy_bpm") score += 1 * factor;
    if (isFinalMoodFallback(match.level)) score -= 2 * factor;
    if (conflict) score -= 5 * factor;

    return {
      score: roundScore(score),
      data: {
        ...emptyData,
        targetMood: zone.targetMood,
        adjacentMoods: zone.adjacentMoods,
        matchingMoods: [...match.matchingMoods, ...targetMatches, ...adjacentMatches].filter((mood, index, moods) => moods.indexOf(mood) === index),
        moodMatchLevel: match.level,
        moodMatchScore: match.score,
        isMoodFallback: isFinalMoodFallback(match.level),
        isMoodConflict: conflict,
        isMultiMoodBridge: bridge,
      },
    };
  }

  const activeMoods = blend.moodBlendMode === "mixed_mood" ? blend.allowedMoods : blend.selectedMoodPath;
  const matches = matchingMoods(moodTags, activeMoods);
  const match = bestMoodMatch({
    track,
    normalizedTags: normalizedMoodTags,
    targetMood: activeMoods[0] || null,
    adjacentMoods: activeMoods.slice(1),
    activeMoods,
    strict: blend.moodBlendMode === "strict_matching",
  });
  const conflict = trackConflictsWithMoods(moodTags, activeMoods);
  const profileDistance = nearestMoodDistance(track, moodTags, activeMoods);
  const multiMatch = matches.length > 1 || match.matchingMoods.length > 1;
  let score = moodScoreToBonus(match.score, factor) + scoreByProfileDistance(profileDistance, blend.moodBlendMode === "strict_matching" ? 1.5 : 2.5) * factor;

  if (blend.moodBlendMode === "strict_matching") {
    if (match.level === "exact" || match.level === "alias") score += Math.min(2, match.matchingMoods.length - 1) * 1.75 * factor;
    else if (moodTags.length > 0) score -= 6 * factor;
    else score -= 2.5 * factor;
    if (conflict) score -= 5 * factor;
  } else {
    if (matches.length > 0) score += Math.min(3, matches.length - 1) * 2 * factor;
    else if (match.level === "energy_bpm") score += 1 * factor;
    else if (isFinalMoodFallback(match.level)) score -= 2 * factor;
    if (multiMatch) score += 2.5 * factor;
    if (conflict) score -= 4.5 * factor;
  }

  return {
    score: roundScore(score),
    data: {
      ...emptyData,
      matchingMoods: [...match.matchingMoods, ...matches].filter((mood, index, moods) => moods.indexOf(mood) === index),
      moodMatchLevel: match.level,
      moodMatchScore: match.score,
      isMoodFallback: isFinalMoodFallback(match.level),
      isMoodConflict: conflict,
      isMultiMoodBridge: multiMatch,
    },
  };
}

function adjacentForMood(moods: string[], mood: string) {
  const index = moods.findIndex((item) => canonicalMood(item) === canonicalMood(mood));
  if (index < 0) return moods.filter((item) => canonicalMood(item) !== canonicalMood(mood));
  return [
    ...(index > 0 ? [moods[index - 1]] : []),
    ...(index < moods.length - 1 ? [moods[index + 1]] : []),
  ];
}

function coverageForMood<TTrack extends Record<string, any>>(tracks: TTrack[], mood: string, moods: string[]) {
  return tracks.reduce<{
    exact: number;
    alias: number;
    adjacent: number;
    related: number;
    fallbackCompatible: number;
    missingMood: number;
  }>((coverage, track) => {
    const normalizedTags = getNormalizedTrackMoods(track);
    const match = bestMoodMatch({
      track,
      normalizedTags,
      targetMood: mood,
      adjacentMoods: adjacentForMood(moods, mood),
      activeMoods: [mood],
      strict: false,
    });
    if (match.level === "exact") coverage.exact += 1;
    if (match.level === "alias") coverage.alias += 1;
    if (match.level === "adjacent") coverage.adjacent += 1;
    if (match.level === "family") coverage.related += 1;
    if (match.level === "energy_bpm") coverage.fallbackCompatible += 1;
    if (normalizedTags.length === 0) coverage.missingMood += 1;
    return coverage;
  }, {
    exact: 0,
    alias: 0,
    adjacent: 0,
    related: 0,
    fallbackCompatible: 0,
    missingMood: 0,
  });
}

function countMoodCoverage<TTrack extends Record<string, any>>(tracks: TTrack[], moods: string[]) {
  return moods.reduce<Record<string, number>>((coverage, mood) => {
    const moodCoverage = coverageForMood(tracks, mood, moods);
    coverage[mood] = moodCoverage.exact
      + moodCoverage.alias
      + moodCoverage.adjacent
      + moodCoverage.related
      + moodCoverage.fallbackCompatible;
    return coverage;
  }, {});
}

export function buildMoodCoverage<TTrack extends Record<string, any>>({
  tracks,
  candidates,
  config,
}: {
  tracks: TTrack[];
  candidates: TTrack[];
  config: SmartMixEngineV2Config;
}): MoodCoverage {
  const blend = normalizeMoodBlendConfig(config);
  const activeMoods = blend.moodBlendMode === "mixed_mood" ? blend.allowedMoods : blend.selectedMoodPath;
  const preview = activeMoods.reduce<MoodCoverage["preview"]>((summary, mood) => {
    summary[mood] = coverageForMood(candidates, mood, activeMoods);
    return summary;
  }, {});
  return {
    selected: countMoodCoverage(tracks, activeMoods),
    library: countMoodCoverage(candidates, activeMoods),
    preview,
    missingMoodCount: tracks.filter((track) => (track.moodBlend?.moodTags || getTrackMoodTags(track)).length === 0).length,
  };
}

export function buildMoodCurve<TTrack extends Record<string, any>>({
  tracks,
  config,
}: {
  tracks: TTrack[];
  config: SmartMixEngineV2Config;
}): SmartMixMoodCurve {
  const blend = normalizeMoodBlendConfig(config);
  if (!blend.enabled) return null;

  if (blend.moodBlendMode === "mixed_mood") {
    const counts = countMoodCoverage(tracks, blend.allowedMoods);
    const dominantMood = Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] || null;
    return {
      mode: "mixed_mood",
      primaryMoods: blend.allowedMoods,
      dominantMood,
      secondaryMoodCoverage: blend.allowedMoods.filter((mood) => mood !== dominantMood && (counts[mood] || 0) > 0),
    };
  }

  const path = blend.selectedMoodPath;
  const sections: SmartMixMoodCurveSection[] = path.map((mood, index) => {
    const start = Math.floor((index / path.length) * tracks.length) + 1;
    const end = index === path.length - 1 ? tracks.length : Math.floor(((index + 1) / path.length) * tracks.length);
    return {
      start,
      end,
      mood,
      matchedTrackCount: tracks.slice(Math.max(0, start - 1), end).filter((track) => {
        const tags: string[] = track.moodBlend?.moodTags || getTrackMoodTags(track);
        return tags.some((tag: string) => canonicalMood(tag) === canonicalMood(mood));
      }).length,
    };
  });

  return {
    mode: blend.moodBlendMode as "smooth_transition" | "strict_matching",
    sections,
  };
}

export function buildMoodWarnings<TTrack extends Record<string, any>>({
  tracks,
  candidates,
  config,
}: {
  tracks: TTrack[];
  candidates: TTrack[];
  config: SmartMixEngineV2Config;
}) {
  const blend = normalizeMoodBlendConfig(config);
  if (!blend.enabled || tracks.length === 0) return [];

  const warnings: string[] = [];
  const coverage = buildMoodCoverage({ tracks, candidates, config });
  const activeMoods = blend.moodBlendMode === "mixed_mood" ? blend.allowedMoods : blend.selectedMoodPath;
  const exactOrAliasCount = tracks.filter((track) => track.moodBlend?.moodMatchLevel === "exact" || track.moodBlend?.moodMatchLevel === "alias").length;
  const relaxedMatchCount = tracks.filter((track) => {
    const level = track.moodBlend?.moodMatchLevel;
    return level === "adjacent" || level === "family" || level === "energy_bpm";
  }).length;
  const fallbackCount = tracks.filter((track) => track.moodBlend?.isMoodFallback).length;
  const conflictCount = tracks.filter((track) => track.moodBlend?.isMoodConflict).length;
  const missingTagCount = tracks.filter((track) => (track.moodBlend?.moodTags || getTrackMoodTags(track)).length === 0).length;

  if (blend.moodBlendMode === "mixed_mood" && selectedMoodsMayConflict(activeMoods)) {
    warnings.push("Selected moods may conflict, so Smart Mix softened mood matching between compatible tracks.");
  }
  if (blend.moodBlendMode === "smooth_transition" && selectedMoodsMayConflict(activeMoods, true)) {
    warnings.push("Mood transition may feel uneven because adjacent moods in the path are far apart.");
  }
  if (blend.moodBlendMode === "strict_matching" && exactOrAliasCount < tracks.length) {
    warnings.push("Strict Mood Matching is enabled and limited the available track pool.");
  }
  if (exactOrAliasCount === 0 && relaxedMatchCount > 0 && activeMoods.length > 0) {
    warnings.push(`0 exact mood matches found for ${activeMoods.join(", ")}, but ${relaxedMatchCount} related mood matches were used.`);
  } else if (relaxedMatchCount > 0 && exactOrAliasCount < Math.min(tracks.length, activeMoods.length)) {
    warnings.push(`${relaxedMatchCount} related mood match${relaxedMatchCount === 1 ? "" : "es"} helped fill the playlist after exact mood matches were limited.`);
  }
  if (missingTagCount > 0) {
    warnings.push("Some tracks are missing mood tags. Smart Mix used energy/BPM scoring for those tracks where possible.");
  }
  if (fallbackCount > 0) {
    warnings.push(`Smart Mix used ${fallbackCount} generic fallback track${fallbackCount === 1 ? "" : "s"} after relaxing mood matching.`);
  }
  if (conflictCount > 0) {
    warnings.push(`${conflictCount} track${conflictCount === 1 ? "" : "s"} had mood tags that may not fit the selected blend.`);
  }

  if (blend.moodBlendMode === "smooth_transition") {
    const weakMood = activeMoods.find((mood) => {
      const moodCoverage = coverage.preview[mood];
      const relatedCoverage = moodCoverage
        ? moodCoverage.exact + moodCoverage.alias + moodCoverage.adjacent + moodCoverage.related + moodCoverage.fallbackCompatible
        : coverage.library[mood] || 0;
      return relatedCoverage < Math.max(2, Math.ceil(config.limit / Math.max(1, activeMoods.length) * 0.4));
    });
    if (weakMood) warnings.push(`Mood transition may feel uneven because ${weakMood} has low library coverage.`);
  } else if (blend.moodBlendMode === "strict_matching") {
    const totalExactMatches = activeMoods.reduce((sum, mood) => {
      const moodCoverage = coverage.preview[mood];
      return sum + (moodCoverage ? moodCoverage.exact + moodCoverage.alias : coverage.library[mood] || 0);
    }, 0);
    if (totalExactMatches < config.limit) warnings.push("Not enough exact or alias mood matches are available for Strict Mood Matching.");
  }

  return warnings.filter((warning, index, list) => list.indexOf(warning) === index).slice(0, 6);
}

export function summarizeMoodBlend<TTrack extends Record<string, any>>({
  tracks,
  candidates,
  config,
}: {
  tracks: TTrack[];
  candidates: TTrack[];
  config: SmartMixEngineV2Config;
}) {
  const blend = normalizeMoodBlendConfig(config);
  const activeMoods = blend.moodBlendMode === "mixed_mood" ? blend.allowedMoods : blend.selectedMoodPath;
  const moodCoverage = buildMoodCoverage({ tracks, candidates, config });
  const moodWarnings = buildMoodWarnings({ tracks, candidates, config });

  return {
    moodBlendMode: blend.moodBlendMode,
    selectedMoodPath: blend.selectedMoodPath,
    allowedMoods: blend.allowedMoods,
    moodCurve: buildMoodCurve({ tracks, config }),
    moodCoverage,
    moodWarnings,
    moodFallbackCount: tracks.filter((track) => track.moodBlend?.isMoodFallback).length,
    moodConflictCount: tracks.filter((track) => track.moodBlend?.isMoodConflict).length,
    multiMoodBridgeTracks: tracks.filter((track) => track.moodBlend?.isMultiMoodBridge).map((track) => track.id || track.title).filter(Boolean),
    missingMoodCount: moodCoverage.missingMoodCount,
    activeMoods,
  };
}
