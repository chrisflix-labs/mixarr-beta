export function debugLoggingEnabled() {
  const level = String(process.env.MIXARR_LOG_LEVEL || process.env.LOG_LEVEL || "info").trim().toLowerCase();
  return level === "debug" || level === "trace";
}

export function logDebug(...args: unknown[]) {
  if (debugLoggingEnabled()) console.debug(...args);
}
