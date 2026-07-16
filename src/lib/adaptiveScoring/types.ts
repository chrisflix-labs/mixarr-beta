import type { PersonalizationScoringContext } from "../personalization/types";
import type { PlaylistIdentityScoringContext } from "../playlistIdentity/types";

export const ADAPTIVE_SCORING_VERSION = "1";
export const ADAPTIVE_COMPONENT_KEYS = [
  "personalPreference",
  "playlistIdentity",
  "historicalAcceptance",
  "historicalRejection",
  "artistPreference",
  "moodPreference",
  "discoveryTolerance",
  "repeatTolerance",
] as const;

export type AdaptiveComponentKey = typeof ADAPTIVE_COMPONENT_KEYS[number];
export type AdaptiveConfidenceLabel = "Very low" | "Low" | "Medium" | "High" | "Very high";
export type AdaptivePreset = "off" | "light" | "balanced" | "strong" | "maximum" | "custom";
export type AdaptiveMinimumConfidence = "very_low" | "low" | "medium" | "high";

export type AdaptiveScoringSettings = {
  enabled: boolean;
  preset: AdaptivePreset;
  maximumInfluence: number;
  showExplanationsByDefault: boolean;
  includeInferredBehavior: boolean;
  includePlaylistHistory: boolean;
  includePlaylistIdentity: boolean;
  includeArtistPreferences: boolean;
  includeMoodPreferences: boolean;
  includeDiscoveryTolerance: boolean;
  includeRepeatTolerance: boolean;
  minimumConfidence: AdaptiveMinimumConfidence;
  preferExplicitFeedback: boolean;
  reduceOldFeedback: boolean;
  positiveAdjustmentLimit: number;
  negativeAdjustmentLimit: number;
  componentWeights: Record<AdaptiveComponentKey, number>;
};

export type AdaptiveStatistic = {
  dimension: string;
  featureKey: string;
  playlistId?: string | null;
  positiveWeight: number;
  negativeWeight: number;
  observationCount: number;
  explicitCount: number;
  confidence: number;
  lastObservedAt?: string | Date | null;
};

export type AdaptiveScoringContext = {
  settings: AdaptiveScoringSettings;
  personalization?: PersonalizationScoringContext;
  playlistIdentity?: PlaylistIdentityScoringContext;
  statistics: Record<string, AdaptiveStatistic>;
  playlistId?: string | null;
  modelVersion: string;
};

export type AdaptiveScoreReason = {
  message: string;
  adjustment: number;
  source: string;
  scope: "global" | "user" | "playlist";
  confidence: AdaptiveConfidenceLabel;
  confidenceValue: number;
  explicit: boolean;
};

export type AdaptiveScoreComponent = {
  key: AdaptiveComponentKey;
  label: string;
  rawAdjustment: number;
  appliedAdjustment: number;
  confidence: AdaptiveConfidenceLabel;
  confidenceValue: number;
  reasons: AdaptiveScoreReason[];
};

export type AdaptiveScoreResult = {
  baseScore: number;
  rawPersonalizedScore: number;
  personalizedScore: number;
  rawAdjustment: number;
  appliedAdjustment: number;
  cappedAdjustment: number;
  adjustmentWasCapped: boolean;
  maximumInfluence: number;
  maximumAdjustment: number;
  confidence: AdaptiveConfidenceLabel;
  confidenceValue: number;
  components: AdaptiveScoreComponent[];
  positiveReasons: AdaptiveScoreReason[];
  negativeReasons: AdaptiveScoreReason[];
  enabled: boolean;
  explanationsDefaultOpen: boolean;
  statusMessage: string;
  excluded: boolean;
  exclusionReason?: string | null;
  baseEngineVersion: string;
  adaptiveScoringVersion: string;
};
