import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { calculateReproducibilityStatus, canonicalize, confidenceCategory, explanationHash, redactExplanationExport, semanticDiff, trackEvaluationsFromDecision, validationResultsFromProposal } from "./recommendationExplanations/core";

test("AI confidence categories are numeric, bounded concepts and deterministic results do not receive fake confidence", () => {
  assert.equal(confidenceCategory(.92), "high");
  assert.equal(confidenceCategory(.67), "medium");
  assert.equal(confidenceCategory(.2), "low");
  assert.equal(confidenceCategory(null), "unknown");
  const results = validationResultsFromProposal({ schema: { valid: true }, safety: { valid: true } }, { findings: [] });
  assert.deepEqual(results.map((item) => item.result), ["passed", "passed"]);
  assert.ok(results.every((item) => !("confidence" in item)));
});

test("configuration and interpretation hashes use canonical key ordering", () => {
  assert.deepEqual(canonicalize({ z: 1, a: { y: 2, b: 3 } }), { a: { b: 3, y: 2 }, z: 1 });
  assert.equal(explanationHash({ b: 2, a: 1 }), explanationHash({ a: 1, b: 2 }));
  assert.notEqual(explanationHash({ a: 1 }), explanationHash({ a: 2 }));
});

test("semantic recipe diff is field-based instead of serialized-text based", () => {
  const diff = semanticDiff({ discovery: { weight: .1 }, safety: { explicit: false } }, { discovery: { weight: .25 }, safety: { explicit: false }, variety: { artistSpacing: 14 } });
  assert.deepEqual(diff.map((item) => item.path), ["discovery.weight", "variety"]);
  assert.equal(diff[0].changeType, "changed");
  assert.equal(diff[1].changeType, "added");
});

test("reproducibility status explains engine and metadata changes", () => {
  assert.equal(calculateReproducibilityStatus({ structuredInterpretation: {}, generatedConfiguration: {}, engineVersion: "v2", currentEngineVersion: "v2" }).status, "fully_reproducible");
  assert.equal(calculateReproducibilityStatus({ structuredInterpretation: {}, generatedConfiguration: {}, engineVersion: "v2", currentEngineVersion: "v3" }).status, "partially_reproducible");
  assert.equal(calculateReproducibilityStatus({ structuredInterpretation: {}, generatedConfiguration: {}, metadataChanged: true, metadataPolicy: "snapshot" }).status, "reproducible_with_stored_snapshot");
  assert.equal(calculateReproducibilityStatus({}).status, "reinterpretation_required");
});

test("privacy export redaction recursively removes credentials, private prompts, and provider secrets", () => {
  const redacted = redactExplanationExport({ request: "rainy night", accessToken: "nope", nested: { apiKey: "nope", value: 4, privatePrompt: "nope" } }) as any;
  assert.equal(redacted.request, "rainy night");
  assert.equal(redacted.accessToken, undefined);
  assert.deepEqual(redacted.nested, { value: 4 });
});

test("track evaluation events retain actual hard decisions, score deltas, metadata gaps, and positioning", () => {
  const explanation: any = {
    schemaVersion: 1, trackId: "track-1", trackTitle: "Rain Window", artistName: "Example", generationId: "run-1", engineVersion: "v2", decision: "selected", rank: 1,
    rejectionCode: undefined, hardFilterResults: [{ code: "EXPLICIT_CONTENT_ALLOWED", passed: true, explanation: "Track is not explicit." }], softFilterResults: [],
    scores: { baseScore: 70, scoreBeforePenalties: 76, personalizationAdjustment: 0, playlistIdentityAdjustment: 0, transitionAdjustment: 2, penaltyAdjustment: 0, scoreAfterPenalties: 76, personalizedScore: 76, finalScore: 78 },
    factors: [{ code: "DISCOVERY_FIT", label: "Discovery fit", category: "discovery", impact: "positive", normalizedContribution: 6, weightedContribution: 6, weight: 1, explanation: "Discovery increased ranking.", source: "global", eligibilityEffect: "ranking", sourceConfidence: 1 }],
    fallbacks: [], missingMetadata: [{ field: "valence", status: "missing", required: false, fallbackUsed: true, scoreImpact: 0, confidenceImpact: -10, suggestedFix: null }], comparisons: [], confidence: { score: 90, label: "High", reasons: [], deductions: [] },
    transition: { previousTrackId: null, previousTrackTitle: null, fromBpm: null, toBpm: 82, rawBpmDifference: null, effectiveBpmDifference: null, relationship: "unknown", direction: "start", difficulty: "none", transitionScore: 100, directionConflict: false, warning: null }, suggestedFixes: [], personalization: {}, playlistIdentity: {}, summary: "Selected", createdAt: "2026-07-22T00:00:00.000Z",
  };
  const rows = trackEvaluationsFromDecision(explanation);
  assert.equal(rows.find((item) => item.ruleId === "EXPLICIT_CONTENT_ALLOWED")?.result, "passed");
  assert.equal(rows.find((item) => item.ruleId === "DISCOVERY_FIT")?.scoreDelta, 6);
  assert.equal(rows.find((item) => item.ruleId === "METADATA_VALENCE")?.result, "insufficient_metadata");
  assert.equal(rows.find((item) => item.ruleId === "PLAYLIST_POSITIONING")?.ruleType, "ordering");
});

test("migration is additive and indexes generation, track, rule, result, and outcome lookups", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260725010000_explainable_ai_recommendations_v247/migration.sql"), "utf8");
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
  assert.match(migration, /explanationId.*trackId.*evaluatedAt/);
  assert.match(migration, /explanationId.*ruleId.*result/);
  assert.match(migration, /generationId.*trackId/);
  assert.match(migration, /generatedPlaylistId.*createdAt/);
});

test("explanation API routes enforce session authentication through the shared boundary", () => {
  const root = process.cwd();
  const api = fs.readFileSync(path.join(root, "src/lib/recommendationExplanations/api.ts"), "utf8");
  assert.match(api, /mixarr_session/);
  assert.match(api, /UNAUTHORIZED/);
  const routes = [
    "src/app/api/recommendations/[id]/explanation/route.ts", "src/app/api/recommendations/[id]/explanation/tracks/route.ts",
    "src/app/api/recommendations/[id]/explanation/assumptions/[assumptionId]/route.ts", "src/app/api/recommendations/[id]/explanation/alternatives/[alternativeId]/apply/route.ts",
    "src/app/api/recommendations/[id]/explanation/regenerate/route.ts", "src/app/api/recommendations/[id]/explanation/export/route.ts",
  ];
  for (const file of routes) assert.match(fs.readFileSync(path.join(root, file), "utf8"), /recommendationExplanationUserId/);
});

test("explanation panel exposes ten keyboard-accessible layers, responsibility labels, lazy track loading, and mobile layout", () => {
  const component = fs.readFileSync(path.join(process.cwd(), "src/components/RecommendationExplanationPanel.tsx"), "utf8");
  const css = fs.readFileSync(path.join(process.cwd(), "src/components/RecommendationExplanationPanel.module.css"), "utf8");
  assert.match(component, /Overview.*User Intent.*AI Interpretation.*Generated Rules.*Engine Evaluation.*Track Results.*Assumptions.*Alternatives.*Reproducibility.*Export/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /ArrowLeft.*ArrowRight.*Home.*End/);
  assert.match(component, /AI Interpretation.*Deterministic Engine/);
  assert.match(component, /tab !== "Track Results"/);
  assert.match(css, /@media\(max-width:700px\)/);
});
