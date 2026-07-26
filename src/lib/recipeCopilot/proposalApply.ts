export const RECIPE_PROPOSAL_APPLY_ERROR_CODES = [
  "AI_RECIPE_PROPOSAL_NOT_FOUND",
  "AI_RECIPE_PROPOSAL_NO_CHANGES_SELECTED",
  "AI_RECIPE_PROPOSAL_PATH_NOT_ALLOWED",
  "AI_RECIPE_PROPOSAL_PATCH_FAILED",
  "AI_RECIPE_PROPOSAL_DRAFT_INVALID",
  "AI_RECIPE_PROPOSAL_FORM_UNAVAILABLE",
  "AI_RECIPE_PROPOSAL_APPLY_FAILED",
] as const;

export type RecipeProposalApplyErrorCode = typeof RECIPE_PROPOSAL_APPLY_ERROR_CODES[number];

export type RecipeProposalChange = {
  id: string;
  path: string;
  currentValue: unknown;
  proposedValue: unknown;
  selected: boolean;
  confidence?: number;
  explanation?: string;
};

export type RecipeProposalPatchFailure = {
  path: string;
  code: RecipeProposalApplyErrorCode;
  message: string;
};

export type RecipeProposalPatchResult<T extends Record<string, unknown>> =
  | { success: true; draft: T; appliedCount: number; appliedPaths: string[] }
  | { success: false; failures: RecipeProposalPatchFailure[] };

export type ApplyRecipeProposalRequest = {
  proposalId: string;
  baseRevision?: string | null;
  changes: RecipeProposalChange[];
};

export type ApplyRecipeProposalResult = {
  success: boolean;
  appliedCount: number;
  appliedPaths: string[];
  validationIssues?: Array<{ path: string; message: string }>;
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
  for (const change of selected) setRecipeProposalPath(draft, change.path, change.proposedValue);
  return { success: true, draft, appliedCount: selected.length, appliedPaths: selected.map((change) => change.path) };
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function findRecipeProposalConflicts(
  baseDraft: Record<string, unknown>,
  currentDraft: Record<string, unknown>,
  changes: RecipeProposalChange[],
) {
  return changes.filter((change) => change.selected).filter((change) => {
    const baseValue = getRecipeProposalPath(baseDraft, change.path);
    const currentValue = getRecipeProposalPath(currentDraft, change.path);
    return !sameValue(baseValue, currentValue) && !sameValue(currentValue, change.proposedValue);
  }).map((change) => change.path);
}
