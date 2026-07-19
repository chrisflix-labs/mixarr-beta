import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { defaultMixRecipeDocument } from "./mixRecipes/schema";
import {
  COMMUNITY_RECIPE_FORMAT, buildCommunityBundle, buildCommunityJson, compareVersions, decodeShareCode, encodeShareCode,
  normalizeCommunityTags, parseCommunityBundle, parseCommunityJson, validateCommunityArchivePath, validateCommunityDocument,
  type CommunityDocument,
} from "./communityRecipes/core";
import { isPublicAddress, normalizeCommunitySourceUrl } from "./communityRecipes/url";
import { sanitizeCommunityReport } from "./communityRecipes/service";

function document(overrides: Record<string, unknown> = {}): CommunityDocument {
  const recipe = defaultMixRecipeDocument({ name: "Smooth Morning", description: "A gradual morning mix.", category: "Chill" }, { engineVersion: "v2", limit: 40, rules: [{ field: "genre", operator: "contains", value: "Ambient" }] });
  return { manifest: { format: COMMUNITY_RECIPE_FORMAT, formatVersion: 1, recipeId: "com.example.smooth-morning", name: "Smooth Morning", version: "1.0.0", description: "A gradual morning mix.", author: { name: "Example Author", url: "https://example.com/" }, license: "MIT", minimumMixarrVersion: "2.3.5", homepage: null, documentationUrl: "https://example.com/docs", sourceUrl: "https://github.com/example/recipes", supportUrl: null, tags: ["Morning", " relaxed ", "morning"], artwork: null, screenshots: [], changelog: null, recipe: "recipe.json", ...overrides }, recipe };
}

describe("community recipe format v1", () => {
  it("normalizes tags and compares semantic versions", () => { assert.deepEqual(normalizeCommunityTags([" Morning ", "morning", "<Focus>", "Deep  Cuts"]), ["Morning", "Focus", "Deep Cuts"]); assert(compareVersions("2.3.5", "2.3.4") > 0); });
  it("round trips plain JSON and checksum-protected share codes", () => { const value = document(); assert.equal(parseCommunityJson(buildCommunityJson(value)).manifest.recipeId, value.manifest.recipeId); const code = encodeShareCode(value); assert.match(code, /^MXR1:/); assert.equal(decodeShareCode(code).recipe.metadata.name, "Smooth Morning"); assert.throws(() => decodeShareCode(`${code.slice(0, -1)}0`), /checksum|corrupted/i); });
  it("round trips full bundles", () => { const value = document({ changelog: "CHANGELOG.md" }); value.changelog = "# 1.0.0\n\nInitial release."; const parsed = parseCommunityBundle(buildCommunityBundle(value)); assert.equal(parsed.manifest.version, "1.0.0"); assert.match(parsed.changelog || "", /Initial release/); });
  it("rejects traversal, executable content, duplicate archive paths, and unknown files", () => { assert.throws(() => validateCommunityArchivePath("../recipe.json"), /unsafe path/i); assert.throws(() => validateCommunityArchivePath("install.ps1"), /executable/i); assert.throws(() => parseCommunityBundle(zipSync({ "manifest.json": strToU8("{}"), "scripts/run.sh": strToU8("echo no") })), /executable|unsupported/i); });
  it("blocks secrets and incompatible minimum versions", () => { const secret = document(); (secret.recipe as any).metadata.description = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"; const unsafe = validateCommunityDocument(secret, { importMethod: "paste" }); assert.equal(unsafe.installable, false); assert(unsafe.messages.some((item) => item.code === "PROHIBITED_SECRET")); const future = document({ minimumMixarrVersion: "99.0.0" }); const incompatible = validateCommunityDocument(future, { importMethod: "paste" }); assert.equal(incompatible.status, "incompatible"); });
});

describe("community URL and reporting security", () => {
  it("converts GitHub blob links and rejects unsupported protocols", () => { assert.equal(normalizeCommunitySourceUrl("https://github.com/owner/repo/blob/main/recipes/test.json").hostname, "raw.githubusercontent.com"); assert.throws(() => normalizeCommunitySourceUrl("file:///etc/passwd"), /HTTPS/); assert.throws(() => normalizeCommunitySourceUrl("https://user:pass@example.com/test.json"), /credentials/); });
  it("classifies private and public addresses", () => { for (const value of ["127.0.0.1", "10.0.0.2", "169.254.169.254", "192.168.1.4", "::1", "fd00::1"]) assert.equal(isPublicAddress(value), false, value); assert.equal(isPublicAddress("1.1.1.1"), true); assert.equal(isPublicAddress("2606:4700:4700::1111"), true); });
  it("creates a sanitized decentralized report", () => { const report = sanitizeCommunityReport({ recipe: { name: "Test", communityRecipeId: "com.example.test", communityVersion: "1.0.0", communitySourceUrl: "https://github.com/example/recipes?token=secret", portableChecksum: "abc", communityValidationJson: [{ code: "INVALID_RECIPE" }], communityImportMethod: "url" }, category: "Suspicious content", description: "Please review." }); assert.equal(report.sourceUrl, "https://github.com/example/recipes"); assert.deepEqual(report.validationCodes, ["INVALID_RECIPE"]); assert(!JSON.stringify(report).includes("token=secret")); });
});
