import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeBetaReport } from "./betaDiagnostics";

describe("beta feedback report sanitization", () => {
  it("removes secrets, cookies, tokens, and filesystem paths recursively", () => {
    const sanitized = sanitizeBetaReport({
      feature: "smartMix.experimentalScoring",
      plexToken: "secret",
      nested: { apiKey: "secret", browserCookie: "secret", fullPath: "C:\\private\\music", warning: "safe warning" },
    }) as any;
    assert.equal(sanitized.feature, "smartMix.experimentalScoring");
    assert.equal(sanitized.plexToken, undefined);
    assert.equal(sanitized.nested.apiKey, undefined);
    assert.equal(sanitized.nested.browserCookie, undefined);
    assert.equal(sanitized.nested.fullPath, undefined);
    assert.equal(sanitized.nested.warning, "safe warning");
  });
});
