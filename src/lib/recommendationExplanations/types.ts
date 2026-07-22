export const RECOMMENDATION_EXPLANATION_SCHEMA_VERSION = "1.0";

export const RESPONSIBILITY_LABELS = [
  "user",
  "ai_interpretation",
  "mixarr_configuration",
  "deterministic_engine",
  "metadata_provider",
  "user_override",
  "household_approval",
  "system_default",
] as const;

export type Responsibility = typeof RESPONSIBILITY_LABELS[number];
export type ConfidenceCategory = "high" | "medium" | "low" | "unknown" | "not_applicable";
export type DeterministicResult = "passed" | "failed" | "not_evaluated" | "insufficient_metadata";
export type ReproducibilityStatus = "fully_reproducible" | "reproducible_with_current_metadata" | "reproducible_with_stored_snapshot" | "partially_reproducible" | "not_reproducible" | "reinterpretation_required";

export type FieldInterpretation = {
  id: string;
  fieldPath: string;
  value: unknown;
  sourcePhrase: string | null;
  explicitlyRequested: boolean;
  inferred: boolean;
  confidence: number | null;
  confidenceCategory: ConfidenceCategory;
  responsibility: Responsibility;
};

export type GeneratedSetting = {
  path: string;
  value: unknown;
  previousValue?: unknown;
  sourceInterpretationId: string | null;
  confidence: number | null;
  confidenceCategory: ConfidenceCategory;
  explicitlyRequested: boolean;
  inferred: boolean;
  userModified: boolean;
  validationStatus: DeterministicResult;
  defaultValue?: unknown;
  responsibility: Responsibility;
};

export type ValidationResult = {
  id: string;
  category: "schema" | "supported_field" | "type" | "range" | "dependency" | "compatibility" | "protected_playlist" | "safety" | "permission" | "provider_capability" | "conflict" | "metadata";
  path?: string | null;
  result: "passed" | "failed" | "warning" | "not_evaluated";
  reasonCode: string;
  message: string;
  responsibility: "deterministic_engine" | "mixarr_configuration" | "metadata_provider";
};

export type ReproducibilitySnapshot = {
  explanation_schema_version: string;
  recipe_schema_version: string;
  engine_version: string;
  original_request: string | null;
  structured_interpretation: Record<string, unknown>;
  generated_configuration: Record<string, unknown>;
  assumptions: unknown[];
  alternatives: unknown[];
  validation_results: ValidationResult[];
  metadata_snapshot_policy: "reference" | "snapshot" | "reference-or-snapshot" | "unavailable";
  random_seed: number | null;
  provider_context: Record<string, unknown>;
  created_at: string;
  configuration_hash: string;
  interpretation_hash: string;
};

export type StructuredTrackEvaluation = {
  trackId: string | null;
  ruleId: string;
  ruleType: "hard_filter" | "soft_preference" | "score_modifier" | "ordering" | "availability" | "metadata";
  result: DeterministicResult;
  reasonCode: string;
  input: Record<string, unknown>;
  scoreDelta: number;
  scoreBefore: number | null;
  scoreAfter: number | null;
  exclusion: boolean;
  responsibility: "deterministic_engine" | "metadata_provider";
  metadataQuality: number | null;
  evaluatedAt: string;
};
