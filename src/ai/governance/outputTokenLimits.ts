import type { NormalizedOutputTokenLimit } from "../contracts";

export type OutputTokenLimitInput = {
  requestedOutputTokens?: number | null;
  configuredGlobalLimit?: number | null;
  configuredProviderLimit?: number | null;
  configuredFeatureLimit?: number | null;
  configuredUserLimit?: number | null;
  modelOutputLimit?: number | null;
  defaultOutputTokens?: number;
};

/** The established Mixarr policy treats zero and negative values as unlimited/unset. */
export function normalizedPositiveTokenLimit(value: number | null | undefined): number | null {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : null;
}

export function resolveNormalizedOutputTokenLimit(input: OutputTokenLimitInput): NormalizedOutputTokenLimit {
  const requestedOutputTokens = normalizedPositiveTokenLimit(input.requestedOutputTokens)
    ?? normalizedPositiveTokenLimit(input.defaultOutputTokens);
  const configuredGlobalLimit = normalizedPositiveTokenLimit(input.configuredGlobalLimit);
  const configuredProviderLimit = normalizedPositiveTokenLimit(input.configuredProviderLimit);
  const configuredFeatureLimit = normalizedPositiveTokenLimit(input.configuredFeatureLimit);
  const configuredUserLimit = normalizedPositiveTokenLimit(input.configuredUserLimit);
  const modelOutputLimit = normalizedPositiveTokenLimit(input.modelOutputLimit);
  const hardLimits = [
    ["global", configuredGlobalLimit],
    ["provider", configuredProviderLimit],
    ["feature", configuredFeatureLimit],
    ["user", configuredUserLimit],
    ["model", modelOutputLimit],
  ] as const;
  const configured: Array<[string, number]> = [];
  for (const [source, value] of hardLimits) if (value != null) configured.push([source, value]);
  const hard = configured.sort((left, right) => left[1] - right[1])[0];
  const target = requestedOutputTokens ?? hard?.[1] ?? 1;
  const effectiveOutputTokens = Math.max(1, Math.min(target, hard?.[1] ?? Number.MAX_SAFE_INTEGER));
  const limitingSource = hard && hard[1] <= target ? hard[0] : requestedOutputTokens != null ? "request" : "unlimited";
  return {
    requestedOutputTokens,
    configuredGlobalLimit,
    configuredProviderLimit,
    configuredFeatureLimit,
    configuredUserLimit,
    modelOutputLimit,
    effectiveOutputTokens,
    limitingSource,
    unlimited: configured.length === 0,
  };
}
