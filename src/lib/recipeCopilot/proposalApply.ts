import { defaultRecipeStudioDraft } from "../recipeStudio";
import { SCORING_MODELS, normalizeScoringModel } from "../scoringModelCatalog";

export const RECIPE_PROPOSAL_APPLY_ERROR_CODES = [
  "AI_RECIPE_PROPOSAL_NOT_FOUND",
  "AI_RECIPE_PROPOSAL_UNAVAILABLE",
  "AI_RECIPE_PROPOSAL_NO_CHANGES_SELECTED",
  "AI_RECIPE_PROPOSAL_PATH_NOT_ALLOWED",
  "AI_RECIPE_PROPOSAL_PATCH_FAILED",
  "AI_RECIPE_PROPOSAL_DRAFT_INVALID",
  "AI_RECIPE_PROPOSAL_FORM_UNAVAILABLE",
  "AI_RECIPE_PROPOSAL_BASE_SNAPSHOT_MISSING",
  "AI_RECIPE_PROPOSAL_BASE_SNAPSHOT_INVALID",
  "AI_RECIPE_PROPOSAL_VALUE_NORMALIZATION_FAILED",
  "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM",
  "AI_RECIPE_PROPOSAL_CONFLICT",
  "AI_RECIPE_PROPOSAL_CONFLICT_RESOLUTION_REQUIRED",
  "AI_RECIPE_PROPOSAL_APPLY_FAILED",
] as const;

export type RecipeProposalApplyErrorCode = typeof RECIPE_PROPOSAL_APPLY_ERROR_CODES[number];
export type RecipeEditablePath = string;
export type RecipeProposalConflictResolution = "keep_current" | "use_proposed";

export type RecipeProposalChange = {
  id: string;
  path: RecipeEditablePath;
  /** Compatibility-only. The authoritative current display comes from baseDraft. */
  currentValue?: unknown;
  proposedValue: unknown;
  selected: boolean;
  confidence?: number;
  explanation?: string;
};

export type RecipeProposalConflict = {
  path: RecipeEditablePath;
  label: string;
  baseValue: unknown;
  currentValue: unknown;
  proposedValue: unknown;
};

export type RecipeProposalPatchFailure = {
  path: string;
  code: RecipeProposalApplyErrorCode;
  message: string;
};

export type RecipeProposalPatchResult<T extends Record<string, unknown>> =
  | {
      success: true;
      draft: T;
      appliedCount: number;
      alreadyAppliedCount: number;
      appliedPaths: string[];
      alreadyAppliedPaths: string[];
    }
  | { success: false; failures: RecipeProposalPatchFailure[] };

export type ApplyRecipeProposalRequest = {
  proposalId: string;
  baseRevision?: string | null;
  changes: RecipeProposalChange[];
  conflictResolutions?: Record<string, RecipeProposalConflictResolution>;
};

export type ApplyRecipeProposalResult = {
  success: boolean;
  appliedCount: number;
  alreadyAppliedCount: number;
  conflictCount: number;
  appliedPaths: string[];
  alreadyAppliedPaths?: string[];
  conflicts?: RecipeProposalConflict[];
  validationIssues?: Array<{
    path: string;
    code?: string;
    message: string;
    receivedValue?: unknown;
    supportedValues?: readonly string[];
  }>;
  proposalSchemaValid?: boolean;
  patchValid?: boolean;
  draftSchemaValid?: boolean;
  saveSemanticValidationValid?: boolean;
  executionCompatibilityValid?: boolean;
  errorCode?: RecipeProposalApplyErrorCode;
  errorMessage?: string;
};

const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"]);
const protectedPaths = new Set([
  "id", "ownerId", "createdAt", "updatedAt", "enabled", "approvalState", "approvalStatus",
  "activationState", "audit", "auditFields", "signature", "signatures", "executionHistory",
  "generatedPlaylistId", "generatedPlaylistIds", "sourcePlaylistId", "lastAiProposalId",
  "aiRecipeStatus", "aiProvenance", "filters.serverId", "filters.libraryId",
  "filters.pinnedTrackIds", "filters.excludedTrackIds", "automationPolicy.enabled",
]);

const editableRootPaths = new Set(["name", "description", "category"]);
const editableFilterPaths = new Set([
  "filters.rules", "filters.limit", "filters.duplicateStrategy", "filters.preferNonLive",
  "filters.excludeRemasters",
]);
const negativeFilterFields = new Set([
  "excludeHoliday", "excludeLive", "excludeRemasters", "excludeExplicit", "excludeIntroOutro",
  "minRating", "excludePlayedWithinDays", "minDurationMinutes", "maxDurationMinutes",
]);
const safetyRuleFields = new Set([
  "avoidSameArtistBackToBack", "limitTracksPerArtist", "maxTracksPerArtist",
  "limitTracksPerAlbum", "maxTracksPerAlbum", "warnIfFewerThan", "minimumTrackCount",
]);
const sectionFields: Record<string, Set<string>> = {
  scoring: new Set([
    "moodMatchWeight", "energyMatchWeight", "bpmCompatibilityWeight", "popularityWeight",
    "discoveryWeight", "playlistIdentityWeight", "historicalAcceptanceWeight",
    "historicalRejectionPenalty", "artistPreferenceWeight", "recencyPenalty", "repeatPenalty",
    "metadataConfidenceWeight", "transitionQualityWeight", "personalizedScoringInfluence",
    "scoringMode", "scoringModel",
  ]),
  targets: new Set([
    "selectedMoods", "primaryMood", "secondaryMoods", "moodBlendMode", "strictMoodMatching",
    "moodTransition", "moodCurve", "minimumEnergy", "maximumEnergy", "targetEnergy",
    "energyProgression", "missingMoodFallback", "missingEnergyFallback",
  ]),
  bpmFlow: new Set([
    "minimumBpm", "maximumBpm", "targetBpm", "mode", "sections", "maximumBpmGap",
    "allowBpmJumps", "halfTimeMatching", "doubleTimeMatching", "transitionDifficultyTolerance",
    "missingBpmFallback", "minimumBpmConfidence",
  ]),
  discovery: new Set([
    "level", "deepCutPercentage", "familiarityBalance", "avoidOverplayedTracks",
    "favorUnderplayedPlexTracks", "favorTracksNotRecentlyUsed", "hiddenGemPreference",
    "maximumHighPopularityPercentage", "recentlyAddedPreference", "newTrackQuarantineDays",
    "lowConfidenceBehavior",
  ]),
  variety: new Set([
    "maximumTracksPerArtist", "minimumArtistSpacing", "maximumTracksPerAlbum",
    "minimumAlbumSpacing", "maximumRepeatedGenres", "duplicateTrackHandling",
    "alternateVersionHandling", "liveVersionHandling", "remixHandling",
    "recentlyPlayedExclusionDays", "recentlyUsedPlaylistTrackExclusion", "repeatTolerance",
    "artistVarietyStrategy", "albumVarietyStrategy",
  ]),
  playlistIdentity: new Set([
    "personalitySummary", "coreMoods", "preferredEnergyCharacter", "preferredBpmMinimum",
    "preferredBpmMaximum", "preferredArtists", "preferredGenres", "avoidedArtists",
    "avoidedGenres", "avoidedTrackTraits", "discoveryTolerance", "repeatTolerance",
    "transitionPreference", "lockedTraits", "identityLearningEnabled",
    "personalizationEnabled", "maximumPersonalizationInfluence",
  ]),
  refreshPolicy: new Set([
    "mode", "frequencyDays", "strategy", "preserveLockedTracks", "preserveLikedTracks",
    "preservePlaylistLength", "preserveMoodCurve", "preserveBpmCurve",
    "addCompatibleRecentlyAddedTracks", "weakTrackScoreThreshold", "minimumReplacements",
    "maximumReplacements", "notificationPreference",
  ]),
  automationPolicy: new Set(["requireExplicitConfirmation", "libraryId", "preserveManualEdits"]),
};

const stringPaths = new Set([
  "name", "description", "category",
  "filters.duplicateStrategy",
  "scoring.scoringMode", "scoring.scoringModel",
  "targets.primaryMood", "targets.moodBlendMode", "targets.moodTransition",
  "targets.energyProgression", "targets.missingMoodFallback", "targets.missingEnergyFallback",
  "bpmFlow.mode", "bpmFlow.missingBpmFallback",
  "discovery.level", "discovery.lowConfidenceBehavior",
  "variety.duplicateTrackHandling", "variety.alternateVersionHandling",
  "variety.liveVersionHandling", "variety.remixHandling",
  "variety.artistVarietyStrategy", "variety.albumVarietyStrategy",
  "playlistIdentity.personalitySummary", "playlistIdentity.preferredEnergyCharacter",
  "playlistIdentity.transitionPreference", "refreshPolicy.mode", "refreshPolicy.strategy",
  "refreshPolicy.notificationPreference", "automationPolicy.libraryId",
]);

const unorderedArrayPaths = new Set([
  "targets.selectedMoods", "targets.secondaryMoods", "playlistIdentity.coreMoods",
  "playlistIdentity.preferredArtists", "playlistIdentity.preferredGenres",
  "playlistIdentity.avoidedArtists", "playlistIdentity.avoidedGenres",
  "playlistIdentity.avoidedTrackTraits", "playlistIdentity.lockedTraits",
]);

const orderedArrayPaths = new Set([
  "filters.rules", "targets.moodCurve", "bpmFlow.sections",
]);

const nestedSchemaDefaults: Record<string, unknown> = {
  "filters.negativeFilters.excludeHoliday": false,
  "filters.negativeFilters.excludeLive": false,
  "filters.negativeFilters.excludeRemasters": false,
  "filters.negativeFilters.excludeExplicit": false,
  "filters.negativeFilters.excludeIntroOutro": false,
  "filters.safetyRules.avoidSameArtistBackToBack": true,
  "filters.safetyRules.limitTracksPerArtist": false,
  "filters.safetyRules.maxTracksPerArtist": 3,
  "filters.safetyRules.limitTracksPerAlbum": false,
  "filters.safetyRules.maxTracksPerAlbum": 2,
  "filters.safetyRules.warnIfFewerThan": true,
  "filters.safetyRules.minimumTrackCount": 10,
};

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)])) as T;
  }
  return value;
}

export function stableRecipeProposalChangeId(proposalId: string, path: string) {
  return `${proposalId}:${path}`;
}

export function isRecipeProposalPathAllowed(path: string) {
  const parts = path.split(".");
  if (!path || parts.some((part) => !part || forbiddenSegments.has(part))) return false;
  if (protectedPaths.has(path) || parts.some((_, index) => protectedPaths.has(parts.slice(0, index + 1).join(".")))) return false;
  if (editableRootPaths.has(path) || editableFilterPaths.has(path)) return true;
  if (parts.length === 3 && parts[0] === "filters" && parts[1] === "negativeFilters") return negativeFilterFields.has(parts[2]);
  if (parts.length === 3 && parts[0] === "filters" && parts[1] === "safetyRules") return safetyRuleFields.has(parts[2]);
  return parts.length === 2 && Boolean(sectionFields[parts[0]]?.has(parts[1]));
}

export function getRecipeProposalPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function setRecipeProposalPath(value: Record<string, unknown>, path: string, nextValue: unknown) {
  const parts = path.split(".");
  let current = value;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    current[part] = existing && typeof existing === "object" && !Array.isArray(existing)
      ? cloneValue(existing as Record<string, unknown>)
      : {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = cloneValue(nextValue);
}

function stableCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCanonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableCanonicalValue(item)]),
    );
  }
  return value;
}

export function stableRecipeValueSerialize(value: unknown) {
  return JSON.stringify(stableCanonicalValue(value));
}

export function hasSurroundingJsonQuotes(value: unknown) {
  return typeof value === "string" && value.length >= 2 && value.startsWith("\"") && value.endsWith("\"");
}

/**
 * Decodes exactly one accidental JSON-string layer for a destination that is
 * defined by the recipe schema as a string. Plain strings and non-string
 * destinations are returned unchanged.
 */
export function normalizeLegacyProposalValue(path: RecipeEditablePath, value: unknown): unknown {
  if (!stringPaths.has(path) || !hasSurroundingJsonQuotes(value)) return value;
  try {
    const parsed = JSON.parse(value as string);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
}

function defaultRecipeValue(path: RecipeEditablePath) {
  const studioDefault = getRecipeProposalPath(defaultRecipeStudioDraft(), path);
  return studioDefault === undefined ? nestedSchemaDefaults[path] : studioDefault;
}

export function canonicalRecipeValue(path: RecipeEditablePath, input: unknown): unknown {
  const legacyNormalized = normalizeLegacyProposalValue(path, input);
  const fallback = defaultRecipeValue(path);
  let value = legacyNormalized;

  if (value == null) {
    if (Array.isArray(fallback)) value = [];
    else if (fallback !== undefined) value = fallback;
    else if (stringPaths.has(path) && path === "description") value = "";
    else return null;
  }

  if (stringPaths.has(path)) return typeof value === "string" ? value.trim() : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const normalized = value.map(stableCanonicalValue);
    if (unorderedArrayPaths.has(path)) {
      return normalized
        .map((item) => ({ item, key: stableRecipeValueSerialize(item) }))
        .sort((left, right) => left.key.localeCompare(right.key))
        .map(({ item }) => item);
    }
    // Recipe rule, curve, and section arrays are intentionally ordered.
    if (orderedArrayPaths.has(path)) return normalized;
    return normalized;
  }
  return stableCanonicalValue(value);
}

export function canonicalRecipeValueEqual(
  path: RecipeEditablePath,
  left: unknown,
  right: unknown,
): boolean {
  return stableRecipeValueSerialize(canonicalRecipeValue(path, left))
    === stableRecipeValueSerialize(canonicalRecipeValue(path, right));
}

export function normalizeRecipeProposalValueForApply(
  path: RecipeEditablePath,
  input: unknown,
): { success: true; value: unknown } | { success: false; code?: RecipeProposalApplyErrorCode; message: string } {
  const value = canonicalRecipeValue(path, input);
  const fallback = defaultRecipeValue(path);
  const invalid = (expected: string) => ({
    success: false as const,
    message: `The proposed value for ${path} must be ${expected}.`,
  });

  if (path === "scoring.scoringModel") {
    const model = normalizeScoringModel(value);
    if (model.status === "unsupported") {
      return {
        success: false,
        code: "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM",
        message: `Unsupported scoring model. Use one of: ${SCORING_MODELS.join(", ")}.`,
      };
    }
    return { success: true, value: model.value };
  }

  if (stringPaths.has(path)) {
    if (value === null && fallback === null) return { success: true, value };
    return typeof value === "string" ? { success: true, value } : invalid("a string");
  }
  if (Array.isArray(fallback)) return Array.isArray(value) ? { success: true, value } : invalid("an array");
  if (typeof fallback === "boolean") return typeof value === "boolean" ? { success: true, value } : invalid("a boolean");
  if (typeof fallback === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? { success: true, value }
      : invalid("a finite number");
  }
  if (typeof value === "number" && !Number.isFinite(value)) return invalid("a finite number");
  return { success: true, value };
}

export function recipeProposalFieldLabel(path: RecipeEditablePath) {
  return path.split(".").at(-1)?.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase()) || "Recipe field";
}

export function applyRecipeProposalChanges<T extends Record<string, unknown>>(
  currentDraft: T,
  changes: RecipeProposalChange[],
): RecipeProposalPatchResult<T> {
  const selected = changes.filter((change) => change.selected);
  if (selected.length === 0) {
    return { success: false, failures: [{ path: "", code: "AI_RECIPE_PROPOSAL_NO_CHANGES_SELECTED", message: "Select at least one Recipe Copilot change." }] };
  }

  const failures: RecipeProposalPatchFailure[] = [];
  const seenPaths = new Set<string>();
  for (const change of selected) {
    if (!change.id || !change.path || typeof change.path !== "string") {
      failures.push({ path: change.path || "", code: "AI_RECIPE_PROPOSAL_PATCH_FAILED", message: "A selected proposal change is missing its stable identifier or field path." });
    } else if (seenPaths.has(change.path)) {
      failures.push({ path: change.path, code: "AI_RECIPE_PROPOSAL_PATCH_FAILED", message: `Duplicate selected recipe field: ${change.path}` });
    } else if (!isRecipeProposalPathAllowed(change.path)) {
      failures.push({ path: change.path, code: "AI_RECIPE_PROPOSAL_PATH_NOT_ALLOWED", message: `Recipe Copilot cannot modify ${change.path}.` });
    }
    seenPaths.add(change.path);
  }
  if (failures.length > 0) return { success: false, failures };

  const draft = cloneValue(currentDraft);
  const appliedPaths: string[] = [];
  const alreadyAppliedPaths: string[] = [];
  for (const change of selected) {
    const currentValue = getRecipeProposalPath(draft, change.path);
    const normalized = normalizeRecipeProposalValueForApply(change.path, change.proposedValue);
    if (!normalized.success) {
      return {
        success: false,
        failures: [{
          path: change.path,
          code: normalized.code || "AI_RECIPE_PROPOSAL_VALUE_NORMALIZATION_FAILED",
          message: normalized.message,
        }],
      };
    }
    const proposedValue = normalized.value;
    if (canonicalRecipeValueEqual(change.path, currentValue, proposedValue)) {
      alreadyAppliedPaths.push(change.path);
      continue;
    }
    setRecipeProposalPath(draft, change.path, proposedValue);
    appliedPaths.push(change.path);
  }
  return {
    success: true,
    draft,
    appliedCount: appliedPaths.length,
    alreadyAppliedCount: alreadyAppliedPaths.length,
    appliedPaths,
    alreadyAppliedPaths,
  };
}

export function findRecipeProposalConflictDetails(
  baseDraft: Record<string, unknown>,
  currentDraft: Record<string, unknown>,
  changes: RecipeProposalChange[],
): RecipeProposalConflict[] {
  return changes.filter((change) => change.selected).flatMap((change) => {
    const baseValue = getRecipeProposalPath(baseDraft, change.path);
    const currentValue = getRecipeProposalPath(currentDraft, change.path);
    const proposedValue = normalizeLegacyProposalValue(change.path, change.proposedValue);
    const conflict = !canonicalRecipeValueEqual(change.path, currentValue, baseValue)
      && !canonicalRecipeValueEqual(change.path, currentValue, proposedValue);
    return conflict ? [{
      path: change.path,
      label: recipeProposalFieldLabel(change.path),
      baseValue,
      currentValue,
      proposedValue,
    }] : [];
  });
}

export function findRecipeProposalConflicts(
  baseDraft: Record<string, unknown>,
  currentDraft: Record<string, unknown>,
  changes: RecipeProposalChange[],
) {
  return findRecipeProposalConflictDetails(baseDraft, currentDraft, changes).map((change) => change.path);
}
