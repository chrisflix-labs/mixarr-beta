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

function extractSingleJsonObject(source: string) {
  const candidates: string[] = [];
  let start = -1; let depth = 0; let quoted = false; let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === "{") { if (depth === 0) start = index; depth += 1; }
    else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) { candidates.push(source.slice(start, index + 1)); start = -1; }
    }
  }
  return depth === 0 && candidates.length === 1 ? candidates[0] : null;
}

export function parseStructuredResponseDetailed<T>(content: string, format: AiResponseFormat<T>, maxBytes: number, maximumStructuredItems = AI_RESPONSE_LIMITS.maxArrayLength): { data: T; repaired: boolean; repairMethod?: string } {
  if (Buffer.byteLength(content, "utf8") > maxBytes) throw new AiError("RESPONSE_TOO_LARGE");
  let parsed: unknown;
  let source = content.trim();
  if (!source) throw new AiError("AI_PROVIDER_EMPTY_RESPONSE", undefined, 502, undefined, { failure_stage: "EMPTY_BODY" });
  let repaired = false;
  let repairMethod: string | undefined;
  try { parsed = JSON.parse(source); } catch {
    const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) { source = fenced[1].trim(); repaired = true; repairMethod = "REMOVED_JSON_CODE_FENCE"; }
    else {
      const extracted = !source.includes("```") ? extractSingleJsonObject(source) : null;
      if (extracted) { source = extracted; repaired = true; repairMethod = "EXTRACTED_UNAMBIGUOUS_OBJECT"; }
    }
    const withoutTrailingCommas = source.replace(/,\s*([}\]])/g, "$1");
    if (withoutTrailingCommas !== source) { source = withoutTrailingCommas; repaired = true; repairMethod = repairMethod ? `${repairMethod}_AND_TRAILING_COMMA` : "REMOVED_TRAILING_COMMA"; }
    try { parsed = JSON.parse(source); } catch { throw new AiError("STRUCTURED_RESPONSE_INVALID", undefined, 422, undefined, { failure_stage: "JSON_PARSE", repair_attempted: repaired, repair_method: repairMethod }); }
  }
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); repaired = true; repairMethod = "PARSED_JSON_STRING"; }
    catch { throw new AiError("STRUCTURED_RESPONSE_INVALID", undefined, 422, undefined, { failure_stage: "JSON_PARSE", repair_attempted: true, repair_method: "PARSED_JSON_STRING" }); }
  }
  assertJsonComplexity(parsed, 0, { ...AI_RESPONSE_LIMITS, maxArrayLength: Math.min(AI_RESPONSE_LIMITS.maxArrayLength, Math.max(1, maximumStructuredItems)) });
  const result = format.schema.safeParse(parsed);
  if (!result.success) throw new AiError("STRUCTURED_RESPONSE_INVALID", undefined, 422, undefined, { failure_stage: "SCHEMA_VALIDATION", issues: result.error.issues.slice(0, 25).map((issue) => ({ path: issue.path.join("."), code: issue.code })) });
  return { data: result.data, repaired, repairMethod };
}

export async function parseStructuredResponseWithProviderRepair<T>(input: {
  content: string;
  format: AiResponseFormat<T>;
  maxBytes: number;
  maximumStructuredItems?: number;
  providerRepairAttempts: number;
  repair?: (malformedContent: string) => Promise<string>;
}) {
  try {
    const parsed = parseStructuredResponseDetailed(input.content, input.format, input.maxBytes, input.maximumStructuredItems);
    return { ...parsed, content: input.content, providerRepairUsed: false };
  } catch (error) {
    const structured = error instanceof AiError ? error : new AiError("STRUCTURED_RESPONSE_INVALID");
    if (structured.details?.failure_stage !== "JSON_PARSE" || input.providerRepairAttempts < 1 || !input.repair) throw structured;
    const repairedContent = await input.repair(input.content);
    try {
      const parsed = parseStructuredResponseDetailed(repairedContent, input.format, input.maxBytes, input.maximumStructuredItems);
      return { ...parsed, content: repairedContent, providerRepairUsed: true, repairMethod: "PROVIDER_JSON_REPAIR" };
    } catch (repairError) {
      const repaired = repairError instanceof AiError ? repairError : new AiError("STRUCTURED_RESPONSE_INVALID");
      if (repaired.details?.failure_stage === "SCHEMA_VALIDATION") throw repaired;
      throw new AiError("AI_PROVIDER_INVALID_RESPONSE", undefined, 422, undefined, { failure_stage: repaired.details?.failure_stage || "JSON_PARSE", repair_attempted: true, repair_method: "PROVIDER_JSON_REPAIR" });
    }
  }
}

export const safeMetadataSchema = z.record(z.union([z.string().max(500), z.number().finite(), z.boolean()])).default({});
