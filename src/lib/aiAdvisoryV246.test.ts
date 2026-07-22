import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  AI_METADATA_WRITES_ENABLED, analyzePlaylist, assertMetadataWritesDisabled, detectMetadataCandidates,
  ignoreRuleMatches, privacyAwarePlaylistPayload, responseReferencesOnlySubmittedCandidates,
  suggestionFingerprint, validateSummaryEvidence,
} from "./aiAdvisory/core";
import { aiMetadataCandidateResponseSchema, summaryProviderResponseSchema } from "./aiAdvisory/contracts";

const tracks = [
  { id: "1", title: "Opening", artist: "The Weeknd", album: "Night", albumId: "a", duration: 180000, bpm: 90, energy: .3, year: 2019, genres: ["Electronic"], moods: ["Mellow"], familiar: true, recentlyAdded: false },
  { id: "2", title: "Middle (Remix)", artist: "the  weeknd ", album: "Night", albumId: "a", duration: 210000, bpm: 110, energy: .55, year: 2020, genres: ["Electronica"], moods: ["Mellow"], familiar: false, recentlyAdded: true },
  { id: "3", title: "Finale", artist: "Another Artist", album: "Day", albumId: "b", duration: 240000, bpm: 130, energy: .8, year: 2021, genres: ["Electronic"], moods: [], familiar: false, recentlyAdded: true },
];

describe("Mixarr v2.4.6 playlist analysis", () => {
  it("builds deterministic factual aggregates and refresh differences", () => {
    const result = analyzePlaylist({ playlist: { id: "p", name: "Evening" }, tracks, previous: { trackIds: ["1", "old"], durationMs: 300000, uniqueArtists: 1, averageBpm: 80, averageEnergy: .2 } });
    assert.equal(result.facts.trackCount, 3); assert.equal(result.facts.durationMs, 630000); assert.equal(result.facts.averageBpm, 110);
    assert.deepEqual(result.facts.bpmProgression, [90, 110, 130]); assert.deepEqual(result.facts.change, { addedCount: 2, removedCount: 1, retainedCount: 1, durationDeltaMs: 330000, uniqueArtistDelta: 1, averageBpmDelta: 30, averageEnergyDelta: 0.35 });
  });
  it("limits Metadata Limited to aggregates and anonymizes track context", () => {
    const analysis = analyzePlaylist({ playlist: { id: "p", name: "Evening" }, tracks });
    const limited = privacyAwarePlaylistPayload(analysis, tracks, "METADATA_LIMITED", false), anonymous = privacyAwarePlaylistPayload(analysis, tracks, "ANONYMOUS_METADATA", false), fullBlocked = privacyAwarePlaylistPayload(analysis, tracks, "FULL_METADATA", false);
    assert.equal(limited.aggregateOnly, true); assert.doesNotMatch(JSON.stringify(limited.payload), /Opening|Weeknd/);
    assert.match(JSON.stringify(anonymous.payload), /"sequence":1/); assert.doesNotMatch(JSON.stringify(anonymous.payload), /Opening|Weeknd/);
    assert.equal(fullBlocked.aggregateOnly, true); assert.ok(fullBlocked.blockedFields.includes("full_track_metadata_disabled_by_setting"));
  });
  it("rejects unsupported claims and overlong or formatted Plex descriptions", () => {
    assert.throws(() => validateSummaryEvidence("BPM_PROGRESSION", "The BPM rises steadily.", { averageBpm: null }), /unsupported/i);
    assert.throws(() => validateSummaryEvidence("PLEX_FRIENDLY", "**Great mix**", { genreDistribution: { Rock: 2 } }, 500), /formatting/i);
    assert.throws(() => validateSummaryEvidence("PLEX_FRIENDLY", "A".repeat(101), {}, 100), /exceeds/i);
  });
  it("accepts strict structured summary output only", () => {
    assert.equal(summaryProviderResponseSchema.parse({ schemaVersion: "1.0", summaries: [{ type: "ONE_SENTENCE", text: "Three tracks.", usedFacts: ["trackCount"], unavailableFacts: [] }] }).summaries.length, 1);
    assert.throws(() => summaryProviderResponseSchema.parse({ schemaVersion: "1.0", summaries: [{ type: "ONE_SENTENCE", text: "Okay", toolCall: "delete" }] }));
  });
});

describe("Mixarr v2.4.6 metadata suggestion safety", () => {
  it("detects deterministic variants, conflicts, version labels, and missing mood candidates", () => {
    const candidates = detectMetadataCandidates(tracks);
    assert.ok(candidates.some((item) => item.suggestionType === "INCONSISTENT_ARTIST_NAME"));
    assert.ok(candidates.some((item) => item.suggestionType === "CONFLICTING_RELEASE_YEAR" && item.confidenceLevel === "CONFLICTING_SOURCES"));
    assert.ok(candidates.some((item) => item.suggestionType === "VERSION_LABEL"));
    assert.ok(candidates.every((item) => item.plexImpact && item.sourceLibraryImpact && item.embeddedTagImpact));
  });
  it("creates stable fingerprints and matches scoped ignore rules", () => {
    const item = detectMetadataCandidates(tracks)[0], left = suggestionFingerprint(item), right = suggestionFingerprint({ ...item, trackIds: [...item.trackIds].reverse() });
    assert.equal(left, right); assert.equal(ignoreRuleMatches(item, "SUGGESTION_TYPE", { suggestionType: item.suggestionType }), true); assert.equal(ignoreRuleMatches(item, "METADATA_FIELD", { field: "unrelated" }), false);
  });
  it("rejects candidate references outside the submitted batch and executable response fields", () => {
    assert.equal(responseReferencesOnlySubmittedCandidates(["a", "b"], ["a"]), true); assert.equal(responseReferencesOnlySubmittedCandidates(["a"], ["outside"]), false); assert.equal(responseReferencesOnlySubmittedCandidates(["a"], ["a", "a"]), false);
    assert.throws(() => aiMetadataCandidateResponseSchema.parse({ schemaVersion: "1.0", suggestions: [{ candidateId: "f3eddf98-85b6-4c9a-86f6-17d69973601a", suggestedValue: "x", reason: "r", confidenceScore: .9, confidenceLevel: "HIGH", sourceSupport: [], advisoryOnly: true, execute: "write_tags" }] }));
  });
  it("hard-codes the no-write boundary", () => { assert.equal(AI_METADATA_WRITES_ENABLED, false); assert.equal(assertMetadataWritesDisabled(), true); });
  it("approval and bulk approval update review state without calling metadata writers", () => {
    const service = readFileSync("src/lib/aiAdvisory/service.ts", "utf8"), approve = service.slice(service.indexOf("export async function reviewMetadataSuggestion"), service.indexOf("export async function listIgnoreRules"));
    assert.match(approve, /assertMetadataWritesDisabled/); assert.match(approve, /metadataSuggestionReview\.create/); assert.match(approve, /metadataModified: false/);
    assert.doesNotMatch(approve, /pushTracksToPlex|writeFile|rename|metadataCorrectionService|embedded|plexApi|axios/);
  });
  it("routes enforce named permissions and selection equality", () => {
    const service = readFileSync("src/lib/aiAdvisory/service.ts", "utf8"), permissions = readFileSync("src/lib/aiAdvisory/permissions.ts", "utf8");
    for (const permission of ["ai.summary.view", "ai.summary.generate", "ai.summary.manage", "ai.metadata_suggestions.view", "ai.metadata_suggestions.generate", "ai.metadata_suggestions.review", "ai.metadata_suggestions.export", "ai.metadata_suggestions.manage_ignore_rules"]) assert.match(permissions + service, new RegExp(permission.replace(".", "\\.")));
    assert.match(service, /rows\.length !== ids\.length/); assert.match(service, /SELECTION_SCOPE_MISMATCH/);
  });
  it("migration is additive, indexed, disabled by default, and contains no scan trigger", () => {
    const migration = readFileSync("prisma/migrations/20260724010000_ai_playlist_summaries_metadata_suggestions_v246/migration.sql", "utf8"), schema = readFileSync("prisma/schema.prisma", "utf8");
    for (const table of ["PlaylistAiSummary", "PlaylistAnalysisSnapshot", "MetadataAnalysisJob", "MetadataSuggestion", "MetadataIgnoreRule"]) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
    assert.match(migration, /'metadata_suggestions', false, true/); assert.doesNotMatch(migration, /CREATE TRIGGER|pushTracksToPlex|UPDATE "Track"|UPDATE "GeneratedPlaylistTrack"/);
    assert.match(schema, /@@unique\(\[ownerId, fingerprint\]\)/); assert.match(schema, /confidenceLevel, confidenceScore/);
  });
  it("UI labels approved suggestions as not applied and exposes no Apply to Plex action", () => {
    const ui = readFileSync("src/components/AiMetadataSuggestions.tsx", "utf8") + readFileSync("src/components/PlaylistAiSummaries.tsx", "utf8");
    assert.match(ui, /Approved suggestion — not applied/); assert.match(ui, /Copy for Plex/); assert.doesNotMatch(ui, />Apply to Plex</);
  });
});

