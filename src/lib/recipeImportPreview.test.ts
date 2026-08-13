import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultMixRecipeDocument } from "./mixRecipes/schema";
import { buildRecipeEnvelope, parseTransferJson, portableRecipePayloadFromDocument, publicImportPreview, type ParsedTransfer } from "./mixRecipes/transfer";
import {
  canonicalSecurityJson,
  changedRecipeImportPreviewDomains,
  createRecipeImportPreviewToken,
  securityFingerprint,
} from "./mixRecipes/previewToken";

function token(overrides: Partial<Parameters<typeof createRecipeImportPreviewToken>[0]> = {}) {
  return createRecipeImportPreviewToken({
    sourceRecipe: { metadata: { name: "Round Trip" }, generation: { limit: 40, rules: [] } },
    effectiveRecipe: { metadata: { name: "Round Trip" }, generation: { limit: 40, rules: [] } },
    trustPolicy: { signature: { status: "MISSING", trusted: false } },
    safetyPolicy: { maxGeneratedPlaylistSize: 500, maxTracksAddedPerRun: 100 },
    compatibility: { status: "COMPATIBLE", installedVersion: "2.4.23" },
    dependencies: [{ type: "feature", name: "mix_recipes", required: true, status: "AVAILABLE" }],
    permissions: { permissions: ["library.read", "playlist.create"], administrator: false },
    governanceRevision: "recipe-governance-v2",
    ...overrides,
  });
}

function jsonbRoundTrip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbRoundTrip);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.length - right.length || left.localeCompare(right))
      .map(([key, child]) => [key, jsonbRoundTrip(child)]));
  }
  return value;
}

describe("recipe secure-import preview tokens", () => {
  it("is deterministic across object ordering and PostgreSQL jsonb persistence", () => {
    const before = {
      sourceRecipe: { schemaVersion: 3, metadata: { description: null, category: "Custom", name: "Round Trip" }, generation: { rules: [], limit: 40 } },
      effectiveRecipe: { generation: { limit: 40, rules: [] }, metadata: { name: "Round Trip", category: "Custom", description: null }, schemaVersion: 3 },
      trustPolicy: { signature: { trusted: false, status: "MISSING" } },
      safetyPolicy: { maxTracksAddedPerRun: 100, maxGeneratedPlaylistSize: 500 },
      compatibility: { installedVersion: "2.4.23", status: "COMPATIBLE" },
      dependencies: [],
      permissions: { administrator: false, permissions: ["library.read", "playlist.create"] },
      governanceRevision: "recipe-governance-v2",
    };
    const after = jsonbRoundTrip(before) as typeof before;
    const first = createRecipeImportPreviewToken(before);
    const second = createRecipeImportPreviewToken(after);
    assert.deepEqual(second, first);
    assert.equal(securityFingerprint(first), securityFingerprint(second));
  });

  it("uses canonical JSON for nested keys, undefined values, and non-finite numbers", () => {
    const left = { z: undefined, b: [{ y: 2, x: 1 }, undefined], a: Number.NaN };
    const right = { a: null, b: [{ x: 1, y: 2 }, null] };
    assert.equal(canonicalSecurityJson(left), canonicalSecurityJson(right));
    assert.equal(securityFingerprint(left), securityFingerprint(right));
  });

  it("keeps the server preview identity stable after the staged payload crosses jsonb", () => {
    const document = defaultMixRecipeDocument({ name: "Database Round Trip", description: null, category: "Custom" }, { limit: 40 });
    const parsed = parseTransferJson(JSON.stringify(buildRecipeEnvelope(portableRecipePayloadFromDocument(document))));
    parsed.candidates[0].governance = { planHash: securityFingerprint(token()), normalizedRecipe: parsed.candidates[0].normalizedRecipe } as any;
    const persisted = jsonbRoundTrip(parsed) as ParsedTransfer;
    assert.equal(publicImportPreview(parsed).previewId, publicImportPreview(persisted).previewId);
  });

  it("does not mix Resolve and Confirm choices into external policy identity", () => {
    const staged = token();
    const choices = [
      { adaptationMode: "adapted", importMode: "suggest_only", action: "import" },
      { adaptationMode: "original", importMode: "approval_required", action: "rename" },
    ];
    for (const _choice of choices) assert.deepEqual(token(), staged);
  });

  it("identifies a real safety-policy change", () => {
    const expected = token();
    const actual = token({ safetyPolicy: { maxGeneratedPlaylistSize: 250, maxTracksAddedPerRun: 100 } });
    assert.deepEqual(changedRecipeImportPreviewDomains(expected, actual), ["safetyPolicy"]);
  });

  it("identifies real trust and dependency changes without conflating domains", () => {
    const expected = token();
    const trustChanged = token({ trustPolicy: { signature: { status: "REVOKED_KEY", trusted: false } } });
    const dependencyChanged = token({ dependencies: [{ type: "feature", name: "mix_recipes", required: true, status: "MISSING" }] });
    assert.deepEqual(changedRecipeImportPreviewDomains(expected, trustChanged), ["trustPolicy"]);
    assert.deepEqual(changedRecipeImportPreviewDomains(expected, dependencyChanged), ["dependencies"]);
  });

  it("identifies recipe and permission changes independently", () => {
    const expected = token();
    const recipeChanged = token({ sourceRecipe: { metadata: { name: "Changed" } } });
    const permissionChanged = token({ permissions: { permissions: ["library.read"], administrator: true } });
    assert.deepEqual(changedRecipeImportPreviewDomains(expected, recipeChanged), ["sourceRecipe"]);
    assert.deepEqual(changedRecipeImportPreviewDomains(expected, permissionChanged), ["permissions"]);
  });

  it("requires the reviewed preview id, refreshes stale previews once, and advances successful imports to Results", () => {
    const root = process.cwd();
    const route = readFileSync(join(root, "src/app/api/playlist-recipes/import/route.ts"), "utf8");
    const page = readFileSync(join(root, "src/app/recipes/page.tsx"), "utf8");
    const service = readFileSync(join(root, "src/lib/mixRecipes/transferService.ts"), "utf8");
    assert.match(route, /IMPORT_PREVIEW_ID_REQUIRED/);
    assert.match(page, /previewId: preview\.previewId/);
    assert.match(page, /staleRefreshAttemptedRef/);
    assert.match(page, /setWizardStep\(6\)/);
    assert.match(service, /recipeImport\.previewInvalidated/);
    assert.match(service, /changedDomains/);
  });
});
