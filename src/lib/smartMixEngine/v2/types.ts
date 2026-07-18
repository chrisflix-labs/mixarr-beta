import type { SmartMixTuningConfig } from "./tuning";
import type { PersonalizationScoreResult, PersonalizationScoringContext } from "../../personalization/types";
import type { PlaylistIdentityScoringContext } from "../../playlistIdentity/types";
import type { AdaptiveScoreResult, AdaptiveScoringContext } from "../../adaptiveScoring/types";
import type { PlaybackScoreResult, PlaybackScoringContext } from "../../playbackAwareness/types";
import type { ContextScoreResult, ContextSelection } from "../../contextualMixes";
import type { CoordinationScoreBreakdown, CoordinationScoringContext } from "../../playlistCoordination/types";

export const SMART_MIX_ENGINE_V1 = "v1";
export const SMART_MIX_ENGINE_V2 = "v2";

export const smartMixEngineVersions = [SMART_MIX_ENGINE_V1, SMART_MIX_ENGINE_V2] as const;

export type SmartMixEngineVersion = typeof smartMixEngineVersions[number];

export function normalizeSmartMixEngineVersion(value: unknown): SmartMixEngineVersion {
  return value === SMART_MIX_ENGINE_V2 ? SMART_MIX_ENGINE_V2 : SMART_MIX_ENGINE_V1;
}

export function smartMixEngineLabel(version: unknown) {
  return normalizeSmartMixEngineVersion(version) === SMART_MIX_ENGINE_V2
    ? "Smart Mix Engine: v2 Foundation"
    : "Smart Mix Engine: v1 Legacy";
}

export type SmartMixRuleLike = {
  field: string;
  operator: string;
  value: string;
};

export type SmartMixRuleTree =
  | SmartMixRuleLike
  | {
      type: "group";
      combinator: "AND" | "OR";
      children: SmartMixRuleTree[];
    };

export type SmartMixEngineV2Config = {
  limit: number;
  rules?: SmartMixRuleLike[];
  ruleTree?: SmartMixRuleTree;
  tuningConfig?: SmartMixTuningConfig;
  recentlyUsedTrackIds?: string[];
  recentPlaylistUsage?: Record<string, number>;
  personalization?: PersonalizationScoringContext;
  playlistIdentity?: PlaylistIdentityScoringContext;
  adaptiveScoring?: AdaptiveScoringContext;
  playbackScoring?: PlaybackScoringContext;
  contextSelection?: ContextSelection | null;
  coordination?: CoordinationScoringContext;
  coverageRotation?: {
    enabled: boolean;
    level: string;
    maximumBoost: number;
    settingsVersion: string;
    statistics: Record<string, { opportunityScore: number; overuseScore: number; eligible: boolean; qualityPassed: boolean; explanation?: unknown }>;
  };
  moodBlendMode?: SmartMixMoodBlendMode;
  selectedMoodPath?: string[];
  allowedMoods?: string[];
  moodStrength?: number;
  transitionSmoothness?: number;
  moodStrictness?: number;
  fallbackTolerance?: number;
  bridgeTrackPreference?: number;
  moodVariety?: number;
  conflictSensitivity?: number;
  selectedMoodPreset?: string;
  [key: string]: unknown;
};

export type SmartMixMoodBlendMode =
  | "off"
  | "smooth_transition"
  | "strict_matching"
  | "mixed_mood";

export type SmartMixMoodCurveSection = {
  start: number;
  end: number;
  mood: string;
  matchedTrackCount?: number;
};

export type SmartMixMoodCurve =
  | {
      mode: "smooth_transition" | "strict_matching";
      sections: SmartMixMoodCurveSection[];
    }
  | {
      mode: "mixed_mood";
      primaryMoods: string[];
      dominantMood: string | null;
      secondaryMoodCoverage: string[];
    }
  | null;

export type SmartMixMoodBlendTrackData = {
  mode: SmartMixMoodBlendMode;
  moodTags: string[];
  targetMood?: string | null;
  matchingMoods: string[];
  adjacentMoods: string[];
  moodMatchLevel: "exact" | "alias" | "adjacent" | "family" | "energy_bpm" | "generic" | "none";
  moodMatchScore: number;
  isMoodFallback: boolean;
  isMoodConflict: boolean;
  isMultiMoodBridge: boolean;
};

export type SmartMixMetadataField = "bpm" | "mood" | "energy" | "popularity";

export type SmartMixMetadataStatus = {
  hasBpm: boolean;
  hasMood: boolean;
  hasEnergy: boolean;
  hasPopularity: boolean;
  missingFields: SmartMixMetadataField[];
};

export type SmartMixFallbackResult = {
  metadataStatus: SmartMixMetadataStatus;
  fallbackValues: {
    bpm: number | null;
    mood: number | null;
    energy: number | null;
    popularity: number;
  };
  fallbacksApplied: string[];
};

export type SmartMixScoreBreakdown = {
  base: number;
  bpm?: number;
  mood?: number;
  energy?: number;
  popularity?: number;
  tuning?: number;
  moodBlend?: number;
  recentlyUsedPenalty?: number;
  discoveryScore?: number;
  underplayedScore?: number;
  playlistFreshnessScore?: number;
  hiddenGemScore?: number;
  overplayedPenalty?: number;
  recentPlaylistPenalty?: number;
  fallbackPenalty?: number;
  diversity?: number;
  playlistPreference?: number;
  personalization?: number;
  trackFeedback?: number;
  artistFeedback?: number;
  playlistFitFeedback?: number;
  learnedProfile?: number;
  transitionFeedback?: number;
  playlistIdentity?: number;
  personalPreference?: number;
  historicalAcceptance?: number;
  historicalRejection?: number;
  artistPreference?: number;
  moodPreference?: number;
  discoveryTolerance?: number;
  repeatTolerance?: number;
  playback?: number;
  recentlyPlayedPlayback?: number;
  playbackCompletion?: number;
  playbackReplay?: number;
  playbackSkip?: number;
  forgottenFavorite?: number;
  playbackDiscovery?: number;
  context?: number;
  coordination?: number;
  coverageBoost?: number;
  overusePenalty?: number;
};

export type SmartMixScoredTrack<TTrack = any> = TTrack & {
  engineVersion: typeof SMART_MIX_ENGINE_V2;
  score: number;
  scoreBreakdown: SmartMixScoreBreakdown;
  metadataStatus: SmartMixMetadataStatus;
  fallbacksApplied: string[];
  moodBlend?: SmartMixMoodBlendTrackData;
  discoveryMetrics?: import("./discovery").TrackDiscoveryMetrics;
  personalizationScore?: PersonalizationScoreResult;
  playlistIdentityScore?: import("../../playlistIdentity/types").PlaylistIdentityScoreResult;
  adaptiveScore?: AdaptiveScoreResult;
  playbackScore?: PlaybackScoreResult;
  contextScore?: ContextScoreResult;
  coordinationScore?: CoordinationScoreBreakdown;
  coverageScore?: { boost: number; penalty: number; reasons: string[]; opportunityScore: number; overuseScore: number };
  baseScore?: number;
  personalizedScore?: number;
  exclusionReason?: string | null;
  smartMixSelectionTrace?: import("../../smartMixExplanations/collector").SmartMixSelectionTrace;
};

export type SmartMixEngineV2StageKey =
  | "sourceFiltering"
  | "metadataChecks"
  | "hardFilters"
  | "softScoring"
  | "fallbacks"
  | "finalSelection"
  | "outputFormatting";

export type SmartMixEngineV2Stage = {
  key: SmartMixEngineV2StageKey;
  order: number;
  label: string;
  description: string;
};
