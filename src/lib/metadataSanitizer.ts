import { logDebug } from "./logging";

type SanitizeContext = {
  entity?: string;
  entityId?: string | number | null;
  field?: string;
};

export type MetadataSanitizerStats = {
  total: number;
  entities: Record<string, number>;
  fields: Record<string, number>;
};

const sanitizerStats: MetadataSanitizerStats = { total: 0, entities: {}, fields: {} };

export function getMetadataSanitizerStats(): MetadataSanitizerStats {
  return {
    total: sanitizerStats.total,
    entities: { ...sanitizerStats.entities },
    fields: { ...sanitizerStats.fields },
  };
}

export function logMetadataSanitizerSummarySince(before: MetadataSanitizerStats) {
  const entities = Object.fromEntries(Object.entries(sanitizerStats.entities)
    .map(([key, value]) => [key, value - (before.entities[key] || 0)])
    .filter(([, value]) => Number(value) > 0));
  const fields = Object.fromEntries(Object.entries(sanitizerStats.fields)
    .map(([key, value]) => [key, value - (before.fields[key] || 0)])
    .filter(([, value]) => Number(value) > 0));
  const total = sanitizerStats.total - before.total;
  if (total > 0) {
    const entityCounts = Object.entries(entities).map(([key, value]) => `${key}=${value}`).join(" ");
    const fieldCounts = Object.entries(fields).map(([key, value]) => `${key}:${value}`).join(",");
    console.info(`[MetadataSanitizer] Sanitized metadata ${entityCounts || `items=${total}`} fields={${fieldCounts}}`);
  }
}

function replaceMalformedSurrogates(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += "\ufffd";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += "\ufffd";
    } else {
      result += value[index];
    }
  }
  return result;
}

export function sanitizeMetadataString(value: string): string {
  return replaceMalformedSurrogates(value)
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u001f\u007f-\u009f]/g, " ");
}

export function sanitizeOptionalMetadataString(
  value: unknown,
  context: SanitizeContext = {},
): string | null {
  if (value === null || value === undefined) return null;
  const original = String(value);
  const sanitized = sanitizeMetadataString(original);
  if (sanitized !== original) {
    const entityKey = String(context.entity || "item").trim().toLowerCase() + "s";
    const fieldKey = String(context.field || "unknown").trim();
    sanitizerStats.total += 1;
    sanitizerStats.entities[entityKey] = (sanitizerStats.entities[entityKey] || 0) + 1;
    sanitizerStats.fields[fieldKey] = (sanitizerStats.fields[fieldKey] || 0) + 1;
    const location = [
      context.entity,
      context.entityId != null ? `id=${sanitizeMetadataString(String(context.entityId))}` : null,
      context.field ? `field=${context.field}` : null,
    ].filter(Boolean).join(" ");
    logDebug(`[MetadataSanitizer] Removed or replaced unsafe characters${location ? ` (${location})` : ""}.`);
  }
  return sanitized;
}

export function sanitizeRequiredMetadataString(
  value: unknown,
  context: SanitizeContext = {},
): string {
  return sanitizeOptionalMetadataString(value, context) ?? "";
}
