import type { SmartMixFallbackResult, SmartMixMetadataField, SmartMixMetadataStatus } from "./types";

export const NEUTRAL_POPULARITY_SCORE = 50;

const metadataFields: SmartMixMetadataField[] = ["bpm", "mood", "energy", "popularity"];

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getTrackBpm(track: any): number | null {
  return finiteNumber(track.effectiveBpm)
    ?? finiteNumber(track.bpm)
    ?? finiteNumber(track.audioFeature?.tempo)
    ?? finiteNumber(track.tempo);
}

export function getTrackMood(track: any): number | null {
  return finiteNumber(track.audioFeature?.effectiveMood)
    ?? finiteNumber(track.audioFeature?.valence)
    ?? finiteNumber(track.mood)
    ?? finiteNumber(track.valence);
}

export function getTrackEnergy(track: any): number | null {
  return finiteNumber(track.audioFeature?.effectiveEnergy)
    ?? finiteNumber(track.audioFeature?.energy)
    ?? finiteNumber(track.energy);
}

export function getTrackPopularity(track: any): number | null {
  return finiteNumber(track.popularity?.score)
    ?? finiteNumber(track.popularity);
}

export function getSmartMixMetadataStatus(track: any): SmartMixMetadataStatus {
  const status = {
    hasBpm: getTrackBpm(track) !== null,
    hasMood: getTrackMood(track) !== null,
    hasEnergy: getTrackEnergy(track) !== null,
    hasPopularity: getTrackPopularity(track) !== null,
    missingFields: [] as SmartMixMetadataField[],
  };

  for (const field of metadataFields) {
    const key = `has${field.charAt(0).toUpperCase()}${field.slice(1)}` as keyof Omit<SmartMixMetadataStatus, "missingFields">;
    if (!status[key]) status.missingFields.push(field);
  }

  return status;
}

export function getSmartMixMetadataFallbacks(track: any): SmartMixFallbackResult {
  const metadataStatus = getSmartMixMetadataStatus(track);
  const fallbacksApplied = metadataStatus.missingFields.map((field) => {
    if (field === "popularity") return "popularity: used neutral popularity score";
    return `${field}: skipped ${field.toUpperCase()} match bonus`;
  });

  return {
    metadataStatus,
    fallbackValues: {
      bpm: getTrackBpm(track),
      mood: getTrackMood(track),
      energy: getTrackEnergy(track),
      popularity: getTrackPopularity(track) ?? NEUTRAL_POPULARITY_SCORE,
    },
    fallbacksApplied,
  };
}
