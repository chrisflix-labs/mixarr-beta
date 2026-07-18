import type { SmartRefreshBlocker, SmartRefreshDecision, SmartRefreshGuards, SmartRefreshRecommendation, SmartRefreshReason, SmartRefreshSignals, SmartRefreshThresholds } from "./types";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10) / 10;

export const SENSITIVITY_DEFAULTS = {
  LOW: { minimumEstimatedImprovement: 8, minimumCompatibleTracks: 10, weakTrackThreshold: 65, identityDriftThreshold: 30, repetitionThreshold: 75, metadataImprovementThreshold: 5 },
  BALANCED: { minimumEstimatedImprovement: 5, minimumCompatibleTracks: 5, weakTrackThreshold: 50, identityDriftThreshold: 20, repetitionThreshold: 60, metadataImprovementThreshold: 2 },
  HIGH: { minimumEstimatedImprovement: 2, minimumCompatibleTracks: 3, weakTrackThreshold: 35, identityDriftThreshold: 12, repetitionThreshold: 45, metadataImprovementThreshold: 1 },
} satisfies Record<string, SmartRefreshThresholds>;

function reason(code: string, label: string, detail: string, impact: SmartRefreshReason["impact"] = "positive"): SmartRefreshReason {
  return { code, label, detail, impact };
}

function selectRecommendation(signals: SmartRefreshSignals, thresholds: SmartRefreshThresholds) {
  const severeIdentityDrift = (signals.identityDriftScore ?? 0) >= Math.min(100, thresholds.identityDriftThreshold + 30);
  const manyUnavailable = signals.unavailableTrackCount >= Math.max(3, Math.ceil((signals.weakTrackCount + signals.lockedTrackCount) * .25));
  if (severeIdentityDrift || manyUnavailable || signals.fallbackOverdue) return "FULL_REGENERATION";
  if (signals.improvedMetadataTrackCount >= thresholds.metadataImprovementThreshold) return "REFRESH_METADATA_AFFECTED_TRACKS";
  if (signals.weakTrackCount > 0 || (signals.currentScore != null && signals.currentScore < 65)) return "REFRESH_WEAK_TRACKS";
  if (signals.compatibleNewTrackCount >= thresholds.minimumCompatibleTracks) return "ADD_COMPATIBLE_TRACKS";
  if ((signals.repetitivePlaybackScore ?? 0) >= thresholds.repetitionThreshold && signals.playbackObservationCount >= 10) return "REBALANCE_PLAYLIST";
  if ((signals.identityDriftScore ?? 0) >= thresholds.identityDriftThreshold) return "REFRESH_WEAK_TRACKS";
  return "NO_ACTION";
}

function guardBlockers(guards: SmartRefreshGuards, recommendation: SmartRefreshRecommendation): SmartRefreshBlocker[] {
  const blockers: SmartRefreshBlocker[] = [];
  if (guards.cooldownUntil && guards.cooldownUntil > new Date()) blockers.push({ code: "COOLDOWN", message: "The minimum time between playlist-changing refreshes has not elapsed.", eligibleAt: guards.cooldownUntil.toISOString() });
  if (guards.weeklyLimitReached) blockers.push({ code: "WEEKLY_LIMIT", message: "This playlist has reached its successful refresh limit for the last seven days." });
  if (guards.quietHours) blockers.push({ code: "QUIET_HOURS", message: "Playlist changes are deferred during quiet hours.", eligibleAt: guards.quietHoursEnd?.toISOString() || null });
  if (guards.activeGenerationJob) blockers.push({ code: "ACTIVE_JOB", message: "Another generation or refresh job is active for this playlist." });
  if (guards.playlistLocked) blockers.push({ code: "PLAYLIST_LOCKED", message: "Playlist automation is paused, protected, or locked." });
  if (guards.libraryUnavailable) blockers.push({ code: "LIBRARY_UNAVAILABLE", message: "The Plex library or playlist is unavailable." });
  if (guards.analysisInProgress) blockers.push({ code: "ANALYSIS_IN_PROGRESS", message: "Required library or audio analysis is still running." });
  if (guards.unsavedManualEdits) blockers.push({ code: "MANUAL_EDITS", message: "The playlist changed after the evaluation source was captured." });
  if (guards.stale) blockers.push({ code: "STALE_EVALUATION", message: "The evaluation is stale and must be run again." });
  if (recommendation === "FULL_REGENERATION" && !guards.automaticFullRegenerationAllowed) blockers.push({ code: "FULL_REGENERATION_REQUIRES_APPROVAL", message: "Automatic full regeneration is disabled; preview and approval are required." });
  return blockers;
}

export function evaluateSmartRefresh(input: {
  playlistId: string;
  evaluatedAt?: Date;
  signals: SmartRefreshSignals;
  thresholds: SmartRefreshThresholds;
  guards?: SmartRefreshGuards;
}): SmartRefreshDecision {
  const evaluatedAt = input.evaluatedAt || new Date();
  const { signals, thresholds } = input;
  const recommendation = selectRecommendation(signals, thresholds);
  const estimatedImprovement = signals.currentScore != null && signals.estimatedScoreAfterRefresh != null
    ? round(signals.estimatedScoreAfterRefresh - signals.currentScore)
    : null;
  const reasons: SmartRefreshReason[] = [];
  if (signals.weakTrackCount) reasons.push(reason("WEAK_TRACKS", `${signals.weakTrackCount} weak track${signals.weakTrackCount === 1 ? "" : "s"}`, "Existing Smart Mix scoring found tracks with replaceable quality or flow weaknesses."));
  if (signals.compatibleNewTrackCount) reasons.push(reason("COMPATIBLE_TRACKS", `${signals.compatibleNewTrackCount} compatible new track${signals.compatibleNewTrackCount === 1 ? "" : "s"}`, "Recently added analysis found candidates that match this playlist."));
  if (signals.repetitivePlaybackScore != null) reasons.push(reason("PLAYBACK_REPETITION", `Playback repetition ${Math.round(signals.repetitivePlaybackScore)}%`, signals.playbackObservationCount < 10 ? "Playback evidence is still too limited for an aggressive decision." : "Recent play concentration, repeats, and skips indicate listener fatigue.", signals.playbackObservationCount < 10 ? "neutral" : "positive"));
  if (signals.identityDriftScore != null) reasons.push(reason("IDENTITY_DRIFT", `Identity drift ${Math.round(signals.identityDriftScore)}%`, "Current mood, energy, BPM, artists, and saved identity characteristics were compared.", signals.identityDriftScore >= thresholds.identityDriftThreshold ? "positive" : "neutral"));
  if (signals.improvedMetadataTrackCount) reasons.push(reason("METADATA_IMPROVED", `${signals.improvedMetadataTrackCount} relevant metadata update${signals.improvedMetadataTrackCount === 1 ? "" : "s"}`, "Only updates affecting current or previously matched playlist tracks were counted."));
  if (signals.unavailableTrackCount) reasons.push(reason("UNAVAILABLE_TRACKS", `${signals.unavailableTrackCount} unavailable track${signals.unavailableTrackCount === 1 ? "" : "s"}`, "Unavailable Plex tracks can be repaired with suitable replacements."));
  if (signals.currentScore != null) reasons.push(reason("CURRENT_QUALITY", `Current quality ${Math.round(signals.currentScore)}`, signals.previousScore == null ? "No comparable prior score is available." : `Previous generation quality was ${Math.round(signals.previousScore)}.`, signals.currentScore >= 75 ? "neutral" : "positive"));
  if (signals.fallbackOverdue) reasons.push(reason("FALLBACK_DUE", "Fallback refresh is due", "The configured maximum time without a successful refresh has elapsed."));

  const blockers = guardBlockers(input.guards || {}, recommendation);
  if (recommendation === "NO_ACTION") blockers.push({ code: "PLAYLIST_HEALTHY", message: "No evaluated signal currently justifies changing this playlist." });
  if (recommendation !== "NO_ACTION" && estimatedImprovement == null) blockers.push({ code: "NO_BOUNDED_ESTIMATE", message: "A bounded candidate preview could not estimate a meaningful improvement." });
  if (estimatedImprovement != null && estimatedImprovement < thresholds.minimumEstimatedImprovement) blockers.push({ code: "IMPROVEMENT_BELOW_THRESHOLD", message: `Expected improvement +${estimatedImprovement} is below the required +${thresholds.minimumEstimatedImprovement}.` });
  if (signals.identityDamageFromProposal != null && signals.identityDamageFromProposal > Math.max(5, estimatedImprovement || 0)) blockers.push({ code: "IDENTITY_DAMAGE", message: `The proposal would reduce playlist identity match by ${round(signals.identityDamageFromProposal)} points.` });
  if (recommendation !== "NO_ACTION" && signals.compatibleNewTrackCount === 0 && signals.unavailableTrackCount === 0 && signals.weakTrackCount > 0 && (estimatedImprovement ?? 0) <= 0) blockers.push({ code: "NO_REPLACEMENTS", message: "No suitable replacement candidates were available." });

  const evidenceSignals = [signals.weakTrackCount > 0, signals.compatibleNewTrackCount >= thresholds.minimumCompatibleTracks, (signals.repetitivePlaybackScore ?? 0) >= thresholds.repetitionThreshold && signals.playbackObservationCount >= 10, (signals.identityDriftScore ?? 0) >= thresholds.identityDriftThreshold, signals.improvedMetadataTrackCount >= thresholds.metadataImprovementThreshold, signals.unavailableTrackCount > 0].filter(Boolean).length;
  const confidence = clamp(30 + evidenceSignals * 12 + (estimatedImprovement != null ? 15 : 0) + (signals.playbackObservationCount >= 10 ? 7 : 0) - (signals.lockedTrackCount > signals.weakTrackCount ? 8 : 0)) / 100;
  const shouldRefresh = recommendation !== "NO_ACTION" && blockers.length === 0;
  const suggestedActions = recommendation === "NO_ACTION" ? [{ action: "DISMISS", label: "Dismiss", description: "No playlist change is proposed." }] : [
    { action: "PREVIEW", label: "Preview changes", description: "Review exact changes without modifying Plex." },
    { action: recommendation, label: recommendation.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()), description: "Run the least disruptive recommended action after revalidation." },
    { action: "DISMISS", label: "Dismiss recommendation", description: "Keep the playlist unchanged and retain this evaluation in history." },
  ];
  return { playlistId: input.playlistId, evaluatedAt, recommendation, shouldRefresh, confidence: round(confidence), currentScore: signals.currentScore, estimatedScoreAfterRefresh: signals.estimatedScoreAfterRefresh, estimatedImprovement, compatibleNewTrackCount: signals.compatibleNewTrackCount, weakTrackCount: signals.weakTrackCount, repetitivePlaybackScore: signals.repetitivePlaybackScore, identityDriftScore: signals.identityDriftScore, improvedMetadataTrackCount: signals.improvedMetadataTrackCount, reasons, blockers, suggestedActions };
}

export function isTimeInQuietHours(input: { now: Date; start: string; end: string; timezone: string }) {
  const parse = (value: string) => { const match = /^(\d{2}):(\d{2})$/.exec(value); if (!match) return null; const minutes = Number(match[1]) * 60 + Number(match[2]); return minutes >= 0 && minutes < 1440 ? minutes : null; };
  const start = parse(input.start); const end = parse(input.end);
  if (start == null || end == null) throw new Error("Invalid quiet-hour time");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: input.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(input.now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value); const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const current = hour * 60 + minute;
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
