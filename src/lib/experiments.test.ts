import test from "node:test";
import assert from "node:assert/strict";
import { calculateOutcomeRates, calculateOverlap, diffExperimentConfigurations, experimentCompletionState, mergeExperimentSettings, recommendExperimentWinner, stableConfigurationSnapshot, validateControlledExperiment } from "./experiments/core";

test("configuration snapshots are stable and diff only changed experiment settings", () => {
  assert.deepEqual(stableConfigurationSnapshot({ b: 2, a: { z: 1 } }), stableConfigurationSnapshot({ a: { z: 1 }, b: 2 }));
  const differences = diffExperimentConfigurations({ tuningConfig: { discovery: { deepCutTarget: 25 } }, limit: 50 }, { tuningConfig: { discovery: { deepCutTarget: 45 } }, limit: 50 });
  assert.deepEqual(differences.map((difference) => difference.path), ["tuningConfig.discovery.deepCutTarget"]);
});

test("controlled-variable validation rejects identity drift and unrelated settings", () => {
  const valid = validateControlledExperiment({ experimentType: "DISCOVERY_LEVEL", configurationA: { limit: 50, tuningConfig: { discovery: { deepCutTarget: 25 } } }, configurationB: { limit: 50, tuningConfig: { discovery: { deepCutTarget: 45 } } } });
  assert.equal(valid.valid, true);
  const invalid = validateControlledExperiment({ experimentType: "DISCOVERY_LEVEL", configurationA: { limit: 50, tuningConfig: { discovery: { deepCutTarget: 25 } } }, configurationB: { limit: 75, tuningConfig: { discovery: { deepCutTarget: 45 }, moodWeight: 80 } } });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /identity settings/i);
  assert.match(invalid.errors.join(" "), /do not belong/i);
});

test("acceptance and rejection exclude passive inactivity", () => {
  const rates = calculateOutcomeRates({ evaluated: 50, kept: 41, removed: 2, disliked: 1, neverRecommend: 1, repeatedEarlySkips: 3 });
  assert.equal(rates.acceptanceRate, 82);
  assert.equal(rates.explicitRejections, 4);
  assert.equal(rates.rejectionRate, 14);
  assert.equal(calculateOutcomeRates({ evaluated: 0 }).rejectionRate, 0);
});

test("winner recommendation enforces minimum evidence and explains mixed signals", () => {
  const sparse = recommendExperimentWinner({ a: { acceptanceRate: 70, rejectionRate: 20, sessions: 1, interactions: 3 }, b: { acceptanceRate: 90, rejectionRate: 5, sessions: 1, interactions: 3 }, elapsedHours: 2 });
  assert.equal(sparse.outcome, "MORE_DATA_REQUIRED");
  assert.equal(sparse.suggestedWinner, null);
  assert.equal(sparse.confidence, "VERY_LOW");
  const supported = recommendExperimentWinner({ a: { acceptanceRate: 70, rejectionRate: 20, earlySkipRate: 15, playlistScore: 90, sessions: 8, interactions: 30 }, b: { acceptanceRate: 90, rejectionRate: 5, earlySkipRate: 7, playlistScore: 86, sessions: 8, interactions: 30 }, elapsedHours: 72 });
  assert.equal(supported.suggestedWinner, "B");
  assert.ok(["MODERATE", "HIGH"].includes(supported.confidence));
  assert.ok(supported.explanation.some((item) => item.signal === "playlist score" && item.favors === "A"));
});

test("merge settings creates a new mixed configuration", () => {
  const merged = mergeExperimentSettings({ tuningConfig: { discovery: 25, moodWeight: 80 }, moodBlendMode: "strict" }, { tuningConfig: { discovery: 45, moodWeight: 50 }, moodBlendMode: "smooth" }, { "tuningConfig.discovery": "B", "tuningConfig.moodWeight": "A", moodBlendMode: "A" });
  assert.equal((merged.configuration as any).tuningConfig.discovery, 45);
  assert.equal((merged.configuration as any).tuningConfig.moodWeight, 80);
  assert.equal((merged.configuration as any).moodBlendMode, "strict");
});

test("overlap and duration completion are deterministic", () => {
  assert.deepEqual(calculateOverlap(["1", "2", "3", "4"], ["3", "4", "5", "6"]), { sharedTrackIds: ["3", "4"], sharedTracks: 2, uniqueToA: 2, uniqueToB: 2, overlapPercentage: 50 });
  const start = new Date("2026-07-01T00:00:00Z");
  assert.deepEqual(experimentCompletionState({ status: "RUNNING", durationType: "DAYS", durationTarget: 3, startAt: start, now: new Date("2026-07-04T00:00:00Z") }), { complete: true, remaining: 0 });
  assert.deepEqual(experimentCompletionState({ status: "RUNNING", durationType: "INTERACTIONS", durationTarget: 10, interactions: 7 }), { complete: false, remaining: 3 });
});

test("v2.2.6 implementation contains protected persistence and explicit action APIs", async () => {
  const fs = await import("node:fs/promises");
  const [schema, migration, decision, restoreRoute] = await Promise.all([fs.readFile("prisma/schema.prisma", "utf8"), fs.readFile("prisma/migrations/20260718190000_smart_experiments_v226/migration.sql", "utf8"), fs.readFile("src/lib/experiments/decision.ts", "utf8"), fs.readFile("src/app/api/experiments/[id]/restore-original/route.ts", "utf8")]);
  assert.match(schema, /model SmartExperiment/); assert.match(schema, /originalPlaylistVersionId/); assert.match(schema, /@@unique\(\[variantId, metricType, source\]\)/);
  assert.match(migration, /ON DELETE RESTRICT/); assert.match(decision, /createPlaylistVersion/); assert.match(decision, /confirm/); assert.match(restoreRoute, /restoreExperimentSchema/);
});

test("experiment UI exposes setup, mobile, empty, error, decision, and restore states", async () => {
  const fs = await import("node:fs/promises");
  const [dashboard, detail, dashboardCss, detailCss] = await Promise.all([
    fs.readFile("src/app/experiments/page.tsx", "utf8"), fs.readFile("src/app/experiments/[experimentId]/page.tsx", "utf8"),
    fs.readFile("src/app/experiments/experiments.module.css", "utf8"), fs.readFile("src/app/experiments/[experimentId]/experiment-detail.module.css", "utf8"),
  ]);
  assert.match(dashboard, /Create Smart Experiment/); assert.match(dashboard, /No Smart Experiments yet/); assert.match(dashboard, /Smart Experiments could not be loaded/);
  assert.match(detail, /Select &amp; apply A/); assert.match(detail, /Restore original/); assert.match(detail, /No placeholder tracks are shown/); assert.match(detail, /window\.confirm/);
  assert.match(dashboardCss, /@media\(max-width:700px\)/); assert.match(detailCss, /@media\(max-width:700px\)/); assert.doesNotMatch(detailCss, /min-width:\s*[89]\d\dpx/);
});

test("large-library experiment paths stay batched and scheduled work is bounded", async () => {
  const fs = await import("node:fs/promises");
  const [generation, metrics, scheduler] = await Promise.all([fs.readFile("src/lib/experiments/generation.ts", "utf8"), fs.readFile("src/lib/experiments/metrics.ts", "utf8"), fs.readFile("src/lib/experiments/scheduler.ts", "utf8")]);
  assert.match(generation, /offset \+= 500/); assert.match(metrics, /offset \+= 400/); assert.match(generation, /take: 25/); assert.match(metrics, /take: 100/); assert.match(scheduler, /5 \* 60 \* 1000/);
});
