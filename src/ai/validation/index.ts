import { z } from "zod";
import type { AiResponseFormat } from "../contracts";
import { AiError } from "../errors";

export const AI_RESPONSE_LIMITS = { maxDepth: 12, maxArrayLength: 1000, maxStringLength: 100_000 };

export function assertJsonComplexity(value: unknown, depth = 0, limits = AI_RESPONSE_LIMITS) {
  if (depth > limits.maxDepth) throw new AiError("STRUCTURED_RESPONSE_INVALID");
  if (typeof value === "string" && value.length > limits.maxStringLength) throw new AiError("STRUCTURED_RESPONSE_INVALID");
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) throw new AiError("STRUCTURED_RESPONSE_INVALID");
    value.forEach((item) => assertJsonComplexity(item, depth + 1, limits));
  } else if (value && typeof value === "object") Object.values(value).forEach((item) => assertJsonComplexity(item, depth + 1, limits));
}

export function parseStructuredResponse<T>(content: string, format: AiResponseFormat<T>, maxBytes: number, maximumStructuredItems = AI_RESPONSE_LIMITS.maxArrayLength): T {
  return parseStructuredResponseDetailed(content, format, maxBytes, maximumStructuredItems).data;
}

export function parseStructuredResponseDetailed<T>(content: string, format: AiResponseFormat<T>, maxBytes: number, maximumStructuredItems = AI_RESPONSE_LIMITS.maxArrayLength): { data: T; repaired: boolean; repairMethod?: string } {
  if (Buffer.byteLength(content, "utf8") > maxBytes) throw new AiError("RESPONSE_TOO_LARGE");
  let parsed: unknown;
  let source = content.trim();
  let repaired = false;
  let repairMethod: string | undefined;
  try { parsed = JSON.parse(source); } catch {
    const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) { source = fenced[1].trim().replace(/,\s*([}\]])/g, "$1"); repaired = true; repairMethod = "REMOVED_CODE_FENCE_AND_TRAILING_COMMA"; }
    else {
      const start = source.indexOf("{"); const end = source.lastIndexOf("}");
      if (start >= 0 && end > start && !source.slice(start + 1, end).includes("```")) { source = source.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"); repaired = true; repairMethod = "EXTRACTED_SINGLE_OBJECT"; }
    }
    try { parsed = JSON.parse(source); } catch { throw new AiError("STRUCTURED_RESPONSE_INVALID", undefined, 400, undefined, { repair_attempted: repaired, repair_method: repairMethod }); }
  }
  assertJsonComplexity(parsed, 0, { ...AI_RESPONSE_LIMITS, maxArrayLength: Math.min(AI_RESPONSE_LIMITS.maxArrayLength, Math.max(1, maximumStructuredItems)) });
  const result = format.schema.safeParse(parsed);
  if (!result.success) throw new AiError("STRUCTURED_RESPONSE_INVALID", undefined, 400, undefined, { issues: result.error.issues.slice(0, 25).map((issue) => ({ path: issue.path.join("."), code: issue.code })) });
  return { data: result.data, repaired, repairMethod };
}

export const safeMetadataSchema = z.record(z.union([z.string().max(500), z.number().finite(), z.boolean()])).default({});
