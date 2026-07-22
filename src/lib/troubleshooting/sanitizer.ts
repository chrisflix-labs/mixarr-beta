const CREDENTIAL_KEY = /(secret|token|password|passwd|credential|authorization|cookie|private[_-]?key|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|database[_-]?url|connection[_-]?string|encryption[_-]?key)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IP = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const PATH = /(?:[A-Za-z]:\\(?:[^\\\s"'<>]+\\)*[^\\\s"'<>]*|\/(?:Users|home|mnt|media|music|var|tmp|app|config)(?:\/[^\s"'<>]+)+)/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const INLINE_SECRET = /\b(secret|token|password|passwd|credential|authorization|cookie|private[_-]?key|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*([^\s,;]+)/gi;
const URL_TOKEN = /([?&](?:access_token|token|api_key|apikey|key|signature|sig|auth)=)[^&#\s]+/gi;
const HOSTNAME = /\b(?=.{1,253}\b)(?![\d.]+\b)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:local|lan|internal|com|net|org|io|dev|app)\b/gi;

export type RedactionSummary = Record<"credentials_removed" | "email_addresses_pseudonymized" | "filesystem_paths_pseudonymized" | "ip_addresses_pseudonymized" | "hostnames_pseudonymized" | "depth_limited", number>;
type Kind = "USER" | "LIBRARY_PATH" | "IP_ADDRESS" | "HOST";

export class DiagnosticSanitizer {
  private maps: Record<Kind, Map<string, string>> = { USER: new Map(), LIBRARY_PATH: new Map(), IP_ADDRESS: new Map(), HOST: new Map() };
  readonly summary: RedactionSummary = { credentials_removed: 0, email_addresses_pseudonymized: 0, filesystem_paths_pseudonymized: 0, ip_addresses_pseudonymized: 0, hostnames_pseudonymized: 0, depth_limited: 0 };

  constructor(private readonly maxDepth = 12) {}

  private placeholder(kind: Kind, value: string) {
    const map = this.maps[kind];
    const normalized = value.toLowerCase();
    if (!map.has(normalized)) map.set(normalized, `[${kind}_${map.size + 1}]`);
    return map.get(normalized)!;
  }

  sanitizeText(input: string) {
    let value = input.replace(BEARER, () => { this.summary.credentials_removed += 1; return "Bearer [REDACTED_CREDENTIAL]"; });
    value = value.replace(INLINE_SECRET, (_, key: string) => { this.summary.credentials_removed += 1; return `${key}=[REDACTED_CREDENTIAL]`; });
    value = value.replace(URL_TOKEN, (_, prefix: string) => { this.summary.credentials_removed += 1; return `${prefix}[REDACTED_CREDENTIAL]`; });
    value = value.replace(EMAIL, (match) => { this.summary.email_addresses_pseudonymized += 1; return this.placeholder("USER", match); });
    value = value.replace(PATH, (match) => { this.summary.filesystem_paths_pseudonymized += 1; return this.placeholder("LIBRARY_PATH", match); });
    value = value.replace(IP, (match) => { this.summary.ip_addresses_pseudonymized += 1; return this.placeholder("IP_ADDRESS", match); });
    value = value.replace(HOSTNAME, (match) => { this.summary.hostnames_pseudonymized += 1; return this.placeholder("HOST", match); });
    return value;
  }

  sanitize<T>(input: T, depth = 0): T {
    if (depth > this.maxDepth) { this.summary.depth_limited += 1; return "[MAX_DEPTH_REMOVED]" as T; }
    if (input instanceof Date) return input.toISOString() as T;
    if (typeof input === "string") return this.sanitizeText(input) as T;
    if (Array.isArray(input)) return input.slice(0, 10_000).map((entry) => this.sanitize(entry, depth + 1)) as T;
    if (!input || typeof input !== "object") return input;
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (CREDENTIAL_KEY.test(key)) { this.summary.credentials_removed += 1; output[key] = "[REDACTED_CREDENTIAL]"; }
      else output[key] = this.sanitize(value, depth + 1);
    }
    return output as T;
  }
}

export function sanitizeDiagnosticValue<T>(value: T, maxDepth = 12) {
  const sanitizer = new DiagnosticSanitizer(maxDepth);
  return { value: sanitizer.sanitize(value), summary: sanitizer.summary };
}

export function containsLikelySecret(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /\bBearer\s+(?!\[REDACTED)|(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*[:=]\s*(?!\[REDACTED)[^\s,;}]+/i.test(text || "");
}
