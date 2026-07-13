import { getTrackBpm, getTrackEnergy, getTrackMood, getTrackPopularity, getSmartMixMetadataStatus } from "../metadataFallbacks";
import type { PlaylistSection, PlaylistTrackState, RegenerationTrack, TrackMetrics } from "./types";

export function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function normalizedFeature(value: number | null) {
  if (value == null) return null;
  return value > 1 ? clamp(value) / 100 : clamp(value, 0, 1);
}

export function trackMetrics(track: RegenerationTrack): TrackMetrics {
  const status = getSmartMixMetadataStatus(track);
  const known = 4 - status.missingFields.length;
  const explicitConfidence = [
    track.bpmConfidence,
    track.audioFeature?.audioFeatureConfidence,
    track.audioFeature?.confidence,
    track.popularity?.confidence,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const measuredConfidence = explicitConfidence.length
    ? explicitConfidence.reduce((sum, value) => sum + (value > 1 ? value / 100 : value), 0) / explicitConfidence.length
    : known / 4;
  return {
    bpm: getTrackBpm(track),
    mood: normalizedFeature(getTrackMood(track)),
    energy: normalizedFeature(getTrackEnergy(track)),
    popularity: getTrackPopularity(track),
    durationMs: Math.max(0, Number(track.duration) || 0),
    metadataConfidence: Math.round(clamp(measuredConfidence, 0, 1) * 100),
    artist: String(track.artist?.id || track.artist?.title || track.artistId || "").trim() || null,
    album: String(track.album?.id || track.album?.title || track.albumId || "").trim() || null,
  };
}

export function sectionPositionRange(section: { type: PlaylistSection; start?: number; end?: number }, length: number) {
  if (length <= 0) return { start: 0, end: -1 };
  if (section.type === "custom_range") {
    return {
      start: Math.max(0, Math.min(length - 1, Number(section.start || 1) - 1)),
      end: Math.max(0, Math.min(length - 1, Number(section.end || length) - 1)),
    };
  }
  const boundaries: Record<Exclude<PlaylistSection, "custom_range">, [number, number]> = {
    intro: [0, 0.1],
    early: [0.1, 0.3],
    middle: [0.3, 0.7],
    late: [0.7, 0.9],
    ending: [0.9, 1],
  };
  const [from, to] = boundaries[section.type];
  const start = Math.min(length - 1, Math.floor(length * from));
  const end = Math.max(start, Math.min(length - 1, Math.ceil(length * to) - 1));
  return { start, end };
}

export function selectablePositions({
  tracks,
  states,
  section,
  targetTrackIds,
}: {
  tracks: RegenerationTrack[];
  states: PlaylistTrackState[];
  section?: { type: PlaylistSection; start?: number; end?: number };
  targetTrackIds?: string[];
}) {
  const targetIds = new Set(targetTrackIds || []);
  const range = section ? sectionPositionRange(section, tracks.length) : null;
  return tracks.map((track, index) => ({ track, index, state: states[index] })).filter(({ track, index }) => {
    if (targetIds.size > 0 && !targetIds.has(track.id)) return false;
    return !range || (index >= range.start && index <= range.end);
  });
}

export function positionalCurveScore(value: number | null, expected: number | null, scale: number) {
  if (value == null || expected == null) return 65;
  return Math.round(clamp(100 - Math.abs(value - expected) / scale * 100));
}

export function durationWithinTolerance(originalMs: number, proposedMs: number, tolerance: number) {
  if (originalMs <= 0 || proposedMs <= 0) return true;
  return Math.abs(proposedMs - originalMs) / originalMs <= tolerance;
}

