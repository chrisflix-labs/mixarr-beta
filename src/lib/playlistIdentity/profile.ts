import type { PlaylistIdentityProfile, WeightedIdentityTrack } from "./types";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value: number, precision = 3) => Number(value.toFixed(precision));

function weightedValues(tracks: WeightedIdentityTrack[], getter: (track: WeightedIdentityTrack) => number | null | undefined) {
  return tracks.flatMap((track) => {
    const value = getter(track);
    return typeof value === "number" && Number.isFinite(value) ? [{ value, weight: Math.max(0.05, track.weight || 1) }] : [];
  });
}

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const total = values.reduce((sum, item) => sum + item.weight, 0);
  return total ? values.reduce((sum, item) => sum + item.value * item.weight, 0) / total : null;
}

function percentile(values: number[], percent: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * percent)))];
}

function range(values: number[], low = 0.12, high = 0.88): [number, number] | null {
  const min = percentile(values, low);
  const max = percentile(values, high);
  return min == null || max == null ? null : [round(min, 2), round(max, 2)];
}

function sectionAverages(tracks: WeightedIdentityTrack[], getter: (track: WeightedIdentityTrack) => number | null | undefined) {
  const ordered = [...tracks].sort((left, right) => (left.position || 0) - (right.position || 0));
  return [0, 1, 2].map((section) => {
    const start = Math.floor(ordered.length * section / 3);
    const end = Math.floor(ordered.length * (section + 1) / 3);
    return weightedAverage(weightedValues(ordered.slice(start, Math.max(start + 1, end)), getter));
  }).map((value) => value == null ? null : round(value, 2));
}

function energyCurve(sections: Array<number | null>): PlaylistIdentityProfile["energyCurve"] {
  const known = sections.filter((value): value is number => value != null);
  if (known.length < 2) return { type: "mixed", sections };
  const delta = known[known.length - 1] - known[0];
  const peak = Math.max(...known);
  const trough = Math.min(...known);
  const type = Math.abs(delta) < 0.08 && peak - trough < 0.12 ? "stable"
    : delta >= 0.12 ? "rising"
    : delta <= -0.12 ? "falling"
    : known.length === 3 && known[1] > known[0] + 0.08 && known[1] > known[2] + 0.08 ? "wave"
    : "mixed";
  return { type, sections };
}

function distribution(tracks: WeightedIdentityTrack[], getter: (track: WeightedIdentityTrack) => string[]) {
  const counts = new Map<string, number>();
  let total = 0;
  for (const track of tracks) {
    const values = Array.from(new Set(getter(track).map((value) => value.trim()).filter(Boolean)));
    const perValue = (track.weight || 1) / Math.max(1, values.length);
    for (const value of values) counts.set(value, (counts.get(value) || 0) + perValue);
    total += values.length ? track.weight || 1 : 0;
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([key, value]) => [key, round(total ? value / total : 0)])) as Record<string, number>;
}

function preferenceState(ratio: number, avoidThreshold = 0.12) {
  if (ratio <= avoidThreshold) return "avoid" as const;
  if (ratio >= 0.35) return "prefer" as const;
  return "neutral" as const;
}

export function calculatePlaylistIdentityProfile(tracks: WeightedIdentityTrack[]): PlaylistIdentityProfile {
  const effectiveTracks = tracks.filter((track) => (track.weight || 1) > 0);
  const bpm = weightedValues(effectiveTracks, (track) => track.bpm);
  const energy = weightedValues(effectiveTracks, (track) => track.energy);
  const popularity = weightedValues(effectiveTracks, (track) => track.popularity);
  const duration = weightedValues(effectiveTracks, (track) => track.durationMs);
  const years = weightedValues(effectiveTracks, (track) => track.year);
  const confidence = weightedValues(effectiveTracks, (track) => track.metadataConfidence);
  const moodDistribution = distribution(effectiveTracks, (track) => track.moods || []);
  const genreDistribution = distribution(effectiveTracks, (track) => track.genres || []);
  const artistCounts = new Map<string, { name: string; score: number }>();
  for (const track of effectiveTracks) {
    if (!track.artistId) continue;
    const current = artistCounts.get(track.artistId) || { name: track.artistName || "Unknown artist", score: 0 };
    current.score += Math.sqrt(Math.max(0.1, track.weight || 1));
    artistCounts.set(track.artistId, current);
  }
  const totalArtistScore = Array.from(artistCounts.values()).reduce((sum, item) => sum + item.score, 0) || 1;
  const bpmNumbers = bpm.map((item) => item.value);
  const energyNumbers = energy.map((item) => item.value);
  const popularityNumbers = popularity.map((item) => item.value);
  const durationNumbers = duration.map((item) => item.value);
  const yearNumbers = years.map((item) => item.value);
  const bpmSections = sectionAverages(effectiveTracks, (track) => track.bpm);
  const energySections = sectionAverages(effectiveTracks, (track) => track.energy);
  const transitionGaps = [...effectiveTracks]
    .sort((left, right) => (left.position || 0) - (right.position || 0))
    .flatMap((track, index, ordered) => index && track.bpm != null && ordered[index - 1].bpm != null ? [Math.abs(track.bpm - ordered[index - 1].bpm!)] : []);
  const liveRatio = effectiveTracks.length ? effectiveTracks.filter((track) => track.isLive).length / effectiveTracks.length : 0.2;
  const explicitRatio = effectiveTracks.length ? effectiveTracks.filter((track) => track.isExplicit).length / effectiveTracks.length : 0.2;
  const averagePopularity = weightedAverage(popularity);
  return {
    coreMoods: (Object.entries(moodDistribution) as Array<[string, number]>).filter(([, score]) => score >= 0.15).slice(0, 4).map(([name]) => name),
    secondaryMoods: (Object.entries(moodDistribution) as Array<[string, number]>).filter(([, score]) => score < 0.15).slice(0, 6).map(([name]) => name),
    moodDistribution,
    averageEnergy: weightedAverage(energy) == null ? null : round(weightedAverage(energy)!),
    energyRange: range(energyNumbers),
    energyCurve: energyCurve(energySections),
    averageBpm: weightedAverage(bpm) == null ? null : round(weightedAverage(bpm)!, 1),
    medianBpm: percentile(bpmNumbers, 0.5),
    bpmRange: range(bpmNumbers),
    bpmClusters: Array.from(new Set(bpmNumbers.map((value) => Math.round(value / 5) * 5))).slice(0, 8),
    bpmCurve: { sections: bpmSections },
    maximumTransitionGap: percentile(transitionGaps, 0.85),
    preferredArtists: Array.from(artistCounts.entries()).map(([artistId, item]) => ({ artistId, name: item.name, score: round(item.score / totalArtistScore) })).sort((a, b) => b.score - a.score).slice(0, 12),
    preferredGenres: (Object.entries(genreDistribution) as Array<[string, number]>).map(([name, score]) => ({ name, score })).slice(0, 12),
    releaseYearRange: range(yearNumbers, 0.08, 0.92),
    discoveryPreference: averagePopularity == null ? null : round(clamp((100 - averagePopularity) / 100)),
    familiarityPreference: averagePopularity == null ? null : round(clamp(averagePopularity / 100)),
    popularityRange: range(popularityNumbers, 0.1, 0.9),
    deepCutPreference: averagePopularity == null ? null : round(clamp((65 - averagePopularity) / 65)),
    durationRange: range(durationNumbers, 0.08, 0.92),
    explicitPreference: explicitRatio >= 0.35 ? "allow" : explicitRatio <= 0.12 ? "avoid" : "neutral",
    livePreference: preferenceState(liveRatio),
    metadataConfidencePreference: weightedAverage(confidence) == null ? null : round(weightedAverage(confidence)!),
    sampleCount: effectiveTracks.length,
    metadataCoverage: {
      mood: round(effectiveTracks.length ? effectiveTracks.filter((track) => track.moods?.length).length / effectiveTracks.length : 0),
      energy: round(effectiveTracks.length ? energy.length / effectiveTracks.length : 0),
      bpm: round(effectiveTracks.length ? bpm.length / effectiveTracks.length : 0),
      popularity: round(effectiveTracks.length ? popularity.length / effectiveTracks.length : 0),
      genre: round(effectiveTracks.length ? effectiveTracks.filter((track) => track.genres?.length).length / effectiveTracks.length : 0),
    },
  };
}

export function confidenceForIdentity(profile: PlaylistIdentityProfile, input: { versions: number; explicitSignals: number; contradictions?: number }) {
  const sample = Math.min(1, profile.sampleCount / 80);
  const coverage = Object.values(profile.metadataCoverage).reduce((sum, value) => sum + value, 0) / 5;
  const history = Math.min(1, input.versions / 8);
  const explicit = Math.min(1, input.explicitSignals / 12);
  const contradictionPenalty = Math.min(0.3, (input.contradictions || 0) * 0.03);
  const overall = clamp(sample * 0.4 + coverage * 0.3 + history * 0.2 + explicit * 0.1 - contradictionPenalty);
  const label = overall < 0.18 ? "INSUFFICIENT_DATA" : overall < 0.4 ? "LOW" : overall < 0.65 ? "MEDIUM" : overall < 0.85 ? "HIGH" : "VERY_HIGH";
  return {
    overall: round(overall),
    label,
    mood: round(clamp(sample * 0.45 + profile.metadataCoverage.mood * 0.55)),
    energy: round(clamp(sample * 0.45 + profile.metadataCoverage.energy * 0.55)),
    bpm: round(clamp(sample * 0.45 + profile.metadataCoverage.bpm * 0.55)),
    artist: round(clamp(sample * 0.65 + history * 0.35)),
    genre: round(clamp(sample * 0.45 + profile.metadataCoverage.genre * 0.55)),
    discovery: round(clamp(sample * 0.45 + profile.metadataCoverage.popularity * 0.55)),
    avoidance: round(clamp(explicit * 0.7 + history * 0.3)),
    transition: round(clamp(sample * 0.35 + profile.metadataCoverage.bpm * 0.4 + history * 0.25)),
    reasons: [
      ...(profile.sampleCount < 10 ? [`Only ${profile.sampleCount} usable tracks are available.`] : []),
      ...(profile.metadataCoverage.bpm < 0.45 ? [`Only ${Math.round(profile.metadataCoverage.bpm * 100)}% of tracks have trusted BPM metadata.`] : []),
      ...(profile.metadataCoverage.mood < 0.45 ? [`Only ${Math.round(profile.metadataCoverage.mood * 100)}% of tracks have mood metadata.`] : []),
      ...(input.versions < 2 ? ["No consistent multi-version history is available yet."] : []),
    ],
  };
}

export function mergeIdentityProfiles(learned: PlaylistIdentityProfile, user: Partial<PlaylistIdentityProfile>, lockedKeys: Set<string>) {
  const effective = { ...learned } as PlaylistIdentityProfile;
  for (const [key, value] of Object.entries(user)) {
    if (value !== undefined && value !== null || lockedKeys.has(key)) (effective as any)[key] = value;
  }
  return effective;
}
