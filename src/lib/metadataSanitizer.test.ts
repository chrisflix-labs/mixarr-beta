import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataSanitizerStats, logMetadataSanitizerSummarySince, sanitizeMetadataString, sanitizeOptionalMetadataString } from "./metadataSanitizer";

describe("metadata string sanitizer", () => {
  it("preserves ASCII, Unicode, and emoji", () => {
    assert.equal(sanitizeMetadataString("Plain title"), "Plain title");
    assert.equal(sanitizeMetadataString("Beyonc\u00e9 \u2014 D\u00e9j\u00e0 vu"), "Beyonc\u00e9 \u2014 D\u00e9j\u00e0 vu");
    assert.equal(sanitizeMetadataString("Music \ud83c\udfb5"), "Music \ud83c\udfb5");
  });

  it("removes null bytes and replaces control characters", () => {
    assert.equal(sanitizeMetadataString("bad\u0000title"), "badtitle");
    assert.equal(sanitizeMetadataString("bad\u0001title\u007f"), "bad title ");
  });

  it("replaces lone UTF-16 surrogates without damaging valid pairs", () => {
    assert.equal(sanitizeMetadataString("bad\ud800value"), "bad\ufffdvalue");
    assert.equal(sanitizeMetadataString("bad\udc00value"), "bad\ufffdvalue");
    assert.equal(sanitizeMetadataString("ok\ud83d\ude00"), "ok\ud83d\ude00");
  });

  it("keeps per-item diagnostics at debug and emits one info summary", () => {
    const debugMessages: unknown[][] = [];
    const infoMessages: unknown[][] = [];
    const originalDebug = console.debug;
    const originalInfo = console.info;
    const originalLogLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    console.debug = (...args: unknown[]) => { debugMessages.push(args); };
    console.info = (...args: unknown[]) => { infoMessages.push(args); };
    try {
      const before = getMetadataSanitizerStats();
      sanitizeOptionalMetadataString("bad\u0000value", { entity: "Artist", entityId: "one", field: "summary" });
      sanitizeOptionalMetadataString("bad\u0001value", { entity: "Album", entityId: "two", field: "summary" });
      logMetadataSanitizerSummarySince(before);
    } finally {
      console.debug = originalDebug;
      console.info = originalInfo;
      if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = originalLogLevel;
    }
    assert.equal(debugMessages.length, 2);
    assert.equal(infoMessages.length, 1);
    assert.match(String(infoMessages[0][0]), /artists=1/);
    assert.match(String(infoMessages[0][0]), /albums=1/);
  });
});
