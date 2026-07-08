import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APP_VERSION } from "./appVersion";
import { buildBugReportTemplate, buildJobFailureReport } from "./supportReports";
import { REDACTED_VALUE, redactSecrets, sanitizeErrorText } from "./supportRedaction";

describe("support redaction", () => {
  it("redacts common secret fields", () => {
    const redacted = redactSecrets({
      PLEX_TOKEN: "plex-secret",
      apiKey: "api-secret",
      api_key: "api-secret-2",
      password: "pw",
      DATABASE_URL: "postgres://user:pass@host/db",
      headers: { authorization: "Bearer abc", cookie: "sid=secret" },
      nested: { sessionToken: "session-secret" },
      safe: "visible",
    });

    assert.equal(redacted.PLEX_TOKEN, REDACTED_VALUE);
    assert.equal(redacted.apiKey, REDACTED_VALUE);
    assert.equal(redacted.api_key, REDACTED_VALUE);
    assert.equal(redacted.password, REDACTED_VALUE);
    assert.equal(redacted.DATABASE_URL, REDACTED_VALUE);
    assert.equal(redacted.headers.authorization, REDACTED_VALUE);
    assert.equal(redacted.headers.cookie, REDACTED_VALUE);
    assert.equal(redacted.nested.sessionToken, REDACTED_VALUE);
    assert.equal(redacted.safe, "visible");
  });

  it("masks embedded URL credentials and local paths in text", () => {
    const text = sanitizeErrorText("failed at postgres://user:pass@example/db for C:\\Users\\me\\Music\\Track.flac");

    assert.match(text || "", /\[REDACTED\]@example/);
    assert.match(text || "", /C:\/\.\.\.\/Track\.flac/);
    assert.doesNotMatch(text || "", /user:pass/);
  });

  it("builds bug reports with version and without secret context", () => {
    const report = buildBugReportTemplate({
      route: "/library-health",
      recentJob: { name: "Sync", status: "failed", summary: "failed with token=abc" },
      worker: { status: "Running", runningJobs: 1, queueDepth: 0, staleJobs: 0 },
    });

    assert.match(report, new RegExp(APP_VERSION));
    assert.match(report, /\/library-health/);
    assert.doesNotMatch(report, /abc/);
  });

  it("builds sanitized job failure reports", () => {
    const report = buildJobFailureReport({
      name: "audio features sync",
      status: "failed",
      processed: 33683,
      failed: 2,
      error: "authorization Bearer secret failed for /music/private/Track.flac",
    });

    assert.match(report, /audio features sync/);
    assert.match(report, /Processed: 33683/);
    assert.match(report, /Failed: 2/);
    assert.match(report, new RegExp(APP_VERSION));
    assert.doesNotMatch(report, /secret/);
    assert.doesNotMatch(report, /\/music\/private\/Track\.flac/);
  });
});
