import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ClipboardCopyError, copyTextToClipboard } from "./clipboard";
import {
  COMMUNITY_RECIPE_FORMAT,
  buildCommunityJson,
  decodeShareCode,
  encodeShareCode,
  parseCommunityJson,
  validateCommunityDocument,
  type CommunityDocument,
} from "./communityRecipes/core";
import { defaultMixRecipeDocument } from "./mixRecipes/schema";
import {
  mixRecipeDocumentFromPortablePayload,
  portableRecipePayloadFromDocument,
  scanSensitiveData,
} from "./mixRecipes/transfer";

function legacyDocument(): CommunityDocument {
  const recipe = defaultMixRecipeDocument({
    name: "Portable LAN Recipe",
    description: "A safe recipe shared from any Mixarr installation.",
    category: "Chill",
    sourcePlaylistId: "971f593d-0dce-4ad5-b9dc-6db20cc2f523",
  }, {
    rules: [{ field: "genre", operator: "contains", value: "Ambient" }],
    limit: 40,
    serverId: "source-server",
    libraryId: "source-library",
    pinnedTrackIds: ["source-track"],
    excludedTrackIds: ["excluded-track"],
    engineVersion: "v2",
  });
  return {
    manifest: {
      format: COMMUNITY_RECIPE_FORMAT,
      formatVersion: 1,
      recipeId: "com.example.portable-lan-recipe",
      name: "Portable LAN Recipe",
      version: "1.0.0",
      description: "Portable recipe fixture",
      author: { name: "Example", url: "https://example.com/" },
      license: "MIT",
      minimumMixarrVersion: "2.3.8",
      homepage: "https://example.com/recipes/portable",
      documentationUrl: null,
      sourceUrl: null,
      supportUrl: null,
      tags: ["portable"],
      artwork: null,
      screenshots: [],
      changelog: null,
      recipe: "recipe.json",
    },
    recipe,
    changelog: null,
  };
}

function portableDocument(): CommunityDocument {
  const legacy = legacyDocument();
  return { ...legacy, recipe: mixRecipeDocumentFromPortablePayload(portableRecipePayloadFromDocument(legacy.recipe)) };
}

function withDescription(description: string) {
  const document = portableDocument();
  document.recipe.metadata.description = description;
  return document;
}

describe("v2.4.23 portable recipe share export", () => {
  it("proves the old full-document path was blocked by library_identifier_key and the portable DTO excludes it", () => {
    const oldScan = scanSensitiveData({ recipe: legacyDocument().recipe });
    assert.deepEqual(oldScan.findings.find((finding) => finding.path === "recipe.generation.libraryId"), {
      category: "Plex library identifier",
      categoryCode: "installation_identifier",
      detectorRule: "library_identifier_key",
      path: "recipe.generation.libraryId",
    });
    const portable = portableRecipePayloadFromDocument(legacyDocument().recipe);
    const serialized = JSON.stringify(portable);
    for (const prohibited of ["source-server", "source-library", "source-track", "excluded-track", "sourcePlaylistId", "libraryId", "serverId", "pinnedTrackIds", "excludedTrackIds"]) assert.equal(serialized.includes(prohibited), false, prohibited);
    assert.equal(validateCommunityDocument(portableDocument(), { importMethod: "paste" }).installable, true);
  });

  it("exports a standard recipe deterministically and imports the intended configuration", () => {
    const document = portableDocument();
    const first = encodeShareCode(document);
    const second = encodeShareCode(document);
    assert.equal(first, second);
    const imported = decodeShareCode(first);
    assert.equal(imported.recipe.metadata.name, document.recipe.metadata.name);
    assert.deepEqual(imported.recipe.scoring, document.recipe.scoring);
    assert.deepEqual(imported.recipe.targets, document.recipe.targets);
    assert.deepEqual(imported.recipe.bpmFlow, document.recipe.bpmFlow);
    assert.deepEqual(imported.recipe.discovery, document.recipe.discovery);
    assert.deepEqual(imported.recipe.variety, document.recipe.variety);
    assert.equal(imported.recipe.generation.libraryId, null);
  });

  it("keeps Community JSON and share codes on equivalent portable data", () => {
    const document = portableDocument();
    const fromJson = parseCommunityJson(buildCommunityJson(document));
    const fromCode = decodeShareCode(encodeShareCode(document));
    assert.deepEqual(fromCode.manifest, fromJson.manifest);
    assert.deepEqual(fromCode.recipe, fromJson.recipe);
    assert.equal(JSON.stringify(fromCode).includes("source-library"), false);
  });

  it("is independent of browser URLs, private LAN origins, recipe database UUIDs, and current users", () => {
    const document = portableDocument();
    const code = encodeShareCode(document);
    for (const pageUrl of [
      "http://localhost:3030/recipes/971f593d-0dce-4ad5-b9dc-6db20cc2f523",
      "http://127.0.0.1:3030/recipes/971f593d-0dce-4ad5-b9dc-6db20cc2f523",
      "http://192.168.1.218:3030/recipes/971f593d-0dce-4ad5-b9dc-6db20cc2f523",
      "http://10.1.2.3:3030/recipes/971f593d-0dce-4ad5-b9dc-6db20cc2f523",
      "http://172.16.1.2:3030/recipes/971f593d-0dce-4ad5-b9dc-6db20cc2f523",
      "http://mixarr.internal:3030/recipes/971f593d-0dce-4ad5-b9dc-6db20cc2f523",
      "https://mixarr.example.com/recipes/971f593d-0dce-4ad5-b9dc-6db20cc2f523",
    ]) {
      assert.equal(encodeShareCode(document), code, pageUrl);
      assert.equal(code.includes(pageUrl), false);
    }
    const clientSource = readFileSync("src/app/recipes/[id]/page.tsx", "utf8");
    assert.doesNotMatch(clientSource.slice(clientSource.indexOf("async function copyShareCode"), clientSource.indexOf("async function reportCommunity")), /window\.location|document\.location|location\.href|location\.origin/);
  });

  it("blocks credentials, environment references, database URLs, private addresses, localhost, and local paths in portable fields", () => {
    const cases: Array<[string, string, string]> = [
      ["api_key=abcdefghijklmnop123456", "inline_credential", "credential"],
      ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456", "bearer_token", "credential"],
      ["postgresql://mixarr:password@db:5432/mixarr", "database_url", "server_configuration"],
      ["http://192.168.1.218:3030/hook", "private_ipv4", "private_address"],
      ["http://10.2.3.4/hook", "private_ipv4", "private_address"],
      ["http://172.31.255.254/hook", "private_ipv4", "private_address"],
      ["http://127.0.0.1:3030/hook", "private_ipv4", "private_address"],
      ["http://localhost:3030/hook", "internal_hostname", "private_address"],
      ["http://mixarr.internal:3030/hook", "internal_hostname", "private_address"],
      ["C:\\Music\\private\\library.m3u", "local_filesystem_path", "filesystem_path"],
      ["MIXARR_SECRET_KEY=do-not-export-this", "environment_reference", "environment_value"],
    ];
    for (const [value, detectorRule, categoryCode] of cases) {
      const preview = validateCommunityDocument(withDescription(value), { importMethod: "paste" });
      const finding = preview.messages.find((message) => message.detectorRule === detectorRule);
      assert.equal(preview.installable, false, value);
      assert.equal(finding?.field, "recipe.metadata.description", value);
      assert.equal(finding?.category, categoryCode, value);
      assert.equal(JSON.stringify(preview.messages).includes("do-not-export-this"), false);
      assert.throws(() => encodeShareCode(withDescription(value)), /could not be created/i);
    }
    for (let secondOctet = 16; secondOctet <= 31; secondOctet += 1) assert.equal(scanSensitiveData({ description: `http://172.${secondOctet}.1.2/hook` }).findings.some((finding) => finding.detectorRule === "private_ipv4"), true, `172.${secondOctet}.x.x`);
  });

  it("allows a public URL and reports only redacted category, rule, and path for blocked values", () => {
    assert.equal(validateCommunityDocument(withDescription("See https://docs.example.com/recipe"), { importMethod: "paste" }).installable, true);
    const scan = scanSensitiveData({ description: "Bearer abcdefghijklmnopqrstuvwxyz123456" });
    assert.deepEqual(scan.findings, [{ category: "Bearer token", categoryCode: "credential", detectorRule: "bearer_token", path: "description" }]);
    assert.equal(JSON.stringify(scan).includes("abcdefghijklmnopqrstuvwxyz123456"), false);
    assert.equal(scanSensitiveData({ description: "Portable reference 971f593d-0dce-4ad5-b9dc-6db20cc2f523" }).safe, true);
  });
});

describe("v2.4.23 share-code clipboard handling", () => {
  it("copies the complete share code through the Clipboard API", async () => {
    let copied = "";
    const method = await copyTextToClipboard("MXR1:complete.share-code", { navigator: { clipboard: { writeText: async (value) => { copied = value; } } } });
    assert.equal(method, "clipboard_api");
    assert.equal(copied, "MXR1:complete.share-code");
  });

  it("uses a temporary textarea only when the Clipboard API is unavailable or denied", async () => {
    let textarea: any;
    let removed = false;
    const body = { appendChild: (value: any) => { textarea = value; } } as any;
    const fakeTextarea = { value: "", style: {}, setAttribute() {}, focus() {}, select() {}, remove() { removed = true; } };
    const method = await copyTextToClipboard("MXR1:fallback.code", { navigator: {}, document: { body, createElement: () => fakeTextarea as any, execCommand: (command: string) => command === "copy" } as any });
    assert.equal(method, "exec_command");
    assert.equal(textarea.value, "MXR1:fallback.code");
    assert.equal(removed, true);
  });

  it("classifies clipboard denial separately from sensitive-data validation", async () => {
    await assert.rejects(() => copyTextToClipboard("MXR1:safe.code", { navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } }, document: { body: { appendChild() {} }, createElement: () => ({ value: "", style: {}, setAttribute() {}, focus() {}, select() {}, remove() {} }), execCommand: () => false } as any }), (error: unknown) => error instanceof ClipboardCopyError && error.code === "CLIPBOARD_COPY_FAILED" && !/credential|private address|sensitive/i.test(error.message));
  });
});
