import type { SmartActionConfidenceLevel, SmartActionPayload, SmartActionRiskLevel, SmartActionStatus } from "./types";

export type ConfidenceThresholds = { high: number; medium: number };
export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = { high: 85, medium: 65 };

export function confidenceLevel(score: number, thresholds = DEFAULT_CONFIDENCE_THRESHOLDS): SmartActionConfidenceLevel {
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return bounded >= thresholds.high ? "HIGH" : bounded >= thresholds.medium ? "MEDIUM" : "LOW";
}

const transitions: Record<SmartActionStatus, SmartActionStatus[]> = {
  PENDING: ["APPROVED", "REJECTED", "SNOOZED", "CANCELED", "EXPIRED", "SUPERSEDED"],
  APPROVED: ["SCHEDULED", "RUNNING", "CANCELED", "EXPIRED", "SUPERSEDED"],
  REJECTED: [], SNOOZED: ["PENDING", "REJECTED", "CANCELED", "EXPIRED", "SUPERSEDED"],
  SCHEDULED: ["RUNNING", "CANCELED", "EXPIRED", "SUPERSEDED"],
  RUNNING: ["COMPLETED", "FAILED"], COMPLETED: [], FAILED: ["APPROVED", "CANCELED", "SUPERSEDED"],
  EXPIRED: [], CANCELED: [], SUPERSEDED: [],
};

export function canTransitionSmartAction(from: SmartActionStatus, to: SmartActionStatus) {
  return transitions[from]?.includes(to) || false;
}

type ConflictAction = { id: string; playlistId?: string | null; actionType: string; actionPayload: SmartActionPayload };
export type SmartActionConflict = { leftId: string; rightId: string; reason: string; recommendation: string };

function removedTracks(payload: SmartActionPayload) {
  if (payload.type === "TRACK_REMOVAL") return [payload.trackId];
  if (payload.type === "PLAYLIST_OVERLAP_FIX") return payload.removeTrackIds;
  return [];
}
function addedTracks(payload: SmartActionPayload) {
  if (payload.type === "TRACK_ADDITION") return [payload.trackId];
  if (payload.type === "TRACK_REMOVAL") return payload.replacementTrackId ? [payload.replacementTrackId] : [];
  if (payload.type === "PLAYLIST_OVERLAP_FIX") return payload.addTrackIds;
  if (payload.type === "COVERAGE_OPPORTUNITY") return payload.trackIds;
  return [];
}

export function detectSmartActionConflicts(actions: ConflictAction[]): SmartActionConflict[] {
  const conflicts: SmartActionConflict[] = [];
  for (let leftIndex = 0; leftIndex < actions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < actions.length; rightIndex += 1) {
      const left = actions[leftIndex];
      const right = actions[rightIndex];
      if (left.playlistId && left.playlistId === right.playlistId) {
        if (left.actionType === "PLAYLIST_REFRESH" || right.actionType === "PLAYLIST_REFRESH") {
          conflicts.push({ leftId: left.id, rightId: right.id, reason: "A playlist refresh can invalidate the other playlist-level recommendation.", recommendation: "Apply the refresh by itself and regenerate the remaining recommendations." });
          continue;
        }
        const leftAdded = new Set(addedTracks(left.actionPayload));
        const rightAdded = new Set(addedTracks(right.actionPayload));
        const leftRemoved = new Set(removedTracks(left.actionPayload));
        const rightRemoved = new Set(removedTracks(right.actionPayload));
        if (Array.from(leftAdded).some((id) => rightRemoved.has(id)) || Array.from(rightAdded).some((id) => leftRemoved.has(id))) {
          conflicts.push({ leftId: left.id, rightId: right.id, reason: "One action adds a track that the other removes.", recommendation: "Choose the action that best matches the playlist identity." });
          continue;
        }
        if (left.actionPayload.type === "TRANSITION_FIX" && right.actionPayload.type === "TRANSITION_FIX" && left.actionPayload.orderedTrackIds.join("|") !== right.actionPayload.orderedTrackIds.join("|")) {
          conflicts.push({ leftId: left.id, rightId: right.id, reason: "Both actions propose a different order for the same playlist.", recommendation: "Preview and approve only one transition plan." });
        }
      }
      if (left.actionPayload.type === "METADATA_CORRECTION" && right.actionPayload.type === "METADATA_CORRECTION"
        && left.actionPayload.trackId === right.actionPayload.trackId && left.actionPayload.field === right.actionPayload.field
        && JSON.stringify(left.actionPayload.suggestedValue) !== JSON.stringify(right.actionPayload.suggestedValue)) {
        conflicts.push({ leftId: left.id, rightId: right.id, reason: "The actions suggest different metadata values for the same field.", recommendation: "Review the supporting source and approve one correction." });
      }
    }
  }
  return conflicts;
}

export function bulkEligibleActionIds(actions: Array<ConflictAction & { confidenceLevel: string; riskLevel: SmartActionRiskLevel; status: string }>) {
  const initiallyEligible = actions.filter((action) => action.status === "PENDING" && action.confidenceLevel !== "LOW" && action.riskLevel !== "HIGH");
  const conflicts = detectSmartActionConflicts(initiallyEligible);
  const conflicted = new Set(conflicts.flatMap((conflict) => [conflict.leftId, conflict.rightId]));
  return initiallyEligible.filter((action) => !conflicted.has(action.id)).map((action) => action.id);
}

export function riskRank(risk: SmartActionRiskLevel) {
  return ({ LOW: 0, MODERATE: 1, HIGH: 2 } as const)[risk];
}

export function isMaintenanceWindow(input: { now: Date; startTime: string; allowedDays: number[]; toleranceMinutes?: number }) {
  if (!input.allowedDays.includes(input.now.getDay())) return false;
  const match = /^(\d{2}):(\d{2})$/.exec(input.startTime);
  if (!match) return false;
  const target = Number(match[1]) * 60 + Number(match[2]);
  const actual = input.now.getHours() * 60 + input.now.getMinutes();
  return actual >= target && actual < target + (input.toleranceMinutes ?? 60);
}
