import { createHash } from "node:crypto";
import { APP_VERSION, APP_VERSION_NUMBER } from "../appVersion";
import type { AdaptiveRecipeAnalysis } from "../adaptiveRecipeMapping";
import { playlistConfigSchema } from "../playlistService";
import { portableRecipeFromRecord } from "../playlistRecipes";
import {
  recipeAutomationPolicySchema,
  recipeBpmFlowSchema,
  recipeDiscoverySchema,
  recipeIdentityDefaultsSchema,
  recipeRefreshPolicySchema,
  recipeScoringSchema,
  recipeTargetsSchema,
  recipeVarietySchema,
  defaultMixRecipeDocument,
  slugifyRecipeName,
  type MixRecipeDocument,
} from "./schema";
import { validateRecipe, type RecipeValidationMessage } from "./validation";
import { scanForbiddenRecipeActions } from "./governance";
import type { RecipeGovernancePlan } from "./governanceService";

export const RECIPE_EXPORT_FORMAT = "mixarr-recipe" as const;
export const RECIPE_BUNDLE_FORMAT = "mixarr-recipe-bundle" as const;
export const RECIPE_EXPORT_FORMAT_VERSION = 1;
export const MAX_RECIPE_JSON_BYTES = 5 * 1024 * 1024;
export const MAX_RECIPE_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const STAGED_IMPORT_TTL_MINUTES = 30;

export type IntegrityStatus = "valid" | "missing" | "malformed" | "unsupported" | "mismatched";
export type CompatibilityClassification = "compatible" | "adaptable" | "unsupported" | "invalid" | "ignored_safely";
export type ConflictAction = "rename" | "replace" | "skip" | "use_existing" | "import";
export type ImportMode = "atomic" | "independent";

export type PortableArtwork = {
  included: boolean;
  reference: string | null;
  mimeType?: string | null;
  checksum?: string | null;
};

export type PortableRecipePayload = {
  recipeVersion: number;
  name: string;
  description: string | null;
  category: string;
  artwork: PortableArtwork;
  permissions: MixRecipeDocument["permissions"];
  dependencies: MixRecipeDocument["dependencies"];
  compatibility: MixRecipeDocument["compatibility"];
  signature: MixRecipeDocument["signature"];
  settings: {
    scoring: MixRecipeDocument["scoring"];
    targets: MixRecipeDocument["targets"];
    bpmFlow: MixRecipeDocument["bpmFlow"];
    discovery: MixRecipeDocument["discovery"];
    variety: MixRecipeDocument["variety"];
    playlistIdentity: MixRecipeDocument["playlistIdentity"];
    refreshPolicy: MixRecipeDocument["refreshPolicy"];
    automationPolicy: Omit<MixRecipeDocument["automationPolicy"], "libraryId">;
    generation: Record<string, unknown>;
  };
};

export type RecipeIntegrity = { algorithm: "sha256"; checksum: string };

export type RecipeExportEnvelope = {
  format: typeof RECIPE_EXPORT_FORMAT;
  formatVersion: typeof RECIPE_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  exportedBy: { application: "Mixarr"; applicationVersion: string };
  recipe: PortableRecipePayload;
  integrity: RecipeIntegrity;
};

export type PortableBundleEntry = PortableRecipePayload & { integrity: RecipeIntegrity };
export type RecipeBundleEnvelope = {
  format: typeof RECIPE_BUNDLE_FORMAT;
  formatVersion: typeof RECIPE_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  exportedBy: { application: "Mixarr"; applicationVersion: string };
  manifest: { recipeCount: number; artworkCount: number; summary: string };
  recipes: PortableBundleEntry[];
  integrity: RecipeIntegrity;
};

export type SensitiveFinding = { category: string; path: string };
export type SensitiveScanResult = { safe: boolean; findingCount: number; categories: { category: string; count: number }[]; findings: SensitiveFinding[] };

export type ImportAdaptation = {
  path: string;
  sourceValue: unknown;
  proposedValue: unknown;
  reason: string;
  impact: string;
  required: boolean;
};

export type CompatibilityItem = { path: string; classification: CompatibilityClassification; message: string };

export type ImportConflict = {
  type: "exact_name" | "normalized_name" | "identical_checksum" | "equivalent_content" | "bundle_name" | "bundle_content";
  existingRecipeId?: string;
  existingRecipeName?: string;
  message: string;
  allowedActions: ConflictAction[];
  recommendedAction: ConflictAction;
};

export type ImportCandidate = {
  index: number;
  portable: PortableRecipePayload;
  sourceRecipeVersion: number;
  sourceFormatVersion: number;
  exportingApplicationVersion: string | null;
  checksumStatus: IntegrityStatus;
  providedChecksum: string | null;
  calculatedChecksum: string;
  contentChecksum: string;
  scan: SensitiveScanResult;
  normalizedRecipe: MixRecipeDocument | null;
  validationErrors: RecipeValidationMessage[];
  validationWarnings: RecipeValidationMessage[];
  migrationSteps: string[];
  compatibility: CompatibilityItem[];
  adaptations: ImportAdaptation[];
  unsupported: CompatibilityItem[];
  ignored: CompatibilityItem[];
  conflicts: ImportConflict[];
  summary: RecipeHumanSummary;
  proposedName: string;
  recommendedAction: ConflictAction;
  artworkDataBase64?: string | null;
  artworkMimeType?: string | null;
  adaptiveAnalysis?: AdaptiveRecipeAnalysis & { analysisId?: string; mappingStateHash?: string; libraries?: Array<{ id: string; name: string; serverId: string; updatedAt: Date | string; _count: { tracks: number } }> };
  governance?: RecipeGovernancePlan;
};

export type ParsedTransfer = {
  format: string;
  formatVersion: number;
  exportingApplicationVersion: string | null;
  exportedAt: string | null;
  bundleChecksumStatus: IntegrityStatus | null;
  sourceDigest: string;
  candidates: ImportCandidate[];
  totalBytes: number;
  archive: boolean;
};

export type ExistingPortableRecipe = { id: string; name: string; checksum: string; contentChecksum: string };

export type RecipeHumanSummary = {
  title: string;
  category: string;
  mood: string;
  energy: string;
  bpm: string;
  discovery: string;
  artistVariety: string;
  refresh: string;
  automation: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(source[key])}`).join(",")}}`;
}

export function parseJsonRejectingDuplicateKeys(input: string) {
  const stack: Array<{ type: "object" | "array"; keys?: Set<string>; expectingKey?: boolean }> = [];
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      const start = index;
      index += 1;
      for (; index < input.length; index += 1) {
        if (input[index] === "\\") { index += 1; continue; }
        if (input[index] === '"') break;
      }
      if (index >= input.length) break;
      const frame = stack[stack.length - 1];
      if (frame?.type === "object" && frame.expectingKey) {
        const key = JSON.parse(input.slice(start, index + 1)) as string;
        if (frame.keys!.has(key)) throw Object.assign(new Error(`Duplicate JSON key “${key}” is ambiguous and is not allowed.`), { code: "DUPLICATE_JSON_KEY" });
        frame.keys!.add(key); frame.expectingKey = false;
      }
      continue;
    }
    if (char === "{") stack.push({ type: "object", keys: new Set(), expectingKey: true });
    else if (char === "[") stack.push({ type: "array" });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") { const frame = stack[stack.length - 1]; if (frame?.type === "object") frame.expectingKey = true; }
  }
  return JSON.parse(input);
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function recipeChecksum(recipe: PortableRecipePayload) {
  return sha256(canonicalize(recipe));
}

export function recipeContentChecksum(recipe: PortableRecipePayload) {
  return sha256(canonicalize({ category: recipe.category, settings: recipe.settings }));
}

function portableGeneration(document: MixRecipeDocument) {
  const source = playlistConfigSchema.parse(document.generation);
  return {
    rules: clone(source.rules),
    ...(source.ruleTree ? { ruleTree: clone(source.ruleTree) } : {}),
    limit: source.limit,
    ...(source.smartPresetName ? { smartPresetName: source.smartPresetName } : {}),
    ...(source.smartPresetVersion ? { smartPresetVersion: source.smartPresetVersion } : {}),
    ...(source.moodPresetName ? { moodPresetName: source.moodPresetName } : {}),
    ...(source.moodPresetVersion ? { moodPresetVersion: source.moodPresetVersion } : {}),
    moodPresetModified: source.moodPresetModified,
    ...(source.bpmPresetName ? { bpmPresetName: source.bpmPresetName } : {}),
    ...(source.bpmPresetVersion ? { bpmPresetVersion: source.bpmPresetVersion } : {}),
    bpmPresetModified: source.bpmPresetModified,
    tuningConfig: clone(source.tuningConfig),
    moodBlendMode: source.moodBlendMode,
    selectedMoodPath: clone(source.selectedMoodPath),
    allowedMoods: clone(source.allowedMoods),
    moodStrength: source.moodStrength,
    transitionSmoothness: source.transitionSmoothness,
    moodStrictness: source.moodStrictness,
    fallbackTolerance: source.fallbackTolerance,
    bridgeTrackPreference: source.bridgeTrackPreference,
    moodVariety: source.moodVariety,
    conflictSensitivity: source.conflictSensitivity,
    selectedMoodPreset: source.selectedMoodPreset,
    engineVersion: source.engineVersion,
    ...(source.scoringModel ? { scoringModel: source.scoringModel } : {}),
    ...(source.allowStableFallback == null ? {} : { allowStableFallback: source.allowStableFallback }),
    ...(source.personalizationEnabled == null ? {} : { personalizationEnabled: source.personalizationEnabled }),
    ...(source.personalizationInfluence == null ? {} : { personalizationInfluence: source.personalizationInfluence }),
    ...(source.coordinationSetup ? { coordinationSetup: { ...clone(source.coordinationSetup), relatedPlaylistIds: [] } } : {}),
    ...(source.coverageRotationOption ? { coverageRotationOption: clone(source.coverageRotationOption) } : {}),
    duplicateStrategy: source.duplicateStrategy,
    preferNonLive: source.preferNonLive,
    excludeRemasters: source.excludeRemasters,
    negativeFilters: clone(source.negativeFilters),
    safetyRules: clone(source.safetyRules),
  };
}

export function portableRecipePayloadFromDocument(document: MixRecipeDocument, artwork: PortableArtwork = { included: false, reference: null }) : PortableRecipePayload {
  const validation = validateRecipe(document);
  if (!validation.normalizedRecipe) throw new Error(validation.errors[0]?.message || "Recipe is invalid.");
  const recipe = validation.normalizedRecipe;
  const { libraryId: _libraryId, ...automationPolicy } = recipe.automationPolicy;
  return {
    recipeVersion: recipe.recipeVersion,
    name: recipe.metadata.name,
    description: recipe.metadata.description || null,
    category: recipe.metadata.category,
    artwork,
    permissions: clone(recipe.permissions),
    dependencies: clone(recipe.dependencies),
    compatibility: clone(recipe.compatibility),
    signature: clone(recipe.signature),
    settings: {
      scoring: clone(recipe.scoring),
      targets: clone(recipe.targets),
      bpmFlow: clone(recipe.bpmFlow),
      discovery: clone(recipe.discovery),
      variety: clone(recipe.variety),
      playlistIdentity: clone(recipe.playlistIdentity),
      refreshPolicy: clone(recipe.refreshPolicy),
      automationPolicy: clone(automationPolicy),
      generation: portableGeneration(recipe),
    },
  };
}

export function portableRecipePayloadFromRecord(record: Record<string, unknown>, artwork?: PortableArtwork) {
  return portableRecipePayloadFromDocument(portableRecipeFromRecord(record), artwork);
}

export function buildRecipeEnvelope(recipe: PortableRecipePayload, exportedAt = new Date()): RecipeExportEnvelope {
  const envelope: RecipeExportEnvelope = {
    format: RECIPE_EXPORT_FORMAT,
    formatVersion: RECIPE_EXPORT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    exportedBy: { application: "Mixarr", applicationVersion: APP_VERSION_NUMBER },
    recipe,
    integrity: { algorithm: "sha256", checksum: recipeChecksum(recipe) },
  };
  assertExportIsSafe(envelope);
  return envelope;
}

export function buildBundleEnvelope(recipes: PortableRecipePayload[], exportedAt = new Date()): RecipeBundleEnvelope {
  const entries = recipes
    .map((recipe) => ({ ...recipe, integrity: { algorithm: "sha256" as const, checksum: recipeChecksum(recipe) } }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.integrity.checksum.localeCompare(right.integrity.checksum));
  const envelope: RecipeBundleEnvelope = {
    format: RECIPE_BUNDLE_FORMAT,
    formatVersion: RECIPE_EXPORT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    exportedBy: { application: "Mixarr", applicationVersion: APP_VERSION_NUMBER },
    manifest: {
      recipeCount: entries.length,
      artworkCount: entries.filter((entry) => entry.artwork.included).length,
      summary: `${entries.length} Mixarr recipe${entries.length === 1 ? "" : "s"}`,
    },
    recipes: entries,
    integrity: { algorithm: "sha256", checksum: sha256(canonicalize(entries)) },
  };
  assertExportIsSafe(envelope);
  return envelope;
}

const prohibitedKeyMatchers: Array<[RegExp, string]> = [
  [/^(plexToken|xPlexToken|accessToken)$/i, "Plex authentication token"],
  [/(api.?key|bearer.?token|authorization|session.?cookie|password|client.?secret|webhook.?secret)/i, "Credential or secret"],
  [/^(machineIdentifier|plexMachineId)$/i, "Plex machine identifier"],
  [/^(plexLibraryId|libraryId)$/i, "Plex library identifier"],
  [/^(ratingKey|plexRatingKey|trackId|trackIds|albumId|albumIds|artistId|artistIds|playlistId|playlistIds|sourcePlaylistId|relatedPlaylistIds)$/i, "Server-specific media identifier"],
  [/^(userId|ownerId|installationId|notificationDestination|notificationDestinationId)$/i, "Private account or installation identifier"],
  [/^(listeningHistory|playbackHistory|rejectedTracks|likedTracks|dislikedTracks|feedbackHistory|recommendationProfile|userProfile|personalizedScoringAdjustments)$/i, "Private listening or feedback data"],
  [/(databaseUrl|connectionString|dockerVolume|filesystemPath|hostPath)/i, "Private server configuration"],
];

const valueMatchers: Array<[RegExp, string]> = [
  [/(?:X-Plex-Token=|plex[_-]?token["'=:\s]+)[A-Za-z0-9_-]{8,}/i, "Plex authentication token"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i, "Bearer token"],
  [/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/i, "Database connection string"],
  [/https?:\/\/[^\s/@:]+:[^\s/@]+@/i, "URL containing credentials"],
  [/\b(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}\b/, "Local IP address"],
  [/https?:\/\/(?:localhost|[A-Za-z0-9_-]+\.local|[A-Za-z0-9_-]+)(?::\d+)?(?:\/|$)/i, "Internal hostname"],
  [/(?:^|[\s"'])(?:[A-Za-z]:\\|\\\\[^\\\s]+\\|\/(?:home|Users|var|etc|mnt|volume|docker)\/)[^\s"']*/i, "Local filesystem path"],
  [/https:\/\/(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services)\//i, "Notification webhook"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "Email address"],
];

export function scanSensitiveData(value: unknown): SensitiveScanResult {
  const findings: SensitiveFinding[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (isPlainObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        const hasSensitiveValue = child !== null && child !== undefined && child !== "" && (!Array.isArray(child) || child.length > 0);
        for (const [matcher, category] of prohibitedKeyMatchers) {
          if (hasSensitiveValue && matcher.test(key)) {
            const signature = `${category}:${childPath}`;
            if (!seen.has(signature)) { findings.push({ category, path: childPath }); seen.add(signature); }
            break;
          }
        }
        visit(child, childPath);
      }
      return;
    }
    if (typeof node === "string") {
      for (const [matcher, category] of valueMatchers) {
        if (matcher.test(node)) {
          const signature = `${category}:${path}`;
          if (!seen.has(signature)) { findings.push({ category, path }); seen.add(signature); }
        }
      }
    }
  };
  visit(value, "");
  const counts = new Map<string, number>();
  findings.forEach((finding) => counts.set(finding.category, (counts.get(finding.category) || 0) + 1));
  return { safe: findings.length === 0, findingCount: findings.length, categories: Array.from(counts.entries()).map(([category, count]) => ({ category, count })), findings };
}

export function assertExportIsSafe(value: unknown) {
  const scan = scanSensitiveData(value);
  if (!scan.safe) {
    const error = new Error(`Recipe export blocked by sensitive-data scan: ${scan.categories.map((item) => item.category).join(", ")}`);
    (error as Error & { code?: string }).code = "SENSITIVE_DATA_DETECTED";
    throw error;
  }
}

export function normalizedRecipeName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function safeImportedName(name: string, usedNames: string[]) {
  const used = new Set(usedNames.map(normalizedRecipeName));
  const clean = name.trim().slice(0, 120) || "Imported Recipe";
  const suffix = " (Imported)";
  const base = clean.length + suffix.length <= 120 ? `${clean}${suffix}` : `${clean.slice(0, 120 - suffix.length)}${suffix}`;
  if (!used.has(normalizedRecipeName(base))) return base;
  for (let index = 2; index < 1000; index += 1) {
    const numbered = ` (Imported ${index})`;
    const candidate = `${clean.slice(0, 120 - numbered.length)}${numbered}`;
    if (!used.has(normalizedRecipeName(candidate))) return candidate;
  }
  return `${clean.slice(0, 105)} (Imported copy)`;
}

export function safeRecipeFilename(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "recipe";
}

function energyLabel(target: number | null | undefined, min: number | null | undefined, max: number | null | undefined) {
  if (target != null) return target >= 0.75 ? "High" : target >= 0.45 ? "Medium" : "Low";
  if (min != null || max != null) return `${min == null ? "Any" : Math.round(min * 100) + "%"}–${max == null ? "Any" : Math.round(max * 100) + "%"}`;
  return "Flexible";
}

export function summarizePortableRecipe(recipe: PortableRecipePayload): RecipeHumanSummary {
  const { targets, bpmFlow, discovery, variety, refreshPolicy, automationPolicy } = recipe.settings;
  const bpmRange = bpmFlow.minimumBpm != null || bpmFlow.maximumBpm != null
    ? `${bpmFlow.minimumBpm ?? "Any"}–${bpmFlow.maximumBpm ?? "Any"} BPM`
    : "Flexible BPM";
  const bpmMode: Record<string, string> = { RAMP_UP: "gradual rise", RAMP_DOWN: "gradual fall", STEADY: "steady flow", NATURAL: "natural flow", CUSTOM: "custom sections", DISABLED: "no transition policy" };
  return {
    title: recipe.name,
    category: recipe.category || "Custom",
    mood: targets.selectedMoods.length ? targets.selectedMoods.join(", ") : "Flexible moods",
    energy: energyLabel(targets.targetEnergy, targets.minimumEnergy, targets.maximumEnergy),
    bpm: `${bpmRange} · ${bpmMode[bpmFlow.mode] || bpmFlow.mode}`,
    discovery: discovery.level.charAt(0).toUpperCase() + discovery.level.slice(1),
    artistVariety: `Maximum ${variety.maximumTracksPerArtist} track${variety.maximumTracksPerArtist === 1 ? "" : "s"} per artist`,
    refresh: refreshPolicy.mode === "scheduled" ? `${refreshPolicy.strategy === "replace_weak" ? "Replace weak tracks" : "Regenerate"} every ${refreshPolicy.frequencyDays || "configured"} days` : "Manual refresh",
    automation: automationPolicy.enabled ? "Requested; requires local configuration and confirmation" : "Disabled",
  };
}

function countLeaves(value: unknown): number {
  if (Array.isArray(value)) return value.length || 1;
  if (!isPlainObject(value)) return 1;
  return Object.values(value).reduce<number>((total, child) => total + countLeaves(child), 0);
}

const sectionSchemas = {
  scoring: recipeScoringSchema,
  targets: recipeTargetsSchema,
  bpmFlow: recipeBpmFlowSchema,
  discovery: recipeDiscoverySchema,
  variety: recipeVarietySchema,
  playlistIdentity: recipeIdentityDefaultsSchema,
  refreshPolicy: recipeRefreshPolicySchema,
  automationPolicy: recipeAutomationPolicySchema,
};

function keysForSection(section: keyof typeof sectionSchemas) {
  try { return new Set<string>(Object.keys((sectionSchemas[section] as any).shape)); } catch { return new Set<string>(); }
}

function portableFromUnknown(raw: unknown, adaptations: ImportAdaptation[], unsupported: CompatibilityItem[]) {
  if (!isPlainObject(raw)) throw Object.assign(new Error("Recipe payload is not an object."), { code: "INVALID_RECIPE_SCHEMA" });
  const settings = isPlainObject(raw.settings) ? raw.settings : {};
  const cleanedSettings: Record<string, unknown> = {};
  for (const section of Object.keys(sectionSchemas) as Array<keyof typeof sectionSchemas>) {
    const source = isPlainObject(settings[section]) ? clone(settings[section] as Record<string, unknown>) : {};
    if (section === "bpmFlow" && source.mode === "progressive-rise") {
      adaptations.push({ path: "settings.bpmFlow.mode", sourceValue: source.mode, proposedValue: "RAMP_UP", reason: "This BPM mode was renamed.", impact: "The same gradual tempo rise is preserved.", required: true });
      source.mode = "RAMP_UP";
    }
    if (section === "discovery" && source.level === "medium-high") {
      adaptations.push({ path: "settings.discovery.level", sourceValue: source.level, proposedValue: "high", reason: "The older discovery level is not part of schema v1.", impact: "Discovery remains above medium.", required: true });
      source.level = "high";
    }
    const allowed = keysForSection(section);
    for (const key of Object.keys(source)) {
      if (!allowed.has(key)) {
        unsupported.push({ path: `settings.${section}.${key}`, classification: "unsupported", message: `The setting "${key}" is not supported by ${APP_VERSION}.` });
        delete source[key];
      }
    }
    cleanedSettings[section] = source;
  }
  const generationSource = isPlainObject(settings.generation) ? settings.generation : {};
  const parsedGeneration = playlistConfigSchema.safeParse({
    ...generationSource,
    serverId: null,
    libraryId: null,
    pinnedTrackIds: [],
    excludedTrackIds: [],
    ...(isPlainObject(generationSource.coordinationSetup) ? { coordinationSetup: { ...generationSource.coordinationSetup, relatedPlaylistIds: [] } } : {}),
  });
  if (!parsedGeneration.success) throw Object.assign(new Error(parsedGeneration.error.issues[0]?.message || "Invalid generation settings."), { code: "INVALID_RECIPE_SCHEMA" });
  const safeGeneration = portableGeneration({ generation: parsedGeneration.data } as MixRecipeDocument);
  for (const key of Object.keys(generationSource)) {
    if (!Object.prototype.hasOwnProperty.call(safeGeneration, key)) unsupported.push({ path: `settings.generation.${key}`, classification: "ignored_safely", message: `The local-only or unknown setting "${key}" will not be imported.` });
  }
  const automationSource = cleanedSettings.automationPolicy as Record<string, unknown>;
  if (automationSource.enabled === true) {
    adaptations.push({ path: "settings.automationPolicy.enabled", sourceValue: true, proposedValue: false, reason: "Imported automation cannot be activated without a destination library and explicit confirmation.", impact: "The recipe imports safely; automation remains off.", required: true });
    automationSource.enabled = false;
  }
  const artwork = isPlainObject(raw.artwork) ? raw.artwork : {};
  const portable: PortableRecipePayload = {
    recipeVersion: Number.isInteger(raw.recipeVersion) && Number(raw.recipeVersion) > 0 ? Number(raw.recipeVersion) : 1,
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, 120) : "",
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 1000) || null : null,
    category: typeof raw.category === "string" ? raw.category.trim().slice(0, 80) || "Custom" : "Custom",
    artwork: {
      included: artwork.included === true,
      reference: typeof artwork.reference === "string" ? artwork.reference : null,
      ...(typeof artwork.mimeType === "string" ? { mimeType: artwork.mimeType } : {}),
      ...(typeof artwork.checksum === "string" ? { checksum: artwork.checksum } : {}),
    },
    permissions: Array.isArray(raw.permissions) ? clone(raw.permissions) as MixRecipeDocument["permissions"] : [],
    dependencies: Array.isArray(raw.dependencies) ? clone(raw.dependencies) as MixRecipeDocument["dependencies"] : [],
    compatibility: isPlainObject(raw.compatibility) ? clone(raw.compatibility) as MixRecipeDocument["compatibility"] : { minMixarrVersion: "2.3.8", maxMixarrVersion: "2.x", recipeSchemaVersion: 3 },
    signature: isPlainObject(raw.signature) ? clone(raw.signature) as MixRecipeDocument["signature"] : null,
    settings: {
      scoring: recipeScoringSchema.parse(cleanedSettings.scoring),
      targets: recipeTargetsSchema.parse(cleanedSettings.targets),
      bpmFlow: recipeBpmFlowSchema.parse(cleanedSettings.bpmFlow),
      discovery: recipeDiscoverySchema.parse(cleanedSettings.discovery),
      variety: recipeVarietySchema.parse(cleanedSettings.variety),
      playlistIdentity: recipeIdentityDefaultsSchema.parse(cleanedSettings.playlistIdentity),
      refreshPolicy: recipeRefreshPolicySchema.parse(cleanedSettings.refreshPolicy),
      automationPolicy: (() => { const { libraryId: _libraryId, ...safe } = recipeAutomationPolicySchema.parse({ ...(cleanedSettings.automationPolicy as Record<string, unknown>), libraryId: null }); return safe; })(),
      generation: safeGeneration,
    },
  };
  if (!portable.name) throw Object.assign(new Error("Recipe name is required."), { code: "INVALID_RECIPE_SCHEMA" });
  return portable;
}

function internalDocumentFromPortable(portable: PortableRecipePayload): MixRecipeDocument {
  const automation = recipeAutomationPolicySchema.parse({ ...portable.settings.automationPolicy, enabled: false, libraryId: null });
  return {
    format: "mixarr-recipe",
    schemaVersion: 3,
    recipeVersion: portable.recipeVersion,
    metadata: { name: portable.name, slug: slugifyRecipeName(portable.name), description: portable.description, category: portable.category, artworkUrl: null, sourcePlaylistId: null },
    permissions: portable.permissions,
    dependencies: portable.dependencies,
    compatibility: portable.compatibility,
    signature: portable.signature,
    scoring: portable.settings.scoring,
    targets: portable.settings.targets,
    bpmFlow: portable.settings.bpmFlow,
    discovery: portable.settings.discovery,
    variety: portable.settings.variety,
    playlistIdentity: portable.settings.playlistIdentity,
    refreshPolicy: portable.settings.refreshPolicy,
    automationPolicy: automation,
    generation: playlistConfigSchema.parse({ ...portable.settings.generation, serverId: null, libraryId: null, pinnedTrackIds: [], excludedTrackIds: [] }),
  };
}

function integrityStatus(integrity: unknown, payload: PortableRecipePayload): { status: IntegrityStatus; provided: string | null; calculated: string } {
  const calculated = recipeChecksum(payload);
  if (!isPlainObject(integrity)) return { status: "missing", provided: null, calculated };
  if (integrity.algorithm !== "sha256") return { status: "unsupported", provided: typeof integrity.checksum === "string" ? integrity.checksum : null, calculated };
  if (typeof integrity.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(integrity.checksum)) return { status: "malformed", provided: typeof integrity.checksum === "string" ? integrity.checksum : null, calculated };
  return { status: integrity.checksum.toLowerCase() === calculated ? "valid" : "mismatched", provided: integrity.checksum, calculated };
}

function versionIsNewer(source: string | null) {
  if (!source) return false;
  const parse = (value: string) => value.replace(/^v/, "").split(".").map((part) => Number(part) || 0);
  const left = parse(source); const right = parse(APP_VERSION_NUMBER);
  for (let index = 0; index < 3; index += 1) { if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0); }
  return false;
}

function makeCandidate(input: { raw: unknown; integrity: unknown; index: number; formatVersion: number; appVersion: string | null; migrationSteps?: string[]; scanSource?: unknown }): ImportCandidate {
  const adaptations: ImportAdaptation[] = [];
  const unsupported: CompatibilityItem[] = [];
  let portable: PortableRecipePayload;
  let normalizedRecipe: MixRecipeDocument | null = null;
  let errors: RecipeValidationMessage[] = [];
  let warnings: RecipeValidationMessage[] = [];
  try {
    portable = portableFromUnknown(input.raw, adaptations, unsupported);
    const result = validateRecipe(internalDocumentFromPortable(portable));
    normalizedRecipe = result.normalizedRecipe;
    errors = result.errors;
    warnings = result.warnings;
  } catch (error) {
    portable = {
      recipeVersion: 1, name: isPlainObject(input.raw) && typeof input.raw.name === "string" ? input.raw.name : "Invalid recipe", description: null, category: "Custom", artwork: { included: false, reference: null },
      permissions: [], dependencies: [], compatibility: { minMixarrVersion: "2.3.8", maxMixarrVersion: "2.x", recipeSchemaVersion: 3 }, signature: null,
      settings: { scoring: recipeScoringSchema.parse({}), targets: recipeTargetsSchema.parse({}), bpmFlow: recipeBpmFlowSchema.parse({}), discovery: recipeDiscoverySchema.parse({}), variety: recipeVarietySchema.parse({}), playlistIdentity: recipeIdentityDefaultsSchema.parse({}), refreshPolicy: recipeRefreshPolicySchema.parse({}), automationPolicy: (() => { const { libraryId: _id, ...value } = recipeAutomationPolicySchema.parse({}); return value; })(), generation: portableGeneration({ generation: playlistConfigSchema.parse({}) } as MixRecipeDocument) },
    };
    errors = [{ path: "recipe", code: (error as Error & { code?: string }).code || "invalid_recipe_schema", message: error instanceof Error ? error.message : "Invalid recipe schema." }];
  }
  const integrity = integrityStatus(input.integrity, portable);
  const scan = scanSensitiveData(input.scanSource ?? input.raw);
  errors.push(...scanForbiddenRecipeActions(input.scanSource ?? input.raw).map((item) => ({ path: item.path, code: item.code, message: item.message, severity: "error" as const })));
  if (integrity.status === "mismatched" || integrity.status === "malformed" || integrity.status === "unsupported") errors.push({ path: "integrity", code: `checksum_${integrity.status}`, message: integrity.status === "mismatched" ? "The recipe checksum does not match its content." : integrity.status === "unsupported" ? "The checksum algorithm is unsupported." : "The checksum is malformed." });
  if (!scan.safe) errors.push({ path: "security", code: "sensitive_data_detected", message: "Import blocked because private or server-specific data was detected." });
  if (integrity.status === "missing") warnings.push({ path: "integrity", code: "checksum_missing", message: "This older export has no checksum. Review it carefully before importing." });
  const compatibility: CompatibilityItem[] = [];
  const ignored = unsupported.filter((item) => item.classification === "ignored_safely");
  const trulyUnsupported = unsupported.filter((item) => item.classification === "unsupported");
  if (versionIsNewer(input.appVersion)) trulyUnsupported.push({ path: "exportedBy.applicationVersion", classification: "unsupported", message: `This recipe was exported by Mixarr ${input.appVersion}, which is newer than ${APP_VERSION_NUMBER}.` });
  const totalLeaves = countLeaves(portable.settings);
  const unavailableLeaves = adaptations.length + unsupported.length;
  compatibility.push({ path: "settings", classification: "compatible", message: `${Math.max(0, totalLeaves - unavailableLeaves)} portable settings are compatible.` });
  adaptations.forEach((item) => compatibility.push({ path: item.path, classification: "adaptable", message: item.reason }));
  compatibility.push(...unsupported);
  const candidate: ImportCandidate = {
    index: input.index, portable, sourceRecipeVersion: portable.recipeVersion, sourceFormatVersion: input.formatVersion,
    exportingApplicationVersion: input.appVersion, checksumStatus: integrity.status, providedChecksum: integrity.provided,
    calculatedChecksum: integrity.calculated, contentChecksum: recipeContentChecksum(portable), scan, normalizedRecipe,
    validationErrors: errors, validationWarnings: warnings, migrationSteps: input.migrationSteps || [], compatibility, adaptations,
    unsupported: trulyUnsupported, ignored, conflicts: [], summary: summarizePortableRecipe(portable), proposedName: portable.name,
    recommendedAction: errors.length ? "skip" : "import",
  };
  return candidate;
}

function legacyPortable(raw: Record<string, unknown>) {
  if (raw.format === "mixarr-recipe" && Number.isInteger(raw.schemaVersion)) {
    const result = validateRecipe(raw);
    if (!result.normalizedRecipe) throw new Error(result.errors[0]?.message || "Invalid legacy recipe.");
    return portableRecipePayloadFromDocument(result.normalizedRecipe);
  }
  const filters = isPlainObject(raw.filters) ? raw.filters : {};
  const document = {
    format: "mixarr-recipe", schemaVersion: 0, name: raw.name, description: raw.description, category: raw.category,
    filters: { ...filters, serverId: null, libraryId: null, pinnedTrackIds: [], excludedTrackIds: [] },
  };
  const result = validateRecipe(document);
  if (!result.normalizedRecipe) throw new Error(result.errors[0]?.message || "Invalid legacy recipe.");
  return portableRecipePayloadFromDocument(result.normalizedRecipe);
}

export function parseTransferJson(input: string | Record<string, unknown>, totalBytes?: number): ParsedTransfer {
  const sourceText = typeof input === "string" ? input : JSON.stringify(input);
  if (Buffer.byteLength(sourceText, "utf8") > MAX_RECIPE_JSON_BYTES) throw Object.assign(new Error("Recipe import file is too large."), { code: "FILE_TOO_LARGE" });
  let payload: unknown;
  try { payload = typeof input === "string" ? parseJsonRejectingDuplicateKeys(input) : input; } catch (error) { if ((error as any)?.code === "DUPLICATE_JSON_KEY") throw error; throw Object.assign(new Error("The recipe file is not valid JSON."), { code: "INVALID_JSON" }); }
  if (!isPlainObject(payload)) throw Object.assign(new Error("The recipe export must be a JSON object."), { code: "UNSUPPORTED_FORMAT" });
  const sourceDigest = sha256(sourceText);
  if (payload.format === RECIPE_EXPORT_FORMAT && payload.formatVersion != null) {
    const formatVersion = Number(payload.formatVersion);
    if (formatVersion !== RECIPE_EXPORT_FORMAT_VERSION) throw Object.assign(new Error(`Recipe export format v${formatVersion} is not supported.`), { code: "UNSUPPORTED_FORMAT_VERSION" });
    const appVersion = isPlainObject(payload.exportedBy) && typeof payload.exportedBy.applicationVersion === "string" ? payload.exportedBy.applicationVersion : null;
    return { format: RECIPE_EXPORT_FORMAT, formatVersion, exportingApplicationVersion: appVersion, exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : null, bundleChecksumStatus: null, sourceDigest, totalBytes: totalBytes ?? Buffer.byteLength(sourceText), archive: false, candidates: [makeCandidate({ raw: payload.recipe, integrity: payload.integrity, index: 0, formatVersion, appVersion, scanSource: payload.recipe })] };
  }
  if (payload.format === RECIPE_BUNDLE_FORMAT) {
    const formatVersion = Number(payload.formatVersion);
    if (formatVersion !== RECIPE_EXPORT_FORMAT_VERSION) throw Object.assign(new Error(`Recipe bundle format v${formatVersion} is not supported.`), { code: "UNSUPPORTED_FORMAT_VERSION" });
    if (!Array.isArray(payload.recipes) || payload.recipes.length === 0) throw Object.assign(new Error("No recipes were found in the bundle."), { code: "NO_RECIPES_FOUND" });
    if (payload.recipes.length > 100) throw Object.assign(new Error("Recipe bundle contains too many recipes."), { code: "FILE_TOO_LARGE" });
    const appVersion = isPlainObject(payload.exportedBy) && typeof payload.exportedBy.applicationVersion === "string" ? payload.exportedBy.applicationVersion : null;
    const entries = payload.recipes.map((entry) => isPlainObject(entry) ? entry : {});
    let bundleStatus: IntegrityStatus = "missing";
    if (isPlainObject(payload.integrity)) {
      if (payload.integrity.algorithm !== "sha256") bundleStatus = "unsupported";
      else if (typeof payload.integrity.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(payload.integrity.checksum)) bundleStatus = "malformed";
      else bundleStatus = payload.integrity.checksum.toLowerCase() === sha256(canonicalize(entries)) ? "valid" : "mismatched";
    }
    const candidates = entries.map((entry, index) => { const { integrity, ...recipe } = entry; return makeCandidate({ raw: recipe, integrity, index, formatVersion, appVersion, scanSource: recipe }); });
    if (["mismatched", "malformed", "unsupported"].includes(bundleStatus)) candidates.forEach((candidate) => candidate.validationErrors.push({ path: "bundle.integrity", code: `checksum_${bundleStatus}`, message: "The bundle checksum could not be validated." }));
    return { format: RECIPE_BUNDLE_FORMAT, formatVersion, exportingApplicationVersion: appVersion, exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : null, bundleChecksumStatus: bundleStatus, sourceDigest, totalBytes: totalBytes ?? Buffer.byteLength(sourceText), archive: false, candidates };
  }
  if (payload.format === "mixarr-recipe" && Number.isInteger(payload.schemaVersion)) {
    const portable = legacyPortable(payload);
    return { format: "mixarr-recipe-legacy", formatVersion: Number(payload.schemaVersion), exportingApplicationVersion: null, exportedAt: null, bundleChecksumStatus: null, sourceDigest, totalBytes: totalBytes ?? Buffer.byteLength(sourceText), archive: false, candidates: [makeCandidate({ raw: portable, integrity: null, index: 0, formatVersion: 0, appVersion: null, migrationSteps: ["Converted the v2.3.0 canonical recipe document to export format v1."], scanSource: payload })] };
  }
  if ((payload.format === "mixarr.recipe" || payload.format === "mixarr.recipes") && Number(payload.formatVersion) === 1) {
    const rawItems = payload.format === "mixarr.recipe" ? [payload.recipe] : Array.isArray(payload.recipes) ? payload.recipes : [];
    const candidates = rawItems.map((item, index) => {
      const source = isPlainObject(item) ? item : {};
      const portable = legacyPortable(source);
      return makeCandidate({ raw: portable, integrity: null, index, formatVersion: 0, appVersion: typeof payload.mixarrVersion === "string" ? payload.mixarrVersion : null, migrationSteps: ["Converted the legacy Mixarr recipe export to export format v1."], scanSource: source });
    });
    return { format: String(payload.format), formatVersion: 0, exportingApplicationVersion: typeof payload.mixarrVersion === "string" ? payload.mixarrVersion : null, exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : null, bundleChecksumStatus: null, sourceDigest, totalBytes: totalBytes ?? Buffer.byteLength(sourceText), archive: false, candidates };
  }
  throw Object.assign(new Error("This is not a supported Mixarr recipe export."), { code: "UNSUPPORTED_FORMAT" });
}

export function addConflictAnalysis(parsed: ParsedTransfer, existing: ExistingPortableRecipe[]) {
  const usedNames = existing.map((item) => item.name);
  const bundleNames = new Map<string, number>();
  const bundleContent = new Map<string, number>();
  for (const candidate of parsed.candidates) {
    const normalizedName = normalizedRecipeName(candidate.portable.name);
    const exact = existing.find((item) => item.name === candidate.portable.name);
    const normalized = existing.find((item) => normalizedRecipeName(item.name) === normalizedName);
    const identical = existing.find((item) => item.checksum === candidate.calculatedChecksum);
    const equivalent = existing.find((item) => item.contentChecksum === candidate.contentChecksum);
    if (identical) candidate.conflicts.push({ type: "identical_checksum", existingRecipeId: identical.id, existingRecipeName: identical.name, message: `Identical recipe content already exists as "${identical.name}".`, allowedActions: ["use_existing", "rename", "skip"], recommendedAction: "use_existing" });
    else if (equivalent) candidate.conflicts.push({ type: "equivalent_content", existingRecipeId: equivalent.id, existingRecipeName: equivalent.name, message: `Equivalent portable settings already exist as "${equivalent.name}".`, allowedActions: ["use_existing", "rename", "skip"], recommendedAction: "use_existing" });
    if (exact) candidate.conflicts.push({ type: "exact_name", existingRecipeId: exact.id, existingRecipeName: exact.name, message: `A recipe named "${exact.name}" already exists.`, allowedActions: ["rename", "replace", "skip"], recommendedAction: identical ? "use_existing" : "rename" });
    else if (normalized) candidate.conflicts.push({ type: "normalized_name", existingRecipeId: normalized.id, existingRecipeName: normalized.name, message: `A recipe with the same normalized name exists as "${normalized.name}".`, allowedActions: ["rename", "replace", "skip"], recommendedAction: "rename" });
    if (bundleNames.has(normalizedName)) candidate.conflicts.push({ type: "bundle_name", message: "Another recipe in this bundle has the same normalized name.", allowedActions: ["rename", "skip"], recommendedAction: "rename" });
    if (bundleContent.has(candidate.contentChecksum)) candidate.conflicts.push({ type: "bundle_content", message: "Another recipe in this bundle has identical portable settings.", allowedActions: ["skip", "rename"], recommendedAction: "skip" });
    bundleNames.set(normalizedName, candidate.index); bundleContent.set(candidate.contentChecksum, candidate.index);
    if (candidate.conflicts.length) {
      const preferred = candidate.conflicts.find((item) => item.type === "identical_checksum")?.recommendedAction || candidate.conflicts[0].recommendedAction;
      candidate.recommendedAction = preferred;
      if (preferred === "rename") candidate.proposedName = safeImportedName(candidate.portable.name, usedNames);
    }
    usedNames.push(candidate.proposedName);
  }
  return parsed;
}

export function redactBlockedCandidates(parsed: ParsedTransfer) {
  for (const candidate of parsed.candidates) {
    if (candidate.scan.safe) continue;
    const redacted = portableRecipePayloadFromDocument(defaultMixRecipeDocument({ name: "Blocked recipe", description: null, category: "Custom" }, {}));
    candidate.portable = redacted;
    candidate.normalizedRecipe = null;
    candidate.contentChecksum = recipeContentChecksum(redacted);
    candidate.summary = { ...summarizePortableRecipe(redacted), title: "Blocked recipe" };
    candidate.artworkDataBase64 = null;
    candidate.artworkMimeType = null;
    candidate.adaptations = [];
    candidate.compatibility = [];
    candidate.unsupported = [];
    candidate.ignored = [];
    candidate.conflicts = [];
    candidate.proposedName = "Blocked recipe";
    candidate.recommendedAction = "skip";
    candidate.validationErrors = [{ path: "security", code: "sensitive_data_detected", message: "Import blocked because private or server-specific data was detected. Sensitive values were not stored." }];
  }
  return parsed;
}

export function publicImportPreview(parsed: ParsedTransfer) {
  const recipes = parsed.candidates.map((candidate) => ({
    index: candidate.index,
    name: candidate.portable.name,
    description: candidate.portable.description,
    category: candidate.portable.category,
    artwork: candidate.portable.artwork,
    sourceFormatVersion: candidate.sourceFormatVersion,
    sourceRecipeVersion: candidate.sourceRecipeVersion,
    exportingApplicationVersion: candidate.exportingApplicationVersion,
    checksumStatus: candidate.checksumStatus,
    sensitiveDataScan: { safe: candidate.scan.safe, findingCount: candidate.scan.findingCount, categories: candidate.scan.categories },
    compatibleSettings: Number(candidate.compatibility.find((item) => item.classification === "compatible")?.message.match(/^\d+/)?.[0] || 0),
    compatibility: candidate.compatibility,
    adaptations: candidate.adaptations,
    unsupported: candidate.unsupported,
    ignored: candidate.ignored,
    validationErrors: candidate.validationErrors,
    validationWarnings: candidate.validationWarnings,
    migrationSteps: candidate.migrationSteps,
    conflicts: candidate.conflicts,
    proposedName: candidate.proposedName,
    recommendedAction: candidate.recommendedAction,
    summary: candidate.summary,
    adaptiveAnalysis: candidate.adaptiveAnalysis || null,
    governance: candidate.governance || null,
    ready: candidate.validationErrors.length === 0,
  }));
  return {
    format: parsed.format,
    formatVersion: parsed.formatVersion,
    exportingApplicationVersion: parsed.exportingApplicationVersion,
    exportedAt: parsed.exportedAt,
    bundleChecksumStatus: parsed.bundleChecksumStatus,
    totalRecipes: recipes.length,
    ready: recipes.filter((item) => item.ready && item.adaptations.length === 0 && item.conflicts.length === 0).length,
    requireAdaptation: recipes.filter((item) => item.ready && item.adaptations.length > 0).length,
    haveConflicts: recipes.filter((item) => item.conflicts.length > 0).length,
    invalid: recipes.filter((item) => !item.ready).length,
    duplicateContentMatches: recipes.filter((item) => item.conflicts.some((conflict) => ["identical_checksum", "equivalent_content", "bundle_content"].includes(conflict.type))).length,
    artworkCount: recipes.filter((item) => item.artwork.included).length,
    totalImportSize: parsed.totalBytes,
    securityStatus: recipes.every((item) => item.sensitiveDataScan.safe) ? "No credentials or library identifiers detected." : "Import blocked because private server configuration was detected.",
    recipes,
  };
}

export function diagnosticForTransfer(parsed: ParsedTransfer, status: string, result?: unknown) {
  const diagnostic = {
    notice: "This diagnostic file has been sanitized, but you should still review it before sharing.",
    mixarrApplicationVersion: APP_VERSION,
    importFormat: parsed.format,
    formatVersion: parsed.formatVersion,
    bundleChecksumStatus: parsed.bundleChecksumStatus,
    status,
    recipeCount: parsed.candidates.length,
    recipes: parsed.candidates.map((candidate) => ({
      name: candidate.scan.safe ? candidate.portable.name : "[redacted]",
      recipeVersion: candidate.sourceRecipeVersion,
      checksumStatus: candidate.checksumStatus,
      validationErrors: candidate.validationErrors.map(({ code, message }) => ({ code, message })),
      validationWarnings: candidate.validationWarnings.map(({ code, message }) => ({ code, message })),
      compatibility: candidate.compatibility.map(({ path, classification, message }) => ({ path, classification, message })),
      adaptations: candidate.adaptations.map(({ path, reason, impact, required }) => ({ path, reason, impact, required })),
      conflicts: candidate.conflicts.map(({ type, message, recommendedAction }) => ({ type, message, recommendedAction })),
      sensitiveDataScan: { safe: candidate.scan.safe, categories: candidate.scan.categories },
      summary: candidate.scan.safe ? candidate.summary : { title: "[redacted]", category: "[redacted]" },
      governance: candidate.governance ? { trustState: candidate.governance.trustState, signature: candidate.governance.signature.status, official: candidate.governance.official, risk: candidate.governance.risk, quarantine: candidate.governance.quarantine, compatibility: candidate.governance.compatibility, permissions: candidate.governance.permissions, dependencies: candidate.governance.dependencies, safetyAdjustments: candidate.governance.safetyAdjustments, planHash: candidate.governance.planHash } : null,
    })),
    result,
  };
  const scan = scanSensitiveData(diagnostic);
  if (!scan.safe) throw new Error("Diagnostic sanitization failed.");
  return diagnostic;
}
