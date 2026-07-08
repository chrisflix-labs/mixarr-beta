import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  getAudioFeatureHealthStatus,
  getEffectiveAudioFeatures,
  type EffectiveAudioFeatureSettings,
} from "./audioFeatures";

export const moodEnergyHealthFilters = [
  "missing_mood",
  "missing_energy",
  "missing_mood_energy",
  "partial_mood_energy",
  "complete_mood_energy",
  "pending_mood_energy",
  "mood_energy_failed",
] as const;

export type MoodEnergyHealthFilter = typeof moodEnergyHealthFilters[number];
export type MoodEnergyConfidence = "High" | "Medium" | "Low" | "Unknown";

export type MoodEnergyHealthStatus = {
  status: "complete" | "partial" | "missing" | "pending" | "failed";
  complete: boolean;
  hasEnergy: boolean;
  hasMood: boolean;
  missingFields: Array<"energy" | "mood">;
  reason: string;
};

export type MoodEnergyDisplayField = {
  value: number | null;
  source: string;
  sourceKey: string;
  confidence: MoodEnergyConfidence;
  confidenceValue: number | null;
};

export type MoodEnergyDisplayMetadata = {
  energy: MoodEnergyDisplayField;
  mood: MoodEnergyDisplayField;
  status: MoodEnergyHealthStatus["status"];
  reason: string;
  missingFields: Array<"energy" | "mood">;
};

const moodEnergyTrackSelect = {
  id: true,
  syncStatus: true,
  bpm: true,
  apiBpm: true,
  localBpm: true,
  effectiveBpm: true,
  bpmSource: true,
  mediaPath: true,
  audioFeature: {
    select: {
      energy: true,
      valence: true,
      danceability: true,
      acousticness: true,
      apiEnergy: true,
      apiMood: true,
      apiDanceability: true,
      apiAcousticness: true,
      localEnergy: true,
      localMood: true,
      localDanceability: true,
      localAcousticness: true,
      effectiveEnergy: true,
      effectiveMood: true,
      effectiveDanceability: true,
      effectiveAcousticness: true,
      tempo: true,
      source: true,
      confidence: true,
      audioFeatureSource: true,
      audioFeatureStatus: true,
      audioFeatureConfidence: true,
      audioFeatureFailureReason: true,
      audioFeatureAnalyzedAt: true,
      audioFeatureAnalysisScope: true,
      energySource: true,
      valenceSource: true,
      danceabilitySource: true,
      acousticnessSource: true,
    },
  },
} satisfies Prisma.TrackSelect;

function validUnitValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function normalizeSource(source: unknown) {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("essentia") || normalized === "local_essentia") return "local_essentia";
  if (normalized === "local_heuristic" || normalized.includes("heuristic") || normalized.includes("estimated")) return "estimated";
  if (normalized.includes("manual")) return "manual";
  if (normalized.includes("import") || normalized.includes("plex")) return "imported";
  if (normalized === "api" || normalized.includes("spotify") || normalized.includes("deezer") || normalized.includes("lastfm")) return "api";
  if (normalized === "mixed") return "mixed";
  if (["not_found", "local_not_found", "unknown", "none", "n/a", "na"].includes(normalized)) return "unknown";
  return normalized;
}

export function normalizeAudioFeatureSource(source: unknown) {
  return normalizeSource(source);
}

export function getMoodEnergySourceLabel(source: unknown) {
  const normalized = normalizeSource(source);
  if (normalized === "local_essentia" || normalized === "mixed") return "Local Essentia";
  if (normalized === "api") return "API";
  if (normalized === "imported") return "Imported";
  if (normalized === "estimated") return "Estimated";
  if (normalized === "manual") return "Manual";
  return "Unknown";
}

function confidenceLabel(value: unknown, sourceKey: string, hasValue: boolean, analysisStatus?: string | null): MoodEnergyConfidence {
  if (!hasValue) return "Unknown";
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.8) return "High";
    if (numeric >= 0.5) return "Medium";
    return "Low";
  }
  if (sourceKey === "local_essentia" && analysisStatus === "success") return "High";
  if (sourceKey === "api" || sourceKey === "imported" || sourceKey === "mixed") return "Medium";
  if (sourceKey === "estimated" || sourceKey === "local_heuristic") return "Low";
  return "Unknown";
}

function sourceForField(feature: any, field: "energy" | "mood", value: number | null) {
  if (value === null) return "unknown";
  const fieldSource = field === "energy" ? feature?.energySource : feature?.valenceSource;
  if (fieldSource) return normalizeSource(fieldSource);
  if (field === "energy") {
    if (validUnitValue(feature?.localEnergy) === value) return "local_essentia";
    if (validUnitValue(feature?.apiEnergy) === value) return "api";
  } else {
    if (validUnitValue(feature?.localMood) === value) return "local_essentia";
    if (validUnitValue(feature?.apiMood) === value) return "api";
  }
  return normalizeSource(feature?.audioFeatureSource || feature?.source);
}

function displayField(feature: any, field: "energy" | "mood", value: number | null): MoodEnergyDisplayField {
  const sourceKey = sourceForField(feature, field, value);
  const confidenceValue = Number.isFinite(Number(feature?.audioFeatureConfidence ?? feature?.confidence))
    ? Number(feature?.audioFeatureConfidence ?? feature?.confidence)
    : null;
  return {
    value,
    source: getMoodEnergySourceLabel(sourceKey),
    sourceKey,
    confidence: confidenceLabel(confidenceValue, sourceKey, value !== null, feature?.audioFeatureStatus),
    confidenceValue,
  };
}

export function classifyMoodEnergyHealth(trackOrFeature: any, settings: EffectiveAudioFeatureSettings = {}): MoodEnergyHealthStatus {
  const effective = getEffectiveAudioFeatures(trackOrFeature, settings);
  const feature = trackOrFeature && typeof trackOrFeature === "object" && "audioFeature" in trackOrFeature
    ? trackOrFeature.audioFeature
    : trackOrFeature;
  const hasEnergy = effective.energy !== null;
  const hasMood = effective.mood !== null;
  const missingFields = [
    hasEnergy ? null : "energy",
    hasMood ? null : "mood",
  ].filter((field): field is "energy" | "mood" => field !== null);
  const audio = getAudioFeatureHealthStatus(trackOrFeature, settings);

  if (hasEnergy && hasMood) {
    return {
      status: "complete",
      complete: true,
      hasEnergy,
      hasMood,
      missingFields,
      reason: "Mood and energy values are complete for the current provider mode.",
    };
  }
  if (audio.status === "failed") {
    return {
      status: "failed",
      complete: false,
      hasEnergy,
      hasMood,
      missingFields,
      reason: feature?.audioFeatureFailureReason || "Local audio feature analysis failed before mood and energy were completed.",
    };
  }
  if (audio.status === "pending" || feature?.audioFeatureStatus === "pending") {
    return {
      status: "pending",
      complete: false,
      hasEnergy,
      hasMood,
      missingFields,
      reason: `Pending local audio feature analysis for ${missingFields.join(" and ") || "mood/energy"}.`,
    };
  }
  if (hasEnergy || hasMood || audio.status === "partial") {
    return {
      status: "partial",
      complete: false,
      hasEnergy,
      hasMood,
      missingFields,
      reason: missingFields.length
        ? `Partial mood/energy data. Missing ${missingFields.join(" and ")}.`
        : "Partial mood/energy data for the current provider mode.",
    };
  }
  return {
    status: "missing",
    complete: false,
    hasEnergy,
    hasMood,
    missingFields,
    reason: "Missing local audio feature values for mood and energy.",
  };
}

export const getMoodEnergyHealthStatus = classifyMoodEnergyHealth;

export function getMoodEnergyDisplayMetadata(trackOrFeature: any, settings: EffectiveAudioFeatureSettings = {}): MoodEnergyDisplayMetadata {
  const feature = trackOrFeature && typeof trackOrFeature === "object" && "audioFeature" in trackOrFeature
    ? trackOrFeature.audioFeature
    : trackOrFeature;
  const effective = getEffectiveAudioFeatures(trackOrFeature, settings);
  const health = classifyMoodEnergyHealth(trackOrFeature, settings);
  return {
    energy: displayField(feature, "energy", effective.energy),
    mood: displayField(feature, "mood", effective.mood),
    status: health.status,
    reason: health.reason,
    missingFields: health.missingFields,
  };
}

export function classifyMoodEnergyTracks(tracks: any[], settings: EffectiveAudioFeatureSettings = {}) {
  const matchingTrackIds: Record<MoodEnergyHealthFilter, string[]> = {
    missing_mood: [],
    missing_energy: [],
    missing_mood_energy: [],
    partial_mood_energy: [],
    complete_mood_energy: [],
    pending_mood_energy: [],
    mood_energy_failed: [],
  };

  for (const track of tracks) {
    if (track?.syncStatus && track.syncStatus !== "active") continue;
    const id = String(track?.id || "");
    if (!id) continue;
    const health = classifyMoodEnergyHealth(track, settings);
    if (!health.hasMood) matchingTrackIds.missing_mood.push(id);
    if (!health.hasEnergy) matchingTrackIds.missing_energy.push(id);
    if (!health.hasMood && !health.hasEnergy) matchingTrackIds.missing_mood_energy.push(id);
    if (health.status === "partial") matchingTrackIds.partial_mood_energy.push(id);
    if (health.status === "complete") matchingTrackIds.complete_mood_energy.push(id);
    if (health.status === "pending") matchingTrackIds.pending_mood_energy.push(id);
    if (health.status === "failed") matchingTrackIds.mood_energy_failed.push(id);
  }

  return {
    matchingTrackIds,
    counts: Object.fromEntries(
      moodEnergyHealthFilters.map((filter) => [filter, matchingTrackIds[filter].length]),
    ) as Record<MoodEnergyHealthFilter, number>,
  };
}

export async function resolveMoodEnergyTrackIds(userId: string, options: {
  filter: MoodEnergyHealthFilter;
  libraryId?: string;
  settings?: EffectiveAudioFeatureSettings;
}) {
  const tracks = await prisma.track.findMany({
    where: {
      syncStatus: "active",
      library: { ...(options.libraryId ? { id: options.libraryId } : {}), server: { userId } },
    },
    select: moodEnergyTrackSelect,
  });
  const classified = classifyMoodEnergyTracks(tracks, options.settings);
  return classified.matchingTrackIds[options.filter] || [];
}

export async function buildMoodEnergyHealthSummary(userId: string, options: {
  libraryId?: string;
  settings?: EffectiveAudioFeatureSettings;
} = {}) {
  const tracks = await prisma.track.findMany({
    where: {
      syncStatus: "active",
      library: { ...(options.libraryId ? { id: options.libraryId } : {}), server: { userId } },
    },
    select: moodEnergyTrackSelect,
  });
  const classified = classifyMoodEnergyTracks(tracks, options.settings);
  const activeTracks = tracks.length;
  const sourceCounts = {
    local: 0,
    apiImported: 0,
    estimated: 0,
    unknown: 0,
  };
  for (const track of tracks) {
    const metadata = getMoodEnergyDisplayMetadata(track, options.settings);
    for (const field of [metadata.energy, metadata.mood]) {
      if (field.value === null) continue;
      if (field.sourceKey === "local_essentia" || field.sourceKey === "mixed") sourceCounts.local += 1;
      else if (field.sourceKey === "api" || field.sourceKey === "imported") sourceCounts.apiImported += 1;
      else if (field.sourceKey === "estimated" || field.sourceKey === "local_heuristic") sourceCounts.estimated += 1;
      else sourceCounts.unknown += 1;
    }
  }

  return {
    activeTracks,
    tracksWithEnergy: activeTracks - classified.counts.missing_energy,
    tracksMissingEnergy: classified.counts.missing_energy,
    tracksWithMood: activeTracks - classified.counts.missing_mood,
    tracksMissingMood: classified.counts.missing_mood,
    tracksMissingBoth: classified.counts.missing_mood_energy,
    partial: classified.counts.partial_mood_energy,
    complete: classified.counts.complete_mood_energy,
    pending: classified.counts.pending_mood_energy,
    failed: classified.counts.mood_energy_failed,
    localMoodEnergyCount: sourceCounts.local,
    apiImportedMoodEnergyCount: sourceCounts.apiImported,
    estimatedMoodEnergyCount: sourceCounts.estimated,
    unknownMoodEnergyCount: sourceCounts.unknown,
  };
}
