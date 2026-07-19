import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { calculateDecisionRates, PERSONALIZATION_EXPORT_FORMAT, PERSONALIZATION_EXPORT_SCHEMA_VERSION, scoreDistribution } from "./personalization/dashboard";
import { aiExploration, roadmapCycles, roadmapReleases } from "./roadmap";

describe("personalization dashboard calculations", () => {
  it("reports behavioral acceptance and rejection rates without inventing zero-data percentages", () => {
    assert.deepEqual(calculateDecisionRates(0, 0), { total: 0, acceptanceRate: null, rejectionRate: null });
    assert.deepEqual(calculateDecisionRates(13, 7), { total: 20, acceptanceRate: .65, rejectionRate: .35 });
  });

  it("places score changes into the documented distribution buckets", () => {
    const distribution = scoreDistribution([-15, -11, -10, -6, -5, -1, 0, 1, 5, 6, 10, 11, 15]);
    assert.deepEqual(distribution.map((item) => item.label), ["-15 to -11", "-10 to -6", "-5 to -1", "No change", "+1 to +5", "+6 to +10", "+11 to +15"]);
    assert.deepEqual(distribution.map((item) => item.count), [2, 2, 2, 1, 2, 2, 2]);
  });
});

describe("personalization dashboard security and performance contracts", () => {
  const service = readFileSync(join(process.cwd(), "src", "lib", "personalization", "dashboard.ts"), "utf8");

  it("uses a versioned export format and does not select stored credentials", () => {
    assert.equal(PERSONALIZATION_EXPORT_FORMAT, "mixarr.personalization");
    assert.equal(PERSONALIZATION_EXPORT_SCHEMA_VERSION, 1);
    assert.doesNotMatch(service, /accessToken:\s*true/);
    assert.doesNotMatch(service, /passwordHash:\s*true/);
    assert.match(service, /EXPORT_COLLECTION_LIMIT = 50_000/);
  });

  it("creates replacement backups and applies imports transactionally", () => {
    assert.match(service, /mode === "replace"/);
    assert.match(service, /personalizationImportBackup\.create/);
    assert.match(service, /prisma\.\$transaction/);
    assert.match(service, /library: \{ server: \{ userId \} \}/);
  });

  it("keeps dashboard drill-down paginated and bounded", () => {
    assert.match(service, /clampPageSize/);
    assert.match(service, /take: pageSize/);
    assert.match(service, /SCORE_SAMPLE_LIMIT = 2_000/);
    assert.match(service, /take: 10_000/);
  });

  it("requires session authentication on every new management route", () => {
    const routes = ["summary", "suggestions", "identities", "identities/compare", "export", "import", "import/validate", "dashboard-reset", "health", "cleanup", "onboarding"];
    for (const name of routes) {
      const source = readFileSync(join(process.cwd(), "src", "app", "api", "personalization", ...name.split("/"), "route.ts"), "utf8");
      assert.match(source, /mixarr_session/, name);
      assert.match(source, /Unauthorized/, name);
    }
  });

  it("adds additive schema, ownership indexes, backup retention, and content-free audits", () => {
    const migration = readFileSync(join(process.cwd(), "prisma", "migrations", "20260717010000_personalization_dashboard_v2110", "migration.sql"), "utf8");
    assert.match(migration, /onboardingState/);
    assert.match(migration, /PersonalizationImportBackup/);
    assert.match(migration, /PersonalizationAuditEntry/);
    assert.match(migration, /SmartMixDecisionTrace_userId_decision_createdAt_idx/);
    assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);
  });
});

describe("v2.1.10 roadmap separation", () => {
  it("completes adaptive personalization and keeps AI optional in v2.3.x", () => {
    assert.equal(roadmapReleases.find((item) => item.version === "2.1.10")?.status, "completed");
    assert.equal(roadmapCycles.find((item) => item.id === "2.1.x")?.status, "completed");
    assert.equal(roadmapCycles.find((item) => item.id === "2.2.x")?.status, "completed");
    assert.equal(roadmapCycles.find((item) => item.id === "2.3.x")?.status, "current");
    assert.match(aiExploration.description, /Ollama/);
    assert.match(aiExploration.description, /OpenRouter/);
    assert.match(aiExploration.description, /OpenAI/);
    assert.match(aiExploration.description, /Anthropic/);
    assert.ok(aiExploration.safeguards.includes("Core generation and scoring work without AI"));
  });
});
