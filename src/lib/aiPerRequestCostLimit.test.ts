import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("AI per-request cost-limit integration contracts", () => {
  it("persists dedicated enabled flags and decimal values at every supported scope", () => {
    const schema = read("prisma/schema.prisma");
    for (const model of ["AiGovernanceSetting", "AiProviderBudget", "AiUserLimit"]) {
      const section = schema.slice(schema.indexOf(`model ${model}`), schema.indexOf("\n}", schema.indexOf(`model ${model}`)));
      assert.match(section, /perRequestCostLimitEnabled\s+Boolean/);
      assert.match(section, /perRequestCostLimitUsd\s+Decimal\?/);
    }
  });

  it("ships an idempotent legacy migration that preserves positive values and disables zero/null", () => {
    const migration = read("prisma/migrations/20260801010000_ai_per_request_cost_limit_semantics/migration.sql");
    assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
    assert.match(migration, /global_enabled_column_existed/);
    assert.match(migration, /maximumCumulativeRequestCost" > 0/);
    assert.match(migration, /ELSE NULL/);
    assert.doesNotMatch(migration, /\b(DELETE|TRUNCATE|DROP TABLE)\b/i);
    const dockerPreflight = read("prisma/db-push-preflight.sql");
    assert.match(dockerPreflight, /AiGovernanceSetting[\s\S]*perRequestCostLimitEnabled/);
    assert.match(dockerPreflight, /enabled_column_existed/);
    assert.match(dockerPreflight, /maximumCumulativeRequestCost" > 0/);
  });

  it("validates enabled amounts on global, provider, and user settings writes", () => {
    const governance = read("src/ai/governance/service.ts");
    const budgets = read("src/app/api/ai/budgets/route.ts");
    const users = read("src/ai/governance/userPolicy.ts");
    for (const source of [governance, budgets, users]) {
      assert.match(source, /perRequestCostLimitEnabled/);
      assert.match(source, /greater than zero when enforcement is enabled/);
    }
  });

  it("resolves policy from only the selected provider and reports source-safe block details", () => {
    const service = read("src/ai/governance/service.ts");
    assert.match(service, /providerRow\.governanceBudget\?\.perRequestCostLimitEnabled/);
    assert.match(service, /resolvePerRequestCostLimit/);
    for (const field of ["estimated_cost_usd", "effective_limit_usd", "limit_source", "provider", "feature"]) assert.match(service, new RegExp(field));
    assert.match(service, /configuredLimits/);
    assert.doesNotMatch(service, /limit:\s*governance\.maximumCumulativeRequestCost\?\.toString\(\),\s*reasonCode:\s*"AI_REQUEST_COST_LIMIT_EXCEEDED"/);
  });

  it("does not cache policy and reloads settings after writes", () => {
    const service = read("src/ai/governance/service.ts");
    const ui = read("src/components/AiGovernanceDashboard.tsx");
    assert.match(service, /export async function previewAiRequest[\s\S]*aiGovernanceSetting\.upsert/);
    assert.doesNotMatch(service, /unstable_cache|React\.cache|memoize/i);
    assert.match(ui, /cache:\s*"no-store"/);
    assert.match(ui, /await onSaved\(\)/);
  });

  it("wires accessible toggles, disables amount inputs, and displays Disabled/Unlimited plus source", () => {
    const ui = read("src/components/AiGovernanceDashboard.tsx");
    assert.match(ui, /Enforce global per-request cost limit/);
    assert.match(ui, /disabled=\{!enabled\}/);
    assert.match(ui, /Disabled \/ Unlimited/);
    assert.match(ui, /Provider override/);
    assert.match(ui, /User override/);
    const copilot = read("src/components/RecipeCopilot.tsx");
    assert.match(copilot, /Per-request cost limit:/);
    assert.match(copilot, /perRequestCostLimit\.source/);
  });

  it("keeps Recipe Copilot on the shared policy coordinator and leaves generated recipes review-only", () => {
    const copilot = read("src/lib/recipeCopilot/service.ts");
    assert.match(copilot, /previewAiRequest/);
    assert.match(copilot, /aiRequestCoordinator\.complete/);
    assert.match(copilot, /status:\s*"READY_FOR_REVIEW"/);
    assert.match(copilot, /automatic_activation:\s*false/);
    assert.doesNotMatch(copilot, /status:\s*"ACTIVE"[\s\S]{0,120}aiRequestCoordinator\.complete/);
  });

  it("returns the intentional block response with six-decimal amounts and source", () => {
    const errors = read("src/ai/errors/index.ts");
    const recipeApi = read("src/lib/recipeCopilot/api.ts");
    for (const source of [errors, recipeApi]) {
      for (const field of ["estimated_cost_usd", "effective_limit_usd", "limit_source", "provider", "feature"]) assert.match(source, new RegExp(field));
    }
    assert.match(recipeApi, /Estimated request cost exceeds the configured per-request limit/);
  });
});
