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
  if (Buffer.byteLength(content, "utf8") > maxBytes) throw new AiError("RESPONSE_TOO_LARGE");
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new AiError("STRUCTURED_RESPONSE_INVALID"); }
  assertJsonComplexity(parsed, 0, { ...AI_RESPONSE_LIMITS, maxArrayLength: Math.min(AI_RESPONSE_LIMITS.maxArrayLength, Math.max(1, maximumStructuredItems)) });
  const result = format.schema.safeParse(parsed);
  if (!result.success) throw new AiError("STRUCTURED_RESPONSE_INVALID");
  return result.data;
}

export const safeMetadataSchema = z.record(z.union([z.string().max(500), z.number().finite(), z.boolean()])).default({});
