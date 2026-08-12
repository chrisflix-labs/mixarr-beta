import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ClipboardCopyError, copyTextToClipboard } from "./clipboard";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

/**
 * Regression guards for interfaces that reported the wrong outcome to the user.
 *
 * v2.4.23 added `copyTextToClipboard` (async Clipboard API, then a textarea
 * `execCommand` fallback) but wired it only into the recipe share code. Every
 * other copy control still called `navigator.clipboard.writeText` directly.
 * Mixarr is normally reached over plain HTTP on a LAN address, where
 * `navigator.clipboard` is undefined, so those controls threw synchronously
 * inside their click handlers: the button appeared to do nothing and no message
 * was shown. For the scoped API token — displayed exactly once — that silently
 * lost an unrecoverable credential.
 */
describe("clipboard controls report their outcome", () => {
  const callSites: Array<[string, string[]]> = [
    ["IntegrationCenter (scoped API token)", ["src", "components", "IntegrationCenter.tsx"]],
    ["PlaylistAiSummaries", ["src", "components", "PlaylistAiSummaries.tsx"]],
    ["BetaFeatureSettingsForm", ["src", "components", "BetaFeatureSettingsForm.tsx"]],
    ["BetaAdministration", ["src", "components", "BetaAdministration.tsx"]],
    ["Recipe detail page", ["src", "app", "recipes", "[id]", "page.tsx"]],
  ];

  for (const [name, parts] of callSites) {
    it(`${name} copies through the shared helper`, () => {
      const source = read(...parts);
      assert.doesNotMatch(source, /navigator\.clipboard\.writeText/, `${name} must not call the Clipboard API directly`);
      assert.match(source, /copyTextToClipboard/, `${name} must use the fallback-capable helper`);
    });
  }

  it("the one-time API token keeps a recoverable failure message", () => {
    const source = read("src", "components", "IntegrationCenter.tsx");
    assert.match(source, /copyToken/);
    // The token is shown once; a failed copy must say so and tell the user to
    // copy it manually before navigating away.
    assert.match(source, /copy it manually before leaving this page/i);
  });

  it("falls back to execCommand and then fails loudly rather than silently", async () => {
    const calls: string[] = [];
    const environment = {
      navigator: { clipboard: { writeText: async () => { calls.push("api"); throw new Error("denied"); } } },
      document: {
        body: { appendChild() { calls.push("append"); } },
        createElement: () => ({ value: "", style: {}, setAttribute() {}, focus() {}, select() {}, remove() { calls.push("remove"); } }),
        execCommand: () => { calls.push("exec"); return true; },
      },
    } as any;
    assert.equal(await copyTextToClipboard("token-value", environment), "exec_command");
    assert.deepEqual(calls, ["api", "append", "exec", "remove"]);

    const failing = { ...environment, document: { ...environment.document, execCommand: () => false } };
    await assert.rejects(() => copyTextToClipboard("token-value", failing), (error: unknown) =>
      error instanceof ClipboardCopyError && error.code === "CLIPBOARD_COPY_FAILED");
  });

  it("keeps the ClipboardCopyError message generic so callers state what succeeded", () => {
    const error = new ClipboardCopyError();
    assert.doesNotMatch(error.message, /share code/i, "the shared error is reused by token, summary, and report copies");
    // The recipe page still names the share code specifically.
    assert.match(read("src", "app", "recipes", "[id]", "page.tsx"), /The share code was created, but/);
  });

  it("separates report creation from report copying", () => {
    const source = read("src", "app", "recipes", "[id]", "page.tsx");
    // A clipboard denial previously surfaced as "The report could not be
    // created.", which was untrue — the report existed.
    assert.match(source, /The report was created, but the browser denied clipboard access/);
  });
});

/**
 * BetaAdministration performed every request without a `try`/`catch`. A failed
 * initial load left the panel on its loading spinner forever, and a failed save
 * left the control it belonged to permanently disabled and showing "SAVING"
 * with no error anywhere on screen.
 */
describe("beta administration reports load and save failures", () => {
  const source = read("src", "components", "BetaAdministration.tsx");

  it("clears the busy flag even when a save rejects", () => {
    assert.match(source, /finally \{ setWorking\(""\); \}/);
    const busyWrites = source.match(/setWorking\(/g) || [];
    const finallyBlocks = source.match(/finally \{ setWorking\(""\); \}/g) || [];
    assert.ok(finallyBlocks.length >= 3, `every mutation must clear the busy flag (found ${finallyBlocks.length} of ${busyWrites.length} setWorking calls)`);
  });

  it("renders a retryable error instead of an endless spinner", () => {
    assert.match(source, /loadError/);
    assert.match(source, /Beta administration could not be loaded/);
    assert.match(source, /onClick=\{\(\) => void load\(\)\}>Retry</);
  });

  it("shows failures as alerts, never through the success indicator", () => {
    assert.match(source, /actionError/);
    assert.match(source, /role="alert"/);
    // The success line is the CheckCircle2 row; errors must not reuse it.
    assert.doesNotMatch(source, /CheckCircle2 size=\{14\} \/> \{actionError\}/);
  });

  it("states that a rejected save left the previous value unchanged", () => {
    assert.match(source, /could not be updated\. The previous setting is unchanged\./);
    assert.match(source, /could not be updated\. The previous access level is unchanged\./);
  });
});

/**
 * The AI governance interface offered up to 10 retry attempts, but
 * `updateAiGovernanceSettings` rejects anything above 1 with a 400 and the
 * coordinator caps the effective limit at 1 regardless. Saving 2 or more looked
 * available and always failed.
 */
describe("AI retry attempts control matches the enforced limit", () => {
  it("offers only the values the server accepts", () => {
    const dashboard = read("src", "components", "AiGovernanceDashboard.tsx");
    assert.match(dashboard, /data-field="maximum_retry_attempts"[^>]*min="0"[^>]*max="1"/);
    assert.doesNotMatch(dashboard, /data-field="maximum_retry_attempts"[^>]*max="10"/);
    assert.match(dashboard, /at most one transient retry/i);
  });

  it("keeps the server as the authority", () => {
    const service = read("src", "ai", "governance", "service.ts");
    assert.match(service, /maximumRetryAttempts != null && input\.maximumRetryAttempts > 1/);
    assert.match(service, /AI requests permit at most one transient retry\./);
    const coordinator = read("src", "ai", "request-coordinator", "index.ts");
    assert.match(coordinator, /Math\.min\(1, input\.candidate\.config\.retryCount, input\.maximumRetryAttempts\)/);
  });
});
