import { createHash } from "crypto";
import type { SmartMixDecisionExplanation } from "../smartMixExplanations/types";
import type { ConfidenceCategory, ReproducibilitySnapshot, ReproducibilityStatus, StructuredTrackEvaluation, ValidationResult } from "./types";
import { RECOMMENDATION_EXPLANATION_SCHEMA_VERSION } from "./types";

const secretKey = /(access.?token|api.?key|authorization|cookie|credential|password|secret|private.?prompt|authentication.?header)/i;

export function confidenceCategory(value: number | null | undefined): ConfidenceCategory {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value >= 0.8) return "high";
  if (value >= 0.55) return "medium";
  return "low";
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
}

export function explanationHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function redactExplanationExport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactExplanationExport);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !secretKey.test(key)).map(([key, item]) => [key, redactExplanationExport(item)]));
}

export function validationResultsFromProposal(validation: any, compatibility: any): ValidationResult[] {
  const results: ValidationResult[] = [];
  const add = (result: ValidationResult) => results.push(result);
  add({ id: "recipe-schema", category: "schema", result: validation?.schema?.valid === false ? "failed" : "passed", reasonCode: validation?.schema?.valid === false ? "RECIPE_SCHEMA_INVALID" : "RECIPE_SCHEMA_VALID", message: validation?.schema?.valid === false ? "The generated recipe does not match the supported schema." : "The generated recipe matches the supported schema.", responsibility: "mixarr_configuration" });
  add({ id: "automation-safety", category: "safety", result: validation?.safety?.valid === false ? "failed" : "passed", reasonCode: validation?.safety?.valid === false ? "AUTOMATION_SAFETY_FAILED" : "AUTOMATION_SAFETY_PASSED", message: validation?.safety?.valid === false ? "One or more generated settings violate an automation safety limit." : "Generated automation remains disabled until explicit approval.", responsibility: "deterministic_engine" });
  for (const [index, conflict] of (validation?.conflicts || []).entries()) add({ id: `conflict-${index + 1}`, category: "conflict", path: conflict.code || null, result: conflict.resolved ? "passed" : "warning", reasonCode: String(conflict.code || "INTENT_CONFLICT").toUpperCase().replace(/[^A-Z0-9]+/g, "_"), message: String(conflict.description || "The request contains potentially conflicting intent."), responsibility: "mixarr_configuration" });
  for (const [index, finding] of (compatibility?.findings || []).entries()) add({ id: `compatibility-${index + 1}`, category: "compatibility", path: finding.path || null, result: finding.severity === "error" ? "failed" : finding.severity === "warning" ? "warning" : "passed", reasonCode: String(finding.code || "COMPATIBILITY_CHECK").toUpperCase().replace(/[^A-Z0-9]+/g, "_"), message: String(finding.message || "Compatibility check completed."), responsibility: "deterministic_engine" });
  return results;
}

export function trackEvaluationsFromDecision(explanation: SmartMixDecisionExplanation): StructuredTrackEvaluation[] {
  const evaluatedAt = explanation.createdAt;
  const rows: StructuredTrackEvaluation[] = [];
  for (const rule of explanation.hardFilterResults) rows.push({ trackId: explanation.trackId, ruleId: rule.code, ruleType: "hard_filter", result: rule.passed ? "passed" : "failed", reasonCode: rule.code, input: { explanation: rule.explanation }, scoreDelta: 0, scoreBefore: explanation.scores.baseScore, scoreAfter: explanation.scores.baseScore, exclusion: !rule.passed, responsibility: "deterministic_engine", metadataQuality: null, evaluatedAt });
  for (const rule of explanation.softFilterResults) rows.push({ trackId: explanation.trackId, ruleId: rule.code, ruleType: "soft_preference", result: rule.passed ? "passed" : "failed", reasonCode: rule.code, input: { explanation: rule.explanation }, scoreDelta: 0, scoreBefore: explanation.scores.baseScore, scoreAfter: explanation.scores.scoreBeforePenalties, exclusion: false, responsibility: "deterministic_engine", metadataQuality: null, evaluatedAt });
  let scoreBefore = explanation.scores.baseScore;
  for (const factor of explanation.factors) {
    const scoreAfter = scoreBefore + factor.weightedContribution;
    rows.push({ trackId: explanation.trackId, ruleId: factor.code, ruleType: "score_modifier", result: factor.impact === "unavailable" ? "insufficient_metadata" : "passed", reasonCode: factor.code, input: { rawValue: factor.rawValue, target: factor.target, source: factor.source, explanation: factor.explanation }, scoreDelta: factor.weightedContribution, scoreBefore, scoreAfter, exclusion: factor.eligibilityEffect === "hard_rejection", responsibility: factor.source === "metadata" ? "metadata_provider" : "deterministic_engine", metadataQuality: factor.source === "metadata" ? factor.sourceConfidence : null, evaluatedAt });
    scoreBefore = scoreAfter;
  }
  for (const missing of explanation.missingMetadata) rows.push({ trackId: explanation.trackId, ruleId: `METADATA_${missing.field.toUpperCase()}`, ruleType: "metadata", result: "insufficient_metadata", reasonCode: `METADATA_${missing.status.toUpperCase()}`, input: { field: missing.field, fallbackUsed: missing.fallbackUsed, status: missing.status }, scoreDelta: missing.scoreImpact, scoreBefore: null, scoreAfter: null, exclusion: missing.required && !missing.fallbackUsed, responsibility: "metadata_provider", metadataQuality: 0, evaluatedAt });
  if (explanation.transition) rows.push({ trackId: explanation.trackId, ruleId: "PLAYLIST_POSITIONING", ruleType: "ordering", result: explanation.transition.warning ? "failed" : "passed", reasonCode: explanation.transition.warning ? "POSITIONING_WARNING" : "POSITION_ASSIGNED", input: { rank: explanation.rank, previousTrackId: explanation.transition.previousTrackId, relationship: explanation.transition.relationship, transitionScore: explanation.transition.transitionScore }, scoreDelta: explanation.scores.transitionAdjustment, scoreBefore: explanation.scores.scoreAfterPenalties, scoreAfter: explanation.scores.finalScore, exclusion: false, responsibility: "deterministic_engine", metadataQuality: null, evaluatedAt });
  return rows;
}

export function calculateReproducibilityStatus(input: { originalRequest?: string | null; structuredInterpretation?: unknown; generatedConfiguration?: unknown; engineVersion?: string | null; currentEngineVersion?: string | null; metadataPolicy?: string | null; metadataChanged?: boolean; configurationHashValid?: boolean }): { status: ReproducibilityStatus; reason: string } {
  if (!input.structuredInterpretation && !input.generatedConfiguration) return { status: "reinterpretation_required", reason: "No structured interpretation or generated configuration is available." };
  if (!input.generatedConfiguration) return { status: "partially_reproducible", reason: "The interpretation is stored, but the generated configuration is unavailable." };
  if (input.configurationHashValid === false) return { status: "not_reproducible", reason: "The stored configuration no longer matches its integrity hash." };
  if (input.engineVersion && input.currentEngineVersion && input.engineVersion !== input.currentEngineVersion) return { status: "partially_reproducible", reason: `The original engine was ${input.engineVersion}; the current engine is ${input.currentEngineVersion}.` };
  if (input.metadataChanged) return { status: input.metadataPolicy === "snapshot" ? "reproducible_with_stored_snapshot" : "reproducible_with_current_metadata", reason: input.metadataPolicy === "snapshot" ? "Provider metadata changed, but the original metadata snapshot is available." : "Provider metadata changed; re-evaluation will use current metadata and explain differences." };
  if (input.metadataPolicy === "snapshot") return { status: "reproducible_with_stored_snapshot", reason: "The generated configuration and original metadata snapshot are available." };
  if (input.metadataPolicy === "reference" || input.metadataPolicy === "reference-or-snapshot") return { status: "reproducible_with_current_metadata", reason: "The structured inputs are complete; track results will be evaluated against current metadata." };
  return { status: "fully_reproducible", reason: "The structured interpretation, generated configuration, engine version, and integrity hashes are available." };
}

export function buildReproducibilitySnapshot(input: Omit<ReproducibilitySnapshot, "explanation_schema_version" | "configuration_hash" | "interpretation_hash">): ReproducibilitySnapshot {
  return { ...input, explanation_schema_version: RECOMMENDATION_EXPLANATION_SCHEMA_VERSION, configuration_hash: explanationHash(input.generated_configuration), interpretation_hash: explanationHash(input.structured_interpretation) };
}

export function semanticDiff(before: unknown, after: unknown, prefix = ""): Array<{ path: string; before: unknown; after: unknown; changeType: "added" | "removed" | "changed" }> {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const left = before && typeof before === "object" && !Array.isArray(before) ? before as Record<string, unknown> : null;
  const right = after && typeof after === "object" && !Array.isArray(after) ? after as Record<string, unknown> : null;
  if (!left || !right) return [{ path: prefix || "$", before, after, changeType: before === undefined ? "added" : after === undefined ? "removed" : "changed" }];
  return Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort().flatMap((key) => semanticDiff(left[key], right[key], prefix ? `${prefix}.${key}` : key));
}
