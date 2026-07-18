export const SMART_MIX_EXPLANATION_SCHEMA_VERSION = 1;

export type SmartMixDecision = "selected" | "rejected" | "eligible" | "replaced";
export type SmartMixFactorImpact = "positive" | "negative" | "neutral" | "unavailable";
export type SmartMixConfidenceLabel = "Very High" | "High" | "Medium" | "Low" | "Very Low";
export type SmartMixExplanationDetailLevel = "SIMPLE" | "DETAILED" | "DEVELOPER";

export type SmartMixExplanationFactor = {
  code: string;
  label: string;
  category: string;
  impact: SmartMixFactorImpact;
  rawValue?: unknown;
  target?: unknown;
  normalizedContribution: number;
  weightedContribution: number;
  weight: number;
  explanation: string;
  detail?: string;
  source: "global" | "personalization" | "playlist_identity" | "transition" | "rules" | "metadata" | "fallback";
  eligibilityEffect: "none" | "ranking" | "hard_rejection";
  sourceConfidence: number;
};

export type SmartMixFallbackExplanation = {
  code: string;
  trigger: string;
  expectedBehavior: string;
  behaviorUsed: string;
  confidenceImpact: number;
  relaxedRule: boolean;
  actionRecommended: boolean;
};

export type SmartMixMissingMetadataExplanation = {
  field: string;
  status: "missing" | "low_confidence" | "conflicting" | "stale" | "manual_override" | "analysis_failed";
  required: boolean;
  fallbackUsed: boolean;
  scoreImpact: number;
  confidenceImpact: number;
  suggestedFix: { label: string; href: string } | null;
};

export type SmartMixConfidenceExplanation = {
  score: number;
  label: SmartMixConfidenceLabel;
  reasons: string[];
  deductions: Array<{ code: string; points: number; explanation: string }>;
};

export type SmartMixTransitionExplanation = {
  previousTrackId: string | null;
  previousTrackTitle: string | null;
  fromBpm: number | null;
  toBpm: number | null;
  rawBpmDifference: number | null;
  effectiveBpmDifference: number | null;
  relationship: "direct" | "half-time" | "double-time" | "unknown";
  direction: string;
  difficulty: string;
  transitionScore: number | null;
  directionConflict: boolean;
  warning: string | null;
};

export type SmartMixCandidateComparison = {
  candidateId: string;
  candidateTitle?: string | null;
  scoreDifference: number;
  winningFactorCodes: string[];
};

export type SmartMixScoreExplanation = {
  baseScore: number;
  scoreBeforePenalties: number;
  personalizationAdjustment: number;
  playlistIdentityAdjustment: number;
  transitionAdjustment: number;
  neglectBonus?: number;
  overusePenalty?: number;
  penaltyAdjustment: number;
  scoreAfterPenalties: number;
  personalizedScore: number;
  finalScore: number;
};

export type SmartMixDecisionExplanation = {
  schemaVersion: number;
  trackId: string;
  trackTitle: string;
  artistName: string | null;
  playlistId?: string | null;
  generationId: string;
  engineVersion: string;
  decision: SmartMixDecision;
  rank?: number;
  rejectionStage?: string;
  rejectionCode?: string;
  hardFilterResults: Array<{ code: string; passed: boolean; explanation: string }>;
  softFilterResults: Array<{ code: string; passed: boolean; explanation: string }>;
  scores: SmartMixScoreExplanation;
  factors: SmartMixExplanationFactor[];
  fallbacks: SmartMixFallbackExplanation[];
  missingMetadata: SmartMixMissingMetadataExplanation[];
  comparisons: SmartMixCandidateComparison[];
  confidence: SmartMixConfidenceExplanation;
  transition: SmartMixTransitionExplanation | null;
  suggestedFixes: Array<{ code: string; label: string; href: string }>;
  personalization: {
    enabled: boolean;
    maximumInfluence: number | null;
    appliedConfidenceLimit: string | null;
    adjustmentWasCapped: boolean;
    changedSelection: boolean | null;
    statusMessage: string;
  };
  playlistIdentity: {
    applied: boolean;
    influence: "strongly_supportive" | "moderately_supportive" | "neutral" | "moderately_conflicting" | "strongly_conflicting";
    reasons: string[];
  };
  summary: string;
  createdAt: string;
};

export type SmartMixGenerationInsights = {
  generationId: string;
  candidatesEvaluated: number;
  eligibleCandidates: number;
  selectedCount: number;
  hardRejectedCount: number;
  rankingRejectedCount: number;
  averageConfidence: number;
  fallbackTrackCount: number;
  missingMetadataTrackCount: number;
  relaxedConstraintCount: number;
  lowConfidenceSelectedCount: number;
  personalizationInfluence: number;
  playlistIdentityInfluence: number;
  mostInfluentialFactors: Array<{ code: string; label: string; totalContribution: number; occurrences: number }>;
  rejectionReasons: Array<{ code: string; count: number }>;
  weakestTransitions: Array<{ trackId: string; trackTitle: string; score: number | null }>;
  lowestConfidenceTracks: Array<{ trackId: string; trackTitle: string; confidence: number }>;
  closestDecisions: Array<{ selectedTrackId: string; candidateTrackId: string; margin: number }>;
  metadataProblems: Array<{ field: string; count: number }>;
};
