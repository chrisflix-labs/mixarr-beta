import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptNumericRanges,
  applyAdaptiveMappings,
  buildAnalysisWarnings,
  buildVocabularyMappings,
  calculateCompatibility,
  classifyIdentityImpact,
  mergeMappingEdits,
  normalizeRecipeVocabulary,
  vocabularySimilarity,
  type LibraryRecipeProfile,
} from "./adaptiveRecipeMapping";
import { defaultMixRecipeDocument, resolveRecipeGenerationConfig } from "./mixRecipes/schema";

function profile(patch: Partial<LibraryRecipeProfile> = {}): LibraryRecipeProfile {
  return {
    libraryId: "library-a", libraryName: "Music", totalTracks: 1000,
    genres: [{ value: "Electronic", normalized: "electronic", trackCount: 400 }, { value: "Retrowave", normalized: "retrowave", trackCount: 120 }, { value: "Synthpop", normalized: "synthpop", trackCount: 180 }],
    moods: [{ value: "Ambient", normalized: "ambient", trackCount: 200 }, { value: "Dreamy", normalized: "dreamy", trackCount: 150 }],
    artists: [{ value: "CHVRCHES", normalized: "chvrche", trackCount: 30 }],
    bpmCoverage: .8, energyCoverage: .7, moodCoverage: .65, popularityCoverage: .9, audioFeatureCoverage: .75,
    bpmMinimum: 60, bpmMaximum: 190, bpmAverage: 118, energyMinimum: .05, energyMaximum: .98, energyAverage: .55,
    savedMappings: [], ...patch,
  };
}

function recipe(rules: any[] = []) {
  return defaultMixRecipeDocument({ name: "Neon Highway", category: "Driving" }, { engineVersion: "v2", limit: 50, rules });
}

test("normalization is case, punctuation, ampersand, and plural tolerant", () => {
  assert.equal(normalizeRecipeVocabulary("  Rhythm & Blues!  "), "rhythm and blue");
  assert.equal(normalizeRecipeVocabulary("SOUNDTRACKS"), "soundtrack");
  assert.ok(vocabularySimilarity("Hip-Hop", "hip hop") > .9);
});

test("exact and normalized genre matches are deterministic", () => {
  const exact = buildVocabularyMappings(recipe([{ field: "genre", operator: "contains", value: "Electronic" }]), profile());
  assert.equal(exact[0].status, "exact_match");
  const normalized = buildVocabularyMappings(recipe([{ field: "genre", operator: "contains", value: "electronic!" }]), profile());
  assert.equal(normalized[0].status, "normalized_match");
  assert.deepEqual(buildVocabularyMappings(recipe([{ field: "genre", operator: "contains", value: "electronic!" }]), profile()), normalized);
});

test("confirmed saved mappings take precedence over automatic aliases", () => {
  const mappings = buildVocabularyMappings(recipe([{ field: "genre", operator: "contains", value: "Synthwave" }]), profile({ savedMappings: [{ mappingType: "genre", sourceValueNormalized: "synthwave", destinationValues: ["Electronic"], confidence: 1, manuallyConfirmed: true, libraryId: "library-a" }] }));
  assert.equal(mappings[0].status, "saved_mapping");
  assert.deepEqual(mappings[0].mappedValues, ["Electronic"]);
});

test("genre aliases support one-to-many mappings without changing AND semantics", () => {
  const source = recipe([{ field: "genre", operator: "contains", value: "Synthwave" }, { field: "artist", operator: "not_contains", value: "Unavailable" }]);
  const mappings = buildVocabularyMappings(source, profile());
  assert.deepEqual(mappings.find((item) => item.mappingType === "genre")?.mappedValues, ["Retrowave", "Synthpop", "Electronic"]);
  const adapted = applyAdaptiveMappings(source, mappings);
  assert.equal(adapted.generation.rules.length, 0);
  assert.equal((adapted.generation.ruleTree as any).combinator, "AND");
  assert.equal((adapted.generation.ruleTree as any).children[0].combinator, "OR");
  const resolved = resolveRecipeGenerationConfig(adapted);
  assert.equal((resolved.ruleTree as any).children[0].children[0].combinator, "OR");
});

test("mood aliases use the existing recipe mood targets", () => {
  const source = recipe(); source.targets.selectedMoods = ["Atmospheric"]; source.targets.primaryMood = "Atmospheric"; source.targets.strictMoodMatching = true;
  const mappings = buildVocabularyMappings(source, profile());
  const mood = mappings.find((item) => item.mappingType === "mood")!;
  assert.equal(mood.status, "multiple_possible_matches");
  assert.deepEqual(mood.mappedValues, ["Ambient", "Dreamy"]);
  assert.deepEqual(applyAdaptiveMappings(source, mappings).targets.selectedMoods, ["Ambient", "Dreamy"]);
});

test("BPM and energy range adaptation stays conservative", () => {
  const source = recipe(); source.bpmFlow.minimumBpm = 105; source.bpmFlow.maximumBpm = 115; source.targets.minimumEnergy = .7; source.targets.maximumEnergy = .9;
  const mappings = adaptNumericRanges(source, profile({ energyCoverage: .4 }), 28);
  assert.deepEqual(mappings.find((item) => item.mappingType === "bpm")?.mappedValues, ["100", "120"]);
  assert.deepEqual(mappings.find((item) => item.mappingType === "energy")?.mappedValues, ["0.64", "0.96"]);
  const adapted = applyAdaptiveMappings(source, mappings);
  assert.equal(adapted.bpmFlow.minimumBpm, 100); assert.equal(adapted.targets.minimumEnergy, .64);
});

test("unavailable excluded artists do not reduce compatibility", () => {
  const mappings = buildVocabularyMappings(recipe([{ field: "artist", operator: "not_contains", value: "Not Here" }]), profile());
  assert.equal(mappings[0].status, "no_mapping_required");
  const result = calculateCompatibility({ mappings, profile: profile(), originalCandidates: 500, adaptedCandidates: 500, requestedLength: 50 });
  assert.equal(result.breakdown.artistAvailability, 100);
});

test("required constraints carry more penalty than optional preferences", () => {
  const required = buildVocabularyMappings(recipe([{ field: "artist", operator: "contains", value: "Missing" }]), profile());
  const optionalRecipe = recipe(); optionalRecipe.playlistIdentity.preferredArtists = ["Missing"];
  const optional = buildVocabularyMappings(optionalRecipe, profile());
  const requiredScore = calculateCompatibility({ mappings: required, profile: profile(), originalCandidates: 0, adaptedCandidates: 0, requestedLength: 50 }).score;
  const optionalScore = calculateCompatibility({ mappings: optional, profile: profile(), originalCandidates: 0, adaptedCandidates: 0, requestedLength: 50 }).score;
  assert.ok(requiredScore < optionalScore);
});

test("metadata and candidate-ratio warnings explain recovery", () => {
  const source = recipe(); source.targets.selectedMoods = ["Ambient"]; source.targets.minimumEnergy = .7; source.bpmFlow.minimumBpm = 105;
  const weakProfile = profile({ moodCoverage: .1, energyCoverage: .2, bpmCoverage: .25 });
  const warnings = buildAnalysisWarnings(source, weakProfile, buildVocabularyMappings(source, weakProfile), 20, 30);
  assert.ok(warnings.some((item) => item.category === "mood"));
  assert.ok(warnings.some((item) => item.category === "energy"));
  assert.ok(warnings.some((item) => item.category === "candidates" && item.severity === "high_risk"));
});

test("major identity changes require an unavailable required constraint", () => {
  const mappings = buildVocabularyMappings(recipe([{ field: "genre", operator: "contains", value: "No Such Genre" }]), profile());
  const disabled = mergeMappingEdits(mappings, [{ id: mappings[0].id, action: "disable", mappedValues: [] }]);
  assert.equal(classifyIdentityImpact(disabled), "major");
});

test("manual mapping edits and reset baselines do not mutate the original plan", () => {
  const baseline = buildVocabularyMappings(recipe([{ field: "genre", operator: "contains", value: "Synthwave" }]), profile());
  const changed = mergeMappingEdits(baseline, [{ id: baseline[0].id, action: "disable", mappedValues: [], saveForFuture: true }]);
  assert.equal(changed[0].action, "disable"); assert.equal(changed[0].saveForFuture, true);
  assert.equal(baseline[0].action, "accept"); assert.equal(baseline[0].saveForFuture, false);
});

test("compatibility scoring is deterministic and not a simple average", () => {
  const source = recipe([{ field: "genre", operator: "contains", value: "Electronic" }]);
  const mappings = buildVocabularyMappings(source, profile());
  const unevenProfile = profile({ popularityCoverage: .2 });
  const first = calculateCompatibility({ mappings, profile: unevenProfile, originalCandidates: 170, adaptedCandidates: 170, requestedLength: 50 });
  const second = calculateCompatibility({ mappings, profile: unevenProfile, originalCandidates: 170, adaptedCandidates: 170, requestedLength: 50 });
  assert.deepEqual(first, second);
  const simpleAverage = Math.round(Object.values(first.breakdown).reduce((sum, value) => sum + value, 0) / Object.values(first.breakdown).length);
  assert.notEqual(first.score, simpleAverage);
});
