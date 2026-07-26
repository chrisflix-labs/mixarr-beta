import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  costLimitAuditDetails, costLimitControlName, describeCostLimitBlock, describeCostLimitFromDetails,
  MAXIMUM_AI_COST_LIMIT, normalizeCostLimitMode, normalizeCostLimitValue, resolveCostLimit,
  validateCostLimitConfiguration,
} from "../ai/governance/costLimits";
import { evaluateCostLimit, evaluateRetryCost } from "../ai/governance/policy";
import {
  isRecipeCopilotCostLimitError, isRecipeCopilotRequestLimitError, recipeCopilotErrorMessage,
  recipeCopilotSettingsUrl,
} from "./recipeCopilot/readiness";

const read = (path: string) => readFileSync(path, "utf8");
const admit = (mode: unknown, limit: unknown, estimatedCost: number) => {
  const resolution = resolveCostLimit({ control: "PER_REQUEST", mode, limit });
  return { resolution, decision: evaluateCostLimit({ scope: "request", estimatedCost, limit: resolution.limit, reasonCode: "AI_REQUEST_COST_LIMIT_EXCEEDED" }) };
};

describe("v2.4.14 per-request AI cost-limit resolution", () => {
  it("admits a priced request when no per-request limit is configured", () => {
    for (const [mode, limit] of [["UNLIMITED", null], ["UNLIMITED", ""], [null, null], [undefined, undefined], ["", ""]] as Array<[unknown, unknown]>) {
      const { resolution, decision } = admit(mode, limit, 0.05);
      assert.equal(resolution.effectiveMode, "UNLIMITED");
      assert.equal(resolution.limit, null);
      assert.equal(decision.allowed, true, `mode ${String(mode)} / limit ${String(limit)} must not block a priced request`);
    }
  });

  it("never reads an unset or Unlimited ceiling as a limit of exactly zero", () => {
    // The onboarding default that caused AI_REQUEST_COST_LIMIT_EXCEEDED.
    assert.equal(admit("UNLIMITED", 0, 0.000001).decision.allowed, true);
    assert.equal(admit("UNLIMITED", "0", 12.5).decision.allowed, true);
    assert.equal(admit(undefined, 0, 0.05).decision.allowed, true);
  });

  it("keeps an explicit zero ceiling meaningful under Limited", () => {
    const free = admit("LIMITED", 0, 0);
    assert.equal(free.resolution.effectiveMode, "LIMITED");
    assert.equal(free.resolution.limitNumber, 0);
    assert.equal(free.decision.allowed, true, "a free or local request stays admissible under a zero ceiling");
    assert.equal(admit("LIMITED", 0, 0.000001).decision.allowed, false, "a priced request is refused by a deliberate zero ceiling");
  });

  it("enforces a positive ceiling at the boundary", () => {
    assert.equal(admit("LIMITED", "0.050000", 0.05).decision.allowed, true);
    assert.equal(admit("LIMITED", "0.050000", 0.050001).decision.allowed, false);
    assert.equal(admit("LIMITED", "0.050000", 0.050001).decision.reasonCode, "AI_REQUEST_COST_LIMIT_EXCEEDED");
  });

  it("treats Limited without an amount as a configuration problem, not a zero ceiling", () => {
    const missing = resolveCostLimit({ control: "PER_REQUEST", mode: "LIMITED", limit: null });
    assert.equal(missing.effectiveMode, "UNLIMITED");
    assert.equal(missing.configurationIssue, "LIMITED_WITHOUT_LIMIT");
    assert.equal(admit("LIMITED", null, 5).decision.allowed, true);
    assert.equal(resolveCostLimit({ control: "PER_REQUEST", mode: "LIMITED", limit: "not-a-number" }).configurationIssue, "INVALID_LIMIT");
  });

  it("lets Unlimited override an amount still stored on the row", () => {
    const resolution = resolveCostLimit({ control: "PER_REQUEST", mode: "UNLIMITED", limit: "0.010000" });
    assert.equal(resolution.limit, null);
    assert.equal(resolution.limitNumber, null);
  });

  it("preserves exact decimal amounts rather than rounding through a float", () => {
    assert.equal(normalizeCostLimitValue("0.000001"), "0.000001");
    assert.equal(normalizeCostLimitValue(0), "0");
    assert.equal(normalizeCostLimitValue("1.1234567"), null);
    assert.equal(normalizeCostLimitValue("-1"), null);
    assert.equal(normalizeCostLimitValue(MAXIMUM_AI_COST_LIMIT + 1), null);
    assert.equal(resolveCostLimit({ control: "PER_REQUEST", mode: "LIMITED", limit: "0.000001" }).limit, "0.000001");
  });

  it("normalizes modes without inventing a limited state", () => {
    assert.equal(normalizeCostLimitMode("limited"), "LIMITED");
    assert.equal(normalizeCostLimitMode(" Unlimited "), "UNLIMITED");
    assert.equal(normalizeCostLimitMode(undefined), "UNLIMITED");
    assert.equal(normalizeCostLimitMode("nonsense"), "UNLIMITED");
  });

  it("keeps the per-request and cumulative retry ceilings as separate controls", () => {
    assert.equal(costLimitControlName("PER_REQUEST"), "per-request estimated cost limit");
    assert.equal(costLimitControlName("CUMULATIVE_REQUEST"), "cumulative request cost limit");
    // An unlimited cumulative ceiling must not block a retry, and it is evaluated
    // only after a transient failure — never on admission.
    const cumulative = resolveCostLimit({ control: "CUMULATIVE_REQUEST", mode: "UNLIMITED", limit: 0 });
    assert.equal(evaluateRetryCost({ incrementalCost: "0.050000", retryNumber: 1, retryLimit: null, initialAttemptCost: "0.050000", cumulativeRequestLimit: cumulative.limit }).allowed, true);
    const limited = resolveCostLimit({ control: "CUMULATIVE_REQUEST", mode: "LIMITED", limit: "0.060000" });
    assert.equal(evaluateRetryCost({ incrementalCost: "0.050000", retryNumber: 1, retryLimit: null, initialAttemptCost: "0.050000", cumulativeRequestLimit: limited.limit }).allowed, false);
  });

  it("keeps sanitized audit details limited to configuration values", () => {
    const details = costLimitAuditDetails({ control: "PER_REQUEST", resolution: resolveCostLimit({ control: "PER_REQUEST", mode: "LIMITED", limit: "0.010000" }), estimatedCost: 0.05, currency: "USD" });
    assert.deepEqual(Object.keys(details).sort(), ["control", "currency", "estimated_cost", "limit", "mode", "scope"]);
    assert.equal(details.limit, 0.01);
    assert.equal(details.control, "PER_REQUEST");
  });

  it("explains a block with the amounts, the control, and a route to the setting", () => {
    const message = describeCostLimitBlock({ control: "PER_REQUEST", estimatedCost: 0.05, limit: 0.01, currency: "USD" });
    assert.match(message, /estimated to cost 0\.050000 USD, which exceeds the per-request estimated cost limit of 0\.010000 USD/);
    assert.match(message, /Unlimited in AI Governance → Budgets → AI cost limits/);
    assert.match(describeCostLimitBlock({ control: "PER_REQUEST", estimatedCost: 0.05, limit: 0, currency: "USD" }), /set to zero, which admits only free or local-provider requests/);
    assert.match(describeCostLimitBlock({ control: "CUMULATIVE_REQUEST", estimatedCost: 1, limit: 0.5, currency: "EUR" }), /cumulative request cost limit of 0\.500000 EUR/);
  });

  it("rebuilds the same explanation from a sanitized error payload", () => {
    const details = costLimitAuditDetails({ control: "PER_REQUEST", resolution: resolveCostLimit({ control: "PER_REQUEST", mode: "LIMITED", limit: "0" }), estimatedCost: 0.05, currency: "USD" });
    assert.match(String(describeCostLimitFromDetails(details as Record<string, unknown>)), /set to zero/);
    assert.equal(describeCostLimitFromDetails({}), null);
    assert.equal(describeCostLimitFromDetails(null), null);
    assert.equal(describeCostLimitFromDetails({ limit: 1 }), null);
  });
});

describe("v2.4.14 cost-limit configuration validation", () => {
  it("requires an amount when Limited is chosen", () => {
    const result = validateCostLimitConfiguration({ control: "PER_REQUEST", mode: "LIMITED", limit: null });
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.field, "limit"); assert.match(result.error, /maximum amount for the per-request estimated cost limit, or choose Unlimited/); }
  });

  it("accepts an explicit zero amount, which is a real policy", () => {
    const result = validateCostLimitConfiguration({ control: "PER_REQUEST", mode: "LIMITED", limit: 0 });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual([result.mode, result.limit], ["LIMITED", "0"]);
  });

  it("clears any stored amount when Unlimited is chosen", () => {
    const result = validateCostLimitConfiguration({ control: "PER_REQUEST", mode: "UNLIMITED", limit: "0.05" });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual([result.mode, result.limit], ["UNLIMITED", null]);
  });

  it("rejects malformed and out-of-range amounts", () => {
    assert.equal(validateCostLimitConfiguration({ mode: "LIMITED", limit: "1.1234567" }).ok, false);
    assert.equal(validateCostLimitConfiguration({ mode: "LIMITED", limit: "-1" }).ok, false);
    assert.equal(validateCostLimitConfiguration({ mode: "LIMITED", limit: MAXIMUM_AI_COST_LIMIT + 1 }).ok, false);
    assert.equal(validateCostLimitConfiguration({ mode: "LIMITED", limit: "0.123456" }).ok, true);
  });

  it("names the control it is validating", () => {
    const result = validateCostLimitConfiguration({ control: "CUMULATIVE_REQUEST", mode: "LIMITED", limit: "" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /cumulative request cost limit/);
  });
});

describe("v2.4.14 admission, onboarding, and persistence contracts", () => {
  it("admits against the per-request column, not the cumulative retry ceiling", () => {
    const service = read("src/ai/governance/service.ts");
    assert.match(service, /resolveCostLimit\(\{ control: "PER_REQUEST", mode: governance\.perRequestCostLimitMode, limit: governance\.maximumEstimatedRequestCost\?\.toString\(\) \}\)/);
    assert.match(service, /evaluateCostLimit\(\{ scope: "request", estimatedCost: cost\.maximumEstimatedCost, limit: perRequestCostLimit\.limit/);
    assert.doesNotMatch(service, /scope: "request",[^}]*governance\.maximumCumulativeRequestCost/);
  });

  it("still routes every monetary decision through the existing cost comparators", () => {
    const service = read("src/ai/governance/service.ts");
    assert.match(service, /evaluateCostLimit\(/);
    assert.match(service, /evaluateRetryCost\(/);
    assert.match(service, /wouldExceedBudget\(/);
    // The mode resolves which limit applies; the arithmetic is not reimplemented.
    assert.doesNotMatch(read("src/ai/governance/costLimits.ts"), /currencyMicros|AI_CURRENCY_MICROS/);
  });

  it("evaluates the cumulative ceiling only on retry and through its own mode", () => {
    const service = read("src/ai/governance/service.ts");
    assert.match(service, /resolveCostLimit\(\{ control: "CUMULATIVE_REQUEST", mode: governance\.cumulativeRequestCostLimitMode/);
    assert.match(service, /cumulativeRequestLimit: cumulativeCostLimit\.limit/);
  });

  it("validates the merged mode and amount pair before persisting a governance patch", () => {
    const service = read("src/ai/governance/service.ts");
    assert.match(service, /validateCostLimitConfiguration\(\{[\s\S]*?previous\[control\.modeKey\]/);
    assert.match(service, /modeKey: "perRequestCostLimitMode"/);
    assert.match(service, /modeKey: "cumulativeRequestCostLimitMode"/);
  });

  it("stops onboarding writing the per-request amount into the cumulative ceiling", () => {
    const intelligence = read("src/ai/intelligence/service.ts");
    assert.doesNotMatch(intelligence, /maximumCumulativeRequestCost: configuration/);
    assert.match(intelligence, /perRequestCostLimitMode: z\.enum\(\["UNLIMITED", "LIMITED"\]\)\.default\("UNLIMITED"\)/);
    assert.match(intelligence, /maximumEstimatedRequestCost: z\.number\(\)\.min\(0\)\.max\(100_000\)\.nullable\(\)\.default\(null\)/);
  });

  it("preserves the local-only zero-cost admission policy explicitly", () => {
    assert.match(read("src/ai/intelligence/service.ts"), /configuration\.mode === "LOCAL_ONLY"\s*\?\s*\{ perRequestCostLimitMode: "LIMITED" as const, maximumEstimatedRequestCost: 0 \}/);
  });

  it("defaults new installations to unlimited per-request and cumulative cost", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /perRequestCostLimitMode\s+String\s+@default\("UNLIMITED"\)/);
    assert.match(schema, /maximumEstimatedRequestCost\s+Decimal\?/);
    assert.match(schema, /cumulativeRequestCostLimitMode\s+String\s+@default\("UNLIMITED"\)/);
  });

  it("keeps the other protections evaluated independently of the per-request ceiling", () => {
    const service = read("src/ai/governance/service.ts");
    for (const marker of [/AI_GLOBAL_BUDGET_EXCEEDED/, /AI_PROVIDER_BUDGET_EXCEEDED/, /DAILY_COST_LIMIT_REACHED/, /MONTHLY_COST_LIMIT_REACHED/, /DAILY_REQUEST_LIMIT_REACHED/, /MODEL_UNPRICED/, /PAID_PROVIDER_NOT_PERMITTED/, /PRIVACY_MODE_INCOMPATIBLE/, /AI_RETRY_COST_LIMIT_EXCEEDED/, /PROVIDER_DISABLED/, /allowUnpricedExternalModels/]) assert.match(service, marker);
  });

  it("ships an additive, idempotent migration that separates the two ceilings", () => {
    const migration = read("prisma/migrations/20260802010000_ai_per_request_cost_limit_v2414/migration.sql");
    assert.equal((migration.match(/ADD COLUMN IF NOT EXISTS/g) || []).length, 3);
    assert.match(migration, /SET "maximumEstimatedRequestCost" = "maximumCumulativeRequestCost",\s*\n\s*"perRequestCostLimitMode" = 'LIMITED'/);
    assert.match(migration, /"maximumCumulativeRequestCost" = 0\s*\n\s*AND "privacyMode" <> 'LOCAL_ONLY'\s*\n\s*AND "externalProvidersAllowed" = true/);
    assert.match(migration, /"privacyMode" = 'LOCAL_ONLY' OR "externalProvidersAllowed" = false/);
    assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN/i);
  });
});

describe("v2.4.14 administrator and Recipe Copilot interface", () => {
  it("exposes a per-request cost-limit mode, amount, and save control", () => {
    const ui = read("src/components/AiGovernanceDashboard.tsx");
    assert.match(ui, /id="ai-cost-limits"/);
    assert.match(ui, /Unlimited — no per-request cost cap/);
    assert.match(ui, /Limited — cap the estimated cost of one request/);
    assert.match(ui, /data-field="per_request_cost_limit_mode"/);
    assert.match(ui, /data-field="maximum_estimated_request_cost"/);
    assert.match(ui, /Save AI cost limits/);
  });

  it("warns before a zero ceiling silently blocks every priced request", () => {
    const ui = read("src/components/AiGovernanceDashboard.tsx");
    assert.match(ui, /A zero limit admits only free or local-provider requests/);
    assert.match(ui, /A zero per-request cost limit blocks every priced external AI request\. Save it\?/);
  });

  it("distinguishes the cumulative retry ceiling from the per-request limit in the interface", () => {
    const ui = read("src/components/AiGovernanceDashboard.tsx");
    assert.match(ui, /data-field="cumulative_cost_limit_mode"/);
    assert.match(ui, /the separate per-request limit lives under Budgets → AI cost limits/);
    assert.match(ui, /Unlimited — no cumulative cap/);
  });

  it("gives the onboarding wizard a mode instead of a zero default", () => {
    const wizard = read("src/components/AiIntelligenceCenter.tsx");
    assert.match(wizard, /Per-request cost limit/);
    assert.match(wizard, /Unlimited — no per-request cost cap/);
    assert.match(wizard, /Maximum estimated request cost/);
    assert.doesNotMatch(wizard, /config\.maximumEstimatedRequestCost\?\?0/);
    assert.match(wizard, /local-only setup is saved with an explicit 0\.00 per-request cost limit/);
  });

  it("opens the exact control that blocked the request from a deep link", () => {
    assert.equal(recipeCopilotSettingsUrl("AI_REQUEST_COST_LIMIT_EXCEEDED"), "/settings/ai?section=Budgets#ai-cost-limits");
    assert.equal(recipeCopilotSettingsUrl("AI_RETRY_COST_LIMIT_EXCEEDED"), "/settings/ai?section=Budgets#ai-cost-limits");
    assert.equal(recipeCopilotSettingsUrl("AI_DAILY_LIMIT_EXCEEDED"), "/settings/ai?section=Budgets#ai-request-limits");
    assert.equal(recipeCopilotSettingsUrl("AI_PROVIDER_UNAVAILABLE"), "/settings/ai");
    assert.equal(isRecipeCopilotCostLimitError("AI_REQUEST_COST_LIMIT_EXCEEDED"), true);
    assert.equal(isRecipeCopilotCostLimitError("AI_DAILY_LIMIT_EXCEEDED"), false);
    assert.equal(isRecipeCopilotRequestLimitError("AI_REQUEST_COST_LIMIT_EXCEEDED"), false);
    assert.match(read("src/components/RecipeCopilot.tsx"), /Open AI cost limits/);
  });

  it("tells the administrator where to change the limit in the blocked message", () => {
    assert.match(recipeCopilotErrorMessage("AI_REQUEST_COST_LIMIT_EXCEEDED", "fallback", false), /per-request AI cost limit[\s\S]*Unlimited in AI Governance → Budgets → AI cost limits/);
    const service = read("src/lib/recipeCopilot/service.ts");
    assert.match(service, /describeCostLimitFromDetails/);
    assert.match(read("src/lib/recipeCopilot/api.ts"), /describeCostLimitFromDetails/);
  });

  it("documents the corrected control mapping and the release", () => {
    const docs = read("docs/AI_PER_REQUEST_COST_LIMIT_V2414.md");
    for (const marker of [/maximumEstimatedRequestCost/, /maximumCumulativeRequestCost/, /perRequestCostLimitMode/, /AI_REQUEST_COST_LIMIT_EXCEEDED/, /Unlimited/, /Limited/, /zero/i, /20260802010000_ai_per_request_cost_limit_v2414/]) assert.match(docs, marker);
    assert.match(read("CHANGELOG.md"), /v2\.4\.14 - Per-Request AI Cost Limit Configuration/);
    assert.equal(JSON.parse(read("package.json")).version, "2.4.16");
  });
});
