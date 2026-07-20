import { createPublicKey, verify as verifySignature } from "node:crypto";
import { APP_VERSION_NUMBER } from "../appVersion";
import type { MixRecipeDocument } from "./schema";
import { RECIPE_PERMISSIONS, type RecipePermission } from "./governanceTypes";
export { assertRecipeExecutionAllowed } from "./executionPolicy";

export type { RecipePermission } from "./governanceTypes";
export type RiskLevel = "low" | "moderate" | "high" | "destructive";
export type GovernanceFinding = { code: string; path: string; severity: "information" | "warning" | "error" | "high" | "destructive"; message: string; suggestedValue?: unknown };
export type PermissionDecision = { permission: RecipePermission; reason: string; riskLevel: RiskLevel; decision: "allow" | "restrict" | "deny"; fallback: string | null; inferred: boolean; required: boolean };

export const DEFAULT_RECIPE_SAFETY_LIMITS = Object.freeze({
  maxTracksAddedPerRun: 50,
  maxTracksRemovedPerRun: 20,
  maxReplacementPercentage: 25,
  maxPlaylistsModifiedPerRun: 3,
  maxRecipesPerImport: 25,
  minimumAutomationIntervalHours: 24,
  maxCandidatePoolSize: 5_000,
  maxGeneratedPlaylistSize: 500,
  maxScheduleExecutionsPerDay: 4,
  maxExternalRequestsPerExecution: 25,
  maxRetryCount: 3,
  maxConsecutiveAutomaticFailures: 3,
});

export const ABSOLUTE_RECIPE_SAFETY_CAPS = Object.freeze({
  maxTracksAddedPerRun: 500,
  maxTracksRemovedPerRun: 100,
  maxReplacementPercentage: 50,
  maxPlaylistsModifiedPerRun: 25,
  maxRecipesPerImport: 100,
  minimumAutomationIntervalHours: 1,
  maxCandidatePoolSize: 25_000,
  maxGeneratedPlaylistSize: 2_000,
  maxScheduleExecutionsPerDay: 24,
  maxExternalRequestsPerExecution: 250,
  maxRetryCount: 10,
  maxConsecutiveAutomaticFailures: 10,
});

export type RecipeSafetyLimits = { [K in keyof typeof DEFAULT_RECIPE_SAFETY_LIMITS]: number };

const permissionRisk: Record<RecipePermission, RiskLevel> = {
  "playlist.create": "low", "playlist.update": "moderate", "playlist.delete": "destructive", "playlist.protected_update": "destructive",
  "automation.create": "low", "automation.update": "moderate", "automation.enable": "moderate", "automation.fully_automatic": "high",
  "automation.remove_tracks": "high", "automation.add_tracks": "moderate", "schedule.create": "moderate", "schedule.frequent_refresh": "high",
  "approval.disable": "high", "library.read": "low", "plex.collection.read": "low", "plex.collection.write": "high",
  "webhook.create": "high", "notification.create": "moderate", "external_integration.use": "high",
};

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
export function canonicalRecipeSignaturePayload(input: unknown) {
  const cloned = JSON.parse(JSON.stringify(input)) as Record<string, any>;
  if (isRecord(cloned.signature)) delete cloned.signature.value;
  if (cloned.format === "mixarr-recipe") {
    if (isRecord(cloned.metadata)) {
      delete cloned.metadata.slug;
      delete cloned.metadata.sourcePlaylistId;
      delete cloned.metadata.artworkUrl;
    }
    if (isRecord(cloned.automationPolicy)) delete cloned.automationPolicy.libraryId;
    if (isRecord(cloned.generation)) {
      cloned.generation.serverId = null;
      cloned.generation.libraryId = null;
      cloned.generation.pinnedTrackIds = [];
      cloned.generation.excludedTrackIds = [];
    }
  }
  return JSON.stringify(stable(cloned));
}

export type SignatureVerification = { status: "VALID" | "INVALID" | "UNKNOWN_KEY" | "REVOKED_KEY" | "UNSUPPORTED_ALGORITHM" | "MISSING" | "EXPIRED"; keyId: string | null; signerIdentity: string | null; official: boolean; trusted: boolean; signedAt: string | null; message: string };
export type PublicSigningKey = { keyId: string; algorithm: string; publicKey: string; identity: string; official: boolean; trusted: boolean; expiresAt?: Date | string | null; revokedAt?: Date | string | null };

export function verifyRecipeSignature(recipe: MixRecipeDocument, keys: PublicSigningKey[], now = new Date()): SignatureVerification {
  const signature = recipe.signature;
  if (!signature) return { status: "MISSING", keyId: null, signerIdentity: null, official: false, trusted: false, signedAt: null, message: "The recipe is unsigned." };
  if (signature.algorithm !== "ed25519") return { status: "UNSUPPORTED_ALGORITHM", keyId: signature.keyId, signerIdentity: null, official: false, trusted: false, signedAt: signature.signedAt, message: "Only Ed25519 recipe signatures are supported." };
  const key = keys.find((item) => item.keyId === signature.keyId);
  if (!key) return { status: "UNKNOWN_KEY", keyId: signature.keyId, signerIdentity: null, official: false, trusted: false, signedAt: signature.signedAt, message: "The signing key is not recognized by this Mixarr installation." };
  if (key.revokedAt) return { status: "REVOKED_KEY", keyId: key.keyId, signerIdentity: key.identity, official: false, trusted: false, signedAt: signature.signedAt, message: "The signing key has been revoked." };
  const expiry = signature.expiresAt || key.expiresAt;
  if (expiry && new Date(expiry) <= now) return { status: "EXPIRED", keyId: key.keyId, signerIdentity: key.identity, official: false, trusted: false, signedAt: signature.signedAt, message: "The recipe signature or signing key has expired." };
  let raw: Buffer;
  try {
    raw = Buffer.from(signature.value, "base64");
    if (!raw.length || raw.toString("base64").replace(/=+$/, "") !== signature.value.replace(/=+$/, "")) throw new Error("invalid base64");
    const valid = verifySignature(null, Buffer.from(canonicalRecipeSignaturePayload(recipe)), createPublicKey(key.publicKey), raw);
    if (!valid) throw new Error("signature mismatch");
  } catch {
    return { status: "INVALID", keyId: key.keyId, signerIdentity: key.identity, official: false, trusted: false, signedAt: signature.signedAt, message: "The signature does not match the canonical recipe payload." };
  }
  return { status: "VALID", keyId: key.keyId, signerIdentity: key.identity, official: key.official && key.trusted, trusted: key.trusted, signedAt: signature.signedAt, message: "The Ed25519 signature is valid." };
}

export function inferRecipePermissions(recipe: MixRecipeDocument): PermissionDecision[] {
  const explicit = new Map(recipe.permissions.map((item) => [item.permission, item]));
  const inferred = new Map<RecipePermission, string>();
  inferred.set("library.read", "Candidate selection reads the local music library.");
  inferred.set("playlist.create", "Using the recipe can create a generated playlist.");
  if (recipe.automationPolicy.enabled) {
    inferred.set("automation.create", "The recipe contains automation configuration.");
    inferred.set("automation.enable", "The recipe requests enabled automation.");
  }
  if (recipe.refreshPolicy.mode === "scheduled") {
    inferred.set("schedule.create", "The recipe requests scheduled refreshes.");
    if ((recipe.refreshPolicy.frequencyDays || 999) <= 1) inferred.set("schedule.frequent_refresh", "The schedule can run daily.");
  }
  if (recipe.refreshPolicy.strategy === "full_regeneration") {
    inferred.set("playlist.update", "Full regeneration replaces playlist membership.");
    inferred.set("automation.remove_tracks", "Full regeneration can remove existing tracks.");
    inferred.set("automation.add_tracks", "Full regeneration can add replacement tracks.");
  } else if (recipe.refreshPolicy.mode === "scheduled") {
    inferred.set("playlist.update", "Scheduled weak-track refresh modifies playlist membership.");
    inferred.set("automation.remove_tracks", "Weak-track refresh can remove tracks.");
    inferred.set("automation.add_tracks", "Weak-track refresh can add tracks.");
  }
  for (const [permission, item] of Array.from(explicit.entries())) if (!inferred.has(permission)) inferred.set(permission, item.reason);
  return Array.from(inferred.entries()).map(([permission, fallbackReason]) => {
    const declaration = explicit.get(permission);
    const riskLevel = permissionRisk[permission];
    const destructive = riskLevel === "destructive";
    const restricted = riskLevel === "high";
    return {
      permission, reason: declaration?.reason || fallbackReason, riskLevel,
      decision: destructive ? "deny" : restricted ? "restrict" : "allow",
      fallback: permission === "playlist.delete" ? "Delete action removed" : permission === "playlist.protected_update" ? "Protected target blocked" : restricted ? "Suggest-Only until administrator approval" : null,
      inferred: !declaration,
      required: declaration?.required ?? true,
    };
  });
}

export function scanForbiddenRecipeActions(value: unknown): GovernanceFinding[] {
  const findings: GovernanceFinding[] = [];
  const visit = (node: unknown, path: string, depth: number) => {
    if (depth > 64) { findings.push({ code: "recipe.payload.too_deep", path, severity: "error", message: "Recipe nesting exceeds the safe maximum." }); return; }
    if (Array.isArray(node)) { node.forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1)); return; }
    if (!isRecord(node)) return;
    for (const [key, child] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      const token = `${key}:${typeof child === "string" ? child : ""}`.toLowerCase().replace(/[\s_-]+/g, "");
      if (/deleteplaylist|playlistdelete|recreateplaylist|deleteandrecreate|replacebydelet/.test(token)) findings.push({ code: "recipe.action.playlist_delete_forbidden", path: childPath, severity: "destructive", message: "Recipes are never allowed to delete or recreate playlists." });
      if (/protectedplaylist|protectedupdate|overrideprotection/.test(token)) findings.push({ code: "recipe.action.protected_playlist_forbidden", path: childPath, severity: "destructive", message: "Recipes cannot target or override protected playlists." });
      visit(child, childPath, depth + 1);
    }
  };
  visit(value, "", 0);
  return findings;
}

function rules(recipe: MixRecipeDocument): any[] {
  const walk = (node: any): any[] => !node ? [] : node.type === "group" ? (node.children || []).flatMap(walk) : [node];
  return recipe.generation.ruleTree ? walk(recipe.generation.ruleTree) : recipe.generation.rules || [];
}

export function analyzeImpossibleRequirements(recipe: MixRecipeDocument, context: { availableIntegrations?: string[]; availableLibraryIds?: string[]; metadataProviders?: string[] } = {}): GovernanceFinding[] {
  const findings: GovernanceFinding[] = [];
  if ((recipe.bpmFlow.minimumBpm ?? -Infinity) > (recipe.bpmFlow.maximumBpm ?? Infinity)) findings.push({ code: "recipe.requirement.impossible_bpm", path: "bpmFlow", severity: "error", message: "Minimum BPM is greater than maximum BPM." });
  if ((recipe.targets.minimumEnergy ?? -Infinity) > (recipe.targets.maximumEnergy ?? Infinity)) findings.push({ code: "recipe.requirement.impossible_energy", path: "targets", severity: "error", message: "Minimum energy is greater than maximum energy." });
  const negative = recipe.generation.negativeFilters;
  if ((negative.minDurationMinutes ?? -Infinity) > (negative.maxDurationMinutes ?? Infinity)) findings.push({ code: "recipe.requirement.impossible_duration", path: "generation.negativeFilters", severity: "error", message: "Minimum duration is greater than maximum duration." });
  const genreEquals = rules(recipe).filter((rule) => rule.field === "genre" && rule.operator === "eq").map((rule) => String(rule.value).toLowerCase());
  const genreExcludes = rules(recipe).filter((rule) => rule.field === "genre" && ["neq", "not_contains"].includes(rule.operator)).map((rule) => String(rule.value).toLowerCase());
  for (const genre of genreEquals.filter((item) => genreExcludes.includes(item))) findings.push({ code: "recipe.requirement.included_and_excluded", path: "generation.rules", severity: "error", message: `Genre “${genre}” is both required and excluded.` });
  if (recipe.generation.limit > ABSOLUTE_RECIPE_SAFETY_CAPS.maxGeneratedPlaylistSize) findings.push({ code: "recipe.value.above_hard_cap", path: "generation.limit", severity: "error", message: "Requested playlist size exceeds Mixarr's absolute safety cap.", suggestedValue: ABSOLUTE_RECIPE_SAFETY_CAPS.maxGeneratedPlaylistSize });
  for (const dependency of recipe.dependencies) {
    const pool = dependency.type === "plex_library" ? context.availableLibraryIds : dependency.type === "metadata_provider" ? context.metadataProviders : context.availableIntegrations;
    if (dependency.required && pool && !pool.includes(dependency.name)) findings.push({ code: "recipe.dependency.required_unavailable", path: "dependencies", severity: "error", message: `Required ${dependency.type.replaceAll("_", " ")} “${dependency.name}” is unavailable.` });
  }
  return findings;
}

type Semver = { major: number; minor: number; patch: number; prerelease: Array<string | number> };
function parseSemver(value: string): Semver | null {
  const match = value.trim().replace(/^v/, "").match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ? match[4].split(".").map((item) => /^\d+$/.test(item) ? Number(item) : item) : [] } : null;
}
function compareSemver(left: Semver, right: Semver) {
  for (const key of ["major", "minor", "patch"] as const) if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  if (!left.prerelease.length || !right.prerelease.length) return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const a = left.prerelease[index], b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b !== "number") return -1;
    if (typeof a !== "number" && typeof b === "number") return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}
function maxExpressionAllows(expression: string, installed: Semver) {
  const trimmed = expression.trim();
  const wildcard = trimmed.match(/^(\d+)(?:\.(\d+))?\.(?:x|\*)$|^(\d+)\.(?:x|\*)$/i);
  if (wildcard) {
    const major = Number(wildcard[1] || wildcard[3]);
    const minor = wildcard[2] == null ? null : Number(wildcard[2]);
    return installed.major === major && (minor == null || installed.minor === minor);
  }
  const exact = parseSemver(trimmed);
  return exact ? compareSemver(installed, exact) <= 0 : null;
}

export function evaluateRecipeCompatibility(recipe: MixRecipeDocument, installedVersion = APP_VERSION_NUMBER) {
  const installed = parseSemver(installedVersion);
  const minimum = parseSemver(recipe.compatibility.minMixarrVersion);
  const maximumAllowed = installed ? maxExpressionAllows(recipe.compatibility.maxMixarrVersion, installed) : null;
  if (!installed || !minimum || maximumAllowed == null) return { status: "UNKNOWN", compatible: false, installedVersion, findings: [{ code: "recipe.compatibility.invalid_version", path: "compatibility", severity: "error" as const, message: "Compatibility versions must use semantic version syntax (for example 2.3.8 or 2.x)." }] };
  if (compareSemver(installed, minimum) < 0) return { status: "MIXARR_UPGRADE_REQUIRED", compatible: false, installedVersion, findings: [{ code: "recipe.compatibility.upgrade_required", path: "compatibility.minMixarrVersion", severity: "error" as const, message: `This recipe requires Mixarr ${recipe.compatibility.minMixarrVersion} or newer.` }] };
  if (!maximumAllowed) return { status: "RECIPE_DOWNGRADE_REQUIRED", compatible: false, installedVersion, findings: [{ code: "recipe.compatibility.maximum_exceeded", path: "compatibility.maxMixarrVersion", severity: "error" as const, message: `This recipe does not declare compatibility with Mixarr ${installedVersion}.` }] };
  return { status: "COMPATIBLE", compatible: true, installedVersion, findings: [] as GovernanceFinding[] };
}

export function normalizeSafetyLimits(configured: Partial<RecipeSafetyLimits> | null | undefined): RecipeSafetyLimits {
  const merged = { ...DEFAULT_RECIPE_SAFETY_LIMITS, ...(configured || {}) } as RecipeSafetyLimits;
  for (const key of Object.keys(merged) as Array<keyof RecipeSafetyLimits>) {
    const number = Number(merged[key]);
    const cap = ABSOLUTE_RECIPE_SAFETY_CAPS[key];
    (merged as any)[key] = key === "minimumAutomationIntervalHours" ? Math.max(cap, number) : Math.min(cap, Math.max(0, number));
  }
  return merged;
}

export function applyRecipeSafetyLimits(recipe: MixRecipeDocument, configured?: Partial<RecipeSafetyLimits> | null) {
  const limits = normalizeSafetyLimits(configured);
  const normalized = JSON.parse(JSON.stringify(recipe)) as MixRecipeDocument;
  const adjustments: GovernanceFinding[] = [];
  const clamp = (path: string, current: number, maximum: number, apply: (value: number) => void) => {
    if (current <= maximum) return;
    apply(maximum);
    adjustments.push({ code: "recipe.value.clamped", path, severity: "warning", message: `Requested value ${current} exceeds the configured safety limit ${maximum}; the import plan will use ${maximum}.`, suggestedValue: maximum });
  };
  clamp("generation.limit", normalized.generation.limit, Math.min(limits.maxGeneratedPlaylistSize, limits.maxTracksAddedPerRun), (value) => { normalized.generation.limit = value; });
  const replacementLimit = Math.min(limits.maxTracksRemovedPerRun, Math.max(1, Math.floor(normalized.generation.limit * limits.maxReplacementPercentage / 100)));
  clamp("refreshPolicy.maximumReplacements", normalized.refreshPolicy.maximumReplacements, replacementLimit, (value) => { normalized.refreshPolicy.maximumReplacements = value; });
  const minimumScheduleHours = Math.max(limits.minimumAutomationIntervalHours, Math.ceil(24 / Math.max(1, limits.maxScheduleExecutionsPerDay)));
  if (normalized.refreshPolicy.mode === "scheduled" && normalized.refreshPolicy.frequencyDays && normalized.refreshPolicy.frequencyDays * 24 < minimumScheduleHours) {
    const days = Math.max(1, Math.ceil(minimumScheduleHours / 24));
    adjustments.push({ code: "recipe.schedule.frequency_clamped", path: "refreshPolicy.frequencyDays", severity: "warning", message: `The refresh interval was increased to ${days} day(s) to satisfy the configured automation limit.`, suggestedValue: days });
    normalized.refreshPolicy.frequencyDays = days;
  }
  return { recipe: normalized, limits, adjustments };
}

export function analyzeRecipeRisk(recipe: MixRecipeDocument, permissions = inferRecipePermissions(recipe)) {
  const findings: GovernanceFinding[] = [];
  let score = 0;
  const add = (points: number, finding: GovernanceFinding) => { score += points; findings.push(finding); };
  if (recipe.automationPolicy.enabled) add(18, { code: "recipe.risk.automation_enabled", path: "automationPolicy.enabled", severity: "warning", message: "The recipe requests enabled automation." });
  if (recipe.refreshPolicy.strategy === "full_regeneration") add(22, { code: "recipe.risk.full_regeneration", path: "refreshPolicy.strategy", severity: "high", message: "Full regeneration can replace the complete playlist membership." });
  if (recipe.refreshPolicy.mode === "scheduled") add(12, { code: "recipe.risk.scheduled", path: "refreshPolicy.mode", severity: "warning", message: "The recipe requests unattended scheduled refreshes." });
  if ((recipe.refreshPolicy.frequencyDays || 999) <= 1) add(15, { code: "recipe.risk.frequent_refresh", path: "refreshPolicy.frequencyDays", severity: "high", message: "The recipe can refresh daily." });
  if (recipe.refreshPolicy.maximumReplacements > 20) add(18, { code: "recipe.risk.large_removal", path: "refreshPolicy.maximumReplacements", severity: "high", message: `The recipe can remove up to ${recipe.refreshPolicy.maximumReplacements} tracks per run.` });
  if (!recipe.refreshPolicy.preserveLockedTracks || !recipe.refreshPolicy.preserveLikedTracks) add(18, { code: "recipe.risk.manual_tracks_unprotected", path: "refreshPolicy", severity: "high", message: "Manual or liked tracks are not fully preserved." });
  const denied = permissions.filter((item) => item.decision === "deny");
  if (denied.length) add(100, { code: "recipe.risk.forbidden_permission", path: "permissions", severity: "destructive", message: `Forbidden permission requested: ${denied.map((item) => item.permission).join(", ")}.` });
  const high = permissions.filter((item) => item.riskLevel === "high");
  if (high.length) score += Math.min(25, high.length * 6);
  if (recipe.automationPolicy.enabled && recipe.refreshPolicy.strategy === "full_regeneration" && recipe.refreshPolicy.maximumReplacements > 20) add(22, { code: "recipe.risk.unattended_large_removal", path: "refreshPolicy", severity: "high", message: `This recipe can remove up to ${recipe.refreshPolicy.maximumReplacements} tracks per run without attendance.` });
  score = Math.min(100, score);
  const riskLevel: RiskLevel = denied.length ? "destructive" : score >= 70 ? "high" : score >= 30 ? "moderate" : "low";
  return { riskLevel, score, findings, recommendedImportMode: riskLevel === "low" ? "approval_required" : "suggest_only" };
}
