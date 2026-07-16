import { getTrackPopularity } from "../smartMixEngine/v2/metadataFallbacks";
import { PLAYBACK_SCORING_VERSION, type PlaybackProfileSnapshot, type PlaybackScoreReason, type PlaybackScoreResult, type PlaybackScoringContext } from "./types";

const DAY_MS = 86_400_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

export function playbackConfidenceLabel(value: number): PlaybackScoreResult["confidenceLabel"] {
  if (value < 0.2) return "Insufficient data";
  if (value < 0.45) return "Limited history";
  if (value < 0.75) return "Moderate signal";
  return "Strong signal";
}

function daysSince(value: Date | string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / DAY_MS) : null;
}

function emptyResult(baseScore: number, enabled: boolean, available: boolean, statusMessage: string): PlaybackScoreResult {
  return {
    enabled,
    available,
    baseScore,
    finalScore: baseScore,
    rawAdjustment: 0,
    appliedAdjustment: 0,
    maximumAdjustment: 0,
    confidence: 0,
    confidenceLabel: "Insufficient data",
    observationCount: 0,
    reasons: [],
    badges: [],
    excluded: false,
    exclusionReason: null,
    protectedFromStrictAvoidance: false,
    statusMessage,
    scoringVersion: PLAYBACK_SCORING_VERSION,
  };
}

export function scorePlaybackAwareTrack(
  baseScore: number,
  track: Record<string, any>,
  context?: PlaybackScoringContext,
): PlaybackScoreResult {
  if (!context?.settings.enabled) return emptyResult(baseScore, false, Boolean(context?.mapped), "Playback scoring disabled");
  if (!context.mapped) return emptyResult(baseScore, true, false, "Playback awareness unavailable until a Plex user is mapped");
  const profile = context.profiles[String(track.id)] as PlaybackProfileSnapshot | undefined;
  if (!profile) return emptyResult(baseScore, true, true, "Limited playback history for this track");

  const settings = context.settings;
  const confidence = clamp(profile.playbackConfidence, 0, 1);
  const confidenceScale = confidence < 0.2 ? 0.1 : confidence < 0.45 ? 0.35 : confidence < 0.75 ? 0.7 : 1;
  const observations = profile.totalPlayCount;
  const enoughEvidence = observations >= settings.minimumObservations;
  const recentDays = daysSince(profile.lastPlayedAt);
  const protectedTrack = context.protectedTrackIds.has(String(track.id));
  const reasons: PlaybackScoreReason[] = [];
  const badges: string[] = [];
  let rawAdjustment = 0;

  if (settings.recentlyPlayedBehavior !== "disabled" && settings.recentlyPlayedWindowDays && recentDays != null && recentDays < settings.recentlyPlayedWindowDays) {
    const closeness = 1 - recentDays / settings.recentlyPlayedWindowDays;
    const penalty = -(4 + 5 * closeness);
    rawAdjustment += penalty;
    reasons.push({ key: "recent", adjustment: penalty, message: `Played ${recentDays < 1 ? "today" : `${Math.max(1, Math.round(recentDays))} days ago`}` });
    badges.push("Played recently");
    if (settings.recentlyPlayedBehavior === "strict" && !protectedTrack) {
      return {
        ...emptyResult(baseScore, true, true, "Excluded by strict recently played avoidance"),
        maximumAdjustment: Math.min(settings.maximumAdjustment, 20 * settings.influence, 20 * context.maximumPersonalizationInfluence),
        confidence,
        confidenceLabel: playbackConfidenceLabel(confidence),
        observationCount: observations,
        reasons,
        badges,
        excluded: true,
        exclusionReason: "PLAYBACK_RECENT",
      };
    }
    if (settings.recentlyPlayedBehavior === "strict" && protectedTrack) {
      reasons.push({ key: "protection", adjustment: Math.abs(penalty), message: "Kept because the track is locked, important, or explicitly selected" });
      rawAdjustment -= penalty;
      badges.push("Protected track");
    }
  } else if (recentDays != null && recentDays >= 30) {
    badges.push(`Not played in ${recentDays >= 365 ? `${Math.floor(recentDays / 365)} year${recentDays >= 730 ? "s" : ""}` : `${Math.floor(recentDays / 30)} months`}`);
  }

  if (settings.useCompletionHistory && enoughEvidence && profile.completionRate >= 0.65) {
    const bonus = Math.min(3.5, 1 + Math.log1p(profile.completedPlayCount) * 0.75) * profile.completionRate;
    rawAdjustment += bonus;
    reasons.push({ key: "completion", adjustment: bonus, message: `Completed on ${Math.round(profile.completionRate * 100)}% of historical plays` });
    badges.push("Frequently completed");
  }

  if (settings.useReplayHistory && enoughEvidence && profile.replayCount >= 2) {
    const bonus = Math.min(2.75, Math.log1p(profile.replayCount) * 0.9);
    rawAdjustment += bonus;
    reasons.push({ key: "replay", adjustment: bonus, message: `${profile.replayCount} historical replays indicate affinity` });
    badges.push("Frequently replayed");
  }

  if (settings.useSkipHistory && enoughEvidence && profile.skipRate >= settings.skipThreshold) {
    const penalty = -Math.min(5, 1 + profile.skipRate * 5);
    rawAdjustment += penalty;
    reasons.push({ key: "skip", adjustment: penalty, message: `Skipped on ${Math.round(profile.skipRate * 100)}% of usable plays` });
    badges.push("Often skipped");
  }

  if (
    settings.forgottenFavoriteDays
    && enoughEvidence
    && recentDays != null
    && recentDays >= settings.forgottenFavoriteDays
    && profile.completionRate >= 0.65
    && profile.replayCount >= 2
  ) {
    const bonus = Math.min(7, 2 + Math.log1p(profile.totalPlayCount) + Math.min(2, recentDays / 365));
    rawAdjustment += bonus;
    reasons.push({ key: "forgotten", adjustment: bonus, message: `Forgotten favorite: not played in ${Math.round(recentDays / 30)} months` });
    badges.push("Forgotten favorite");
  }

  const popularity = getTrackPopularity(track);
  if (settings.playbackAwareDiscovery && enoughEvidence && popularity != null && popularity <= 40 && profile.completionRate >= 0.75) {
    const bonus = 1.5;
    rawAdjustment += bonus;
    reasons.push({ key: "discovery", adjustment: bonus, message: "Playback history supports this deeper-cut discovery" });
    badges.push("Playback discovery match");
  }

  const maximumAdjustment = Math.max(0, Math.min(
    settings.maximumAdjustment,
    20 * clamp(settings.influence, 0, 1),
    20 * clamp(context.maximumPersonalizationInfluence, 0, 1),
  ));
  const confidenceWeighted = rawAdjustment * confidenceScale;
  const appliedAdjustment = round(clamp(confidenceWeighted, -maximumAdjustment, maximumAdjustment));
  return {
    enabled: true,
    available: true,
    baseScore: round(baseScore),
    finalScore: round(baseScore + appliedAdjustment),
    rawAdjustment: round(rawAdjustment),
    appliedAdjustment,
    maximumAdjustment: round(maximumAdjustment),
    confidence: round(confidence),
    confidenceLabel: playbackConfidenceLabel(confidence),
    observationCount: observations,
    reasons: reasons.map((item) => ({ ...item, adjustment: round(item.adjustment * confidenceScale) })),
    badges: Array.from(new Set(badges)),
    excluded: false,
    exclusionReason: null,
    protectedFromStrictAvoidance: protectedTrack && settings.recentlyPlayedBehavior === "strict",
    statusMessage: Math.abs(appliedAdjustment) > 0
      ? "Playback awareness applied within the configured influence cap"
      : enoughEvidence ? "Playback history did not materially change this score" : "Limited playback history",
    scoringVersion: PLAYBACK_SCORING_VERSION,
  };
}
