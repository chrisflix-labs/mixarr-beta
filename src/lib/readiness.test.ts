import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildDatabaseReadinessCheck, buildReadinessLogLine, buildReadinessMessages, supportLinkChecks, type AppReadiness, type ReadinessCheck } from "./readiness";
import { sanitizeDiagnostics } from "./supportRedaction";

function check(label: string, status: ReadinessCheck["status"], summary: string): ReadinessCheck {
  return { label, status, summary };
}

function readiness(overrides: Partial<AppReadiness["checks"]> = {}): AppReadiness {
  const checks = {
    database: check("Database", "OK", "Database connection and schema checks passed."),
    storage: check("Storage", "OK", "Mixarr managed storage has adequate free space."),
    plex: check("Plex", "Warning", "Plex token missing. Plex sync will be unavailable until configured."),
    worker: check("Background Worker", "Warning", "Background worker heartbeat is stale."),
    scheduler: check("Scheduler", "Error", "Scheduler cron schedule is invalid."),
    localAudioAnalysis: check("Local Audio Analysis", "Disabled", "Local audio analysis is disabled."),
    externalApis: check("External APIs", "Disabled", "Mixarr is configured for local analysis and no API providers are enabled."),
    secretsEncryption: check("Secrets Encryption", "Warning", "Secret encryption key is not configured. API credentials cannot be saved from the UI."),
    supportLinks: check("Support Links", "Warning", "Discord support link is not configured."),
    githubRepo: check("GitHub Repo", "OK", "GitHub beta repo is configured."),
    environment: check("Environment", "OK", "Environment variables look sane."),
    ...overrides,
  };
  return {
    version: "v1.5.0",
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
      "[Readiness] Secret encryption key is not configured. API credentials cannot be saved from the UI.",
      "[Readiness] Discord support link is not configured.",
    ]);
  });

  it("summarizes startup readiness using compact status labels", () => {
    const logLine = buildReadinessLogLine(readiness({
      plex: check("Plex", "OK", "Plex is configured and reachable."),
      worker: check("Background Worker", "OK", "Background worker is idle."),
      scheduler: check("Scheduler", "OK", "Scheduler is enabled (0 3 * * *)."),
      localAudioAnalysis: check("Local Audio Analysis", "OK", "Local Essentia analysis is available."),
      secretsEncryption: check("Secrets Encryption", "OK", "Secret encryption is configured for UI-saved API credentials."),
    }));

    assert.equal(
      logLine,
      "[Readiness] Startup check completed database=ok storage=ok plex=connected worker=ok scheduler=ok localAnalysis=enabled externalApis=disabled discord=not_configured",
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
    assert.equal(json.includes("v1.5.0"), true);
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

describe("support link readiness", () => {
  function withDiscordSupportUrl(value: string | undefined, test: () => void) {
    const originalDiscord = process.env.DISCORD_SUPPORT_URL;
    const originalPublicDiscord = process.env.NEXT_PUBLIC_DISCORD_SUPPORT_URL;
    delete process.env.NEXT_PUBLIC_DISCORD_SUPPORT_URL;
    if (value === undefined) delete process.env.DISCORD_SUPPORT_URL;
    else process.env.DISCORD_SUPPORT_URL = value;
    try {
      test();
    } finally {
      if (originalDiscord === undefined) delete process.env.DISCORD_SUPPORT_URL;
      else process.env.DISCORD_SUPPORT_URL = originalDiscord;
      if (originalPublicDiscord === undefined) delete process.env.NEXT_PUBLIC_DISCORD_SUPPORT_URL;
      else process.env.NEXT_PUBLIC_DISCORD_SUPPORT_URL = originalPublicDiscord;
    }
  }

  it("accepts modern Discord channel URLs", () => {
    withDiscordSupportUrl("https://discord.com/channels/1522752907378819156/1522764175305080842", () => {
      const result = supportLinkChecks().supportLinks;

      assert.equal(result.status, "OK");
      assert.equal(result.summary, "Discord support link is configured.");
    });
  });

  it("accepts legacy Discord channel URLs", () => {
    withDiscordSupportUrl("https://discordapp.com/channels/1522752907378819156/1522764175305080842", () => {
      const result = supportLinkChecks().supportLinks;

      assert.equal(result.status, "OK");
      assert.equal(result.summary, "Discord support link is configured.");
    });
  });

  it("accepts common Discord invite URLs", () => {
    const urls = [
      "https://discord.gg/B7xMvAhaF",
      "https://discord.com/invite/B7xMvAhaF",
      "https://discordapp.com/invite/B7xMvAhaF",
    ];

    for (const url of urls) {
      withDiscordSupportUrl(url, () => {
        const result = supportLinkChecks().supportLinks;

        assert.equal(result.status, "OK", url);
        assert.equal(result.summary, "Discord support link is configured.", url);
      });
    }
  });

  it("keeps missing Discord support as a warning", () => {
    withDiscordSupportUrl(undefined, () => {
      const result = supportLinkChecks().supportLinks;

      assert.equal(result.status, "Warning");
      assert.equal(result.summary, "Discord support link is not configured.");
    });
  });

  it("reports invalid non-Discord support URLs clearly", () => {
    withDiscordSupportUrl("https://example.com/support", () => {
      const result = supportLinkChecks().supportLinks;

      assert.equal(result.status, "Warning");
      assert.equal(result.summary, "Discord support link is configured but does not look like a valid Discord URL.");
    });
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
