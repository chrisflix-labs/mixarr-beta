import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultMixRecipeDocument } from "./mixRecipes/schema";
import { confidenceLabel, naturalLanguageInterpretationSchema } from "./naturalLanguageRequests/contracts";
import { interpretationRequiresClarification, mergeRecipePatch } from "./naturalLanguageRequests/normalization";

function read(path: string) { return readFileSync(join(process.cwd(), path), "utf8"); }
function response(overrides: Record<string, unknown> = {}) {
  return {
    detectedLanguage: "en", intent: "create_playlist", summary: "A calm coding mix.", confidence: { overall: 1.4, duration: -0.2 },
    explicitConstraints: [{ id: "explicit-1", field: "activity", value: "coding", originalWording: "coding playlist", explanation: "Coding was directly requested.", confidence: .95 }],
    inferredConstraints: [{ id: "inferred-1", field: "vocalPreference", value: "low", originalWording: "focused", explanation: "Low vocals may support focus.", confidence: .62 }],
    assumptions: [{ id: "assumption-1", field: "trackCount", proposedValue: 47, originalPhrase: null, explanation: "No duration was supplied, so a reviewable size was proposed.", confidence: .45, blocking: false, accepted: false }],
    ambiguities: [], unresolvedEntities: [], unsupportedRequests: [],
    recipePatch: { metadata: { name: "Coding Flow", category: "Focus" }, generation: { limit: 47 }, targets: { energyProgression: "rising" }, bpmFlow: {}, discovery: {}, variety: {}, refreshPolicy: { mode: "manual" } }, warnings: [], ...overrides,
  };
}

describe("natural-language playlist interpretation", () => {
  it("validates strict provider output, normalizes confidence, and preserves explicit versus inferred origin", () => {
    const parsed = naturalLanguageInterpretationSchema.parse(response());
    assert.equal(parsed.confidence.overall, 1); assert.equal(parsed.confidence.duration, 0);
    assert.equal(parsed.explicitConstraints[0].originalWording, "coding playlist");
    assert.equal(parsed.inferredConstraints[0].field, "vocalPreference");
    assert.equal(confidenceLabel(.79), "Medium");
  });

  it("rejects malformed, unsupported, and provider-invented recipe fields", () => {
    assert.equal(naturalLanguageInterpretationSchema.safeParse(response({ secretReasoning: "hidden" })).success, false);
    const invalid = response(); (invalid.recipePatch as any).generation.trackIds = ["invented"];
    assert.equal(naturalLanguageInterpretationSchema.safeParse(invalid).success, false);
  });

  it("maps only safe fields into the canonical recipe and forces mutation controls off", () => {
    const base = defaultMixRecipeDocument({ name: "Base", category: "Custom" }, { engineVersion: "v2", limit: 100, rules: [], pinnedTrackIds: ["unsafe"], excludedTrackIds: ["unsafe"] });
    const interpretation = naturalLanguageInterpretationSchema.parse(response());
    const recipe = mergeRecipePatch(base, interpretation.recipePatch);
    assert.equal(recipe.metadata.name, "Coding Flow"); assert.equal(recipe.generation.limit, 47);
    assert.deepEqual(recipe.generation.pinnedTrackIds, []); assert.deepEqual(recipe.generation.excludedTrackIds, []);
    assert.equal(recipe.automationPolicy.enabled, false); assert.deepEqual(recipe.permissions, []); assert.equal(recipe.signature, null);
  });

  it("blocks unresolved entities, material ambiguities, and blocking assumptions", () => {
    const ambiguity = { id: "amb-1", originalPhrase: "no repeats", proposedInterpretation: "No repeated artists", reason: "Repeat scope is unclear.", alternatives: [], affectedFields: ["artistSpacing"], confidence: .4, requiresConfirmation: true, resolution: null };
    assert.equal(interpretationRequiresClarification(naturalLanguageInterpretationSchema.parse(response({ ambiguities: [ambiguity] }))), true);
    const assumption = { ...(response().assumptions as any[])[0], blocking: true };
    assert.equal(interpretationRequiresClarification(naturalLanguageInterpretationSchema.parse(response({ assumptions: [assumption] }))), true);
  });

  it("keeps approval, execution, privacy, and deterministic handoff authoritative on the server", () => {
    const service = read("src/lib/naturalLanguageRequests/service.ts");
    for (const marker of ["approvalRevision === row.currentRevision", "previewRevision !== row.currentRevision", "validateRecipe", "createPlaylistFromRecipe", "executionIdempotencyKey", "APPROVAL_INVALIDATED", "confirmAutomation: false", "unresolvedEntities.filter"]) assert.match(service, new RegExp(marker));
    const interpreter = read("src/lib/naturalLanguageRequests/interpreter.ts");
    assert.match(interpreter, /aiRequestCoordinator\.complete/); assert.match(interpreter, /responseFormat/); assert.match(interpreter, /pinnedTrackIds: \[\], excludedTrackIds: \[\]/); assert.match(interpreter, /providerDisplayName/);
    const coordinator = read("src/ai/request-coordinator/index.ts"); assert.match(coordinator, /parseStructuredResponse/); assert.match(coordinator, /reserveAiBudget/);
  });

  it("ships the complete request API, responsive review UI, migration, and documentation", () => {
    for (const route of ["route.ts", "[id]/route.ts", "[id]/interpret/route.ts", "[id]/revisions/route.ts", "[id]/analyze/route.ts", "[id]/preview/route.ts", "[id]/approve/route.ts", "[id]/save/route.ts", "[id]/execute/route.ts", "[id]/cancel/route.ts"]) assert.doesNotThrow(() => read(`src/app/api/natural-language-requests/${route}`));
    const ui = read("src/components/NaturalLanguageRequests.tsx"), css = read("src/components/NaturalLanguageRequests.module.css"), docs = read("docs/NATURAL_LANGUAGE_PLAYLIST_REQUESTS_V242.md"), migration = read("prisma/migrations/20260721180000_natural_language_playlist_requests/migration.sql");
    for (const marker of [/Review privacy & cost/, /Explicit requirements/, /Assumptions and ambiguities/, /Deterministic preview/, /Approve & create/, /Edit in Recipe Studio/]) assert.match(ui, marker);
    assert.match(css, /:focus-visible/); assert.match(css, /@media\(max-width:560px\)/);
    assert.match(docs, /AI interprets intent/i); assert.match(docs, /idempotency/i); assert.match(migration, /NaturalLanguageRequestRevision/);
    assert.equal(JSON.parse(read("package.json")).version, "2.4.23");
  });
});
