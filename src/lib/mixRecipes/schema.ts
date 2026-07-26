import { z } from "zod";
import { playlistConfigSchema, type PlaylistConfigInput } from "../playlistService";
import { DEFAULT_SMART_MIX_TUNING, normalizeSmartMixTuningConfig } from "../smartMixEngine/v2/tuning";
import { normalizeDiscoveryConfig } from "../smartMixEngine/v2/discovery";
import { normalizeBpmFlowConfig } from "../smartMixEngine/v2/bpmFlow";
import { RECIPE_PERMISSIONS } from "./governanceTypes";
import { DEFAULT_SCORING_MODEL, scoringModelSchema } from "../scoringModelCatalog";
export { RECIPE_PERMISSIONS } from "./governanceTypes";

export const MIX_RECIPE_FORMAT = "mixarr-recipe" as const;
export const CURRENT_RECIPE_SCHEMA_VERSION = 3;
export const RECIPE_CATEGORIES = [
  "Driving", "Workout", "Party", "Focus", "Chill", "Sleep", "Discovery",
  "Mood", "Decade", "Genre", "Artist", "Seasonal", "Custom",
] as const;

const percent = z.coerce.number().min(0).max(100);
const unit = z.coerce.number().min(0).max(1);
const nullableUnit = unit.optional().nullable();
const nullableBpm = z.coerce.number().min(30).max(300).optional().nullable();
const shortList = z.array(z.string().trim().min(1).max(120)).max(50).default([]);

export const recipeScoringSchema = z.object({
  moodMatchWeight: percent.default(50),
  energyMatchWeight: percent.default(50),
  bpmCompatibilityWeight: percent.default(50),
  popularityWeight: percent.default(50),
  discoveryWeight: percent.default(50),
  playlistIdentityWeight: percent.default(50),
  historicalAcceptanceWeight: percent.default(50),
  historicalRejectionPenalty: percent.default(50),
  artistPreferenceWeight: percent.default(50),
  recencyPenalty: percent.default(50),
  repeatPenalty: percent.default(50),
  metadataConfidenceWeight: percent.default(50),
  transitionQualityWeight: percent.default(50),
  personalizedScoringInfluence: percent.default(35),
  scoringMode: z.enum(["base", "personalized"]).default("base"),
  scoringModel: scoringModelSchema.default(DEFAULT_SCORING_MODEL),
}).strict();

export const recipeTargetsSchema = z.object({
  selectedMoods: shortList,
  primaryMood: z.string().trim().max(80).optional().nullable(),
  secondaryMoods: shortList,
  moodBlendMode: z.enum(["off", "smooth_transition", "strict_matching", "mixed_mood"]).default("off"),
  strictMoodMatching: z.boolean().default(false),
  moodTransition: z.enum(["none", "smooth", "sectioned"]).default("none"),
  moodCurve: z.array(z.object({ start: percent, end: percent, mood: z.string().trim().min(1).max(80) }).strict()).max(12).default([]),
  minimumEnergy: nullableUnit,
  maximumEnergy: nullableUnit,
  targetEnergy: nullableUnit,
  energyProgression: z.enum(["steady", "rising", "falling", "wave", "mixed"]).default("mixed"),
  missingMoodFallback: z.enum(["allow", "neutral", "exclude"]).default("allow"),
  missingEnergyFallback: z.enum(["allow", "neutral", "exclude"]).default("allow"),
}).strict();

export const recipeBpmFlowSchema = z.object({
  minimumBpm: nullableBpm,
  maximumBpm: nullableBpm,
  targetBpm: nullableBpm,
  mode: z.enum(["RAMP_UP", "RAMP_DOWN", "STEADY", "NATURAL", "CUSTOM", "DISABLED"]).default("DISABLED"),
  sections: z.array(z.object({ start: percent, end: percent, targetBpm: z.coerce.number().min(30).max(300) }).strict()).max(12).default([]),
  maximumBpmGap: z.coerce.number().min(1).max(80).default(8),
  allowBpmJumps: z.boolean().default(false),
  halfTimeMatching: z.boolean().default(true),
  doubleTimeMatching: z.boolean().default(true),
  transitionDifficultyTolerance: percent.default(70),
  missingBpmFallback: z.enum(["allow", "neutral", "exclude"]).default("allow"),
  minimumBpmConfidence: unit.default(0),
}).strict();

export const recipeDiscoverySchema = z.object({
  level: z.enum(["low", "medium", "high", "custom"]).default("medium"),
  deepCutPercentage: percent.default(35),
  familiarityBalance: percent.default(50),
  avoidOverplayedTracks: z.boolean().default(true),
  favorUnderplayedPlexTracks: z.boolean().default(true),
  favorTracksNotRecentlyUsed: z.boolean().default(true),
  hiddenGemPreference: percent.default(50),
  maximumHighPopularityPercentage: percent.default(45),
  recentlyAddedPreference: percent.default(0),
  newTrackQuarantineDays: z.coerce.number().int().min(0).max(3650).default(0),
  lowConfidenceBehavior: z.enum(["allow", "neutral", "exclude"]).default("neutral"),
}).strict();

export const recipeVarietySchema = z.object({
  maximumTracksPerArtist: z.coerce.number().int().min(1).max(5000).default(3),
  minimumArtistSpacing: z.coerce.number().int().min(0).max(5000).default(1),
  maximumTracksPerAlbum: z.coerce.number().int().min(1).max(5000).default(2),
  minimumAlbumSpacing: z.coerce.number().int().min(0).max(5000).default(0),
  maximumRepeatedGenres: z.coerce.number().int().min(1).max(100).default(12),
  duplicateTrackHandling: z.enum(["avoid", "allow", "prefer_best_copy"]).default("avoid"),
  alternateVersionHandling: z.enum(["avoid", "allow", "prefer"]).default("avoid"),
  liveVersionHandling: z.enum(["avoid", "allow", "prefer"]).default("avoid"),
  remixHandling: z.enum(["avoid", "allow", "prefer"]).default("allow"),
  recentlyPlayedExclusionDays: z.coerce.number().int().min(0).max(3650).default(0),
  recentlyUsedPlaylistTrackExclusion: z.boolean().default(true),
  repeatTolerance: percent.default(35),
  artistVarietyStrategy: z.enum(["balanced", "strict", "relaxed"]).default("balanced"),
  albumVarietyStrategy: z.enum(["balanced", "strict", "relaxed"]).default("balanced"),
}).strict();

export const recipeIdentityDefaultsSchema = z.object({
  personalitySummary: z.string().trim().max(1000).default(""),
  coreMoods: shortList,
  preferredEnergyCharacter: z.enum(["low", "medium", "high", "dynamic", "unspecified"]).default("unspecified"),
  preferredBpmMinimum: nullableBpm,
  preferredBpmMaximum: nullableBpm,
  preferredArtists: shortList,
  preferredGenres: shortList,
  avoidedArtists: shortList,
  avoidedGenres: shortList,
  avoidedTrackTraits: shortList,
  discoveryTolerance: percent.default(50),
  repeatTolerance: percent.default(35),
  transitionPreference: z.enum(["smooth", "balanced", "adventurous"]).default("balanced"),
  lockedTraits: shortList,
  identityLearningEnabled: z.boolean().default(true),
  personalizationEnabled: z.boolean().default(false),
  maximumPersonalizationInfluence: percent.default(35),
}).strict();

export const recipeRefreshPolicySchema = z.object({
  mode: z.enum(["manual", "scheduled"]).default("manual"),
  frequencyDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  strategy: z.enum(["replace_weak", "full_regeneration"]).default("replace_weak"),
  preserveLockedTracks: z.boolean().default(true),
  preserveLikedTracks: z.boolean().default(true),
  preservePlaylistLength: z.boolean().default(true),
  preserveMoodCurve: z.boolean().default(true),
  preserveBpmCurve: z.boolean().default(true),
  addCompatibleRecentlyAddedTracks: z.boolean().default(false),
  weakTrackScoreThreshold: percent.default(50),
  minimumReplacements: z.coerce.number().int().min(0).max(5000).default(1),
  maximumReplacements: z.coerce.number().int().min(1).max(5000).default(10),
  notificationPreference: z.enum(["none", "in_app"]).default("in_app"),
}).strict();

export const recipeAutomationPolicySchema = z.object({
  enabled: z.boolean().default(false),
  requireExplicitConfirmation: z.literal(true).default(true),
  libraryId: z.string().trim().max(120).optional().nullable(),
  preserveManualEdits: z.boolean().default(true),
}).strict();

export const mixRecipeMetadataSchema = z.object({
  name: z.string().trim().min(1, "Recipe name is required.").max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase URL-safe slug.").max(160).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  category: z.string().trim().min(1).max(80).default("Custom"),
  artworkUrl: z.string().trim().max(500).refine((value) => value.startsWith("/") || /^https:\/\//i.test(value), "Artwork must be an HTTPS URL or an application-relative path.").optional().nullable(),
  sourcePlaylistId: z.string().uuid().optional().nullable(),
}).strict();

export const recipePermissionSchema = z.object({
  permission: z.enum(RECIPE_PERMISSIONS),
  reason: z.string().trim().min(1).max(500),
  required: z.boolean().default(true),
}).strict();

export const recipeDependencySchema = z.object({
  type: z.enum(["feature", "metadata_provider", "plex_integration", "plex_library", "plex_collection", "integration", "approval_workflow", "smart_actions", "recipe", "capability", "api_scope"]),
  name: z.string().trim().min(1).max(160),
  required: z.boolean().default(true),
  minimumVersion: z.string().trim().max(80).optional().nullable(),
  fallback: z.object({
    action: z.enum(["disable_rule", "suggest_only", "skip_notification", "disabled_schedule", "require_approval", "compatible_source", "ignore_ui_field"]),
    target: z.string().trim().max(240).optional().nullable(),
  }).strict().optional().nullable(),
}).strict();

export const recipeCompatibilitySchema = z.object({
  minMixarrVersion: z.string().trim().max(80).default("2.3.8"),
  maxMixarrVersion: z.string().trim().max(80).default("2.x"),
  recipeSchemaVersion: z.coerce.number().int().min(1).max(CURRENT_RECIPE_SCHEMA_VERSION).default(CURRENT_RECIPE_SCHEMA_VERSION),
}).strict();

export const recipeSignatureSchema = z.object({
  algorithm: z.literal("ed25519"),
  keyId: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(1000),
  signedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
}).strict();

export const mixRecipeDocumentSchema = z.object({
  format: z.literal(MIX_RECIPE_FORMAT),
  schemaVersion: z.literal(CURRENT_RECIPE_SCHEMA_VERSION),
  recipeVersion: z.coerce.number().int().min(1),
  metadata: mixRecipeMetadataSchema,
  permissions: z.array(recipePermissionSchema).max(RECIPE_PERMISSIONS.length).default([]),
  dependencies: z.array(recipeDependencySchema).max(100).default([]),
  compatibility: recipeCompatibilitySchema.default({}),
  signature: recipeSignatureSchema.optional().nullable(),
  scoring: recipeScoringSchema,
  targets: recipeTargetsSchema,
  bpmFlow: recipeBpmFlowSchema,
  discovery: recipeDiscoverySchema,
  variety: recipeVarietySchema,
  playlistIdentity: recipeIdentityDefaultsSchema,
  refreshPolicy: recipeRefreshPolicySchema,
  automationPolicy: recipeAutomationPolicySchema,
  generation: playlistConfigSchema,
}).strict();

export type MixRecipeDocument = z.infer<typeof mixRecipeDocumentSchema>;
export type MixRecipeMetadataInput = z.input<typeof mixRecipeMetadataSchema>;

export function slugifyRecipeName(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140) || "recipe";
}

function flattenedRules(node: any): PlaylistConfigInput["rules"] {
  if (!node) return [];
  if (node.type !== "group") return [node];
  return (node.children || []).flatMap(flattenedRules);
}

function withoutRangeRules(node: any): any | null {
  if (!node) return null;
  if (node.type !== "group") return ["tempo", "energy"].includes(node.field) ? null : node;
  const children = (node.children || []).map(withoutRangeRules).filter(Boolean);
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

function rulesFor(config: PlaylistConfigInput, field: string) {
  const rules = config.ruleTree ? flattenedRules(config.ruleTree) : config.rules;
  return rules.filter((rule) => rule.field === field);
}

function rangeFor(config: PlaylistConfigInput, field: string): [number | null, number | null] {
  const rules = rulesFor(config, field);
  const lower = rules.find((rule) => ["gt", "gte", "eq"].includes(rule.operator));
  const upper = rules.find((rule) => ["lt", "lte", "eq"].includes(rule.operator));
  return [lower && Number.isFinite(Number(lower.value)) ? Number(lower.value) : null, upper && Number.isFinite(Number(upper.value)) ? Number(upper.value) : null];
}

export function recipeSectionsFromPlaylistConfig(value: unknown) {
  const generation = playlistConfigSchema.parse(value);
  const tuning = normalizeSmartMixTuningConfig(generation.tuningConfig || DEFAULT_SMART_MIX_TUNING);
  const discovery = normalizeDiscoveryConfig(tuning.discovery, tuning.familiarityDiscoveryBalance);
  const bpm = normalizeBpmFlowConfig(tuning.bpmFlow);
  const [minimumBpm, maximumBpm] = rangeFor(generation, "tempo");
  const [minimumEnergy, maximumEnergy] = rangeFor(generation, "energy");
  return {
    scoring: recipeScoringSchema.parse({
      moodMatchWeight: tuning.moodWeight, energyMatchWeight: tuning.energyWeight,
      bpmCompatibilityWeight: tuning.bpmWeight, popularityWeight: tuning.popularityWeight,
      discoveryWeight: 100 - tuning.familiarityDiscoveryBalance,
      transitionQualityWeight: Math.round((tuning.bpmWeight + tuning.energyWeight + tuning.moodWeight) / 3),
      personalizedScoringInfluence: generation.personalizationInfluence ?? 35,
      scoringMode: generation.personalizationEnabled ? "personalized" : "base",
      scoringModel: generation.scoringModel || DEFAULT_SCORING_MODEL,
    }),
    targets: recipeTargetsSchema.parse({
      selectedMoods: generation.allowedMoods, primaryMood: generation.selectedMoodPath[0] || null,
      secondaryMoods: generation.selectedMoodPath.slice(1), moodBlendMode: generation.moodBlendMode,
      strictMoodMatching: generation.moodBlendMode === "strict_matching", minimumEnergy, maximumEnergy,
    }),
    bpmFlow: recipeBpmFlowSchema.parse({
      minimumBpm, maximumBpm, mode: bpm.mode, maximumBpmGap: bpm.maxPreferredGap,
      allowBpmJumps: bpm.allowJumps, halfTimeMatching: bpm.halfDoubleTimeMatching,
      doubleTimeMatching: bpm.halfDoubleTimeMatching,
    }),
    discovery: recipeDiscoverySchema.parse({
      level: discovery.level, deepCutPercentage: discovery.deepCutTarget,
      familiarityBalance: tuning.familiarityDiscoveryBalance, avoidOverplayedTracks: discovery.avoidOverplayed,
      favorUnderplayedPlexTracks: discovery.underplayedBoost !== "off",
      favorTracksNotRecentlyUsed: discovery.avoidRecentlyUsedPlaylistTracks,
      hiddenGemPreference: discovery.includeHiddenGems ? 70 : 0,
      maximumHighPopularityPercentage: discovery.maxPopularTrackPercent,
    }),
    variety: recipeVarietySchema.parse({
      maximumTracksPerArtist: generation.safetyRules.maxTracksPerArtist,
      maximumTracksPerAlbum: generation.safetyRules.maxTracksPerAlbum,
      duplicateTrackHandling: generation.duplicateStrategy === "allow" ? "allow" : generation.duplicateStrategy === "prefer_highest_quality" ? "prefer_best_copy" : "avoid",
      liveVersionHandling: generation.negativeFilters.excludeLive ? "avoid" : "allow",
      recentlyPlayedExclusionDays: generation.negativeFilters.excludePlayedWithinDays || 0,
      recentlyUsedPlaylistTrackExclusion: tuning.avoidRecentlyUsedTracks,
    }),
  };
}

export function defaultMixRecipeDocument(metadata: MixRecipeMetadataInput, generationValue: unknown): MixRecipeDocument {
  const generation = playlistConfigSchema.parse(generationValue);
  const sections = recipeSectionsFromPlaylistConfig(generation);
  return mixRecipeDocumentSchema.parse({
    format: MIX_RECIPE_FORMAT,
    schemaVersion: CURRENT_RECIPE_SCHEMA_VERSION,
    recipeVersion: 1,
    metadata: { ...metadata, slug: metadata.slug || slugifyRecipeName(metadata.name) },
    permissions: [], dependencies: [], compatibility: {}, signature: null,
    ...sections,
    playlistIdentity: {}, refreshPolicy: {}, automationPolicy: {},
    generation: { ...generation, scoringModel: sections.scoring.scoringModel },
  });
}

export function resolveRecipeGenerationConfig(recipe: MixRecipeDocument, overrides: unknown = {}) {
  const safeOverrides = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides as Record<string, unknown> : {};
  const permitted = new Set(["limit", "serverId", "libraryId", "pinnedTrackIds", "excludedTrackIds", "personalizationEnabled", "personalizationInfluence"]);
  const unknown = Object.keys(safeOverrides).filter((key) => !permitted.has(key));
  if (unknown.length) throw new Error(`Unsupported playlist-only override: ${unknown.join(", ")}`);
  const sourceRules = recipe.generation.ruleTree ? flattenedRules(recipe.generation.ruleTree) : recipe.generation.rules;
  const withoutRecipeRanges = sourceRules.filter((rule) => !["tempo", "energy"].includes(rule.field));
  const rangeRules = [
    ...(recipe.bpmFlow.minimumBpm != null ? [{ field: "tempo" as const, operator: "gte" as const, value: String(recipe.bpmFlow.minimumBpm) }] : []),
    ...(recipe.bpmFlow.maximumBpm != null ? [{ field: "tempo" as const, operator: "lte" as const, value: String(recipe.bpmFlow.maximumBpm) }] : []),
    ...(recipe.targets.minimumEnergy != null ? [{ field: "energy" as const, operator: "gte" as const, value: String(recipe.targets.minimumEnergy) }] : []),
    ...(recipe.targets.maximumEnergy != null ? [{ field: "energy" as const, operator: "lte" as const, value: String(recipe.targets.maximumEnergy) }] : []),
  ];
  const currentTuning = normalizeSmartMixTuningConfig(recipe.generation.tuningConfig);
  const bpmMode = recipe.bpmFlow.mode === "CUSTOM" ? "NATURAL" : recipe.bpmFlow.mode;
  const generation = {
    ...recipe.generation,
    engineVersion: "v2",
    rules: [...withoutRecipeRanges, ...rangeRules],
    ruleTree: recipe.generation.ruleTree
      ? { type: "group" as const, combinator: "AND" as const, children: [withoutRangeRules(recipe.generation.ruleTree), ...rangeRules].filter(Boolean) }
      : undefined,
    moodBlendMode: recipe.targets.strictMoodMatching ? "strict_matching" : recipe.targets.moodBlendMode,
    allowedMoods: recipe.targets.selectedMoods,
    selectedMoodPath: [recipe.targets.primaryMood, ...recipe.targets.secondaryMoods].filter((mood): mood is string => Boolean(mood)),
    personalizationEnabled: recipe.playlistIdentity.personalizationEnabled || recipe.scoring.scoringMode === "personalized",
    personalizationInfluence: Math.min(recipe.scoring.personalizedScoringInfluence, recipe.playlistIdentity.maximumPersonalizationInfluence),
    scoringModel: recipe.scoring.scoringModel,
    duplicateStrategy: recipe.variety.duplicateTrackHandling === "allow" ? "allow" : recipe.variety.duplicateTrackHandling === "prefer_best_copy" ? "prefer_highest_quality" : "avoid_recordings",
    negativeFilters: {
      ...recipe.generation.negativeFilters,
      excludeLive: recipe.variety.liveVersionHandling === "avoid",
      excludePlayedWithinDays: recipe.variety.recentlyPlayedExclusionDays || null,
    },
    safetyRules: {
      ...recipe.generation.safetyRules,
      limitTracksPerArtist: true,
      maxTracksPerArtist: recipe.variety.maximumTracksPerArtist,
      limitTracksPerAlbum: true,
      maxTracksPerAlbum: recipe.variety.maximumTracksPerAlbum,
    },
    tuningConfig: {
      ...currentTuning,
      popularityWeight: recipe.scoring.popularityWeight,
      moodWeight: recipe.scoring.moodMatchWeight,
      energyWeight: recipe.scoring.energyMatchWeight,
      bpmWeight: recipe.scoring.bpmCompatibilityWeight,
      familiarityDiscoveryBalance: recipe.discovery.familiarityBalance,
      artistVariety: recipe.variety.artistVarietyStrategy === "strict" ? 90 : recipe.variety.artistVarietyStrategy === "relaxed" ? 25 : currentTuning.artistVariety,
      albumVariety: recipe.variety.albumVarietyStrategy === "strict" ? 90 : recipe.variety.albumVarietyStrategy === "relaxed" ? 25 : currentTuning.albumVariety,
      avoidRecentlyUsedTracks: recipe.variety.recentlyUsedPlaylistTrackExclusion,
      discovery: {
        ...currentTuning.discovery,
        level: recipe.discovery.level,
        deepCutTarget: recipe.discovery.deepCutPercentage,
        avoidOverplayed: recipe.discovery.avoidOverplayedTracks,
        includeHiddenGems: recipe.discovery.hiddenGemPreference > 0,
        limitPopularTracks: recipe.discovery.maximumHighPopularityPercentage < 100,
        maxPopularTrackPercent: recipe.discovery.maximumHighPopularityPercentage,
        underplayedBoost: recipe.discovery.favorUnderplayedPlexTracks ? "high" : "off",
        avoidRecentlyUsedPlaylistTracks: recipe.discovery.favorTracksNotRecentlyUsed,
      },
      bpmFlow: {
        enabled: bpmMode !== "DISABLED",
        mode: bpmMode,
        strength: recipe.bpmFlow.transitionDifficultyTolerance,
        maxPreferredGap: recipe.bpmFlow.maximumBpmGap,
        allowJumps: recipe.bpmFlow.allowBpmJumps,
        halfDoubleTimeMatching: recipe.bpmFlow.halfTimeMatching || recipe.bpmFlow.doubleTimeMatching,
        startingBpmMode: recipe.bpmFlow.targetBpm != null ? "CUSTOM" : "AUTO",
        customStartingBpm: recipe.bpmFlow.targetBpm,
      },
    },
  };
  return playlistConfigSchema.parse({ ...generation, ...safeOverrides });
}
