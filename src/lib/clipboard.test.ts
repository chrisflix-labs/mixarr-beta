import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { tryCopyTextToClipboard } from "./clipboard";
import { createAndCopyShareCode } from "./shareCodeCopy";

function legacyEnvironment(options: { api?: (text: string) => Promise<void>; exec?: () => boolean; secureContext?: boolean } = {}) {
  const calls: string[] = [];
  const textarea = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute(name: string, value: string) { calls.push(`attribute:${name}=${value}`); },
    focus() { calls.push("focus"); },
    select() { calls.push("select"); },
    remove() { calls.push("remove"); },
  };
  return {
    calls,
    textarea,
    environment: {
      navigator: options.api ? { clipboard: { writeText: async (text: string) => { calls.push("clipboard-api"); await options.api!(text); } } } : {},
      document: {
        body: { appendChild() { calls.push("append"); } },
        createElement() { return textarea; },
        execCommand(command: string) { calls.push(`exec:${command}`); return options.exec?.() ?? false; },
      },
      secureContext: options.secureContext,
    } as any,
  };
}

describe("clipboard compatibility", () => {
  it("uses the Clipboard API in a secure context and reports success", async () => {
    let copied = "";
    const result = await tryCopyTextToClipboard("MXR1:https", {
      secureContext: true,
      navigator: { clipboard: { writeText: async (text) => { copied = text; } } },
    });
    assert.deepEqual(result, { ok: true, method: "clipboard-api" });
    assert.equal(copied, "MXR1:https");
  });

  it("falls back after a NotAllowedError and cleans up the temporary textarea", async () => {
    const denied = new DOMException("activation expired", "NotAllowedError");
    const fixture = legacyEnvironment({ api: async () => { throw denied; }, exec: () => true, secureContext: true });
    const result = await tryCopyTextToClipboard("MXR1:fallback", fixture.environment);
    assert.deepEqual(result, { ok: true, method: "legacy-copy" });
    assert.deepEqual(fixture.calls.filter((call) => ["clipboard-api", "append", "focus", "select", "exec:copy", "remove"].includes(call)), ["clipboard-api", "append", "focus", "select", "exec:copy", "remove"]);
    assert.equal(fixture.textarea.value, "MXR1:fallback");
  });

  it("uses the legacy fallback when the Clipboard API is unavailable", async () => {
    const fixture = legacyEnvironment({ exec: () => true, secureContext: true });
    assert.deepEqual(await tryCopyTextToClipboard("MXR1:legacy", fixture.environment), { ok: true, method: "legacy-copy" });
    assert.equal(fixture.calls.includes("exec:copy"), true);
  });

  it("does not query clipboard-write permission before a successful write", async () => {
    let permissionQueries = 0;
    let clipboardWrites = 0;
    const result = await tryCopyTextToClipboard("MXR1:no-permission-gate", {
      secureContext: true,
      navigator: {
        permissions: { query: async () => { permissionQueries += 1; throw new Error("unsupported permission name"); } },
        clipboard: { writeText: async () => { clipboardWrites += 1; } },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(permissionQueries, 0);
    assert.equal(clipboardWrites, 1);
  });

  it("uses browser secure-context state, not localhost URL heuristics", async () => {
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "https://mixarr.example.com"]) {
      let writes = 0;
      const result = await tryCopyTextToClipboard(origin, { secureContext: true, navigator: { clipboard: { writeText: async () => { writes += 1; } } } });
      assert.equal(result.ok, true, origin);
      assert.equal(writes, 1, origin);
    }
  });

  it("classifies an untrusted HTTP context only after both automatic methods fail", async () => {
    const diagnostics: Array<[string, Record<string, unknown>]> = [];
    const fixture = legacyEnvironment({ exec: () => false, secureContext: false });
    const result = await tryCopyTextToClipboard("MXR1:never-log-this", {
      ...fixture.environment,
      logDiagnostic: (event, details) => diagnostics.push([event, details]),
    });
    assert.deepEqual(result, { ok: false, reason: "not-secure-context" });
    assert.equal(fixture.calls.includes("exec:copy"), true);
    assert.equal(JSON.stringify(diagnostics).includes("MXR1:never-log-this"), false);
    assert.equal(diagnostics[0][0], "clipboard.copy.failed");
  });
});

describe("share-code creation and copy remain separate", () => {
  it("retains one generated code when automatic copying fails", async () => {
    let creations = 0;
    let copyAttempts = 0;
    const outcome = await createAndCopyShareCode(
      async () => { creations += 1; return { code: "MXR1:retained", characterCount: 13 }; },
      async () => { copyAttempts += 1; return { ok: false, reason: "not-allowed" }; },
    );
    assert.equal(creations, 1);
    assert.equal(copyAttempts, 1);
    assert.equal(outcome.created.code, "MXR1:retained");
    assert.deepEqual(outcome.copyResult, { ok: false, reason: "not-allowed" });
  });

  it("wires success, cached retry, and accessible manual-copy UI into the recipe page", () => {
    const source = readFileSync(join(process.cwd(), "src", "app", "recipes", "[id]", "page.tsx"), "utf8");
    assert.match(source, /Share code copied to clipboard\./);
    assert.match(source, /if \(shareCode\) \{ await copyExistingShareCode\(shareCode\); return; \}/);
    assert.match(source, /Copy it manually below/);
    assert.match(source, /readOnly rows=\{4\} value=\{shareCode\.code\}/);
    assert.match(source, /> Copy again<\/button>/);
  });
});
