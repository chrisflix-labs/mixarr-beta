import { AiError } from "../errors";

const forbiddenKey = /(token|credential|password|secret|authorization|cookie|filesystem|path)/i;
const plexToken = /X-Plex-Token|plex[_-]?(?:access[_-]?)?token/i;
export function sanitizePromptText(value: unknown, maxLength = 1000) {
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (plexToken.test(text)) throw new AiError("INVALID_REQUEST", "Plex credentials are not permitted in AI prompts.");
  return text.slice(0, maxLength);
}
export function buildUntrustedDataBlock(records: Record<string, unknown>[], allowedFields: string[], maximumRecords = 100) {
  const fields = allowedFields.filter((field) => !forbiddenKey.test(field)).slice(0, 25);
  const safe = records.slice(0, maximumRecords).map((record) => Object.fromEntries(fields.map((field) => [field, sanitizePromptText(record[field], 500)])));
  return `<mixarr_untrusted_library_data>\n${JSON.stringify(safe)}\n</mixarr_untrusted_library_data>`;
}
