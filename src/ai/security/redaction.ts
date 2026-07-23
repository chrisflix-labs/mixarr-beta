import crypto from "crypto";

export const AI_REDACTION_POLICY_VERSION = "2.4.9-1";
export type RedactionCategory = "api_key" | "bearer_token" | "session_token" | "cookie" | "password" | "plex_token" | "database_url" | "authorization" | "webhook_secret" | "encryption_key" | "private_key" | "email" | "filesystem_path" | "hostname" | "ip_address" | "username" | "configured_secret";
export type RedactionPolicy = { emails?: boolean; filesystemPaths?: boolean; internalHostnames?: boolean; ipAddresses?: boolean; usernames?: string[]; configuredSecrets?: string[]; blockOnPrivateKey?: boolean };
export type RedactionResult = { redacted: boolean; count: number; categories: RedactionCategory[]; blockedEntirely: boolean; policyVersion: string; fingerprint: string };

const replacement = (category: RedactionCategory) => `[REDACTED:${category.toUpperCase()}]`;

function redactString(source: string, policy: RedactionPolicy) {
  let value = source;
  const counts = new Map<RedactionCategory, number>();
  const replace = (category: RedactionCategory, pattern: RegExp) => {
    value = value.replace(pattern, () => { counts.set(category, (counts.get(category) || 0) + 1); return replacement(category); });
  };
  replace("private_key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi);
  replace("authorization", /\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi);
  replace("bearer_token", /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi);
  replace("database_url", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi);
  replace("plex_token", /\bX-Plex-Token\s*[:=]\s*[^\s,;]+/gi);
  replace("cookie", /\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi);
  replace("password", /\b(?:password|passwd|pwd)\s*[:=]\s*[^\s,;]+/gi);
  replace("webhook_secret", /\b(?:webhook[_-]?secret)\s*[:=]\s*[^\s,;]+/gi);
  replace("encryption_key", /\b(?:encryption[_-]?key|secret[_-]?key)\s*[:=]\s*[^\s,;]+/gi);
  replace("api_key", /\b(?:api[_-]?key|access[_-]?token|session[_-]?token|client[_-]?secret)\s*[:=]\s*[A-Za-z0-9._~+\/-]{8,}/gi);
  replace("api_key", /\b(?:sk|pk|rk|ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{16,}\b/g);
  for (const secret of policy.configuredSecrets || []) if (secret && secret.length >= 4) replace("configured_secret", new RegExp(escapeRegExp(secret), "g"));
  if (policy.emails !== false) replace("email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
  if (policy.filesystemPaths !== false) {
    replace("filesystem_path", /\b[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/g);
    replace("filesystem_path", /(?<![A-Za-z0-9:])\/(?:home|Users|var|etc|opt|srv|mnt)\/[A-Za-z0-9._~+\/-]+/g);
  }
  if (policy.ipAddresses !== false) replace("ip_address", /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g);
  if (policy.internalHostnames !== false) replace("hostname", /\b(?:localhost|[a-z0-9-]+\.(?:local|internal|lan|home|corp))\b/gi);
  for (const username of policy.usernames || []) if (username && username.length >= 3) replace("username", new RegExp(`\\b${escapeRegExp(username)}\\b`, "gi"));
  return { value, counts };
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function walk(value: unknown, policy: RedactionPolicy, summary: Map<RedactionCategory, number>): unknown {
  if (typeof value === "string") {
    const redacted = redactString(value, policy);
    redacted.counts.forEach((count, category) => summary.set(category, (summary.get(category) || 0) + count));
    return redacted.value;
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, policy, summary));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key/i.test(key)) {
        if (item != null && item !== "") summary.set(key.toLowerCase().includes("cookie") ? "cookie" : "configured_secret", (summary.get(key.toLowerCase().includes("cookie") ? "cookie" : "configured_secret") || 0) + 1);
        output[key] = item == null || item === "" ? item : replacement("configured_secret");
      } else output[key] = walk(item, policy, summary);
    }
    return output;
  }
  return value;
}

export function redactAiContent<T>(input: T, policy: RedactionPolicy = {}): { value: T; result: RedactionResult } {
  const summary = new Map<RedactionCategory, number>();
  const value = walk(input, policy, summary) as T;
  const categories = Array.from(summary.keys()).sort();
  const count = Array.from(summary.values()).reduce((total, item) => total + item, 0);
  const blockedEntirely = policy.blockOnPrivateKey === true && summary.has("private_key");
  return { value, result: { redacted: count > 0, count, categories, blockedEntirely, policyVersion: AI_REDACTION_POLICY_VERSION, fingerprint: crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex") } };
}
