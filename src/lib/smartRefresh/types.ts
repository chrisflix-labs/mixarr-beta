export const SMART_REFRESH_MODES = ["MANUAL_ONLY", "FIXED_SCHEDULE", "SMART_REFRESH", "SMART_WITH_FALLBACK", "DISABLED"] as const;
export const SMART_REFRESH_SENSITIVITIES = ["LOW", "BALANCED", "HIGH", "CUSTOM"] as const;
export const SMART_REFRESH_RECOMMENDATIONS = ["NO_ACTION", "REFRESH_WEAK_TRACKS", "ADD_COMPATIBLE_TRACKS", "REBALANCE_PLAYLIST", "REFRESH_METADATA_AFFECTED_TRACKS", "FULL_REGENERATION"] as const;

export type SmartRefreshMode = typeof SMART_REFRESH_MODES[number];
export type SmartRefreshSensitivity = typeof SMART_REFRESH_SENSITIVITIES[number];
export type SmartRefreshRecommendation = typeof SMART_REFRESH_RECOMMENDATIONS[number];

export type SmartRefreshReason = { code: string; label: string; detail: string; impact: "positive" | "neutral" | "negative" };
export type SmartRefreshBlocker = { code: string; message: string; eligibleAt?: string | null; hard?: boolean };
export type SmartRefreshSuggestedAction = { action: string; label: string; description: string };

export type SmartRefreshThresholds = {
  minimumEstimatedImprovement: number;
  minimumCompatibleTracks: number;
  weakTrackThreshold: number;
  identityDriftThreshold: number;
  repetitionThreshold: number;
  metadataImprovementThreshold: number;
};

export type SmartRefreshSignals = {
  currentScore: number | null;
  previousScore: number | null;
  estimatedScoreAfterRefresh: number | null;
  weakTrackCount: number;
  compatibleNewTrackCount: number;
  averageCandidateScore: number | null;
  repetitivePlaybackScore: number | null;
  playbackObservationCount: number;
  identityDriftScore: number | null;
  identityDamageFromProposal: number | null;
  improvedMetadataTrackCount: number;
  unavailableTrackCount: number;
  libraryChangeCount: number;
  fallbackOverdue: boolean;
  lockedTrackCount: number;
};

export type SmartRefreshGuards = {
  cooldownUntil?: Date | null;
  weeklyLimitReached?: boolean;
  quietHours?: boolean;
  quietHoursEnd?: Date | null;
  activeGenerationJob?: boolean;
  playlistLocked?: boolean;
  libraryUnavailable?: boolean;
  analysisInProgress?: boolean;
  unsavedManualEdits?: boolean;
  stale?: boolean;
  automaticFullRegenerationAllowed?: boolean;
};

export type SmartRefreshDecision = {
  playlistId: string;
  evaluatedAt: Date;
  recommendation: SmartRefreshRecommendation;
  shouldRefresh: boolean;
  confidence: number;
  currentScore: number | null;
  estimatedScoreAfterRefresh: number | null;
  estimatedImprovement: number | null;
  compatibleNewTrackCount: number;
  weakTrackCount: number;
  repetitivePlaybackScore: number | null;
  identityDriftScore: number | null;
  improvedMetadataTrackCount: number;
  reasons: SmartRefreshReason[];
  blockers: SmartRefreshBlocker[];
  suggestedActions: SmartRefreshSuggestedAction[];
};
