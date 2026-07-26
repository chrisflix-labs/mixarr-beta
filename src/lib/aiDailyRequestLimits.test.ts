import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  describeRequestLimitBlock, describeRequestLimitFromDetails, evaluateRequestLimit, MAXIMUM_AI_REQUEST_LIMIT,
  normalizeRequestLimitMode, normalizeRequestLimitValue, requestLimitAuditDetails, requestLimitResetAt,
  resolveRequestLimitScope, validateRequestLimitConfiguration,
} from "../ai/governance/requestLimits";
import { aiUserPolicySchema, fieldErrorsFromZod } from "../ai/governance/userPolicy";
import {
  isRecipeCopilotRequestLimitError, recipeCopilotCanRequest, recipeCopilotDailyRequestSummary,
  recipeCopilotErrorMessage, recipeCopilotSettingsUrl,
} from "./recipeCopilot/readiness";

const read = (path: string) => readFileSync(path, "utf8");
const daily = (scopes: Parameters<typeof evaluateRequestLimit>[0]["scopes"]) => evaluateRequestLimit({ period: "DAILY", scopes, now: new Date("2026-07-25T18:30:00.000Z") });
const globalScope = (patch: Record<string, unknown> = {}) => ({ scope: "GLOBAL" as const, mode: "LIMITED", limit: 10, usage: 0, ...patch });

describe("v2.4.13 daily AI request-limit resolution", () => {
  it("treats an unconfigured limit as no limit rather than zero requests", () => {
    const result = daily([{ scope: "GLOBAL", mode: "UNLIMITED", limit: null, usage: 500 }]);
    assert.equal(result.allowed, true);
    assert.equal(result.unlimited, true);
    assert.equal(result.limit, null);
    assert.equal(result.resetAt, null);
  });

  it("never interprets a missing, blank, or zero limit as zero requests allowed", () => {
    for (const limit of [null, undefined, "", 0, -5, 1.5, Number.NaN]) {
      assert.equal(normalizeRequestLimitValue(limit), null, `limit ${String(limit)} must not become a numeric limit`);
      assert.equal(daily([{ scope: "GLOBAL", mode: "LIMITED", limit: limit as any, usage: 0 }]).allowed, true);
      assert.equal(daily([{ scope: "GLOBAL", mode: "INHERIT", limit: limit as any, usage: 9_999 }]).allowed, true);
    }
  });

  it("reports a Limited scope with no usable number as a configuration problem instead of blocking", () => {
    const result = daily([{ scope: "GLOBAL", mode: "LIMITED", limit: 0, usage: 3 }]);
    assert.equal(result.allowed, true);
    assert.equal(result.configurationIssues.length, 1);
    assert.equal(result.configurationIssues[0].configurationIssue, "NON_POSITIVE_LIMIT");
    assert.equal(daily([{ scope: "GLOBAL", mode: "LIMITED", limit: null, usage: 3 }]).configurationIssues[0].configurationIssue, "LIMITED_WITHOUT_LIMIT");
  });

  it("enforces an explicit Limited limit only once the count reaches it", () => {
    assert.equal(daily([globalScope({ usage: 9 })]).allowed, true);
    assert.equal(daily([globalScope({ usage: 9 })]).remaining, 1);
    assert.equal(daily([globalScope({ usage: 10 })]).allowed, false);
    assert.equal(daily([globalScope({ usage: 11 })]).blocking?.scope, "GLOBAL");
    assert.equal(daily([globalScope({ usage: 11 })]).remaining, 0);
  });

  it("lets Unlimited override a number still stored at the same scope", () => {
    const result = daily([{ scope: "GLOBAL", mode: "UNLIMITED", limit: 5, usage: 500 }]);
    assert.equal(result.allowed, true);
    assert.equal(result.decisions[0].effectiveMode, "UNLIMITED");
    assert.equal(result.decisions[0].limit, null);
  });

  it("keeps a legacy row without a mode enforcing its stored positive limit", () => {
    const legacy = resolveRequestLimitScope({ scope: "USER", mode: null, limit: 25, usage: 25 });
    assert.equal(legacy.requestedMode, "INHERIT");
    assert.equal(legacy.effectiveMode, "LIMITED");
    assert.equal(legacy.exceeded, true);
  });

  it("treats an absent settings row as having no opinion at that scope", () => {
    const absent = resolveRequestLimitScope({ scope: "PROVIDER", configured: false, mode: "LIMITED", limit: 1, usage: 900 });
    assert.equal(absent.effectiveMode, "UNLIMITED");
    assert.equal(absent.exceeded, false);
  });

  it("evaluates global, provider, and user scopes and reports the first exhausted one", () => {
    const result = daily([
      { scope: "USER", mode: "LIMITED", limit: 4, usage: 4 },
      { scope: "PROVIDER", mode: "LIMITED", limit: 3, usage: 3 },
      { scope: "GLOBAL", mode: "LIMITED", limit: 100, usage: 50 },
    ]);
    assert.deepEqual(result.decisions.map((decision) => decision.scope), ["GLOBAL", "PROVIDER", "USER"]);
    assert.equal(result.allowed, false);
    assert.equal(result.blocking?.scope, "PROVIDER");
  });

  it("reports the most restrictive enforced scope while every scope still has room", () => {
    const result = daily([
      { scope: "GLOBAL", mode: "LIMITED", limit: 100, usage: 10 },
      { scope: "USER", mode: "LIMITED", limit: 20, usage: 18 },
    ]);
    assert.equal(result.allowed, true);
    assert.equal(result.effective?.scope, "USER");
    assert.equal(result.remaining, 2);
  });

  it("lets a user-scope Unlimited override without weakening the global limit", () => {
    const scopes = [{ scope: "GLOBAL" as const, mode: "LIMITED", limit: 5, usage: 5 }, { scope: "USER" as const, mode: "UNLIMITED", limit: null, usage: 5 }];
    assert.equal(daily(scopes).allowed, false, "a user override must not weaken the global limit");
    assert.equal(daily([{ scope: "GLOBAL", mode: "UNLIMITED", limit: null, usage: 900 }, { scope: "USER", mode: "LIMITED", limit: 5, usage: 5 }]).blocking?.scope, "USER");
  });

  it("resets daily at the next UTC midnight and monthly at the supplied period end", () => {
    assert.equal(requestLimitResetAt("DAILY", new Date("2026-07-25T18:30:00.000Z")).toISOString(), "2026-07-26T00:00:00.000Z");
    assert.equal(daily([globalScope({ usage: 10 })]).resetAt, "2026-07-26T00:00:00.000Z");
    assert.equal(evaluateRequestLimit({ period: "MONTHLY", resetAt: new Date("2026-08-01T00:00:00.000Z"), scopes: [globalScope({ usage: 10 })] }).resetAt, "2026-08-01T00:00:00.000Z");
  });

  it("normalizes modes without inventing a limited state", () => {
    assert.equal(normalizeRequestLimitMode("limited"), "LIMITED");
    assert.equal(normalizeRequestLimitMode(" Unlimited "), "UNLIMITED");
    assert.equal(normalizeRequestLimitMode(undefined), "INHERIT");
    assert.equal(normalizeRequestLimitMode("nonsense"), "INHERIT");
    assert.equal(normalizeRequestLimitMode(null, { allowInherit: false }), "UNLIMITED");
  });

  it("keeps sanitized audit details limited to configuration values", () => {
    const details = requestLimitAuditDetails(daily([globalScope({ usage: 10 })]));
    assert.deepEqual(Object.keys(details).sort(), ["current_usage", "evaluated_scopes", "limit", "period", "remaining", "reset_at", "scope", "scope_id"]);
    assert.equal(details.limit, 10);
    assert.equal(details.current_usage, 10);
  });

  it("explains a block in administrator-facing language with a route to the control", () => {
    const message = describeRequestLimitBlock(daily([globalScope({ usage: 10 })]));
    assert.match(String(message), /global daily AI request limit of 10 requests has been reached \(10 used\)/);
    assert.match(String(message), /resets at 2026-07-26 00:00:00 UTC/);
    assert.match(String(message), /Unlimited in AI Governance → Budgets → AI request limits/);
    assert.equal(describeRequestLimitBlock(daily([globalScope({ usage: 1 })])), null);
  });

  it("rebuilds the same explanation from a sanitized error payload", () => {
    const rebuilt = describeRequestLimitFromDetails(requestLimitAuditDetails(daily([{ scope: "USER", mode: "LIMITED", limit: 1, usage: 1 }])) as Record<string, unknown>);
    assert.match(String(rebuilt), /user daily AI request limit of 1 request has been reached/);
    assert.equal(describeRequestLimitFromDetails({}), null);
    assert.equal(describeRequestLimitFromDetails(null), null);
  });
});

describe("v2.4.13 daily request-limit configuration validation", () => {
  it("rejects zero instead of storing an unrecoverable limit", () => {
    const result = validateRequestLimitConfiguration({ mode: "LIMITED", limit: 0 });
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.field, "limit"); assert.match(result.error, /Zero is not a valid limit/); }
  });

  it("requires a number when Limited is chosen", () => {
    const result = validateRequestLimitConfiguration({ mode: "LIMITED", limit: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /maximum number of daily AI requests, or choose Unlimited/);
  });

  it("clears any stored number when Unlimited is chosen", () => {
    const result = validateRequestLimitConfiguration({ mode: "UNLIMITED", limit: 250 });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual([result.mode, result.limit], ["UNLIMITED", null]);
  });

  it("accepts Inherit with no number and a Limited number in range", () => {
    assert.deepEqual(validateRequestLimitConfiguration({ mode: "INHERIT", limit: "" }), { ok: true, mode: "INHERIT", limit: null });
    assert.deepEqual(validateRequestLimitConfiguration({ mode: "LIMITED", limit: "250" }), { ok: true, mode: "LIMITED", limit: 250 });
  });

  it("rejects fractional and out-of-range limits", () => {
    assert.equal(validateRequestLimitConfiguration({ mode: "LIMITED", limit: 2.5 }).ok, false);
    assert.equal(validateRequestLimitConfiguration({ mode: "LIMITED", limit: MAXIMUM_AI_REQUEST_LIMIT + 1 }).ok, false);
    assert.equal(validateRequestLimitConfiguration({ mode: "LIMITED", limit: MAXIMUM_AI_REQUEST_LIMIT }).ok, true);
  });

  it("validates the user policy form with a field-level daily request error", () => {
    const userId = "123e4567-e89b-42d3-a456-426614174000";
    const parse = (patch: Record<string, unknown>) => aiUserPolicySchema.safeParse({ scope: "user", userId, ...patch });
    const zero = parse({ dailyRequestLimit: "0" });
    assert.equal(zero.success, false);
    if (!zero.success) assert.match(fieldErrorsFromZod(zero.error).daily_requests, /1 or more requests, or choose Unlimited/);
    const limitedWithoutNumber = parse({ dailyRequestLimitMode: "LIMITED" });
    assert.equal(limitedWithoutNumber.success, false);
    if (!limitedWithoutNumber.success) assert.ok(fieldErrorsFromZod(limitedWithoutNumber.error).daily_requests);
    const unlimited = parse({ dailyRequestLimitMode: "UNLIMITED" });
    assert.equal(unlimited.success, true);
    if (unlimited.success) assert.equal(unlimited.data.dailyRequestLimitMode, "UNLIMITED");
    const inherited = parse({ dailyCostLimit: "0" });
    assert.equal(inherited.success, true);
    // A zero cost limit stays valid: it permits only zero-cost requests.
    if (inherited.success) assert.deepEqual([inherited.data.dailyRequestLimitMode, inherited.data.dailyCostLimit], ["INHERIT", "0"]);
    assert.equal(parse({ dailyRequestLimitMode: "LIMITED", dailyRequestLimit: 250 }).success, true);
  });
});

describe("v2.4.13 governance admission and persistence contracts", () => {
  it("admits daily and monthly request counts through the shared resolver only", () => {
    const service = read("src/ai/governance/service.ts");
    assert.match(service, /evaluateRequestLimit\(\{ period: "DAILY"/);
    assert.match(service, /evaluateRequestLimit\(\{ period: "MONTHLY"/);
    assert.match(service, /scope: "GLOBAL", mode: input\.governance\.dailyRequestLimitMode, limit: input\.governance\.dailyRequestLimit/);
    assert.match(service, /scope: "USER",[^}]*mode: input\.userLimit\?\.dailyRequestLimitMode/);
    assert.doesNotMatch(service, /dailyRequestLimit != null && \w+CountDay >=/);
    assert.doesNotMatch(service, /monthlyRequestLimit != null && \w+CountMonth >=/);
  });

  it("returns a distinct monthly request-limit code instead of mislabeling it daily", () => {
    const service = read("src/ai/governance/service.ts");
    assert.match(service, /violations\.push\("MONTHLY_REQUEST_LIMIT_REACHED"\)/);
    const errors = read("src/ai/errors/index.ts");
    assert.match(errors, /"MONTHLY_REQUEST_LIMIT_REACHED"/);
    assert.match(errors, /MONTHLY_REQUEST_LIMIT_REACHED: "The applicable monthly AI request limit has been reached\."/);
  });

  it("includes the blocking scope, usage, limit, and reset time in the sanitized error", () => {
    const service = read("src/ai/governance/service.ts");
    assert.match(service, /code === "DAILY_REQUEST_LIMIT_REACHED" \? requestLimitAuditDetails\(dailyRequests\)/);
    assert.match(service, /code === "MONTHLY_REQUEST_LIMIT_REACHED" \? requestLimitAuditDetails\(monthlyRequests\)/);
  });

  it("validates the merged mode and limit pair before persisting a governance patch", () => {
    const service = read("src/ai/governance/service.ts");
    assert.match(service, /validateRequestLimitConfiguration\(\{[\s\S]*?previous\.dailyRequestLimitMode/);
    assert.match(service, /allowInherit: false/);
  });

  it("keeps the other protections evaluated independently of request counts", () => {
    const service = read("src/ai/governance/service.ts");
    for (const marker of [/AI_REQUEST_COST_LIMIT_EXCEEDED/, /AI_PROVIDER_BUDGET_EXCEEDED/, /DAILY_COST_LIMIT_REACHED/, /MONTHLY_COST_LIMIT_REACHED/, /AI_GLOBAL_BUDGET_EXCEEDED/, /PAID_PROVIDER_NOT_PERMITTED/, /PRIVACY_MODE_INCOMPATIBLE/, /MODEL_UNPRICED/, /validatePromptLimits/, /PROVIDER_DISABLED/]) assert.match(service, marker);
  });

  it("exempts an administrator from the user-scope daily request limit explicitly", () => {
    assert.match(read("src/ai/governance/service.ts"), /adminExempt && userLimit \? \{[^}]*dailyRequestLimitMode: "UNLIMITED"/);
  });

  it("rejects a zero or fractional request limit at every write path", () => {
    assert.match(read("src/ai/governance/service.ts"), /dailyRequestLimit: z\.number\(\)\.int\(\)\.positive\(/);
    assert.match(read("src/app/api/ai/budgets/route.ts"), /min\(1, "Enter 1 or more requests, or choose Unlimited\. Zero is not a valid limit\."\)/);
    assert.match(read("src/ai/governance/userPolicy.ts"), /optionalRequestCount/);
  });

  it("defaults new installations and onboarding to unlimited daily requests", () => {
    assert.match(read("prisma/schema.prisma"), /dailyRequestLimitMode\s+String\s+@default\("UNLIMITED"\)/);
    const intelligence = read("src/ai/intelligence/service.ts");
    assert.match(intelligence, /dailyRequestLimitMode: z\.enum\(\["UNLIMITED", "LIMITED"\]\)\.default\("UNLIMITED"\)/);
    assert.match(intelligence, /dailyRequestLimit: configuration\.dailyRequestLimitMode === "LIMITED" \? configuration\.dailyRequestLimit : null/);
  });

  it("ships an additive, idempotent migration that clears ambiguous zero limits", () => {
    const migration = read("prisma/migrations/20260801010000_ai_daily_request_limit_configuration_v2413/migration.sql");
    assert.equal((migration.match(/ADD COLUMN IF NOT EXISTS "dailyRequestLimitMode"/g) || []).length, 3);
    assert.match(migration, /SET "dailyRequestLimitMode" = 'LIMITED'[\s\S]*?"dailyRequestLimit" > 0/);
    assert.match(migration, /SET "dailyRequestLimitMode" = 'UNLIMITED', "dailyRequestLimit" = NULL WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" <= 0/);
    assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN/i);
  });
});

describe("v2.4.13 administrator and Recipe Copilot interface", () => {
  it("exposes a global daily request-limit mode, number, usage, and save control", () => {
    const ui = read("src/components/AiGovernanceDashboard.tsx");
    assert.match(ui, /id="ai-request-limits"/);
    assert.match(ui, /Unlimited — no daily request cap/);
    assert.match(ui, /Limited — cap requests per day/);
    assert.match(ui, /data-field="daily_request_limit_mode"/);
    assert.match(ui, /Save AI request limits/);
    assert.match(ui, /Zero is not a valid limit/);
    assert.match(ui, /dailyRequestUsage/);
  });

  it("offers Inherit, Unlimited, and Limited at the provider and user scopes", () => {
    const ui = read("src/components/AiGovernanceDashboard.tsx");
    assert.match(ui, /data-field="provider_daily_requests_mode"/);
    assert.match(ui, /data-field="daily_requests_mode"/);
    assert.match(ui, /Inherit the global limit/);
    assert.match(ui, /Inherit the broader policy/);
    assert.match(ui, /Unlimited for this user/);
  });

  it("opens the exact control that blocked the request from a deep link", () => {
    assert.match(read("src/components/AiGovernanceDashboard.tsx"), /URLSearchParams\(window\.location\.search\)\.get\("section"\)/);
    assert.equal(recipeCopilotSettingsUrl("AI_DAILY_LIMIT_EXCEEDED"), "/settings/ai?section=Budgets#ai-request-limits");
    assert.equal(recipeCopilotSettingsUrl("AI_MONTHLY_REQUEST_LIMIT_EXCEEDED"), "/settings/ai?section=Budgets#ai-request-limits");
    assert.equal(recipeCopilotSettingsUrl("AI_PROVIDER_UNAVAILABLE"), "/settings/ai");
    assert.equal(isRecipeCopilotRequestLimitError("AI_DAILY_LIMIT_EXCEEDED"), true);
    assert.equal(isRecipeCopilotRequestLimitError("AI_MONTHLY_BUDGET_EXCEEDED"), false);
    assert.match(read("src/components/RecipeCopilot.tsx"), /Open AI request limits/);
  });

  it("tells the administrator where to change the limit in the blocked message", () => {
    const message = recipeCopilotErrorMessage("AI_DAILY_LIMIT_EXCEEDED", "fallback", false);
    assert.match(message, /daily AI limit has been reached/);
    assert.match(message, /Unlimited in AI Governance → Budgets → AI request limits/);
    assert.match(recipeCopilotErrorMessage("AI_MONTHLY_REQUEST_LIMIT_EXCEEDED", "fallback", false), /monthly AI request limit/);
  });

  it("maps the governance codes Recipe Copilot can receive to accurate feature codes", () => {
    for (const path of ["src/lib/recipeCopilot/service.ts", "src/lib/recipeCopilot/api.ts"]) {
      const source = read(path);
      assert.match(source, /MONTHLY_REQUEST_LIMIT_REACHED/);
      assert.match(source, /AI_MONTHLY_REQUEST_LIMIT_EXCEEDED/);
      assert.match(source, /describeRequestLimitFromDetails/);
    }
  });

  it("summarizes remaining daily requests in the readiness panel", () => {
    assert.equal(recipeCopilotDailyRequestSummary(null), "No daily AI request limit is configured.");
    assert.equal(recipeCopilotDailyRequestSummary({ effectiveMode: "UNLIMITED", limit: null }), "No daily AI request limit is configured.");
    assert.match(recipeCopilotDailyRequestSummary({ effectiveMode: "LIMITED", limit: 250, usage: 12, remaining: 238, resetAt: "2026-07-26T00:00:00.000Z" }), /^12 of 250 daily AI requests used · 238 remaining\. Resets /);
    assert.match(read("src/components/RecipeCopilot.tsx"), /recipeCopilotDailyRequestSummary\(availability\.dailyRequestLimit\)/);
  });

  it("keeps the Generate button enabled once a request limit no longer blocks the feature", () => {
    const ready = { available: true } as any;
    assert.equal(recipeCopilotCanRequest({ readiness: ready, running: false, action: "explain", instruction: "", playlistId: "" }), true);
    assert.equal(recipeCopilotCanRequest({ readiness: { available: false, code: "AI_DAILY_LIMIT_EXCEEDED" } as any, running: false, action: "explain", instruction: "", playlistId: "" }), false);
  });

  it("documents the limit precedence and the release", () => {
    const docs = read("docs/AI_DAILY_REQUEST_LIMITS_V2413.md");
    for (const marker of [/precedence/i, /Unlimited/, /Limited/, /Inherit/, /zero/i, /AI_DAILY_LIMIT_EXCEEDED/, /20260801010000_ai_daily_request_limit_configuration_v2413/]) assert.match(docs, marker);
    assert.match(read("CHANGELOG.md"), /v2\.4\.13 - Daily AI Request Limit Configuration/);
    assert.equal(JSON.parse(read("package.json")).version, "2.4.19");
  });
});
