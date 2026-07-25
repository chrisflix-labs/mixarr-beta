// Monetary AI cost ceilings that are a single request's admission gate.
//
// This module is pure so administrative validation, governance admission, the
// settings interface, and tests resolve one mode. It resolves *which* limit is
// active; the arithmetic still runs in `evaluateCostLimit` and
// `evaluateRetryCost` in `./policy`, which remain the only cost comparators.
//
// Unlike a request *count*, a zero-dollar ceiling is a legitimate policy ("admit
// only free or local-provider requests"). Zero is therefore kept expressible —
// but only under an explicit Limited mode, so it can never again be confused
// with an unset field that happens to hold zero.

export const AI_COST_LIMIT_MODES = ["UNLIMITED", "LIMITED"] as const;
export type AiCostLimitMode = typeof AI_COST_LIMIT_MODES[number];

/** The two distinct per-request monetary ceilings Mixarr enforces. */
export const AI_COST_LIMIT_CONTROLS = ["PER_REQUEST", "CUMULATIVE_REQUEST"] as const;
export type AiCostLimitControl = typeof AI_COST_LIMIT_CONTROLS[number];

export const MAXIMUM_AI_COST_LIMIT = 100_000;
const DECIMAL_PATTERN = /^\d+(\.\d{1,6})?$/;

export type AiCostLimitConfigurationIssue = "LIMITED_WITHOUT_LIMIT" | "INVALID_LIMIT";

export type AiCostLimitResolution = {
  control: AiCostLimitControl;
  requestedMode: AiCostLimitMode;
  effectiveMode: AiCostLimitMode;
  /** Decimal string preserved for exact micro-unit conversion, or null when unlimited. */
  limit: string | null;
  limitNumber: number | null;
  configurationIssue: AiCostLimitConfigurationIssue | null;
};

const controlNames: Record<AiCostLimitControl, string> = {
  PER_REQUEST: "per-request estimated cost limit",
  CUMULATIVE_REQUEST: "cumulative request cost limit",
};

export function costLimitControlName(control: AiCostLimitControl) { return controlNames[control]; }

export function normalizeCostLimitMode(value: unknown): AiCostLimitMode {
  return String(value ?? "").trim().toUpperCase() === "LIMITED" ? "LIMITED" : "UNLIMITED";
}

/**
 * Normalizes a stored or submitted monetary ceiling to an exact decimal string.
 * Blank and unparseable values become null; zero is preserved, because under an
 * explicit Limited mode a zero-dollar ceiling is a real, useful policy.
 */
export function normalizeCostLimitValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  const source = String(typeof value === "number" ? value : value).trim();
  if (!DECIMAL_PATTERN.test(source)) return null;
  if (Number(source) > MAXIMUM_AI_COST_LIMIT) return null;
  return source;
}

/**
 * Resolves one ceiling. A Limited mode with no usable amount resolves to
 * unlimited and reports a configuration problem rather than blocking every
 * request, which is the failure this module exists to prevent.
 */
export function resolveCostLimit(input: { control: AiCostLimitControl; mode?: unknown; limit?: unknown }): AiCostLimitResolution {
  const requestedMode = normalizeCostLimitMode(input.mode);
  const limit = normalizeCostLimitValue(input.limit);
  const enforced = requestedMode === "LIMITED" && limit != null;
  const configurationIssue: AiCostLimitConfigurationIssue | null =
    requestedMode !== "LIMITED" || limit != null ? null
    : input.limit == null || input.limit === "" ? "LIMITED_WITHOUT_LIMIT"
    : "INVALID_LIMIT";
  return {
    control: input.control,
    requestedMode,
    effectiveMode: enforced ? "LIMITED" : "UNLIMITED",
    limit: enforced ? limit : null,
    limitNumber: enforced ? Number(limit) : null,
    configurationIssue,
  };
}

const currency = (value: number, code: string) => `${Number(value).toFixed(6)} ${code}`;

/** Administrator-facing sentence naming the control, the amount, and the fix. */
export function describeCostLimitBlock(input: { control: AiCostLimitControl; estimatedCost: number; limit: number; currency?: string | null }) {
  const code = input.currency || "USD";
  return [
    `This request is estimated to cost ${currency(input.estimatedCost, code)}, which exceeds the ${controlNames[input.control]} of ${currency(input.limit, code)}.`,
    input.limit === 0
      ? "The limit is set to zero, which admits only free or local-provider requests."
      : null,
    "An administrator can raise it or choose Unlimited in AI Governance → Budgets → AI cost limits.",
  ].filter(Boolean).join(" ");
}

/** Rebuilds the sentence from a sanitized AiError details payload. */
export function describeCostLimitFromDetails(details: Record<string, unknown> | null | undefined) {
  if (!details || details.limit == null || details.estimated_cost == null) return null;
  const limit = Number(details.limit); const estimatedCost = Number(details.estimated_cost);
  if (!Number.isFinite(limit) || !Number.isFinite(estimatedCost)) return null;
  const control = AI_COST_LIMIT_CONTROLS.includes(details.control as AiCostLimitControl) ? (details.control as AiCostLimitControl) : "PER_REQUEST";
  return describeCostLimitBlock({ control, estimatedCost, limit, currency: typeof details.currency === "string" ? details.currency : null });
}

export function costLimitAuditDetails(input: { control: AiCostLimitControl; resolution: AiCostLimitResolution; estimatedCost: number; currency?: string | null }) {
  return {
    control: input.control,
    scope: "GLOBAL",
    mode: input.resolution.effectiveMode,
    estimated_cost: input.estimatedCost,
    limit: input.resolution.limitNumber,
    currency: input.currency || "USD",
  };
}

export type CostLimitConfigurationResult =
  | { ok: true; mode: AiCostLimitMode; limit: string | null }
  | { ok: false; error: string; field: "mode" | "limit" };

/**
 * Validates a submitted mode/amount pair before persistence, so a Limited mode
 * can never be stored without the amount it needs.
 */
export function validateCostLimitConfiguration(input: { control?: AiCostLimitControl; mode?: unknown; limit?: unknown }): CostLimitConfigurationResult {
  const name = controlNames[input.control || "PER_REQUEST"];
  const mode = normalizeCostLimitMode(input.mode);
  if (input.limit != null && input.limit !== "") {
    const source = String(input.limit).trim();
    if (!DECIMAL_PATTERN.test(source)) return { ok: false, error: `Enter a non-negative ${name} with no more than 6 decimal places.`, field: "limit" };
    if (Number(source) > MAXIMUM_AI_COST_LIMIT) return { ok: false, error: `Enter ${MAXIMUM_AI_COST_LIMIT.toLocaleString("en-US")} or less for the ${name}.`, field: "limit" };
  }
  const limit = normalizeCostLimitValue(input.limit);
  if (mode === "LIMITED" && limit == null) return { ok: false, error: `Enter the maximum amount for the ${name}, or choose Unlimited. Zero is allowed and admits only free or local-provider requests.`, field: "limit" };
  // Unlimited clears any stored amount so a later mode change cannot resurrect it.
  return { ok: true, mode, limit: mode === "UNLIMITED" ? null : limit };
}
