import type { AiResponseFormat } from "../contracts";
import { AiError } from "../errors";
import { PLAYLIST_SUMMARY_FEATURE_KEY, summaryProviderResponseSchema } from "../../lib/aiAdvisory/contracts";
import { PLAYLIST_SUMMARY_JSON_SCHEMA } from "./prompts";

const COLLECTION_KEYS = ["summaries", "playlistSummaries", "playlist_summaries"] as const;
const WRAPPER_KEYS = ["result", "data", "output", "response"] as const;

function valueType(value: unknown) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function playlistSummaryShapeDiagnostics(value: unknown) {
  const root = objectValue(value);
  const nestedWrapperPropertyNames: Record<string, string[]> = {};
  if (root) for (const wrapper of WRAPPER_KEYS) {
    const nested = objectValue(root[wrapper]);
    if (nested) nestedWrapperPropertyNames[wrapper] = Object.keys(nested).sort().slice(0, 50);
  }
  return {
    rootValueType: valueType(value),
    rootPropertyNames: root ? Object.keys(root).sort().slice(0, 50) : [],
    nestedWrapperPropertyNames,
  };
}

type Candidate = { path: string; summaries: unknown[]; owner?: Record<string, unknown> };

export function normalizePlaylistSummaryResponse(value: unknown) {
  const diagnostics = playlistSummaryShapeDiagnostics(value);
  const root = objectValue(value);
  const candidates: Candidate[] = [];
  const invalidCollectionPaths: string[] = [];

  if (Array.isArray(value)) candidates.push({ path: "$", summaries: value });
  const collect = (owner: Record<string, unknown>, prefix: string) => {
    for (const key of COLLECTION_KEYS) {
      if (!(key in owner)) continue;
      if (Array.isArray(owner[key])) candidates.push({ path: `${prefix}.${key}`, summaries: owner[key] as unknown[], owner });
      else invalidCollectionPaths.push(`${prefix}.${key}`);
    }
  };
  if (root) {
    collect(root, "$root");
    for (const wrapper of WRAPPER_KEYS) {
      const nested = objectValue(root[wrapper]);
      if (nested) collect(nested, `$root.${wrapper}`);
    }
  }

  const baseDetails = { ...diagnostics, summaryCandidatePaths: candidates.map((candidate) => candidate.path), invalidCollectionPaths };
  if (candidates.length > 1) throw new AiError("STRUCTURED_RESPONSE_INVALID", undefined, 422, undefined, { ...baseDetails, failure_stage: "AMBIGUOUS_SUMMARY_CANDIDATES", repairable: true });
  if (!candidates.length) {
    const failureStage = invalidCollectionPaths.length ? "SUMMARY_ROOT_NORMALIZATION" : "NO_SUMMARY_CANDIDATE";
    throw new AiError("STRUCTURED_RESPONSE_INVALID", undefined, 422, undefined, { ...baseDetails, failure_stage: failureStage, repairable: true });
  }
  if (invalidCollectionPaths.length) throw new AiError("STRUCTURED_RESPONSE_INVALID", undefined, 422, undefined, { ...baseDetails, failure_stage: "SUMMARY_ROOT_NORMALIZATION", repairable: true });

  const candidate = candidates[0];
  const schemaVersion = candidate.owner && "schemaVersion" in candidate.owner ? candidate.owner.schemaVersion : "1.0";
  const canonical = { schemaVersion, summaries: candidate.summaries };
  const canonicalRoot = candidate.path === "$root.summaries"
    && root
    && Object.keys(root).every((key) => key === "schemaVersion" || key === "summaries")
    && root.schemaVersion === "1.0";
  return {
    value: canonical,
    method: canonicalRoot ? undefined : candidate.path === "$" ? "WRAPPED_BARE_SUMMARY_ARRAY" : `CANONICALIZED_${candidate.path.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`,
    details: { ...baseDetails, summaryEntryCount: candidate.summaries.length },
  };
}

export function playlistSummaryValidationFailureStage(issues: Array<{ path: string }>) {
  return issues.some((issue) => /^summaries\.\d+(?:\.|$)/.test(issue.path)) ? "SUMMARY_ITEM_VALIDATION" : "SUMMARY_ROOT_VALIDATION";
}

export function safePlaylistSummaryLogDetails(details: Record<string, unknown> | undefined) {
  const issues = Array.isArray(details?.issues) ? details.issues as Array<Record<string, unknown>> : [];
  return {
    failureStage: details?.repair_failed === true ? "REPAIR_FAILURE" : details?.failure_stage,
    repairFailureStage: details?.repair_failed === true ? details?.failure_stage : undefined,
    rootValueType: details?.rootValueType,
    rootPropertyNames: details?.rootPropertyNames,
    nestedWrapperPropertyNames: details?.nestedWrapperPropertyNames,
    summaryEntryCount: details?.summaryEntryCount,
    issueCount: details?.issue_count || issues.length,
    issues: issues.map((issue) => ({ path: issue.path, code: issue.code })).slice(0, 25),
    repairAttempted: details?.repair_attempted === true,
    repairFailed: details?.repair_failed === true,
  };
}

export const playlistSummaryResponseFormat = {
  type: "json",
  name: PLAYLIST_SUMMARY_FEATURE_KEY,
  schema: summaryProviderResponseSchema,
  jsonSchema: PLAYLIST_SUMMARY_JSON_SCHEMA,
  unknownFields: "reject",
  allowEmbeddedJson: true,
  normalizeParsedValue: normalizePlaylistSummaryResponse,
  validationFailureStage: playlistSummaryValidationFailureStage,
} satisfies AiResponseFormat<any>;
