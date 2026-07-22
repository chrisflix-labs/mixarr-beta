import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aiTroubleshootingResponseSchema } from "./troubleshooting/contracts";
import { buildCandidateFunnel, candidateShortageFindings, requiredElevenOfFiftyFixture } from "./troubleshooting/diagnostics";
import { DiagnosticSanitizer, containsLikelySecret, sanitizeDiagnosticValue } from "./troubleshooting/sanitizer";

test("diagnostic sanitizer recursively removes credentials and uses stable session placeholders", () => {
  const sanitizer = new DiagnosticSanitizer();
  const value = sanitizer.sanitize({ authorization: "Bearer real-secret", nested: { client_secret: "abc", message: "user@example.com called https://host.internal/api?token=abc from 10.0.0.4 at C:\\Music\\Artist\\song.flac" }, repeated: "user@example.com 10.0.0.4" }) as any;
  assert.equal(value.authorization, "[REDACTED_CREDENTIAL]");
  assert.equal(value.nested.client_secret, "[REDACTED_CREDENTIAL]");
  assert.doesNotMatch(JSON.stringify(value), /real-secret|user@example\.com|10\.0\.0\.4|C:\\Music/);
  assert.match(value.nested.message, /\[USER_1\]/);
  assert.match(value.repeated, /\[USER_1\].*\[IP_ADDRESS_1\]/);
  assert.equal(containsLikelySecret(value), false);
  assert.ok(sanitizer.summary.credentials_removed >= 3);
});

test("diagnostic sanitizer protects maximum recursion depth", () => {
  const input: any = {}; input.a = { b: { c: { d: "hidden" } } };
  const result = sanitizeDiagnosticValue(input, 2);
  assert.equal((result.value as any).a.b.c, "[MAX_DEPTH_REMOVED]");
  assert.equal(result.summary.depth_limited, 1);
});

test("candidate funnel uses first rejection reasons without double-counting", () => {
  const funnel = buildCandidateFunnel({ totalScanned: 100, requested: 30, selected: 15, firstRejectionCounts: { genre: 50, release_year: 20, recent_play: 15 }, overlapCounts: { "genre+release_year": 12 } });
  assert.equal(funnel.eligible, 15);
  assert.equal(funnel.stages.reduce((sum, stage) => sum + stage.rejected, 0) + funnel.eligible, 100);
  assert.equal(funnel.unfilled, 15);
  assert.equal(funnel.overlap?.["genre+release_year"], 12);
});

test("required 11-of-50 scenario produces confirmed candidate exhaustion", () => {
  const funnel = requiredElevenOfFiftyFixture();
  assert.deepEqual(funnel.stages.map((stage) => stage.rejected), [2102, 491, 183, 53]);
  assert.equal(funnel.eligible, 11); assert.equal(funnel.selected, 11); assert.equal(funnel.unfilled, 39);
  const [finding] = candidateShortageFindings(funnel);
  assert.equal(finding.checkId, "recipe.candidate_pool.exhausted");
  assert.equal(finding.evidenceStrength, "CONFIRMED");
  assert.match(finding.summary, /Only 11 eligible candidates remained for 50 requested tracks/);
  assert.match(finding.limitations[0], /simulation/);
});

test("AI response schema rejects arbitrary operations and requires finding references", () => {
  const base = { summary: "The candidate pool is exhausted. No settings have been changed.", most_likely_causes: [{ interpretation: "Genre rules removed most candidates.", finding_ids: ["recipe.candidate_pool.exhausted"], classification: "LIKELY_INTERPRETATION" }], how_the_findings_connect: "The filters leave too few candidates.", suggested_actions: [{ title: "Widen years", explanation: "Review a wider range.", action_type: "RECIPE_SET_VALUE", finding_ids: ["recipe.candidate_pool.exhausted"], target_resource_type: "RECIPE", target_resource_id: "r1", setting_path: "rules", proposed_value: [], expected_effect: "May broaden eligibility.", possible_side_effects: ["Composition changes"], risk_level: "LOW", reversible: true, manual_only: false }], missing_information: [], uncertainty_warnings: [], technical_details: "" };
  assert.equal(aiTroubleshootingResponseSchema.safeParse(base).success, true);
  assert.equal(aiTroubleshootingResponseSchema.safeParse({ ...base, suggested_actions: [{ ...base.suggested_actions[0], action_type: "EXECUTE_SHELL_COMMAND" }] }).success, false);
  assert.equal(aiTroubleshootingResponseSchema.safeParse({ ...base, most_likely_causes: [{ ...base.most_likely_causes[0], finding_ids: [] }] }).success, false);
});

test("troubleshooting UI and service enforce preview, approval, stale checks, and non-persistent simulations", () => {
  const root = process.cwd();
  const service = readFileSync(join(root, "src/lib/troubleshooting/service.ts"), "utf8");
  const contracts = readFileSync(join(root, "src/lib/troubleshooting/contracts.ts"), "utf8");
  const page = readFileSync(join(root, "src/app/troubleshooting/page.tsx"), "utf8");
  const migration = readFileSync(join(root, "prisma/migrations/20260726010000_ai_assisted_troubleshooting_v248/migration.sql"), "utf8");
  assert.match(service, /DETERMINISTIC_DIAGNOSTICS_REQUIRED/);
  assert.match(service, /SUGGESTION_STALE/);
  assert.match(service, /playlistConfigSchema\.parse/);
  assert.match(service, /playlistWritten: false/);
  assert.match(service, /historyUpdated: false/);
  assert.match(contracts, /I approve this exact change/);
  assert.match(page, /No settings have been changed/);
  assert.match(page, /Preview sanitized bundle/);
  assert.match(page, /No action is preselected/);
  assert.match(migration, /troubleshooting_explanations', false/);
});
