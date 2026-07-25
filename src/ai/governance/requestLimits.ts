// Daily and monthly AI request-count limits.
//
// This module is pure so administrative validation, governance admission, the
// settings UI, and tests all resolve the same precedence. Request-count limits
// are throttles, not spending controls: a missing, blank, or non-positive limit
// therefore means "no request-count limit at this scope", never "zero requests
// allowed". Cost, budget, token, privacy, approval, and availability controls
// are evaluated separately and are unaffected by this module.

export const AI_REQUEST_LIMIT_MODES = ["INHERIT", "UNLIMITED", "LIMITED"] as const;
export type AiRequestLimitMode = typeof AI_REQUEST_LIMIT_MODES[number];
// The global scope has nothing broader to inherit from, so it is explicit only.
export const AI_GLOBAL_REQUEST_LIMIT_MODES = ["UNLIMITED", "LIMITED"] as const;
export type AiGlobalRequestLimitMode = typeof AI_GLOBAL_REQUEST_LIMIT_MODES[number];

export const AI_REQUEST_LIMIT_SCOPES = ["GLOBAL", "PROVIDER", "USER"] as const;
export type AiRequestLimitScope = typeof AI_REQUEST_LIMIT_SCOPES[number];
export type AiRequestLimitPeriod = "DAILY" | "MONTHLY";

export const MAXIMUM_AI_REQUEST_LIMIT = 1_000_000;

export type AiRequestLimitConfigurationIssue = "LIMITED_WITHOUT_LIMIT" | "NON_POSITIVE_LIMIT" | "INVALID_LIMIT";

export type AiRequestLimitScopeInput = {
  scope: AiRequestLimitScope;
  scopeId?: string | null;
  scopeLabel?: string | null;
  /** Whether a settings row exists for this scope at all. */
  configured?: boolean;
  mode?: string | null;
  limit?: number | string | null;
  usage?: number | null;
};

export type AiRequestLimitScopeDecision = {
  scope: AiRequestLimitScope;
  scopeId: string | null;
  scopeLabel: string | null;
  requestedMode: AiRequestLimitMode;
  effectiveMode: "UNLIMITED" | "LIMITED";
  limit: number | null;
  usage: number;
  remaining: number | null;
  exceeded: boolean;
  configurationIssue: AiRequestLimitConfigurationIssue | null;
};

export type AiRequestLimitEvaluation = {
  period: AiRequestLimitPeriod;
  allowed: boolean;
  unlimited: boolean;
  decisions: AiRequestLimitScopeDecision[];
  blocking: AiRequestLimitScopeDecision | null;
  /** The most restrictive enforced scope, whether or not it is exhausted. */
  effective: AiRequestLimitScopeDecision | null;
  limit: number | null;
  usage: number | null;
  remaining: number | null;
  resetAt: string | null;
  configurationIssues: AiRequestLimitScopeDecision[];
};

const scopeRank: Record<AiRequestLimitScope, number> = { GLOBAL: 0, PROVIDER: 1, USER: 2 };
const scopeNames: Record<AiRequestLimitScope, string> = { GLOBAL: "global", PROVIDER: "provider", USER: "user" };

export function normalizeRequestLimitMode(value: unknown, options: { allowInherit?: boolean } = {}): AiRequestLimitMode {
  const source = String(value ?? "").trim().toUpperCase();
  if (source === "UNLIMITED") return "UNLIMITED";
  if (source === "LIMITED") return "LIMITED";
  return options.allowInherit === false ? "UNLIMITED" : "INHERIT";
}

/**
 * Normalizes a stored or submitted request-count limit. Blank values, zero,
 * negatives, and non-integers all resolve to null so no caller can accidentally
 * interpret them as a limit of zero requests.
 */
export function normalizeRequestLimitValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 1) return null;
  return Math.min(MAXIMUM_AI_REQUEST_LIMIT, numeric);
}

function configurationIssueFor(mode: AiRequestLimitMode, rawLimit: unknown, limit: number | null): AiRequestLimitConfigurationIssue | null {
  if (mode !== "LIMITED" || limit != null) return null;
  if (rawLimit == null || rawLimit === "") return "LIMITED_WITHOUT_LIMIT";
  const numeric = typeof rawLimit === "number" ? rawLimit : Number(String(rawLimit).trim());
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return "INVALID_LIMIT";
  return "NON_POSITIVE_LIMIT";
}

/**
 * Resolves one scope. `INHERIT` (including legacy rows written before the mode
 * existed) enforces a stored positive limit and is otherwise unlimited, so
 * upgrading never silently drops an intentional limit and never invents one.
 */
export function resolveRequestLimitScope(input: AiRequestLimitScopeInput): AiRequestLimitScopeDecision {
  const configured = input.configured !== false;
  const requestedMode = configured ? normalizeRequestLimitMode(input.mode) : "INHERIT";
  const limit = configured ? normalizeRequestLimitValue(input.limit) : null;
  const usage = Math.max(0, Math.floor(Number(input.usage ?? 0) || 0));
  const configurationIssue = configured ? configurationIssueFor(requestedMode, input.limit, limit) : null;
  const enforced = requestedMode !== "UNLIMITED" && limit != null;
  return {
    scope: input.scope,
    scopeId: input.scopeId ?? null,
    scopeLabel: input.scopeLabel ?? null,
    requestedMode,
    effectiveMode: enforced ? "LIMITED" : "UNLIMITED",
    limit: enforced ? limit : null,
    usage,
    remaining: enforced ? Math.max(0, limit! - usage) : null,
    exceeded: enforced ? usage >= limit! : false,
    configurationIssue,
  };
}

export function requestLimitResetAt(period: AiRequestLimitPeriod, now: Date = new Date()) {
  if (period === "DAILY") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * Evaluates every applicable scope. Scopes are resolved in the deterministic
 * order global, provider, user; the first exhausted enforced scope blocks and is
 * reported so an administrator sees exactly which control needs changing.
 */
export function evaluateRequestLimit(input: { period: AiRequestLimitPeriod; scopes: AiRequestLimitScopeInput[]; resetAt?: Date | string | null; now?: Date }): AiRequestLimitEvaluation {
  const decisions = input.scopes
    .map(resolveRequestLimitScope)
    .sort((left, right) => scopeRank[left.scope] - scopeRank[right.scope]);
  const enforced = decisions.filter((decision) => decision.effectiveMode === "LIMITED");
  const blocking = enforced.find((decision) => decision.exceeded) || null;
  const effective = enforced.slice().sort((left, right) => (left.remaining ?? 0) - (right.remaining ?? 0) || left.limit! - right.limit!)[0] || null;
  const resetSource = input.resetAt ? new Date(input.resetAt) : requestLimitResetAt(input.period, input.now);
  return {
    period: input.period,
    allowed: !blocking,
    unlimited: enforced.length === 0,
    decisions,
    blocking,
    effective: blocking || effective,
    limit: (blocking || effective)?.limit ?? null,
    usage: (blocking || effective)?.usage ?? null,
    remaining: (blocking || effective)?.remaining ?? null,
    resetAt: enforced.length ? resetSource.toISOString() : null,
    configurationIssues: decisions.filter((decision) => decision.configurationIssue != null),
  };
}

const periodWord: Record<AiRequestLimitPeriod, string> = { DAILY: "daily", MONTHLY: "monthly" };

/** Administrator-facing sentence. Contains configuration values only. */
function describeRequestLimit(input: { period: AiRequestLimitPeriod; scope: AiRequestLimitScope; limit: number; usage: number; resetAt?: string | null }) {
  const parsedReset = input.resetAt ? new Date(input.resetAt) : null;
  const reset = parsedReset && !Number.isNaN(parsedReset.getTime()) ? parsedReset.toISOString().replace("T", " ").replace(".000Z", " UTC") : null;
  return [
    `The ${scopeNames[input.scope]} ${periodWord[input.period]} AI request limit of ${input.limit} request${input.limit === 1 ? "" : "s"} has been reached (${input.usage} used).`,
    reset ? `It resets at ${reset}.` : null,
    "An administrator can raise it or choose Unlimited in AI Governance → Budgets → AI request limits.",
  ].filter(Boolean).join(" ");
}

export function describeRequestLimitBlock(evaluation: AiRequestLimitEvaluation) {
  const decision = evaluation.blocking;
  if (!decision || decision.limit == null) return null;
  return describeRequestLimit({ period: evaluation.period, scope: decision.scope, limit: decision.limit, usage: decision.usage, resetAt: evaluation.resetAt });
}

/** Rebuilds the sentence from a sanitized AiError details payload. */
export function describeRequestLimitFromDetails(details: Record<string, unknown> | null | undefined) {
  if (!details || details.limit == null) return null;
  const limit = Number(details.limit);
  if (!Number.isFinite(limit)) return null;
  const scope = AI_REQUEST_LIMIT_SCOPES.includes(details.scope as AiRequestLimitScope) ? (details.scope as AiRequestLimitScope) : "GLOBAL";
  return describeRequestLimit({ period: details.period === "MONTHLY" ? "MONTHLY" : "DAILY", scope, limit, usage: Number(details.current_usage ?? 0) || 0, resetAt: typeof details.reset_at === "string" ? details.reset_at : null });
}

export function requestLimitAuditDetails(evaluation: AiRequestLimitEvaluation) {
  return {
    period: evaluation.period,
    scope: evaluation.blocking?.scope ?? null,
    scope_id: evaluation.blocking?.scopeId ?? null,
    limit: evaluation.blocking?.limit ?? null,
    current_usage: evaluation.blocking?.usage ?? null,
    remaining: evaluation.blocking?.remaining ?? null,
    reset_at: evaluation.resetAt,
    evaluated_scopes: evaluation.decisions.map((decision) => ({ scope: decision.scope, mode: decision.effectiveMode, limit: decision.limit, usage: decision.usage })),
  };
}

export type RequestLimitConfigurationResult =
  | { ok: true; mode: AiRequestLimitMode; limit: number | null }
  | { ok: false; error: string; field: "mode" | "limit" };

/**
 * Validates a submitted mode/limit pair before persistence. Zero is rejected
 * rather than stored, because an ambiguous zero is what previously blocked every
 * request with no way to recover from the interface.
 */
export function validateRequestLimitConfiguration(input: { mode?: unknown; limit?: unknown; allowInherit?: boolean; period?: AiRequestLimitPeriod }): RequestLimitConfigurationResult {
  const period = periodWord[input.period || "DAILY"];
  const mode = normalizeRequestLimitMode(input.mode, { allowInherit: input.allowInherit });
  if (input.limit != null && input.limit !== "") {
    const numeric = typeof input.limit === "number" ? input.limit : Number(String(input.limit).trim());
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return { ok: false, error: `Enter a whole number of ${period} requests.`, field: "limit" };
    if (numeric < 1) return { ok: false, error: `Enter 1 or more ${period} requests, or choose Unlimited. Zero is not a valid limit.`, field: "limit" };
    if (numeric > MAXIMUM_AI_REQUEST_LIMIT) return { ok: false, error: `Enter ${MAXIMUM_AI_REQUEST_LIMIT.toLocaleString("en-US")} or fewer ${period} requests.`, field: "limit" };
  }
  const limit = normalizeRequestLimitValue(input.limit);
  if (mode === "LIMITED" && limit == null) return { ok: false, error: `Enter the maximum number of ${period} AI requests, or choose Unlimited.`, field: "limit" };
  // Unlimited clears any stored number so a later mode change cannot resurrect it.
  return { ok: true, mode, limit: mode === "UNLIMITED" ? null : limit };
}
