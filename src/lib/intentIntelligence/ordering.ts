import { getTrackBpm, getTrackEnergy } from "../smartMixEngine/v2/metadataFallbacks";

type Curve = { points: Array<{ position: number; value: number }>; tolerance: number; hard?: boolean } | null | undefined;
export type IntentOrderingConfig = { schemaVersion: 1; phases?: Array<{ id: string; label: string; targetShare: number }>; energyCurve?: Curve; bpmCurve?: Curve; smoothTransitions?: boolean };

export function sampleIntentCurve(curve: Curve, position: number) {
  if (!curve?.points.length) return null;
  const points = [...curve.points].sort((left, right) => left.position - right.position);
  if (position <= points[0].position) return points[0].value;
  if (position >= points[points.length - 1].position) return points[points.length - 1].value;
  for (let index = 1; index < points.length; index += 1) {
    if (position <= points[index].position) {
      const left = points[index - 1], right = points[index], progress = (position - left.position) / Math.max(.0001, right.position - left.position);
      return left.value + (right.value - left.value) * progress;
    }
  }
  return points[points.length - 1].value;
}

function key(track: any, type: "artist" | "album") { return String(type === "artist" ? track.artistId || track.artist?.id || track.artist?.title || "" : track.albumId || track.album?.id || track.album?.title || "").toLowerCase(); }

export function orderTracksByIntentCurves<TTrack extends Record<string, any>>(tracks: TTrack[], config?: IntentOrderingConfig | null) {
  if (!config || tracks.length < 2 || (!config.energyCurve && !config.bpmCurve)) return tracks;
  const remaining = [...tracks], selected: TTrack[] = [];
  while (remaining.length) {
    const position = tracks.length <= 1 ? 0 : selected.length / (tracks.length - 1);
    const targetEnergy = sampleIntentCurve(config.energyCurve, position), targetBpm = sampleIntentCurve(config.bpmCurve, position);
    const previous = selected[selected.length - 1];
    let bestIndex = 0, bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index], energy = getTrackEnergy(candidate), bpm = getTrackBpm(candidate);
      let score = Number(candidate.score || 0) * .02;
      if (targetEnergy != null) score += energy == null ? -1.5 : 12 - Math.abs(energy - targetEnergy) / Math.max(.03, Number(config.energyCurve?.tolerance || .12));
      if (targetBpm != null) score += bpm == null ? -1.5 : 12 - Math.abs(bpm - targetBpm) / Math.max(1, Number(config.bpmCurve?.tolerance || 10));
      if (previous && config.smoothTransitions) {
        const previousEnergy = getTrackEnergy(previous), previousBpm = getTrackBpm(previous);
        if (energy != null && previousEnergy != null) score -= Math.abs(energy - previousEnergy) * 7;
        if (bpm != null && previousBpm != null) score -= Math.min(8, Math.abs(bpm - previousBpm) / 8);
        if (key(previous, "artist") && key(previous, "artist") === key(candidate, "artist")) score -= 20;
      }
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    }
    selected.push(...remaining.splice(bestIndex, 1));
  }
  return selected;
}

export function explainAchievedIntentCurves(tracks: Array<Record<string, any>>, config?: IntentOrderingConfig | null) {
  const points = tracks.map((track, index) => ({ position: tracks.length <= 1 ? 0 : index / (tracks.length - 1), energy: getTrackEnergy(track), bpm: getTrackBpm(track) }));
  return {
    requested: { energy: config?.energyCurve || null, bpm: config?.bpmCurve || null }, achieved: points,
    unavailableMetadata: { energy: points.filter((point) => point.energy == null).length, bpm: points.filter((point) => point.bpm == null).length },
    phaseCoverage: config?.phases || [], relaxedPreferences: [], unresolvedGaps: [],
  };
}
