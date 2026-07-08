import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildDatabaseReadinessCheck, buildReadinessLogLine, buildReadinessMessages, type AppReadiness, type ReadinessCheck } from "./readiness";
import { sanitizeDiagnostics } from "./supportRedaction";

function check(label: string, status: ReadinessCheck["status"], summary: string): ReadinessCheck {
  return { label, status, summary };
}

function readiness(overrides: Partial<AppReadiness["checks"]> = {}): AppReadiness {
  const checks = {
    database: check("Database", "OK", "Database connection and schema checks passed."),
    plex: check("Plex", "Warning", "Plex token missing. Plex sync will be unavailable until configured."),
    worker: check("Background Worker", "Warning", "Background worker heartbeat is stale."),
    scheduler: check("Scheduler", "Error", "Scheduler cron schedule is invalid."),
    localAudioAnalysis: check("Local Audio Analysis", "Disabled", "Local audio analysis is disabled."),
    supportLinks: check("Support Links", "Warning", "Discord support link is not configured."),
    githubRepo: check("GitHub Repo", "OK", "GitHub beta repo is configured."),
    environment: check("Environment", "OK", "Environment variables look sane."),
    ...overrides,
  };
  return {
    version: "v1.3.9.1",
    betaLabel: "Beta",
    releaseChannel: "beta",
    checkedAt: "2026-07-08T00:00:00.000Z",
    overallStatus: "Error",
    checks,
    messages: [],
  };
}

describe("readiness diagnostics", () => {
  it("builds warning and error readiness messages without crashing optional missing settings", () => {
    const messages = buildReadinessMessages(readiness());

    assert.deepEqual(messages, [
      "[Readiness] Plex token missing. Plex sync will be unavailable until configured.",
      "[Readiness] Background worker heartbeat is stale.",
      "[Readiness] Scheduler cron schedule is invalid.",
      "[Readiness] Discord support link is not configured.",
    ]);
  });

  it("summarizes startup readiness using compact status labels", () => {
    const logLine = buildReadinessLogLine(readiness({
      plex: check("Plex", "OK", "Plex is configured and reachable."),
      worker: check("Background Worker", "OK", "Background worker is idle."),
      scheduler: check("Scheduler", "OK", "Scheduler is enabled (0 3 * * *)."),
      localAudioAnalysis: check("Local Audio Analysis", "OK", "Local Essentia analysis is available."),
    }));

    assert.equal(
      logLine,
      "[Readiness] Startup check completed database=ok plex=connected worker=ok scheduler=ok localAnalysis=enabled discord=not_configured",
    );
  });

  it("keeps diagnostics redacted", () => {
    const sanitized = sanitizeDiagnostics({
      appReadiness: readiness(),
      plexToken: "secret-token",
      nested: {
        apiKey: "secret-api-key",
        error: "token=secret-token password=secret-password path=C:\\Users\\person\\Music\\song.flac",
      },
    });
    const json = JSON.stringify(sanitized);

    assert.equal(json.includes("secret-token"), false);
    assert.equal(json.includes("secret-api-key"), false);
    assert.equal(json.includes("secret-password"), false);
    assert.equal(json.includes("C:\\Users\\person\\Music\\song.flac"), false);
    assert.equal(json.includes("v1.3.9.1"), true);
  });

  it("keeps known navigation routes resolvable or redirected", () => {
    const routes = [
      "page.tsx",
      "builder/page.tsx",
      "smart-builder/page.tsx",
      "recipes/page.tsx",
      "generated-playlists/page.tsx",
      "playlist-history/page.tsx",
      "library/page.tsx",
      "tracks/page.tsx",
      "genres/page.tsx",
      "data-enrichment/page.tsx",
      "library-health/page.tsx",
      "job-history/page.tsx",
      "release-notes/page.tsx",
      "roadmap/page.tsx",
      "settings/page.tsx",
      "support/page.tsx",
    ];

    for (const route of routes) {
      const source = readFileSync(join(process.cwd(), "src", "app", ...route.split("/")), "utf8");
      assert.equal(source.length > 0, true, `${route} should exist`);
    }
  });
});

function modelDelegate(error?: unknown) {
  return {
    findFirst: async () => {
      if (error) throw error;
      return null;
    },
  };
}

function mockDatabase(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: async () => [{ ok: 1 }],
    $queryRawUnsafe: async () => [],
    user: modelDelegate(),
    server: modelDelegate(),
    library: modelDelegate(),
    track: modelDelegate(),
    syncLog: modelDelegate(),
    jobHistory: modelDelegate(),
    workerHeartbeat: modelDelegate(),
    systemState: modelDelegate(),
    ...overrides,
  } as any;
}

describe("database readiness check", () => {
  it("returns OK when the connection and core model probes work", async () => {
    const result = await buildDatabaseReadinessCheck(mockDatabase());

    assert.equal(result.status, "OK");
    assert.equal(result.summary, "Database connection and schema checks passed.");
    assert.equal(result.diagnostics?.coreTables, "verified");
  });

  it("does not require optional migration metadata when core tables are queryable", async () => {
    const result = await buildDatabaseReadinessCheck(mockDatabase({
      $queryRawUnsafe: async () => [],
    }));

    assert.equal(result.status, "OK");
    assert.equal(result.diagnostics?.migrationState, "unavailable");
  });

  it("returns Warning only when migration metadata shows incomplete migrations", async () => {
    let callCount = 0;
    const result = await buildDatabaseReadinessCheck(mockDatabase({
      $queryRawUnsafe: async () => {
        callCount += 1;
        return callCount === 1
          ? [{ table_name: "_prisma_migrations" }]
          : [{ migration_name: "20260708010000_worker_reliability" }];
      },
    }));

    assert.equal(result.status, "Warning");
    assert.equal(result.summary, "Database is reachable, but some migrations may be missing. Check container logs or run migrations.");
    assert.deepEqual(result.diagnostics?.incompleteMigrations, ["20260708010000_worker_reliability"]);
  });

  it("returns Error with missing required table diagnostics for a core table failure", async () => {
    const result = await buildDatabaseReadinessCheck(mockDatabase({
      track: modelDelegate({ code: "P2021", message: "The table `Track` does not exist." }),
    }));

    assert.equal(result.status, "Error");
    assert.equal(result.summary, "Database schema check found missing required tables.");
    assert.deepEqual(result.diagnostics?.missingRequiredTables, ["Track"]);
  });

  it("returns Error with a safe message when the connection fails", async () => {
    const result = await buildDatabaseReadinessCheck(mockDatabase({
      $queryRaw: async () => {
        throw new Error("password=super-secret database_url=postgres://user:pass@example/db");
      },
    }));

    assert.equal(result.status, "Error");
    assert.equal(result.summary, "Database is not reachable.");
    assert.equal(JSON.stringify(result).includes("super-secret"), false);
    assert.equal(JSON.stringify(result).includes("postgres://user:pass@example/db"), false);
  });
});
