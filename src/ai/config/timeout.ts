export const AI_REQUEST_TIMEOUT_DEFAULT_SECONDS = 120;
export const AI_REQUEST_TIMEOUT_MIN_SECONDS = 30;
export const AI_REQUEST_TIMEOUT_MAX_SECONDS = 600;

export type AiTimeoutCandidate = {
  source: "request" | "provider" | "global" | "governance" | "environment";
  timeoutMs: number;
};

function validMilliseconds(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= AI_REQUEST_TIMEOUT_MIN_SECONDS * 1000 && number <= AI_REQUEST_TIMEOUT_MAX_SECONDS * 1000
    ? number
    : null;
}

export function configuredAiRequestTimeoutMs(environment = process.env) {
  const raw = environment.AI_REQUEST_TIMEOUT_SECONDS;
  if (raw == null || raw.trim() === "") return AI_REQUEST_TIMEOUT_DEFAULT_SECONDS * 1000;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < AI_REQUEST_TIMEOUT_MIN_SECONDS || seconds > AI_REQUEST_TIMEOUT_MAX_SECONDS) {
    throw new RangeError(`AI_REQUEST_TIMEOUT_SECONDS must be a whole number from ${AI_REQUEST_TIMEOUT_MIN_SECONDS} to ${AI_REQUEST_TIMEOUT_MAX_SECONDS}.`);
  }
  return seconds * 1000;
}

/**
 * Resolve every applicable policy into one deadline. Only the coordinator creates
 * a timer; provider/global/governance values are policy inputs, not competing timers.
 */
export function resolveAiRequestTimeout(input: {
  requestTimeoutMs?: number;
  providerTimeoutMs?: number;
  globalTimeoutMs?: number;
  governanceTimeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
}) {
  const candidates: AiTimeoutCandidate[] = [{ source: "environment", timeoutMs: configuredAiRequestTimeoutMs(input.environment) }];
  const optional: Array<[AiTimeoutCandidate["source"], unknown]> = [
    ["request", input.requestTimeoutMs],
    ["provider", input.providerTimeoutMs],
    ["global", input.globalTimeoutMs],
    ["governance", input.governanceTimeoutMs],
  ];
  for (const [source, value] of optional) {
    if (value == null) continue;
    const timeoutMs = validMilliseconds(value);
    if (timeoutMs == null) throw new RangeError(`${source} AI request timeout must be between ${AI_REQUEST_TIMEOUT_MIN_SECONDS} and ${AI_REQUEST_TIMEOUT_MAX_SECONDS} seconds.`);
    candidates.push({ source, timeoutMs });
  }
  const effective = candidates.reduce((strictest, candidate) => candidate.timeoutMs < strictest.timeoutMs ? candidate : strictest);
  return { timeoutMs: effective.timeoutMs, timeoutSource: effective.source, candidates };
}
