import { resolveEffectiveTrackMetadata } from "../metadataCorrections";

export type NewMusicScoreBreakdown = {
  metadataCompleteness: number;
  moodConfidence: number;
  bpmConfidence: number;
  energyConfidence: number;
  playlistCompatibility: number;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function confidence(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric <= 1 ? numeric * 100 : numeric) : fallback;
}

export function scoreNewMusic(track: any, compatibilityScore = 50) {
  const effective = resolveEffectiveTrackMetadata(track);
  const core = [effective.bpm.value, effective.moodScore.value, effective.energy.value];
  const verifiedFields = new Set((track.metadataVerifications || []).filter((item: any) => item.verified !== false).map((item: any) => item.field));
  const correctedFields = new Set((track.metadataCorrections || []).filter((item: any) => item.isActive !== false && item.isVerified !== false).map((item: any) => item.field));
  const fieldConfidence = (field: "bpm" | "mood" | "energy", raw: unknown, present: boolean) => {
    if (verifiedFields.has(field) || correctedFields.has(field)) return 100;
    return present ? confidence(raw, 72) : 0;
  };
  const completenessCount = core.filter((value) => value !== null && value !== undefined).length;
  const breakdown: NewMusicScoreBreakdown = {
    metadataCompleteness: Math.round((completenessCount / 3) * 20),
    moodConfidence: Math.round(fieldConfidence("mood", track.audioFeature?.audioFeatureConfidence ?? track.audioFeature?.confidence, effective.moodScore.value != null) * 0.2),
    bpmConfidence: Math.round(fieldConfidence("bpm", track.bpmConfidence ?? track.audioFeature?.tempoConfidence, effective.bpm.value != null) * 0.2),
    energyConfidence: Math.round(fieldConfidence("energy", track.audioFeature?.audioFeatureConfidence ?? track.audioFeature?.confidence, effective.energy.value != null) * 0.2),
    playlistCompatibility: Math.round(clamp(compatibilityScore) * 0.2),
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const confidenceScore = Math.round((fieldConfidence("mood", track.audioFeature?.audioFeatureConfidence ?? track.audioFeature?.confidence, effective.moodScore.value != null)
    + fieldConfidence("bpm", track.bpmConfidence ?? track.audioFeature?.tempoConfidence, effective.bpm.value != null)
    + fieldConfidence("energy", track.audioFeature?.audioFeatureConfidence ?? track.audioFeature?.confidence, effective.energy.value != null)) / 3);
  const band = score >= 90 ? "excellent" : score >= 75 ? "strong" : score >= 60 ? "usable" : score >= 40 ? "low_confidence" : "not_ready";
  return { score, confidenceScore, band, breakdown, coreFieldsAvailable: completenessCount };
}

export function quarantineDecision({ track, settings, now = new Date() }: { track: any; settings: any; now?: Date }) {
  if (!settings.quarantineUntilAnalyzed) return { quarantined: false, reason: null };
  if (track.recentlyAddedState?.manualOverride) return { quarantined: false, reason: "manual_override" };
  const scored = scoreNewMusic(track);
  const ageHours = Math.max(0, (now.getTime() - new Date(track.firstSeenAt || track.createdAt || now).getTime()) / 3_600_000);
  const timeoutReleased = settings.quarantineTimeoutHours && ageHours >= settings.quarantineTimeoutHours;
  if (timeoutReleased) return { quarantined: false, reason: "timeout_low_confidence" };
  const ready = settings.quarantineRule === "manual" ? false
    : settings.quarantineRule === "two_core" ? scored.coreFieldsAvailable >= 2
    : settings.quarantineRule === "confidence" ? scored.confidenceScore >= settings.metadataConfidenceThreshold
    : scored.coreFieldsAvailable === 3;
  return { quarantined: !ready, reason: ready ? null : settings.quarantineRule };
}

