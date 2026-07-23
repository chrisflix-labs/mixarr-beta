export const PROMPT_INJECTION_REASON_CODES = ["instruction_override", "secret_exfiltration", "permission_bypass", "policy_bypass", "role_impersonation", "embedded_prompt", "unsafe_action_request", "external_data_exfiltration"] as const;
export type PromptInjectionReason = typeof PROMPT_INJECTION_REASON_CODES[number];
export type PromptInjectionSeverity = "none" | "low" | "medium" | "high" | "blocked";

const rules: Array<{ reason: PromptInjectionReason; severity: PromptInjectionSeverity; pattern: RegExp }> = [
  { reason: "instruction_override", severity: "high", pattern: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)(?:\s+(?:system|developer))?\s+instructions?\b/i },
  { reason: "secret_exfiltration", severity: "blocked", pattern: /\b(?:reveal|show|print|return|exfiltrate|send)\b[\s\S]{0,80}\b(?:api keys?|tokens?|passwords?|credentials?|system prompt|hidden prompt)\b/i },
  { reason: "permission_bypass", severity: "blocked", pattern: /\b(?:bypass|circumvent|override|disable)\b[\s\S]{0,80}\b(?:permission|authorization|approval|role check)\b/i },
  { reason: "policy_bypass", severity: "blocked", pattern: /\b(?:disable|ignore|bypass|override)\b[\s\S]{0,80}\b(?:safety|policy|validation|quarantine|redaction|local.only)\b/i },
  { reason: "role_impersonation", severity: "high", pattern: /\b(?:act as|you are now|pretend to be)\b[\s\S]{0,40}\b(?:administrator|admin|system|root)\b/i },
  { reason: "embedded_prompt", severity: "high", pattern: /(?:^|\n|["'])\s*(?:system|assistant|developer)\s*:\s*/im },
  { reason: "unsafe_action_request", severity: "blocked", pattern: /(?:\b(?:execute|run|install)\b[\s\S]{0,60}\b(?:shell|sql|javascript|powershell|command|package)\b|\b(?:delete|drop|chmod)\b[\s\S]{0,60}\b(?:database|playlist|file|table)\b)/i },
  { reason: "external_data_exfiltration", severity: "blocked", pattern: /\b(?:upload|post|send|forward)\b[\s\S]{0,80}\b(?:logs?|library|metadata|diagnostics?|credentials?)\b[\s\S]{0,80}\b(?:external|webhook|url|server|provider)\b/i },
];

const rank: Record<PromptInjectionSeverity, number> = { none: 0, low: 1, medium: 2, high: 3, blocked: 4 };

export function detectPromptInjection(input: unknown) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  const reasons: PromptInjectionReason[] = [];
  let severity: PromptInjectionSeverity = "none";
  for (const rule of rules) if (rule.pattern.test(text)) { reasons.push(rule.reason); if (rank[rule.severity] > rank[severity]) severity = rule.severity; }
  if (severity === "none" && /\bprompt\b.{0,30}\binstruction/i.test(text)) severity = "low";
  return { severity, reasons: Array.from(new Set(reasons)), blocked: severity === "high" || severity === "blocked", detectorVersion: "2.4.9-1", perfectSecurityClaimed: false };
}
