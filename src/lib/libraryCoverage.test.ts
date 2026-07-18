import test from "node:test";
import assert from "node:assert/strict";
import { applyCoverageInfluence, calculateOpportunityScore, calculateOveruseScore, calculateRotationFairness, decadeForYear } from "./libraryCoverageCore";

test("high-quality never-selected tracks receive an explainable opportunity score", () => {
  const result = calculateOpportunityScore({ eligible: true, analyzed: true, selectionCount: 0, rejectionCount: 0, baseQualityScore: 88, personalizedQualityScore: 84, metadataConfidence: 94, audioFeatureConfidence: 90, compatibilityPotential: 86, artistUnused: true, daysSinceAdded: 400 });
  assert.ok(result.score >= 80);
  assert.ok(result.reasons.some((reason) => reason.includes("never appeared")));
});

test("neglect never bypasses low confidence or eligibility", () => {
  assert.equal(calculateOpportunityScore({ eligible: false, analyzed: true, selectionCount: 0, rejectionCount: 0, baseQualityScore: 100, metadataConfidence: 100, audioFeatureConfidence: 100, compatibilityPotential: 100 }).score, 0);
  const weak = calculateOpportunityScore({ eligible: true, analyzed: true, selectionCount: 0, rejectionCount: 4, baseQualityScore: 35, metadataConfidence: 20, audioFeatureConfidence: 10, compatibilityPotential: 20 });
  assert.ok(weak.score < 40);
});

test("overuse explains exemptions for intentional favorites", () => {
  const regular = calculateOveruseScore({ selectionCount: 20, uniquePlaylistCount: 6, recentSelectionCount: 8, averageSelectionCount: 2, generationVolume: 30 });
  const favorite = calculateOveruseScore({ selectionCount: 20, uniquePlaylistCount: 6, recentSelectionCount: 8, averageSelectionCount: 2, generationVolume: 30, liked: true });
  assert.ok(regular.score > favorite.score);
  assert.equal(favorite.exempt, true);
});

test("coverage influence is disabled and quality-gated by default", () => {
  assert.equal(applyCoverageInfluence(70, { enabled: false, eligible: true, qualityPassed: true, maximumBoost: 3, opportunityScore: 100, overuseScore: 0 }).finalScore, 70);
  assert.equal(applyCoverageInfluence(70, { enabled: true, eligible: true, qualityPassed: false, maximumBoost: 3, opportunityScore: 100, overuseScore: 0 }).finalScore, 70);
  assert.equal(applyCoverageInfluence(70, { enabled: true, eligible: true, qualityPassed: true, maximumBoost: 3, opportunityScore: 100, overuseScore: 0 }).finalScore, 73);
});

test("fairness and decade calculations retain unknown years", () => {
  const concentrated = calculateRotationFairness([100, 0, 0, 0, 0, 0]);
  const broad = calculateRotationFairness([10, 9, 10, 8, 9, 10]);
  assert.ok(broad.score > concentrated.score);
  assert.deepEqual(decadeForYear(null), { key: "unknown", label: "Unknown year" });
  assert.deepEqual(decadeForYear(1987), { key: "1980", label: "1980s" });
});
