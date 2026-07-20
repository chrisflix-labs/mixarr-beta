import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultMixRecipeDocument } from "./mixRecipes/schema";
import { canonicalRecipeSignaturePayload, verifyRecipeSignature, inferRecipePermissions, analyzeRecipeRisk, applyRecipeSafetyLimits, evaluateRecipeCompatibility, scanForbiddenRecipeActions, assertRecipeExecutionAllowed } from "./mixRecipes/governance";
import { parseJsonRejectingDuplicateKeys } from "./mixRecipes/transfer";
import { validateRecipe } from "./mixRecipes/validation";

function recipe(overrides: Record<string, unknown> = {}) {
  const base = defaultMixRecipeDocument({ name: "Safe Mix", description: "A safe recipe", category: "Custom" }, {});
  return { ...base, ...overrides } as typeof base;
}

describe("v2.3.8 recipe signature verification", () => {
  it("verifies an Ed25519 signature and derives official status from the trusted key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const unsigned = recipe({ signature: { algorithm: "ed25519", keyId: "mixarr-official-test", value: "pending", signedAt: "2026-07-19T00:00:00.000Z" } });
    unsigned.signature!.value = sign(null, Buffer.from(canonicalRecipeSignaturePayload(unsigned)), privateKey).toString("base64");
    const result = verifyRecipeSignature(unsigned, [{ keyId: "mixarr-official-test", algorithm: "ed25519", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), identity: "Mixarr", official: true, trusted: true }]);
    assert.equal(result.status, "VALID"); assert.equal(result.official, true);
  });

  it("detects payload modification, unknown keys, revoked keys, invalid base64, and missing signatures", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519"); const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const signed = recipe({ signature: { algorithm: "ed25519", keyId: "third-party", value: "pending", signedAt: "2026-07-19T00:00:00.000Z" } });
    signed.signature!.value = sign(null, Buffer.from(canonicalRecipeSignaturePayload(signed)), privateKey).toString("base64");
    assert.equal(verifyRecipeSignature({ ...signed, recipeVersion: 2 }, [{ keyId: "third-party", algorithm: "ed25519", publicKey: pem, identity: "Author", official: false, trusted: true }]).status, "INVALID");
    assert.equal(verifyRecipeSignature(signed, []).status, "UNKNOWN_KEY");
    assert.equal(verifyRecipeSignature(signed, [{ keyId: "third-party", algorithm: "ed25519", publicKey: pem, identity: "Author", official: false, trusted: true, revokedAt: new Date() }]).status, "REVOKED_KEY");
    assert.equal(verifyRecipeSignature({ ...signed, signature: { ...signed.signature!, value: "%%%" } }, [{ keyId: "third-party", algorithm: "ed25519", publicKey: pem, identity: "Author", official: false, trusted: true }]).status, "INVALID");
    assert.equal(verifyRecipeSignature(recipe(), []).status, "MISSING");
  });
});

describe("v2.3.8 permissions and risk policy", () => {
  it("infers legacy automation permissions without silently granting high-risk capabilities", () => {
    const value = recipe({ automationPolicy: { enabled: true, requireExplicitConfirmation: true, libraryId: "library", preserveManualEdits: true }, refreshPolicy: { ...recipe().refreshPolicy, mode: "scheduled", frequencyDays: 1, strategy: "full_regeneration", maximumReplacements: 40 } });
    const permissions = inferRecipePermissions(value); const removals = permissions.find((item) => item.permission === "automation.remove_tracks");
    assert.equal(removals?.decision, "restrict"); assert.equal(removals?.inferred, true);
    const risk = analyzeRecipeRisk(value, permissions); assert.equal(risk.riskLevel, "high"); assert.equal(risk.recommendedImportMode, "suggest_only"); assert.ok(risk.findings.some((item) => item.code === "recipe.risk.unattended_large_removal"));
  });

  it("denies destructive permissions and every encoded delete/recreate alias", () => {
    const value = recipe({ permissions: [{ permission: "playlist.delete", reason: "Replace old playlist", required: true }] });
    assert.equal(inferRecipePermissions(value).find((item) => item.permission === "playlist.delete")?.decision, "deny");
    assert.ok(scanForbiddenRecipeActions({ action: "delete_and_recreate_playlist" }).some((item) => item.code === "recipe.action.playlist_delete_forbidden"));
    assert.throws(() => assertRecipeExecutionAllowed({ enabled: true, trustState: "OFFICIAL", approvalState: "APPROVED", quarantineState: "NONE", grantedPermissionsJson: ["playlist.delete"] }, "playlist.delete"), /never allowed/i);
  });

  it("blocks protected targets and quarantined execution at the domain boundary", () => {
    assert.throws(() => assertRecipeExecutionAllowed({ enabled: true, trustState: "TRUSTED", approvalState: "APPROVED", quarantineState: "NONE", grantedPermissionsJson: ["playlist.update"] }, "playlist.update", { protected: true, name: "Manual favorites" }), /Protected playlist/i);
    assert.throws(() => assertRecipeExecutionAllowed({ enabled: false, trustState: "QUARANTINED", approvalState: "QUARANTINED", quarantineState: "QUARANTINED", grantedPermissionsJson: [] }, "playlist.create"), /disabled|quarantined/i);
    assert.throws(() => assertRecipeExecutionAllowed({ enabled: true, trustState: "TRUSTED", approvalState: "APPROVED_WITH_RESTRICTIONS", quarantineState: "NONE", grantedPermissionsJson: ["playlist.update"] }, "automation.remove_tracks"), /permission/i);
  });
});

describe("v2.3.8 compatibility and input safety", () => {
  it("uses semantic versions including prereleases and wildcard maximums", () => {
    assert.equal(evaluateRecipeCompatibility(recipe(), "2.3.8").status, "COMPATIBLE");
    assert.equal(evaluateRecipeCompatibility(recipe({ compatibility: { minMixarrVersion: "2.3.8", maxMixarrVersion: "2.x", recipeSchemaVersion: 3 } }), "2.3.8-beta.1").status, "MIXARR_UPGRADE_REQUIRED");
    assert.equal(evaluateRecipeCompatibility(recipe({ compatibility: { minMixarrVersion: "3.0", maxMixarrVersion: "3.x", recipeSchemaVersion: 3 } }), "2.3.8").status, "UNKNOWN");
    assert.equal(evaluateRecipeCompatibility(recipe({ compatibility: { minMixarrVersion: "2.3.0", maxMixarrVersion: "2.x", recipeSchemaVersion: 3 } }), "3.0.0").status, "RECIPE_DOWNGRADE_REQUIRED");
  });

  it("clamps above-policy values visibly and respects absolute caps", () => {
    const value = recipe(); value.generation.limit = 900; value.refreshPolicy.maximumReplacements = 80;
    const result = applyRecipeSafetyLimits(value, { maxGeneratedPlaylistSize: 100, maxTracksAddedPerRun: 100, maxTracksRemovedPerRun: 10 });
    assert.equal(result.recipe.generation.limit, 100); assert.equal(result.recipe.refreshPolicy.maximumReplacements, 10); assert.equal(result.adjustments.length, 2);
  });

  it("rejects duplicate JSON keys before signature or checksum evaluation", () => {
    assert.throws(() => parseJsonRejectingDuplicateKeys('{"name":"first","name":"second"}'), (error: any) => error.code === "DUPLICATE_JSON_KEY");
  });

  it("migrates deprecated fields with structured warnings instead of silently enabling capability", () => {
    const legacy: any = recipe(); legacy.automationPolicy.autoRegenerate = true;
    const result = validateRecipe(legacy);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((item) => item.code === "recipe.field.deprecated" && item.path === "automationPolicy.autoRegenerate"));
    assert.equal((result.normalizedRecipe!.automationPolicy as any).autoRegenerate, undefined);
  });
});

describe("v2.3.8 governance integration contracts", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("uses an additive migration with indexed audit, snapshot, key, and policy storage", () => {
    const sql = read("prisma/migrations/20260720180000_recipe_governance_v238/migration.sql");
    assert.match(sql, /CREATE TABLE "RecipeAuditEvent"/);
    assert.match(sql, /CREATE TABLE "RecipeImportSnapshot"/);
    assert.match(sql, /CREATE TABLE "RecipeSigningKey"/);
    assert.match(sql, /CREATE INDEX/);
    assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
  });

  it("enforces governance for legacy community imports and execution workers", () => {
    const community = read("src/lib/communityRecipes/service.ts");
    const playlists = read("src/lib/playlistService.ts");
    assert.match(community, /buildRecipeGovernancePlan/);
    assert.match(community, /createRecipeSnapshot/);
    assert.match(community, /prisma\.\$transaction/);
    assert.match(community, /STALE_IMPORT_PREVIEW/);
    assert.match(playlists, /assertRecipeExecutionAllowed/);
    assert.match(playlists, /RECIPE_PROTECTED_PLAYLIST_BLOCKED/);
  });

  it("exposes scoped approval, quarantine, migration, audit, signing-key, and restore APIs", () => {
    const expected: Record<string, string> = {
      "src/app/api/recipes/quarantine/route.ts": "recipes.view",
      "src/app/api/recipes/audit/route.ts": "recipes.audit.view",
      "src/app/api/recipes/[id]/approval/route.ts": "recipes.approve",
      "src/app/api/recipes/[id]/migration/route.ts": "recipes.migrate",
      "src/app/api/recipes/[id]/snapshots/route.ts": "recipes.restore",
      "src/app/api/recipes/signing-keys/route.ts": "recipes.signing_keys.view",
    };
    for (const [file, scope] of Object.entries(expected)) assert.match(read(file), new RegExp(scope.replace(".", "\\.")));
  });

  it("keeps high-risk review, quarantine, migration, audit, and restore controls visible in the UI", () => {
    const recipes = read("src/app/recipes/page.tsx");
    const community = read("src/app/recipes/community/page.tsx");
    const detail = read("src/app/recipes/[id]/page.tsx");
    assert.match(recipes, /Recommended:/);
    assert.match(recipes, /Safety-limit adjustments/);
    assert.match(community, /Requested permissions/);
    assert.match(detail, /Immutable audit history/);
    assert.match(detail, /Restore snapshots/);
    assert.match(detail, /Preview migration/);
  });
});
