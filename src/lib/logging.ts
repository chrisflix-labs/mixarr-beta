export function debugLoggingEnabled() {
  const level = String(process.env.MIXARR_LOG_LEVEL || process.env.LOG_LEVEL || "info").trim().toLowerCase();
  return level === "debug" || level === "trace";
}

export function logDebug(...args: unknown[]) {
  if (debugLoggingEnabled()) console.debug(...args);
}

const repeatedLogs = new Map<string, number>();

/** Logs the first three occurrences and then one compact reminder per 100. */
export function logRateLimited(level: "warn" | "error", key: string, ...args: unknown[]) {
  const count = (repeatedLogs.get(key) || 0) + 1;
  repeatedLogs.set(key, count);
  if (count <= 3 || count % 100 === 0) {
    const suffix = count > 3 ? `(repeated ${count} times; intermediate messages suppressed)` : undefined;
    console[level](...args, ...(suffix ? [suffix] : []));
  }
}
