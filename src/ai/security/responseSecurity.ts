import { detectPromptInjection } from "./promptInjection";

export const NON_OVERRIDABLE_QUARANTINE_REASONS = new Set([
  "protected_playlist_modification", "credential_modification", "permission_modification", "safety_limit_disabling",
  "unapproved_provider_use", "local_only_policy_violation", "deterministic_validation_bypass", "unsupported_destructive_action",
]);

const prohibited: Array<{ code: string; pattern: RegExp }> = [
  { code: "credential_modification", pattern: /\b(?:api.?key|plex.?token|password|credential)\b[\s\S]{0,60}\b(?:set|replace|change|update|write)\b|\b(?:set|replace|change|update|write)\b[\s\S]{0,60}\b(?:api.?key|plex.?token|password|credential)\b/i },
  { code: "permission_modification", pattern: /\b(?:grant|revoke|change|modify)\b[\s\S]{0,60}\b(?:permission|role|administrator|admin)\b/i },
  { code: "safety_limit_disabling", pattern: /\b(?:disable|remove|increase|bypass)\b[\s\S]{0,60}\b(?:safety|limit|validation|quarantine|approval)\b/i },
  { code: "protected_playlist_modification", pattern: /\b(?:delete|modify|overwrite|remove)\b[\s\S]{0,60}\bprotected\s+playlist\b/i },
  { code: "deterministic_validation_bypass", pattern: /\b(?:bypass|ignore|override)\b[\s\S]{0,60}\bdeterministic\s+validation\b/i },
  { code: "unsupported_destructive_action", pattern: /\b(?:execute|run)\b[\s\S]{0,40}\b(?:shell|sql|javascript|powershell|command)\b|<script\b|javascript:/i },
  { code: "self_approval", pattern: /\b(?:approve|approved|mark)\b[\s\S]{0,40}\b(?:myself|itself|this response|as safe)\b/i },
  { code: "policy_override", pattern: /\b(?:ignore|override|disable)\b[\s\S]{0,60}\b(?:mixarr policy|system policy|security controls?)\b/i },
];

export function inspectAiResponse(value: unknown, allowedTopLevelFields?: readonly string[]) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const reasons = prohibited.filter((rule) => rule.pattern.test(text)).map((rule) => rule.code);
  const injection = detectPromptInjection(text);
  if (injection.blocked) reasons.push(...injection.reasons.map((reason) => `response_${reason}`));
  if (allowedTopLevelFields && value && typeof value === "object" && !Array.isArray(value)) {
    const allowed = new Set(allowedTopLevelFields);
    for (const key of Object.keys(value as Record<string, unknown>)) if (!allowed.has(key)) reasons.push(`unknown_field:${key}`);
  }
  const unique = Array.from(new Set(reasons));
  return { safe: unique.length === 0, reasons: unique, severity: unique.some((reason) => NON_OVERRIDABLE_QUARANTINE_REASONS.has(reason)) ? "BLOCKED" : unique.length ? "HIGH" : "NONE", nonOverridable: unique.some((reason) => NON_OVERRIDABLE_QUARANTINE_REASONS.has(reason)), htmlMustRenderAsText: /<[^>]+>/.test(text) };
}
