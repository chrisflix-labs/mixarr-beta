export const PLAYBACK_SCORING_VERSION = "1";

export type RecentlyPlayedBehavior = "disabled" | "soft" | "strict";

export type PlaybackAwarenessSettings = {
  enabled: boolean;
  influence: number;
  recentlyPlayedBehavior: RecentlyPlayedBehavior;
  recentlyPlayedWindowDays: 7 | 14 | 30 | 90 | null;
  forgottenFavoriteDays: 90 | 180 | 365 | null;
  useSkipHistory: boolean;
  useCompletionHistory: boolean;
  useReplayHistory: boolean;
  playbackAwareDiscovery: boolean;
  completionThreshold: number;
  skipThreshold: number;
  minimumSkipDurationMs: number;
  minimumObservations: number;
  maximumAdjustment: number;
  historyRetentionDays: number;
  syncIntervalHours: number;
};

export type NormalizedPlaybackEvent = {
  importKey: string;
  serverId: string;
  plexLibraryId: string | null;
  plexUserId: string;
  plexUsername: string | null;
  plexRatingKey: string | null;
  playedAt: Date;
  durationMs: number | null;
  viewOffsetMs: number | null;
  completionPercent: number | null;
  completed: boolean;
  skipped: boolean;
  playCountContribution: number;
  source: string;
  rawEventType: string | null;
  raw: Record<string, unknown>;
};

export type PlaybackProfileSnapshot = {
  trackId: string;
  plexUserId: string;
  totalPlayCount: number;
  completedPlayCount: number;
  skipCount: number;
  replayCount: number;
  completionRate: number;
  skipRate: number;
  firstPlayedAt: Date | string | null;
  lastPlayedAt: Date | string | null;
  lastCompletedAt: Date | string | null;
  lastSkippedAt: Date | string | null;
  averageCompletionPercent: number | null;
  recentPlayCount7Days: number;
  recentPlayCount14Days: number;
  recentPlayCount30Days: number;
  recentPlayCount90Days: number;
  forgottenFavoriteScore: number;
  playbackAffinityScore: number;
  playbackConfidence: number;
};

export type PlaybackScoringContext = {
  settings: PlaybackAwarenessSettings;
  mapped: boolean;
  profiles: Record<string, PlaybackProfileSnapshot>;
  protectedTrackIds: Set<string>;
  maximumPersonalizationInfluence: number;
  statusMessage: string;
};

export type PlaybackScoreReason = {
  key: "recent" | "completion" | "replay" | "skip" | "forgotten" | "discovery" | "protection";
  message: string;
  adjustment: number;
};

export type PlaybackScoreResult = {
  enabled: boolean;
  available: boolean;
  baseScore: number;
  finalScore: number;
  rawAdjustment: number;
  appliedAdjustment: number;
  maximumAdjustment: number;
  confidence: number;
  confidenceLabel: "Insufficient data" | "Limited history" | "Moderate signal" | "Strong signal";
  observationCount: number;
  reasons: PlaybackScoreReason[];
  badges: string[];
  excluded: boolean;
  exclusionReason: string | null;
  protectedFromStrictAvoidance: boolean;
  statusMessage: string;
  scoringVersion: string;
};
