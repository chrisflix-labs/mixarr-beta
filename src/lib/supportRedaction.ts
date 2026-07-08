export const REDACTED_VALUE = "[REDACTED]";

const sensitiveKeyPattern = /(token|api[_-]?key|password|secret|authorization|cookie|session|database_url|access[_-]?token|refresh[_-]?token)/i;
const likelyPathPattern = /(?:[A-Za-z]:\\|\/(?:Users|home|mnt|media|music|var|tmp)\/)[^\s"'<>]+/g;
const inlineSecretPattern = /\b(token|api[_-]?key|password|secret|authorization|cookie|session|database_url|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*([^\s,;]+)/gi;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

export function isSensitiveKey(key: string) {
  return sensitiveKeyPattern.test(key);
}

export function maskUrlCredentials(value: string) {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/?#\s:@]+):([^/?#\s@]+)@/gi, `$1${REDACTED_VALUE}@`);
}

export function maskLocalPath(value: string) {
  return value.replace(likelyPathPattern, (match) => {
    const normalized = match.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const filename = parts.at(-1);
    if (!filename || !filename.includes(".")) return match;
    const root = normalized.startsWith("/") ? "/" : "";
    const base = parts[0]?.endsWith(":") ? `${parts[0]}/` : root || "/";
    return `${base}.../${filename}`;
  });
}

export function maskSensitiveValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return maskLocalPath(maskUrlCredentials(value)
    .replace(bearerPattern, `Bearer ${REDACTED_VALUE}`)
    .replace(inlineSecretPattern, `$1=${REDACTED_VALUE}`));
}

export function sanitizeErrorText(value: unknown, maxLength = 1200) {
  if (value == null) return null;
  const text = value instanceof Error ? value.message : String(value);
  const sanitized = String(maskSensitiveValue(text)).replace(/\s+/g, " ").trim();
  return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength - 1)}...` : sanitized;
}

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry)) as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (!isPlainObject(value)) return maskSensitiveValue(value) as T;

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactSecrets(entry);
  }
  return redacted as T;
}

export function sanitizeDiagnostics<T>(value: T): T {
  return redactSecrets(value);
}
