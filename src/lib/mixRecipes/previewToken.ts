import { createHash } from "node:crypto";

export type RecipeImportPreviewToken = {
  sourceRecipeFingerprint: string;
  effectiveRecipeFingerprint: string;
  trustPolicyRevision: string;
  safetyPolicyRevision: string;
  compatibilityRevision: string;
  dependencyRevision: string;
  permissionRevision: string;
  governanceRevision: string;
};

export type RecipeImportPreviewDomain =
  | "sourceRecipe"
  | "effectiveRecipe"
  | "trustPolicy"
  | "safetyPolicy"
  | "compatibility"
  | "dependencies"
  | "permissions"
  | "governanceEngine";

function canonicalValue(value: unknown, inArray = false): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return inArray ? null : undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, true));
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => {
        const normalized = canonicalValue((value as Record<string, unknown>)[key]);
        return normalized === undefined ? [] : [[key, normalized]];
      }));
  }
  return String(value);
}

export function canonicalSecurityJson(value: unknown) {
  return JSON.stringify(canonicalValue(value)) ?? "null";
}

export function securityFingerprint(value: unknown) {
  return createHash("sha256").update(canonicalSecurityJson(value)).digest("hex");
}

export function createRecipeImportPreviewToken(input: {
  sourceRecipe: unknown;
  effectiveRecipe: unknown;
  trustPolicy: unknown;
  safetyPolicy: unknown;
  compatibility: unknown;
  dependencies: unknown;
  permissions: unknown;
  governanceRevision: string;
}): RecipeImportPreviewToken {
  return {
    sourceRecipeFingerprint: securityFingerprint(input.sourceRecipe),
    effectiveRecipeFingerprint: securityFingerprint(input.effectiveRecipe),
    trustPolicyRevision: securityFingerprint(input.trustPolicy),
    safetyPolicyRevision: securityFingerprint(input.safetyPolicy),
    compatibilityRevision: securityFingerprint(input.compatibility),
    dependencyRevision: securityFingerprint(input.dependencies),
    permissionRevision: securityFingerprint(input.permissions),
    governanceRevision: input.governanceRevision,
  };
}

const tokenDomains: Array<[keyof RecipeImportPreviewToken, RecipeImportPreviewDomain]> = [
  ["sourceRecipeFingerprint", "sourceRecipe"],
  ["effectiveRecipeFingerprint", "effectiveRecipe"],
  ["trustPolicyRevision", "trustPolicy"],
  ["safetyPolicyRevision", "safetyPolicy"],
  ["compatibilityRevision", "compatibility"],
  ["dependencyRevision", "dependencies"],
  ["permissionRevision", "permissions"],
  ["governanceRevision", "governanceEngine"],
];

export function changedRecipeImportPreviewDomains(expected: RecipeImportPreviewToken | null | undefined, actual: RecipeImportPreviewToken) {
  if (!expected) return tokenDomains.map(([, domain]) => domain);
  return tokenDomains.filter(([key]) => expected[key] !== actual[key]).map(([, domain]) => domain);
}
