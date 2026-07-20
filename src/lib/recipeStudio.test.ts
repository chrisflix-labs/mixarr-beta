import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeRecipeCompatibility, applyGuidedRecipeAnswers, compareRecipeDocuments, defaultRecipeStudioDraft,
  energyCurvePreset, estimateRecipeCandidates, hasAdvancedRecipeSettings, previewDiscoveryAndVariety,
  previewScoringImpact, validateBpmFlow, validateCurve,
} from "./recipeStudio";

const profile = { libraryId: "library-1", libraryName: "Music", totalTracks: 10_000, bpmTracks: 7_800, energyTracks: 8_000, moodTracks: 6_200, popularityTracks: 9_000, uniqueArtists: 1_400, uniqueAlbums: 3_200, explicitTracks: 400, liveTracks: 300, holidayTracks: 100 };

describe("Recipe Studio core", () => {
  it("maps guided answers into the shared advanced recipe document without dropping advanced fields", () => {
    const source: Record<string, any> = { ...defaultRecipeStudioDraft(), advancedOnly: { preserved: true } };
    const result = applyGuidedRecipeAnswers(source, { mixStyle: "workout", libraryId: "library-1", trackCount: 80, discoveryBalance: "exploratory", energyShape: "rising", smoothBpm: true, artistRepetition: "low", refresh: "weekly", requireApproval: false, household: true, insufficientCandidates: "allow_fallback" });
    assert.equal(result.filters.limit, 80);
    assert.equal(result.filters.personalizationMode, "HOUSEHOLD");
    assert.equal(result.bpmFlow.mode, "RAMP_UP");
    assert.equal(result.variety.maximumTracksPerArtist, 2);
    assert.deepEqual(result.advancedOnly, { preserved: true });
    assert.equal(source.filters.limit, 100);
  });

  it("validates accessible curve tables and catches duplicate positions", () => {
    assert.equal(validateCurve(energyCurvePreset("peak")).length, 0);
    assert.match(validateCurve([{ position: 0, value: 20 }, { position: 0, value: 80 }])[0].code, /duplicate/);
  });

  it("validates BPM ranges and section overlap", () => {
    const findings = validateBpmFlow({ minimumBpm: 130, maximumBpm: 100, sections: [{ start: 0, end: 60 }, { start: 50, end: 100 }] });
    assert.deepEqual(findings.map((finding) => finding.code), ["bpm.range", "bpm.sections_overlap"]);
  });

  it("returns bounded candidate estimates and fallback guidance", () => {
    const recipe = defaultRecipeStudioDraft();
    recipe.filters.limit = 100;
    recipe.bpmFlow.mode = "NATURAL";
    recipe.bpmFlow.minimumBpm = 100;
    recipe.bpmFlow.maximumBpm = 140;
    const result = estimateRecipeCandidates(recipe, profile);
    assert.equal(result.evaluatedTracks, 10_000);
    assert.ok(result.matchingCandidates >= 0 && result.matchingCandidates <= 10_000);
    assert.equal(typeof result.fallbackLikely, "boolean");
  });

  it("provides actionable compatibility states from actual metadata coverage", () => {
    const recipe = defaultRecipeStudioDraft();
    recipe.bpmFlow.mode = "NATURAL";
    const result = analyzeRecipeCompatibility(recipe, profile);
    assert.equal(result.status, "fully_compatible");
    const strict = analyzeRecipeCompatibility({ ...recipe, filters: { ...recipe.filters, limit: 20_000 } }, profile);
    assert.equal(strict.status, "partially_compatible");
    assert.ok(strict.findings.some((finding) => finding.remediation));
  });

  it("explains scoring conflicts and discovery estimates", () => {
    const recipe = defaultRecipeStudioDraft();
    recipe.scoring.popularityWeight = 90;
    recipe.scoring.discoveryWeight = 90;
    assert.equal(previewScoringImpact(recipe).conflicts[0].code, "scoring.popularity_discovery");
    const discovery = previewDiscoveryAndVariety(recipe, profile);
    assert.equal(discovery.familiarFavorites + discovery.rediscovery + discovery.newOrRare, 100);
  });

  it("generates grouped recursive comparisons", () => {
    const differences = compareRecipeDocuments({ scoring: { mood: 20 }, enabled: true }, { scoring: { mood: 80 }, enabled: false });
    assert.deepEqual(differences.map((difference) => difference.path), ["enabled", "scoring.mood"]);
    assert.equal(differences[1].section, "scoring");
  });

  it("detects settings that beginner mode cannot represent", () => {
    assert.equal(hasAdvancedRecipeSettings(defaultRecipeStudioDraft()), false);
    assert.equal(hasAdvancedRecipeSettings({ ...defaultRecipeStudioDraft(), inheritanceEnabled: true }), true);
  });
});
