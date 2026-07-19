import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strFromU8 } from "fflate";
import { defaultMixRecipeDocument } from "./mixRecipes/schema";
import {
  addConflictAnalysis,
  buildBundleEnvelope,
  buildRecipeEnvelope,
  canonicalize,
  parseTransferJson,
  portableRecipePayloadFromDocument,
  publicImportPreview,
  redactBlockedCandidates,
  recipeChecksum,
  recipeContentChecksum,
  safeImportedName,
  safeRecipeFilename,
  scanSensitiveData,
  summarizePortableRecipe,
} from "./mixRecipes/transfer";
import { buildRecipeArchive, parseRecipeArchive, validateArchivePath, validateArtwork } from "./mixRecipes/archive";

function sampleDocument(name = "Late Night Highway") {
  return defaultMixRecipeDocument({ name, description: "Atmospheric driving mix", category: "Driving" }, {
    rules: [{ field: "genre", operator: "contains", value: "Electronic" }],
    limit: 50,
    serverId: "private-server",
    libraryId: "private-library",
    pinnedTrackIds: ["private-track"],
    excludedTrackIds: ["private-excluded-track"],
    allowedMoods: ["Atmospheric", "Energetic"],
    selectedMoodPath: ["Atmospheric"],
    engineVersion: "v2",
    negativeFilters: { excludeLive: true, excludePlayedWithinDays: 14 },
    safetyRules: { limitTracksPerArtist: true, maxTracksPerArtist: 2 },
  });
}

describe("Mixarr v2.3.1 recipe transfer", () => {
  it("uses a strict portable allowlist and excludes local identities", () => {
    const portable = portableRecipePayloadFromDocument(sampleDocument());
    const text = JSON.stringify(portable);
    assert.equal(text.includes("private-server"), false);
    assert.equal(text.includes("private-library"), false);
    assert.equal(text.includes("private-track"), false);
    assert.equal(text.includes("serverId"), false);
    assert.equal(text.includes("libraryId"), false);
    assert.equal(text.includes("sourcePlaylistId"), false);
    assert.equal(text.includes("slug"), false);
  });

  it("canonicalizes object keys and calculates timestamp-independent checksums", () => {
    assert.equal(canonicalize({ z: 1, a: { y: 2, b: 3 } }), canonicalize({ a: { b: 3, y: 2 }, z: 1 }));
    const portable = portableRecipePayloadFromDocument(sampleDocument());
    const first = buildRecipeEnvelope(portable, new Date("2026-07-19T10:00:00Z"));
    const second = buildRecipeEnvelope(portable, new Date("2030-01-01T00:00:00Z"));
    assert.equal(first.integrity.checksum, second.integrity.checksum);
    assert.equal(first.integrity.checksum, recipeChecksum(portable));
  });

  it("builds deterministic bundles with recipe and bundle checksums", () => {
    const alpha = portableRecipePayloadFromDocument(sampleDocument("Alpha"));
    const zulu = portableRecipePayloadFromDocument(sampleDocument("Zulu"));
    const bundle = buildBundleEnvelope([zulu, alpha], new Date("2026-07-19T00:00:00Z"));
    assert.equal(bundle.format, "mixarr-recipe-bundle");
    assert.deepEqual(bundle.recipes.map((recipe) => recipe.name), ["Alpha", "Zulu"]);
    assert.match(bundle.integrity.checksum, /^[a-f0-9]{64}$/);
    assert.ok(bundle.recipes.every((recipe) => /^[a-f0-9]{64}$/.test(recipe.integrity.checksum)));
  });

  it("validates checksums and builds a detailed import preview", () => {
    const envelope = buildRecipeEnvelope(portableRecipePayloadFromDocument(sampleDocument()));
    const parsed = parseTransferJson(JSON.stringify(envelope));
    addConflictAnalysis(parsed, []);
    const preview = publicImportPreview(parsed);
    assert.equal(preview.totalRecipes, 1);
    assert.equal(preview.recipes[0].checksumStatus, "valid");
    assert.equal(preview.recipes[0].sensitiveDataScan.safe, true);
    assert.equal(preview.securityStatus, "No credentials or library identifiers detected.");
    assert.equal(preview.recipes[0].summary.category, "Driving");
  });

  it("rejects a mismatched checksum by default", () => {
    const envelope = buildRecipeEnvelope(portableRecipePayloadFromDocument(sampleDocument()));
    envelope.recipe.name = "Tampered";
    const parsed = parseTransferJson(JSON.stringify(envelope));
    assert.equal(parsed.candidates[0].checksumStatus, "mismatched");
    assert.ok(parsed.candidates[0].validationErrors.some((error) => error.code === "checksum_mismatched"));
  });

  it("accepts checksum-less legacy canonical documents with a visible warning", () => {
    const parsed = parseTransferJson(JSON.stringify(sampleDocument()));
    assert.equal(parsed.candidates[0].checksumStatus, "missing");
    assert.ok(parsed.candidates[0].validationWarnings.some((warning) => warning.code === "checksum_missing"));
    assert.ok(parsed.candidates[0].migrationSteps.length > 0);
  });

  it("detects credentials, Plex IDs, paths, database URLs, and private history without storing values", () => {
    const scan = scanSensitiveData({ plexToken: "secret-value-123", libraryId: "42", hostPath: "C:\\Music", databaseUrl: "postgresql://user:secret@db/app", playbackHistory: [{ track: "x" }], supportEmail: "private@example.com", internalUrl: "http://plex:32400/web" });
    assert.equal(scan.safe, false);
    assert.ok(scan.categories.some((finding) => finding.category === "Plex authentication token"));
    assert.ok(scan.categories.some((finding) => finding.category === "Plex library identifier"));
    assert.ok(scan.categories.some((finding) => finding.category === "Private listening or feedback data"));
    assert.ok(scan.categories.some((finding) => finding.category === "Email address"));
    assert.ok(scan.categories.some((finding) => finding.category === "Internal hostname"));
    assert.equal(JSON.stringify(scan).includes("secret-value-123"), false);
  });

  it("does not over-block ordinary prose containing the word token", () => {
    assert.equal(scanSensitiveData({ description: "A token of appreciation for late-night listeners." }).safe, true);
  });

  it("redacts sensitive values before a blocked stage can be persisted", () => {
    const envelope = buildRecipeEnvelope(portableRecipePayloadFromDocument(sampleDocument()));
    envelope.recipe.description = "Private endpoint postgresql://user:secret@db/app";
    envelope.integrity.checksum = recipeChecksum(envelope.recipe);
    const parsed = parseTransferJson(JSON.stringify(envelope));
    assert.equal(parsed.candidates[0].scan.safe, false);
    redactBlockedCandidates(parsed);
    assert.equal(JSON.stringify(parsed).includes("user:secret"), false);
    assert.equal(parsed.candidates[0].portable.name, "Blocked recipe");
  });

  it("detects exact, normalized, and equivalent-content conflicts", () => {
    const portable = portableRecipePayloadFromDocument(sampleDocument());
    const parsed = parseTransferJson(JSON.stringify(buildRecipeEnvelope(portable)));
    addConflictAnalysis(parsed, [{ id: "local", name: "Late Night Highway", checksum: recipeChecksum(portable), contentChecksum: recipeContentChecksum(portable) }]);
    assert.ok(parsed.candidates[0].conflicts.some((conflict) => conflict.type === "identical_checksum"));
    assert.ok(parsed.candidates[0].conflicts.some((conflict) => conflict.type === "exact_name"));
    assert.equal(parsed.candidates[0].recommendedAction, "use_existing");
  });

  it("generates safe filenames and collision names", () => {
    assert.equal(safeRecipeFilename("Workout Mix! 2026"), "workout-mix-2026");
    assert.equal(safeRecipeFilename("!!!"), "recipe");
    assert.equal(safeImportedName("Workout", ["Workout", "Workout (Imported)"]), "Workout (Imported 2)");
  });

  it("formats the shared human-readable summary", () => {
    const summary = summarizePortableRecipe(portableRecipePayloadFromDocument(sampleDocument()));
    assert.equal(summary.title, "Late Night Highway");
    assert.match(summary.mood, /Atmospheric/);
    assert.match(summary.artistVariety, /Maximum 2 tracks per artist/);
  });

  it("validates artwork by file content and safely round-trips an archive", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 0, 1], 16); png.set([0, 0, 0, 1], 20);
    const artwork = validateArtwork(png);
    const portable = portableRecipePayloadFromDocument(sampleDocument(), { included: true, reference: "artwork/late-night.png", mimeType: artwork.mimeType, checksum: artwork.checksum });
    const envelope = buildRecipeEnvelope(portable);
    const archive = buildRecipeArchive(envelope, new Map([["artwork/late-night.png", artwork]]));
    const parsed = parseRecipeArchive(archive);
    assert.equal(JSON.parse(parsed.manifestText).format, "mixarr-recipe");
    assert.equal(parsed.artwork.get("artwork/late-night.png")?.checksum, artwork.checksum);
    assert.equal(strFromU8(parsed.artwork.get("artwork/late-night.png")!.data.subarray(1, 4)), "PNG");
  });

  it("blocks archive traversal, executable files, and nested archives", () => {
    assert.throws(() => validateArchivePath("../manifest.json"), /unsafe file path/i);
    assert.throws(() => validateArchivePath("artwork/run.exe"), /executable/i);
    assert.throws(() => validateArchivePath("recipes/inside.zip"), /Nested archives/i);
  });
});
