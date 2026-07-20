import crypto from "crypto";
import { decryptAiSecret, encryptAiSecret, isAiSecretEncryptionConfigured } from "../../lib/secretStorage";
import { redactSecrets, sanitizeErrorText } from "../../lib/supportRedaction";

export { isAiSecretEncryptionConfigured };
export function encryptAiCredentialPayload(value: Record<string, unknown>) { return encryptAiSecret(JSON.stringify(value)); }
export function decryptAiCredentialPayload(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  const parsed = JSON.parse(decryptAiSecret(value));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}
export function redactAiValue<T>(value: T): T { return redactSecrets(value); }
export function sanitizeAiError(value: unknown) { return sanitizeErrorText(value, 400) || "Provider request failed."; }
export function oneWayPromptHash(parts: string[]) { return crypto.createHash("sha256").update(parts.join("\u001f")).digest("hex"); }

const forbiddenHeader = /^(authorization|proxy-authorization|cookie|set-cookie|x-plex-token)$/i;
export function validateNonSecretHeaders(headers: Record<string, unknown>) {
  const output: Record<string, string> = {};
  for (const [name, raw] of Object.entries(headers)) {
    if (forbiddenHeader.test(name) || /(api[-_]?key|token|secret|password)/i.test(name)) throw new Error(`Header ${name} must be configured as a secret header.`);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || typeof raw !== "string" || raw.length > 1024) throw new Error("Invalid custom header.");
    output[name] = raw;
  }
  return output;
}

export function validateSecretHeaders(headers: Record<string, unknown>) {
  const output: Record<string, string> = {};
  for (const [name, raw] of Object.entries(headers)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || typeof raw !== "string" || !raw || raw.length > 4096) throw new Error("Invalid secret header.");
    output[name] = raw;
  }
  return output;
}
