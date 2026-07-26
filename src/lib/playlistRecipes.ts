import { z } from "zod";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { APP_VERSION } from "./appVersion";
import { playlistConfigSchema, summarizePlaylistSafetyRules, type PlaylistConfigInput, type PlaylistRuleInput } from "./playlistService";
import {
  defaultMixRecipeDocument,
  mixRecipeMetadataSchema,
  recipeAutomationPolicySchema,
  recipeBpmFlowSchema,
  recipeDiscoverySchema,
  recipeIdentityDefaultsSchema,
  recipeRefreshPolicySchema,
  recipeScoringSchema,
  recipeTargetsSchema,
  recipeVarietySchema,
  slugifyRecipeName,
  resolveRecipeGenerationConfig,
  type MixRecipeDocument,
} from "./mixRecipes/schema";
import { validateRecipe } from "./mixRecipes/validation";
import { inferRecipePermissions } from "./mixRecipes/governance";
import {
  DEFAULT_SCORING_MODEL,
  normalizeScoringModel,
  scoringModelValidationIssue,
} from "./scoringModelCatalog";

type RuleNode = PlaylistRuleInput | {
  type: "group";
  combinator: "AND" | "OR";
  children: RuleNode[];
};

export const playlistRecipeSchema = z.object({
  name: z.string().trim().min(1, "Recipe name is required.").max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  category: z.string().trim().min(1).max(80).default("Custom"),
  artworkUrl: z.string().trim().max(500).optional().nullable(),
  enabled: z.boolean().default(true),
  sourcePlaylistId: z.string().uuid().optional().nullable(),
  filters: playlistConfigSchema,
  scoring: recipeScoringSchema.optional(),
  targets: recipeTargetsSchema.optional(),
  bpmFlow: recipeBpmFlowSchema.optional(),
  discovery: recipeDiscoverySchema.optional(),
  variety: recipeVarietySchema.optional(),
  playlistIdentity: recipeIdentityDefaultsSchema.optional(),
  refreshPolicy: recipeRefreshPolicySchema.optional(),
  automationPolicy: recipeAutomationPolicySchema.optional(),
  baseRecipeId: z.string().uuid().optional().nullable(),
  recipeCategoryId: z.string().uuid().optional().nullable(),
  transitionPresetId: z.string().uuid().optional().nullable(),
  discoveryPresetId: z.string().uuid().optional().nullable(),
  varietyPresetId: z.string().uuid().optional().nullable(),
  automationPresetId: z.string().uuid().optional().nullable(),
});

export type PlaylistRecipeInput = z.infer<typeof playlistRecipeSchema>;

export type PlaylistRecipeDraftValidationIssue = {
  path: string;
  code: string;
  message: string;
  receivedValue?: unknown;
  supportedValues?: readonly string[];
};

export class PlaylistRecipeDraftValidationError extends Error {
  readonly code: string;
  readonly status = 422;
  readonly issues: PlaylistRecipeDraftValidationIssue[];

  constructor(issues: PlaylistRecipeDraftValidationIssue[]) {
    super(issues[0]?.message || "The recipe draft is invalid.");
    this.name = "PlaylistRecipeDraftValidationError";
    this.code = issues[0]?.code || "RECIPE_DRAFT_INVALID";
    this.issues = issues;
  }
}

function playlistInputDocument(input: PlaylistRecipeInput, recipeVersion = 1) {
  const document = defaultMixRecipeDocument({
    name: input.name,
    description: input.description || null,
    category: input.category,
    artworkUrl: input.artworkUrl || null,
    sourcePlaylistId: input.sourcePlaylistId || null,
  }, input.filters);
  return {
    ...document,
    recipeVersion,
    scoring: input.scoring || document.scoring,
    targets: input.targets || document.targets,
    bpmFlow: input.bpmFlow || document.bpmFlow,
    discovery: input.discovery || document.discovery,
    variety: input.variety || document.variety,
    playlistIdentity: input.playlistIdentity || document.playlistIdentity,
    refreshPolicy: input.refreshPolicy || document.refreshPolicy,
    automationPolicy: input.automationPolicy || document.automationPolicy,
  };
}

function zodDraftIssues(error: z.ZodError, input: unknown): PlaylistRecipeDraftValidationIssue[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    if (path === "scoring.scoringModel" || path === "filters.scoringModel") {
      const source = input && typeof input === "object" ? input as Record<string, any> : {};
      const receivedValue = path === "filters.scoringModel"
        ? source.filters?.scoringModel
        : source.scoring?.scoringModel;
      return { ...scoringModelValidationIssue(receivedValue), path: "scoring.scoringModel" };
    }
    return { path, code: issue.code, message: issue.message };
  });
}

/**
 * Canonical Recipe Studio/save validator. It performs the draft Zod parse and
 * the same full recipe semantic validation used immediately before
 * persistence and execution.
 */
export function validatePlaylistRecipeDraft(
  input: unknown,
  options: { recipeVersion?: number } = {},
):
  | { success: true; data: PlaylistRecipeInput; recipe: MixRecipeDocument; issues: [] }
  | { success: false; data: null; recipe: null; issues: PlaylistRecipeDraftValidationIssue[] } {
  const parsed = playlistRecipeSchema.safeParse(input);
  if (!parsed.success) return { success: false, data: null, recipe: null, issues: zodDraftIssues(parsed.error, input) };
  const validation = validateRecipe(playlistInputDocument(parsed.data, options.recipeVersion || 1));
  if (!validation.normalizedRecipe) {
    return {
      success: false,
      data: null,
      recipe: null,
      issues: validation.errors.map((issue) => ({
        path: issue.path === "generation.scoringModel" ? "scoring.scoringModel" : issue.path,
        code: issue.code,
        message: issue.message,
        ...(issue.receivedValue === undefined ? {} : { receivedValue: issue.receivedValue }),
        ...(issue.supportedValues === undefined ? {} : { supportedValues: issue.supportedValues }),
      })),
    };
  }
  const recipe = validation.normalizedRecipe;
  return {
    success: true,
    issues: [],
    recipe,
    data: {
      ...parsed.data,
      name: recipe.metadata.name,
      description: recipe.metadata.description,
      category: recipe.metadata.category,
      artworkUrl: recipe.metadata.artworkUrl,
      sourcePlaylistId: recipe.metadata.sourcePlaylistId,
      filters: recipe.generation,
      scoring: recipe.scoring,
      targets: recipe.targets,
      bpmFlow: recipe.bpmFlow,
      discovery: recipe.discovery,
      variety: recipe.variety,
      playlistIdentity: recipe.playlistIdentity,
      refreshPolicy: recipe.refreshPolicy,
      automationPolicy: recipe.automationPolicy,
    },
  };
}

export function parseCanonicalPlaylistRecipeDraft(input: unknown, options: { recipeVersion?: number } = {}) {
  const validation = validatePlaylistRecipeDraft(input, options);
  if (!validation.success) throw new PlaylistRecipeDraftValidationError(validation.issues);
  return validation;
}

function collectRules(node: RuleNode | undefined, fallbackRules: PlaylistRuleInput[]): PlaylistRuleInput[] {
  if (!node) return fallbackRules;
  if (node.type !== "group") return [node];
  return node.children.reduce<PlaylistRuleInput[]>((rules, child) => rules.concat(collectRules(child, [])), []);
}

function numericRangeLabel(rules: PlaylistRuleInput[], field: string) {
  const relevant = rules.filter((rule) => rule.field === field);
  if (relevant.length === 0) return "";
  const exact = relevant.find((rule) => rule.operator === "eq");
  if (exact) return exact.value;
  const lower = relevant.find((rule) => rule.operator === "gte" || rule.operator === "gt");
  const upper = relevant.find((rule) => rule.operator === "lte" || rule.operator === "lt");
  if (lower || upper) {
    const low = lower ? `${lower.operator === "gt" ? ">" : ""}${lower.value}` : "";
    const high = upper ? `${upper.operator === "lt" ? "<" : ""}${upper.value}` : "";
    return low && high ? `${low}–${high}` : low || high;
  }
  return relevant.map((rule) => `${rule.field} ${rule.operator} ${rule.value}`).join(", ");
}

function negativeFilterLabels(filters: PlaylistConfigInput["negativeFilters"]) {
  const labels: string[] = [];
  if (filters.excludeHoliday) labels.push("no holiday");
  if (filters.excludeLive) labels.push("no live");
  if (filters.excludeRemasters) labels.push("no remasters");
  if (filters.excludeExplicit) labels.push("clean");
  if (filters.excludeIntroOutro) labels.push("no intros");
  if (filters.minRating != null) labels.push(`rating >= ${filters.minRating}`);
  if (filters.excludePlayedWithinDays != null) labels.push(`not played ${filters.excludePlayedWithinDays}d`);
  if (filters.minDurationMinutes != null || filters.maxDurationMinutes != null) {
    labels.push(`duration ${filters.minDurationMinutes ?? 0}-${filters.maxDurationMinutes ?? "any"} min`);
  }
  return labels;
}

export function summarizePlaylistRecipeFilters(filters: PlaylistConfigInput) {
  const rules = collectRules(filters.ruleTree as RuleNode | undefined, filters.rules);
  const genres = rules.filter((rule) => rule.field === "genre").map((rule) => rule.value);
  const parts: string[] = [];
  if (filters.smartPresetName) parts.push(`Preset: ${filters.smartPresetName}`);
  if (filters.moodPresetName) parts.push(`Mood: ${filters.moodPresetName}${filters.moodPresetModified ? " modified" : ""}`);
  if (filters.bpmPresetName) parts.push(`BPM: ${filters.bpmPresetName}${filters.bpmPresetModified ? " modified" : ""}`);
  if (genres.length) parts.push(`Genres: ${genres.slice(0, 3).join(", ")}${genres.length > 3 ? "..." : ""}`);

  const bpm = numericRangeLabel(rules, "tempo");
  const energy = numericRangeLabel(rules, "energy");
  const mood = numericRangeLabel(rules, "valence");
  const popularity = numericRangeLabel(rules, "popularity");
  if (bpm && (!filters.bpmPresetName || filters.bpmPresetModified)) parts.push(`${filters.bpmPresetName ? "BPM range" : "BPM"}: ${bpm}`);
  if (energy) parts.push(`Energy: ${energy}`);
  if (mood) parts.push(`${filters.moodPresetName ? "Mood range" : "Mood"}: ${mood}`);
  if (popularity) parts.push(`Popularity: ${popularity}`);

  const otherRules = rules.filter((rule) => !["genre", "tempo", "energy", "valence", "popularity"].includes(rule.field));
  if (otherRules.length) parts.push(`${otherRules.length} other rule${otherRules.length === 1 ? "" : "s"}`);

  parts.push(`Limit: ${filters.limit}`);
  parts.push("Sort: Popularity");
  parts.push(`Duplicates: ${filters.duplicateStrategy === "allow" || filters.duplicateStrategy === "allow_alternate_copies" ? "Alternate copies allowed" : filters.duplicateStrategy === "prefer_highest_quality" ? "Highest-quality copy preferred" : filters.duplicateStrategy === "prefer_existing_playlist_copy" ? "Existing playlist copy preferred" : "Duplicate recordings avoided"}`);

  const negative = negativeFilterLabels(filters.negativeFilters);
  if (negative.length) parts.push(`Filters: ${negative.slice(0, 3).join(", ")}${negative.length > 3 ? "..." : ""}`);

  parts.push(summarizePlaylistSafetyRules(filters));
  return parts.join(" · ");
}

export function portableRecipeFromRecord(recipe: any): MixRecipeDocument {
  const filters = playlistConfigSchema.parse(recipe.filtersJson);
  const base = defaultMixRecipeDocument({
    name: recipe.name,
    slug: recipe.slug || slugifyRecipeName(recipe.name),
    description: recipe.description,
    category: recipe.category || "Custom",
    artworkUrl: recipe.artworkUrl || null,
    sourcePlaylistId: recipe.sourcePlaylistId || null,
  }, filters);
  const document = {
    ...base,
    schemaVersion: recipe.schemaVersion || 1,
    recipeVersion: recipe.recipeVersion || 1,
    scoring: recipeScoringSchema.parse(recipe.scoringJson || base.scoring),
    targets: recipeTargetsSchema.parse(recipe.targetsJson || base.targets),
    bpmFlow: recipeBpmFlowSchema.parse(recipe.bpmFlowJson || base.bpmFlow),
    discovery: recipeDiscoverySchema.parse(recipe.discoveryJson || base.discovery),
    variety: recipeVarietySchema.parse(recipe.varietyJson || base.variety),
    playlistIdentity: recipeIdentityDefaultsSchema.parse(recipe.identityDefaultsJson || base.playlistIdentity),
    refreshPolicy: recipeRefreshPolicySchema.parse(recipe.refreshPolicyJson || base.refreshPolicy),
    automationPolicy: recipeAutomationPolicySchema.parse(recipe.automationPolicyJson || base.automationPolicy),
  };
  const validation = validateRecipe(document);
  if (!validation.normalizedRecipe) throw new Error(validation.errors[0]?.message || "Stored recipe is invalid.");
  return validation.normalizedRecipe;
}

export function parsePlaylistRecipe(recipe: any) {
  const storedScoring = recipe.scoringJson && typeof recipe.scoringJson === "object" && !Array.isArray(recipe.scoringJson)
    ? recipe.scoringJson as Record<string, unknown>
    : {};
  const storedModel = storedScoring.scoringModel ?? DEFAULT_SCORING_MODEL;
  const modelState = normalizeScoringModel(storedModel);
  const reviewRequired = modelState.status === "unsupported";
  const normalizedRecord = modelState.status === "canonical"
    ? recipe
    : {
        ...recipe,
        scoringJson: {
          ...storedScoring,
          scoringModel: modelState.status === "legacy_alias" ? modelState.value : DEFAULT_SCORING_MODEL,
        },
      };
  const portable = portableRecipeFromRecord(normalizedRecord);
  const validation = validateRecipe(portable);
  const resolvedFilters = resolveRecipeGenerationConfig(portable);
  const { metadata: _communityMetadata, format: _communityFormat, schemaVersion: _communitySchemaVersion, recipeVersion: _communityRecipeVersion, ...communityPortableBehavior } = portable;
  const communityCurrentChecksum = recipe.communityRecipeId ? createHash("sha256").update(JSON.stringify(communityPortableBehavior)).digest("hex") : null;
  const locallyModified = Boolean(recipe.communityOriginalChecksum && communityCurrentChecksum !== recipe.communityOriginalChecksum);
  return {
    id: recipe.id,
    name: recipe.name,
    slug: recipe.slug || portable.metadata.slug,
    description: recipe.description,
    category: recipe.category || "Custom",
    artworkUrl: recipe.artworkUrl || null,
    enabled: recipe.enabled !== false,
    schemaVersion: portable.schemaVersion,
    recipeVersion: portable.recipeVersion,
    sourcePlaylistId: recipe.sourcePlaylistId || null,
    filters: resolvedFilters,
    scoring: reviewRequired
      ? { ...portable.scoring, scoringModel: storedModel }
      : portable.scoring,
    targets: portable.targets,
    bpmFlow: portable.bpmFlow,
    discovery: portable.discovery,
    variety: portable.variety,
    playlistIdentity: portable.playlistIdentity,
    refreshPolicy: portable.refreshPolicy,
    automationPolicy: portable.automationPolicy,
    portableRecipe: portable,
    validation: reviewRequired ? {
      valid: false,
      errors: [scoringModelValidationIssue(storedModel)],
      warnings: validation.warnings,
    } : { valid: validation.valid, errors: validation.errors, warnings: validation.warnings },
    scoringModelMigration: modelState.status === "canonical" ? null : {
      status: modelState.status === "legacy_alias" ? "normalized" : "requires_review",
      field: "scoring.scoringModel",
      receivedValue: storedModel,
      ...(modelState.status === "legacy_alias" ? { canonicalValue: modelState.value } : {}),
    },
    filterSummary: summarizePlaylistRecipeFilters(resolvedFilters),
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    lastUsedAt: recipe.lastUsedAt,
    importedAt: recipe.importedAt || null,
    adaptedFromImport: recipe.adaptedFromImport === true,
    originalImportedRecipe: recipe.originalImportedRecipeJson || null,
    importSchemaVersion: recipe.importSchemaVersion || null,
    importEngineVersion: recipe.importEngineVersion || null,
    importWarnings: recipe.importWarningsJson || [],
    importAnalysis: recipe.importAnalysis || null,
    lastExportedAt: recipe.lastExportedAt || null,
    portableChecksum: recipe.portableChecksum || null,
    useCount: recipe.useCount,
    createdFromVersion: recipe.createdFromVersion,
    sourceRecipeId: recipe.sourceRecipeId || null,
    sourceRecipeVersion: recipe.sourceRecipeVersion || null,
    isFavorite: recipe.isFavorite,
    isArchived: recipe.isArchived,
    deletedAt: recipe.deletedAt || null,
    playlistCount: recipe._count?.generatedPlaylists ?? recipe.playlistCount ?? 0,
    inheritanceEnabled: recipe.inheritanceEnabled === true,
    baseRecipeId: recipe.baseRecipeId || null,
    baseRecipe: recipe.baseRecipe ? { id: recipe.baseRecipe.id, name: recipe.baseRecipe.name, recipeVersion: recipe.baseRecipe.recipeVersion } : null,
    recipeCategoryId: recipe.recipeCategoryId || null,
    recipeCategory: recipe.recipeCategory || null,
    transitionPresetId: recipe.transitionPresetId || null,
    discoveryPresetId: recipe.discoveryPresetId || null,
    varietyPresetId: recipe.varietyPresetId || null,
    automationPresetId: recipe.automationPresetId || null,
    presetReferences: { transition: recipe.transitionPreset || null, discovery: recipe.discoveryPreset || null, variety: recipe.varietyPreset || null, automation: recipe.automationPreset || null },
    localOverrides: recipe.recipeOverrides || [],
    dependentRecipeCount: recipe._count?.childRecipes ?? 0,
    governance: {
      schemaVersion: recipe.governanceSchemaVersion || 3,
      source: recipe.recipeSource || "LOCAL",
      trustState: recipe.trustState || "LOCAL",
      approvalState: recipe.approvalState || "APPROVED",
      quarantineState: recipe.quarantineState || "NONE",
      quarantineReason: recipe.quarantineReason || null,
      signatureStatus: recipe.signatureStatus || "MISSING",
      signatureKeyId: recipe.signatureKeyId || null,
      signerIdentity: recipe.signerIdentity || null,
      official: recipe.trustState === "OFFICIAL" && recipe.signatureStatus === "VALID",
      requestedPermissions: recipe.requestedPermissionsJson || [],
      grantedPermissions: recipe.grantedPermissionsJson || [],
      restrictedPermissions: recipe.restrictedPermissionsJson || [],
      compatibilityStatus: recipe.compatibilityStatus || "COMPATIBLE",
      compatibility: recipe.compatibilityJson || {},
      riskLevel: recipe.riskLevel || "LOW",
      riskScore: recipe.riskScore || 0,
      riskFindings: recipe.riskFindingsJson || [],
      dependencies: recipe.dependencyStatusJson || [],
      migrationHistory: recipe.migrationHistoryJson || [],
      approvedAt: recipe.approvedAt || null,
      lastValidatedAt: recipe.lastValidatedAt || null,
    },
    community: recipe.communityRecipeId ? {
      recipeId: recipe.communityRecipeId,
      version: recipe.communityVersion,
      formatVersion: recipe.communityFormatVersion,
      author: { name: recipe.communityAuthorName, url: recipe.communityAuthorUrl },
      license: recipe.communityLicense,
      minimumMixarrVersion: recipe.minimumMixarrVersion,
      homepageUrl: recipe.communityHomepageUrl,
      documentationUrl: recipe.communityDocumentationUrl,
      sourceUrl: recipe.communitySourceUrl,
      tags: recipe.communityTagsJson || [],
      changelog: recipe.communityChangelog,
      screenshots: recipe.communityScreenshotsJson || [],
      importSource: recipe.communityImportSource,
      importMethod: recipe.communityImportMethod,
      trustState: locallyModified ? "modified" : recipe.communityTrustState || "unknown",
      validation: recipe.communityValidationJson || [],
      importedVersion: recipe.communityImportedVersion,
      locallyModified,
      updatedAt: recipe.communityUpdatedAt,
    } : null,
    ai: recipe.aiGenerated ? {
      generated: true,
      status: recipe.aiRecipeStatus || "NEEDS_REVIEW",
      provenance: recipe.aiProvenanceJson || null,
      lastProposalId: recipe.lastAiProposalId || null,
      manuallyEditedAfterGeneration: recipe.manuallyEditedAfterAi === true,
    } : null,
  };
}

export function createPlaylistRecipeData(userId: string, input: PlaylistRecipeInput): Prisma.PlaylistRecipeCreateInput {
  const prepared = parseCanonicalPlaylistRecipeDraft(input);
  input = prepared.data;
  const recipe = prepared.recipe;
  const permissionPlan = inferRecipePermissions(recipe);
  return {
    user: { connect: { id: userId } },
    name: input.name,
    slug: `${slugifyRecipeName(input.name)}-${crypto.randomUUID().slice(0, 8)}`,
    description: input.description || null,
    category: input.category,
    artworkUrl: input.artworkUrl || null,
    enabled: input.enabled,
    schemaVersion: recipe.schemaVersion,
    recipeVersion: recipe.recipeVersion,
    filtersJson: recipe.generation as Prisma.InputJsonValue,
    scoringJson: recipe.scoring as Prisma.InputJsonValue,
    targetsJson: recipe.targets as Prisma.InputJsonValue,
    bpmFlowJson: recipe.bpmFlow as Prisma.InputJsonValue,
    discoveryJson: recipe.discovery as Prisma.InputJsonValue,
    varietyJson: recipe.variety as Prisma.InputJsonValue,
    identityDefaultsJson: recipe.playlistIdentity as Prisma.InputJsonValue,
    refreshPolicyJson: recipe.refreshPolicy as Prisma.InputJsonValue,
    automationPolicyJson: recipe.automationPolicy as Prisma.InputJsonValue,
    governanceSchemaVersion: 3,
    recipeSource: "LOCAL",
    trustState: "LOCAL",
    approvalState: "APPROVED",
    quarantineState: "NONE",
    signatureStatus: "MISSING",
    normalizedPayloadJson: recipe as Prisma.InputJsonValue,
    requestedPermissionsJson: permissionPlan as Prisma.InputJsonValue,
    grantedPermissionsJson: permissionPlan.filter((item) => item.decision === "allow").map((item) => item.permission) as Prisma.InputJsonValue,
    restrictedPermissionsJson: permissionPlan.filter((item) => item.decision !== "allow").map((item) => item.permission) as Prisma.InputJsonValue,
    lastValidatedAt: new Date(),
    ...(input.sourcePlaylistId ? { sourcePlaylist: { connect: { id: input.sourcePlaylistId } } } : {}),
    ...(input.baseRecipeId ? { baseRecipe: { connect: { id: input.baseRecipeId } }, inheritanceEnabled: true } : {}),
    ...(input.recipeCategoryId ? { recipeCategory: { connect: { id: input.recipeCategoryId } }, inheritanceEnabled: true } : {}),
    ...(input.transitionPresetId ? { transitionPreset: { connect: { id: input.transitionPresetId } }, inheritanceEnabled: true } : {}),
    ...(input.discoveryPresetId ? { discoveryPreset: { connect: { id: input.discoveryPresetId } }, inheritanceEnabled: true } : {}),
    ...(input.varietyPresetId ? { varietyPreset: { connect: { id: input.varietyPresetId } }, inheritanceEnabled: true } : {}),
    ...(input.automationPresetId ? { automationPreset: { connect: { id: input.automationPresetId } }, inheritanceEnabled: true } : {}),
    createdFromVersion: APP_VERSION,
    revisions: {
      create: {
        recipeVersion: 1,
        schemaVersion: recipe.schemaVersion,
        changeType: input.sourcePlaylistId ? "CREATED_FROM_PLAYLIST" : "CREATED",
        portableSnapshotJson: recipe as Prisma.InputJsonValue,
      },
    },
  };
}

export function updatePlaylistRecipeData(input: PlaylistRecipeInput, existing?: any): Prisma.PlaylistRecipeUpdateInput {
  const currentVersion = existing?.recipeVersion || 1;
  const prepared = parseCanonicalPlaylistRecipeDraft(input, { recipeVersion: currentVersion + 1 });
  input = prepared.data;
  const normalized = prepared.recipe;
  const behaviorChanged = !existing || [
    [existing.filtersJson, normalized.generation], [existing.scoringJson, normalized.scoring], [existing.targetsJson, normalized.targets],
    [existing.bpmFlowJson, normalized.bpmFlow], [existing.discoveryJson, normalized.discovery], [existing.varietyJson, normalized.variety],
    [existing.identityDefaultsJson, normalized.playlistIdentity], [existing.refreshPolicyJson, normalized.refreshPolicy],
    [existing.automationPolicyJson, normalized.automationPolicy],
  ].some(([left, right]) => JSON.stringify(left) !== JSON.stringify(right));
  const nextVersion = behaviorChanged ? currentVersion + 1 : currentVersion;
  const snapshot = { ...normalized, recipeVersion: nextVersion };
  return {
    name: input.name,
    description: input.description || null,
    category: input.category,
    artworkUrl: input.artworkUrl || null,
    enabled: input.enabled,
    schemaVersion: normalized.schemaVersion,
    filtersJson: normalized.generation as Prisma.InputJsonValue,
    scoringJson: normalized.scoring as Prisma.InputJsonValue,
    targetsJson: normalized.targets as Prisma.InputJsonValue,
    bpmFlowJson: normalized.bpmFlow as Prisma.InputJsonValue,
    discoveryJson: normalized.discovery as Prisma.InputJsonValue,
    varietyJson: normalized.variety as Prisma.InputJsonValue,
    identityDefaultsJson: normalized.playlistIdentity as Prisma.InputJsonValue,
    refreshPolicyJson: normalized.refreshPolicy as Prisma.InputJsonValue,
    automationPolicyJson: normalized.automationPolicy as Prisma.InputJsonValue,
    ...(behaviorChanged ? {
      recipeVersion: nextVersion,
      revisions: { create: { recipeVersion: nextVersion, schemaVersion: normalized.schemaVersion, changeType: "UPDATED", portableSnapshotJson: snapshot as Prisma.InputJsonValue } },
    } : {}),
    ...(input.baseRecipeId !== undefined ? { baseRecipe: input.baseRecipeId ? { connect: { id: input.baseRecipeId } } : { disconnect: true }, inheritanceEnabled: true } : {}),
    ...(input.recipeCategoryId !== undefined ? { recipeCategory: input.recipeCategoryId ? { connect: { id: input.recipeCategoryId } } : { disconnect: true }, inheritanceEnabled: true } : {}),
    ...(input.transitionPresetId !== undefined ? { transitionPreset: input.transitionPresetId ? { connect: { id: input.transitionPresetId } } : { disconnect: true }, inheritanceEnabled: true } : {}),
    ...(input.discoveryPresetId !== undefined ? { discoveryPreset: input.discoveryPresetId ? { connect: { id: input.discoveryPresetId } } : { disconnect: true }, inheritanceEnabled: true } : {}),
    ...(input.varietyPresetId !== undefined ? { varietyPreset: input.varietyPresetId ? { connect: { id: input.varietyPresetId } } : { disconnect: true }, inheritanceEnabled: true } : {}),
    ...(input.automationPresetId !== undefined ? { automationPreset: input.automationPresetId ? { connect: { id: input.automationPresetId } } : { disconnect: true }, inheritanceEnabled: true } : {}),
  };
}

export function duplicateRecipeName(originalName: string, existingNames: string[]) {
  const usedNames = new Set(existingNames);
  const baseName = `${originalName} Copy`;

  if (!usedNames.has(baseName)) return baseName;

  for (let copyNumber = 2; copyNumber < 1000; copyNumber += 1) {
    const candidate = `${baseName} ${copyNumber}`;
    if (!usedNames.has(candidate)) return candidate;
  }

  return `${baseName} ${Date.now()}`;
}

export async function markPlaylistRecipeUsed(userId: string, recipeId: string) {
  return prisma.playlistRecipe.updateMany({
    where: { id: recipeId, userId },
    data: {
      lastUsedAt: new Date(),
      useCount: { increment: 1 },
    },
  });
}
