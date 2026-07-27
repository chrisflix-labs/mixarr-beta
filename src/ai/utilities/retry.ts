import { AiError } from "../errors";

export function isRetryEligible(error: unknown) {
  return error instanceof AiError && (
    ["RATE_LIMITED", "REQUEST_TIMEOUT", "CONNECTION_FAILED", "PROVIDER_OVERLOADED", "STREAM_INTERRUPTED", "AI_CONNECTION_TIMEOUT", "AI_FIRST_TOKEN_TIMEOUT", "AI_TOTAL_TIMEOUT", "AI_STREAM_IDLE_TIMEOUT"].includes(error.category)
    || error.category === "AI_PROVIDER_HTTP_ERROR" && error.details?.retryable === true
  );
}
export function retryDelayMs(attempt: number, initial: number, maximum: number, multiplier: number, random = Math.random) {
  const base = Math.min(maximum, initial * Math.pow(multiplier, attempt));
  return Math.min(maximum, Math.round(base * (0.75 + random() * 0.5)));
}
export function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new AiError("REQUEST_CANCELLED"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new AiError("REQUEST_CANCELLED")); }, { once: true });
  });
}
