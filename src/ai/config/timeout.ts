export const MAX_AI_TIMEOUT_MS = 2_147_483_647;
export const MIN_CANCELLATION_GRACE_MS = 100;
export const MAX_CANCELLATION_GRACE_MS = 60_000;

export const AI_TIMEOUT_PHASE_FIELDS = [
  "connectionTimeoutMs",
  "firstTokenTimeoutMs",
  "totalRequestTimeoutMs",
  "streamingIdleTimeoutMs",
] as const;

export type AiTimeoutPhaseField = typeof AI_TIMEOUT_PHASE_FIELDS[number];
export type AiTimeoutValue = number | null;
export type AiTimeoutPolicy = Record<AiTimeoutPhaseField, AiTimeoutValue> & {
  cancellationGraceMs: number;
};
export type AiTimeoutPolicyOverride = Partial<Record<AiTimeoutPhaseField, AiTimeoutValue> & {
  cancellationGraceMs: number;
}>;
export type AiTimeoutPolicySource = "request" | "provider" | "global" | "default";
export type EffectiveAiTimeoutPolicy = AiTimeoutPolicy & {
  sources: Record<keyof AiTimeoutPolicy, AiTimeoutPolicySource>;
  source: AiTimeoutPolicySource;
};

export const DEFAULT_AI_TIMEOUT_POLICY: AiTimeoutPolicy = {
  connectionTimeoutMs: 10_000,
  firstTokenTimeoutMs: 30_000,
  totalRequestTimeoutMs: 120_000,
  streamingIdleTimeoutMs: 30_000,
  cancellationGraceMs: 2_000,
};

/** @deprecated Runtime requests use the persisted phase policy. Kept for config diagnostics. */
export function configuredAiRequestTimeoutMs(environment = process.env) {
  const raw = environment.AI_REQUEST_TIMEOUT_SECONDS;
  if (raw == null || raw.trim() === "") return DEFAULT_AI_TIMEOUT_POLICY.totalRequestTimeoutMs!;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 600) {
    throw new RangeError("AI_REQUEST_TIMEOUT_SECONDS must be a whole number from 30 to 600.");
  }
  return seconds * 1_000;
}

function owns(value: object | null | undefined, field: PropertyKey) {
  return !!value && Object.prototype.hasOwnProperty.call(value, field);
}

export function validateAiTimeoutValue(value: unknown, field = "timeout"): AiTimeoutValue {
  if (value === null) return null;
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new RangeError(`${field} must be a positive whole number of milliseconds or null for Unlimited.`);
  }
  if (Number(value) > MAX_AI_TIMEOUT_MS) {
    throw new RangeError(`${field} must not exceed ${MAX_AI_TIMEOUT_MS} milliseconds.`);
  }
  return Number(value);
}

export function validateCancellationGraceMs(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < MIN_CANCELLATION_GRACE_MS || Number(value) > MAX_CANCELLATION_GRACE_MS) {
    throw new RangeError(`cancellationGraceMs must be a whole number from ${MIN_CANCELLATION_GRACE_MS} to ${MAX_CANCELLATION_GRACE_MS} milliseconds.`);
  }
  return Number(value);
}

export function validateAiTimeoutPolicy(policy: AiTimeoutPolicyOverride, requireAll = false): AiTimeoutPolicyOverride {
  const result: AiTimeoutPolicyOverride = {};
  for (const field of AI_TIMEOUT_PHASE_FIELDS) {
    if (!owns(policy, field)) {
      if (requireAll) throw new RangeError(`${field} is required.`);
      continue;
    }
    result[field] = validateAiTimeoutValue(policy[field], field);
  }
  if (owns(policy, "cancellationGraceMs")) result.cancellationGraceMs = validateCancellationGraceMs(policy.cancellationGraceMs);
  else if (requireAll) throw new RangeError("cancellationGraceMs is required.");
  return result;
}

export function resolveEffectiveTimeoutPolicy(input: {
  requestOverride?: AiTimeoutPolicyOverride;
  providerOverrideEnabled?: boolean;
  providerPolicy?: AiTimeoutPolicyOverride;
  globalPolicy?: AiTimeoutPolicyOverride;
  defaults?: AiTimeoutPolicy;
}): EffectiveAiTimeoutPolicy {
  const defaults = validateAiTimeoutPolicy(input.defaults || DEFAULT_AI_TIMEOUT_POLICY, true) as AiTimeoutPolicy;
  const request = validateAiTimeoutPolicy(input.requestOverride || {});
  const provider = input.providerOverrideEnabled ? validateAiTimeoutPolicy(input.providerPolicy || {}, true) : {};
  const global = validateAiTimeoutPolicy(input.globalPolicy || {});
  const values = {} as AiTimeoutPolicy;
  const sources = {} as EffectiveAiTimeoutPolicy["sources"];
  for (const field of [...AI_TIMEOUT_PHASE_FIELDS, "cancellationGraceMs"] as const) {
    if (owns(request, field)) {
      (values as any)[field] = (request as any)[field];
      sources[field] = "request";
    } else if (input.providerOverrideEnabled) {
      (values as any)[field] = (provider as any)[field];
      sources[field] = "provider";
    } else if (owns(global, field)) {
      (values as any)[field] = (global as any)[field];
      sources[field] = "global";
    } else {
      (values as any)[field] = defaults[field];
      sources[field] = "default";
    }
  }
  const source: AiTimeoutPolicySource = Object.values(sources).includes("request")
    ? "request"
    : Object.values(sources).includes("provider")
      ? "provider"
      : Object.values(sources).includes("global")
        ? "global"
        : "default";
  return { ...values, sources, source };
}

/** Backward-compatible total-timeout helper for internal callers being migrated. */
export function resolveAiRequestTimeout(input: {
  requestTimeoutMs?: number | null;
  providerTimeoutMs?: number | null;
  globalTimeoutMs?: number | null;
  governanceTimeoutMs?: number | null;
  environment?: NodeJS.ProcessEnv;
}) {
  const requestOverride = owns(input, "requestTimeoutMs") ? { totalRequestTimeoutMs: input.requestTimeoutMs } : undefined;
  const providerEnabled = owns(input, "providerTimeoutMs");
  const effective = resolveEffectiveTimeoutPolicy({
    requestOverride,
    providerOverrideEnabled: providerEnabled,
    providerPolicy: providerEnabled ? { ...DEFAULT_AI_TIMEOUT_POLICY, totalRequestTimeoutMs: input.providerTimeoutMs! } : undefined,
    globalPolicy: owns(input, "governanceTimeoutMs")
      ? { totalRequestTimeoutMs: input.governanceTimeoutMs }
      : owns(input, "globalTimeoutMs")
        ? { totalRequestTimeoutMs: input.globalTimeoutMs }
        : undefined,
  });
  return {
    timeoutMs: effective.totalRequestTimeoutMs,
    timeoutSource: effective.sources.totalRequestTimeoutMs,
    candidates: [{ source: effective.sources.totalRequestTimeoutMs, timeoutMs: effective.totalRequestTimeoutMs }],
  };
}

export function formatAiDuration(value: AiTimeoutValue) {
  if (value === null) return "Unlimited";
  if (value % 3_600_000 === 0) return `${value / 3_600_000} ${value === 3_600_000 ? "hour" : "hours"}`;
  if (value % 60_000 === 0) return `${value / 60_000} ${value === 60_000 ? "minute" : "minutes"}`;
  if (value % 1_000 === 0) return `${value / 1_000} ${value === 1_000 ? "second" : "seconds"}`;
  return `${value} milliseconds`;
}
