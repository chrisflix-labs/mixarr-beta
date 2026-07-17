import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildDecisionExplanation, buildGenerationInsights, calculateRecommendationConfidence, compareDecisionExplanations, factorsFromScoredTrack, fallbacksFromScoredTrack } from "./smartMixExplanations/collector";
import { DEFAULT_REJECTED_CANDIDATE_LIMIT, DEFAULT_REJECTED_RETENTION_DAYS } from "./smartMixExplanations/service";

function track(overrides: Record<string, any> = {}) {
  return {
    id: "track-a", title: "Midnight Signal", artist: { title: "Example Artist" }, engineVersion: "v2", score: 88.4, baseScore: 76.8, personalizedScore: 88.4,
    scoreBreakdown: { base: 50, mood: 14.2, energy: -2.8, bpm: 4, recentlyUsedPenalty: -3.2, personalization: 6.4, playlistIdentity: 5.7 },
    metadataStatus: { hasBpm: true, hasMood: true, hasEnergy: true, hasPopularity: true, missingFields: [] }, fallbacksApplied: [],
    personalizationScore: { personalizationAdjustment: 6.4, boundedBy: 12, applied: true },
    playlistIdentityScore: { applied: true, excluded: false, adjustment: 5.7, matchScore: 0.8, components: { mood: 3 }, reasons: ["Matches the identity's moody character."] },
    adaptiveScore: { baseScore: 76.8, personalizedScore: 88.4, appliedAdjustment: 12.1, cappedAdjustment: 12.1, maximumInfluence: 0.7, adjustmentWasCapped: false, confidence: "High", confidenceValue: 0.82, enabled: true, statusMessage: "Adaptive scoring applied.", components: [{ key: "playlistIdentity", label: "Playlist identity", rawAdjustment: 5.7, appliedAdjustment: 5.7, confidence: "High", confidenceValue: 0.8, reasons: [{ message: "Matches the identity's moody character.", adjustment: 5.7, source: "Playlist identity", scope: "playlist", confidence: "High", confidenceValue: 0.8, explicit: false }] }] },
    smartMixSelectionTrace: { position: 1, selectionScore: 88.4, transitionAdjustment: 3.1, transitionFeedbackAdjustment: 0, varietyPenalty: 3.6, discoveryAdjustment: 2, moodAdjustment: 0, coordinationAdjustment: 0, comparisonCandidateId: "track-b", comparisonCandidateTitle: "Runner Up", scoreMargin: 6.4, previousTrackId: "track-prev", previousTrackTitle: "Previous Track" },
    bpmTransitionFromPrevious: { fromBpm: 104, toBpm: 108, rawGap: 4, effectiveGap: 4, relationship: "direct", direction: "up", difficulty: "Easy", score: 91, directionConflict: false, exceedsPreferredGap: false, reason: "Smooth transition." },
    ...overrides,
  } as any;
}

test("factor generation preserves actual positive and negative score contributions", () => {
  const factors = factorsFromScoredTrack(track());
  assert.equal(factors.find((item) => item.code === "MOOD_MATCH")?.weightedContribution, 14.2);
  assert.equal(factors.find((item) => item.code === "ENERGY_MATCH")?.weightedContribution, -2.8);
  assert.ok(factors.some((item) => item.code === "BPM_TRANSITION"));
  assert.ok(factors.some((item) => item.code === "ARTIST_ALBUM_REPETITION"));
});

test("selected explanation separates base, personalization, identity, transition, penalties, and final score", () => {
  const explanation = buildDecisionExplanation({ track: track(), generationId: "generation-1", decision: "selected", rank: 1 });
  assert.equal(explanation.decision, "selected");
  assert.equal(explanation.scores.baseScore, 76.8);
  assert.equal(explanation.scores.personalizationAdjustment, 6.4);
  assert.equal(explanation.scores.playlistIdentityAdjustment, 5.7);
  assert.equal(explanation.scores.transitionAdjustment, 3.1);
  assert.equal(explanation.scores.finalScore, 88.4);
  assert.match(explanation.summary, /Selected at rank 1/);
});

test("hard rejection explanation retains stage and stable reason code", () => {
  const explanation = buildDecisionExplanation({ track: track({ exclusionReason: "PLAYBACK_RECENT" }), generationId: "generation-1", decision: "rejected", rejectionCode: "PLAYBACK_RECENT" });
  assert.equal(explanation.rejectionStage, "rule_filtering");
  assert.equal(explanation.rejectionCode, "PLAYBACK_RECENT");
  assert.equal(explanation.hardFilterResults[0].passed, false);
});

test("soft rejection names the winning candidate and score difference", () => {
  const loser = track({ id: "track-b", title: "Runner Up", score: 80, smartMixSelectionTrace: undefined });
  const explanation = buildDecisionExplanation({ track: loser, generationId: "generation-1", decision: "rejected", winner: track() });
  assert.equal(explanation.rejectionStage, "final_ranking");
  assert.equal(explanation.comparisons[0].candidateId, "track-a");
  assert.equal(explanation.comparisons[0].scoreDifference, 8.4);
});

test("personalization cap state is disclosed", () => {
  const explanation = buildDecisionExplanation({ track: track({ adaptiveScore: { ...track().adaptiveScore, adjustmentWasCapped: true, appliedAdjustment: 5, cappedAdjustment: 5, maximumInfluence: 0.5, components: [] } }), generationId: "g", decision: "selected" });
  assert.equal(explanation.personalization.adjustmentWasCapped, true);
  assert.equal(explanation.personalization.maximumInfluence, 0.5);
  assert.equal(explanation.scores.personalizationAdjustment, 5);
});

test("playlist identity support and conflicts use actual adjustment", () => {
  assert.equal(buildDecisionExplanation({ track: track(), generationId: "g", decision: "selected" }).playlistIdentity.influence, "moderately_supportive");
  const conflicting = track({ playlistIdentityScore: { ...track().playlistIdentityScore, adjustment: -8, reasons: ["Outside the preferred identity range."] }, adaptiveScore: { ...track().adaptiveScore, appliedAdjustment: -8, cappedAdjustment: -8, components: [{ ...track().adaptiveScore.components[0], rawAdjustment: -8, appliedAdjustment: -8 }] } });
  assert.equal(buildDecisionExplanation({ track: conflicting, generationId: "g", decision: "rejected" }).playlistIdentity.influence, "strongly_conflicting");
});

test("half-time and double-time transition behavior is serialized", () => {
  const explanation = buildDecisionExplanation({ track: track({ bpmTransitionFromPrevious: { ...track().bpmTransitionFromPrevious, fromBpm: 70, toBpm: 140, rawGap: 70, effectiveGap: 0, relationship: "double-time" } }), generationId: "g", decision: "selected" });
  assert.equal(explanation.transition?.relationship, "double-time");
  assert.equal(explanation.transition?.effectiveBpmDifference, 0);
});

test("missing metadata creates stable fallbacks, confidence deductions, and relevant fixes", () => {
  const incomplete = track({ metadataStatus: { hasBpm: false, hasMood: true, hasEnergy: false, hasPopularity: true, missingFields: ["bpm", "energy"] }, fallbacksApplied: ["BPM missing: used mood and energy", "energy unavailable: used BPM and mood"], scoreBreakdown: { ...track().scoreBreakdown, fallbackPenalty: -6 } });
  const explanation = buildDecisionExplanation({ track: incomplete, generationId: "g", decision: "selected" });
  assert.deepEqual(fallbacksFromScoredTrack(incomplete).map((item) => item.code), ["BPM_UNAVAILABLE", "ENERGY_UNAVAILABLE"]);
  assert.ok(explanation.confidence.score < 100);
  assert.ok(explanation.suggestedFixes.some((fix) => fix.code === "FIX_BPM"));
});

test("confidence is deterministic and independent from final score", () => {
  const highScoreLowEvidence = track({ score: 99, metadataStatus: { hasBpm: false, hasMood: false, hasEnergy: false, hasPopularity: false, missingFields: ["bpm", "mood", "energy", "popularity"] }, fallbacksApplied: ["bpm unavailable", "mood unavailable", "energy unavailable", "popularity unavailable"] });
  const first = calculateRecommendationConfidence(highScoreLowEvidence);
  const second = calculateRecommendationConfidence(highScoreLowEvidence);
  assert.deepEqual(first, second);
  assert.ok(first.score <= 40);
});

test("candidate comparison aligns factor rows by stable code", () => {
  const left = buildDecisionExplanation({ track: track(), generationId: "g", decision: "selected" });
  const right = buildDecisionExplanation({ track: track({ id: "track-b", title: "Runner Up", score: 82, smartMixSelectionTrace: { ...track().smartMixSelectionTrace, selectionScore: 82 } }), generationId: "g", decision: "rejected" });
  const comparison = compareDecisionExplanations(left, right);
  assert.equal(comparison.margin, 6.4);
  assert.ok(comparison.factors.some((row) => row.code === "MOOD_MATCH"));
});

test("generation insights aggregate confidence, factors, fallbacks, and metadata", () => {
  const selected = buildDecisionExplanation({ track: track(), generationId: "g", decision: "selected" });
  const rejected = buildDecisionExplanation({ track: track({ id: "track-b", title: "Runner Up", score: 80 }), generationId: "g", decision: "rejected", rejectionCode: "RANKED_BELOW_CUTOFF" });
  const insights = buildGenerationInsights("g", [selected, rejected], { evaluated: 2481, eligible: 614, hardRejected: 1867 });
  assert.equal(insights.candidatesEvaluated, 2481);
  assert.equal(insights.hardRejectedCount, 1867);
  assert.equal(insights.selectedCount, 1);
  assert.equal(insights.rejectionReasons[0].code, "RANKED_BELOW_CUTOFF");
});

test("explanations serialize without losing stable fields", () => {
  const explanation = buildDecisionExplanation({ track: track(), generationId: "g", decision: "selected" });
  assert.deepEqual(JSON.parse(JSON.stringify(explanation)), explanation);
  assert.equal(explanation.schemaVersion, 1);
});

test("retention defaults cap rejected candidates and full traces", () => {
  assert.equal(DEFAULT_REJECTED_CANDIDATE_LIMIT, 100);
  assert.equal(DEFAULT_REJECTED_RETENTION_DAYS, 30);
});

test("all explanation APIs enforce session ownership at the route boundary", () => {
  const root = process.cwd();
  const files = [
    "src/app/api/smart-mix-explanations/tracks/[trackId]/route.ts",
    "src/app/api/smart-mix-explanations/generations/[generationId]/insights/route.ts",
    "src/app/api/smart-mix-explanations/generations/[generationId]/candidates/route.ts",
    "src/app/api/smart-mix-explanations/compare/route.ts",
    "src/app/api/smart-mix-explanations/generations/[generationId]/export/route.ts",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /mixarr_session/);
    assert.match(source, /Unauthorized/);
    assert.match(source, /userId/);
  }
});

test("migration is additive, bounded, and indexed for explanation queries", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260716120000_smart_mix_explanations/migration.sql"), "utf8");
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
  assert.match(migration, /generationId.*decision.*rank/);
  assert.match(migration, /userId.*trackId.*createdAt/);
  assert.match(migration, /generatedPlaylistId.*decision/);
  assert.match(migration, /expiresAt_idx/);
});

test("playlist versions preserve immutable explanation snapshots", () => {
  const snapshot = fs.readFileSync(path.join(process.cwd(), "src/lib/playlists/versions/playlist-version-snapshot.ts"), "utf8");
  assert.match(snapshot, /explanationSnapshot: track\.explanationJson/);
  assert.match(snapshot, /explanationSnapshot: z\.record/);
});

test("explanation UI exposes accessible dialog tabs, empty states, and mobile layout", () => {
  const component = fs.readFileSync(path.join(process.cwd(), "src/components/SmartMixExplanation.tsx"), "utf8");
  const css = fs.readFileSync(path.join(process.cwd(), "src/components/SmartMixExplanation.module.css"), "utf8");
  assert.match(component, /role="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /Summary.*Scores.*Transition.*Metadata.*Advanced/);
  assert.match(component, /historical Smart Mix v1 playlist or an expired candidate trace/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(css, /@media\(max-width:640px\)/);
});
