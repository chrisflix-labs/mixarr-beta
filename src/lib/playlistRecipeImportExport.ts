import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { APP_VERSION } from "./appVersion";
import {
  playlistConfigSchema,
  playlistSafetyRulesSchema,
  type PlaylistConfigInput,
} from "./playlistService";
import {
  playlistRecipeSchema,
  summarizePlaylistRecipeFilters,
  type PlaylistRecipeInput,
} from "./playlistRecipes";

export const MIXARR_RECIPE_FORMAT = "mixarr.recipe";
export const MIXARR_RECIPES_FORMAT = "mixarr.recipes";
export const MIXARR_RECIPE_FORMAT_VERSION = 1;
export const INVALID_RECIPE_EXPORT_MESSAGE = "This does not look like a valid Mixarr recipe export.";
export const UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE = "This recipe export format is newer than this Mixarr version supports.";

export type RecipeConflictStrategy = "rename" | "skip";

type StoredRecipe = {
  id: string;
  name: string;
  description?: string | null;
  filtersJson: Prisma.JsonValue | unknown;
  useCount?: number | null;
  lastUsedAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdFromVersion?: string | null;
};

export type MixarrRecipeExportItem = {
  name: string;
  description: string | null;
  filters: PlaylistConfigInput;
  safetyRules: PlaylistConfigInput["safetyRules"];
  smartPreset: { id?: string; name?: string; version?: string } | null;
  moodPreset: { id?: string; name?: string; version?: string; modified: boolean } | null;
  bpmPreset: { id?: string; name?: string; version?: string; modified: boolean } | null;
  trackLimit: number;
  sortMode: "popularity";
  duplicateControl: PlaylistConfigInput["duplicateStrategy"];
  negativeFilters: PlaylistConfigInput["negativeFilters"];
  exportMetadata?: {
    originalRecipeId?: string;
    originalCreatedFromVersion?: string | null;
    originalCreatedAt?: string | null;
    originalUpdatedAt?: string | null;
    useCount?: number | null;
    lastUsedAt?: string | null;
    omittedLocalFields?: string[];
  };
};

export type MixarrRecipeExport = {
  format: typeof MIXARR_RECIPE_FORMAT;
  formatVersion: typeof MIXARR_RECIPE_FORMAT_VERSION;
  exportedBy: "Mixarr";
  mixarrVersion: string;
  exportedAt: string;
  recipe: MixarrRecipeExportItem;
};

export type MixarrRecipesExport = {
  format: typeof MIXARR_RECIPES_FORMAT;
  formatVersion: typeof MIXARR_RECIPE_FORMAT_VERSION;
  exportedBy: "Mixarr";
  mixarrVersion: string;
  exportedAt: string;
  recipes: MixarrRecipeExportItem[];
};

export type ImportPreviewRecipe = {
  index: number;
  name: string;
  description: string | null;
  filterSummary: string;
  smartPresetName: string | null;
  moodPresetName: string | null;
  bpmPresetName: string | null;
  warnings: string[];
  errors: string[];
  hasConflict: boolean;
  proposedName: string;
};

export type ImportPreview = {
  format: string;
  formatVersion: number;
  recipeCount: number;
  validCount: number;
  invalidCount: number;
  recipes: ImportPreviewRecipe[];
};

export type ImportResult = {
  imported: number;
  renamed: number;
  skipped: number;
  failed: number;
  failures: { index: number; name: string; reason: string }[];
  recipes: PlaylistRecipeInput[];
};

const supportedFormats = [MIXARR_RECIPE_FORMAT, MIXARR_RECIPES_FORMAT];

function isoDate(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function presetOrNull(preset: { id?: string; name?: string; version?: string; modified?: boolean }) {
  return preset.id || preset.name || preset.version
    ? {
        ...(preset.id ? { id: preset.id } : {}),
        ...(preset.name ? { name: preset.name } : {}),
        ...(preset.version ? { version: preset.version } : {}),
        ...(preset.modified == null ? {} : { modified: preset.modified }),
      }
    : null;
}

function sanitizeFiltersForExport(filtersJson: StoredRecipe["filtersJson"]) {
  const filters = playlistConfigSchema.parse(filtersJson);
  const omittedLocalFields: string[] = [];

  if (filters.serverId) omittedLocalFields.push("serverId");
  if (filters.libraryId) omittedLocalFields.push("libraryId");
  if (filters.pinnedTrackIds.length) omittedLocalFields.push("pinnedTrackIds");
  if (filters.excludedTrackIds.length) omittedLocalFields.push("excludedTrackIds");

  return {
    filters: {
      ...filters,
      serverId: null,
      libraryId: null,
      pinnedTrackIds: [],
      excludedTrackIds: [],
    },
    omittedLocalFields,
  };
}

export function buildRecipeExportItem(recipe: StoredRecipe): MixarrRecipeExportItem {
  const { filters, omittedLocalFields } = sanitizeFiltersForExport(recipe.filtersJson);

  return {
    name: recipe.name,
    description: recipe.description || null,
    filters,
    safetyRules: filters.safetyRules,
    smartPreset: presetOrNull({
      id: filters.smartPresetId,
      name: filters.smartPresetName,
      version: filters.smartPresetVersion,
    }) as MixarrRecipeExportItem["smartPreset"],
    moodPreset: presetOrNull({
      id: filters.moodPresetId,
      name: filters.moodPresetName,
      version: filters.moodPresetVersion,
      modified: filters.moodPresetModified,
    }) as MixarrRecipeExportItem["moodPreset"],
    bpmPreset: presetOrNull({
      id: filters.bpmPresetId,
      name: filters.bpmPresetName,
      version: filters.bpmPresetVersion,
      modified: filters.bpmPresetModified,
    }) as MixarrRecipeExportItem["bpmPreset"],
    trackLimit: filters.limit,
    sortMode: "popularity",
    duplicateControl: filters.duplicateStrategy,
    negativeFilters: filters.negativeFilters,
    exportMetadata: {
      originalRecipeId: recipe.id,
      originalCreatedFromVersion: recipe.createdFromVersion || null,
      originalCreatedAt: isoDate(recipe.createdAt),
      originalUpdatedAt: isoDate(recipe.updatedAt),
      useCount: recipe.useCount ?? null,
      lastUsedAt: isoDate(recipe.lastUsedAt),
      omittedLocalFields,
    },
  };
}

export function buildSingleRecipeExport(recipe: StoredRecipe, exportedAt = new Date()): MixarrRecipeExport {
  return {
    format: MIXARR_RECIPE_FORMAT,
    formatVersion: MIXARR_RECIPE_FORMAT_VERSION,
    exportedBy: "Mixarr",
    mixarrVersion: APP_VERSION,
    exportedAt: exportedAt.toISOString(),
    recipe: buildRecipeExportItem(recipe),
  };
}

export function buildRecipesExport(recipes: StoredRecipe[], exportedAt = new Date()): MixarrRecipesExport {
  return {
    format: MIXARR_RECIPES_FORMAT,
    formatVersion: MIXARR_RECIPE_FORMAT_VERSION,
    exportedBy: "Mixarr",
    mixarrVersion: APP_VERSION,
    exportedAt: exportedAt.toISOString(),
    recipes: recipes.map(buildRecipeExportItem),
  };
}

export function sanitizeRecipeFilename(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "recipe";
}

export function importedRecipeName(originalName: string, existingNames: string[]) {
  const usedNames = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  const trimmed = originalName.trim();
  const baseName = `${trimmed} Imported`;

  if (!usedNames.has(baseName.toLowerCase())) return baseName;

  for (let copyNumber = 2; copyNumber < 1000; copyNumber += 1) {
    const candidate = `${baseName} ${copyNumber}`;
    if (!usedNames.has(candidate.toLowerCase())) return candidate;
  }

  return `${baseName} ${Date.now()}`;
}

function parseImportContent(content: unknown) {
  if (typeof content !== "string") return content;

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(INVALID_RECIPE_EXPORT_MESSAGE);
  }
}

function extractRecipeItems(content: unknown): { format: string; formatVersion: number; items: unknown[] } {
  const payload = parseImportContent(content);
  const base = z.object({
    format: z.string(),
    formatVersion: z.number().int(),
  }).passthrough().safeParse(payload);

  if (!base.success || !supportedFormats.includes(base.data.format)) {
    throw new Error(INVALID_RECIPE_EXPORT_MESSAGE);
  }

  if (base.data.formatVersion > MIXARR_RECIPE_FORMAT_VERSION) {
    throw new Error(UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE);
  }

  if (base.data.formatVersion < 1) {
    throw new Error(INVALID_RECIPE_EXPORT_MESSAGE);
  }

  const container = payload as any;
  if (base.data.format === MIXARR_RECIPE_FORMAT) {
    return {
      format: base.data.format,
      formatVersion: base.data.formatVersion,
      items: [container.recipe],
    };
  }

  if (!Array.isArray(container.recipes)) {
    throw new Error(INVALID_RECIPE_EXPORT_MESSAGE);
  }

  return {
    format: base.data.format,
    formatVersion: base.data.formatVersion,
      items: container.recipes as unknown[],
  };
}

function applyPresetMetadata(filters: Record<string, unknown>, recipe: any) {
  const smartPreset = recipe?.smartPreset || {};
  const moodPreset = recipe?.moodPreset || {};
  const bpmPreset = recipe?.bpmPreset || {};

  return {
    ...filters,
    safetyRules: filters.safetyRules ?? recipe?.safetyRules ?? {},
    smartPresetId: filters.smartPresetId ?? smartPreset.id,
    smartPresetName: filters.smartPresetName ?? smartPreset.name,
    smartPresetVersion: filters.smartPresetVersion ?? smartPreset.version,
    moodPresetId: filters.moodPresetId ?? moodPreset.id,
    moodPresetName: filters.moodPresetName ?? moodPreset.name,
    moodPresetVersion: filters.moodPresetVersion ?? moodPreset.version,
    moodPresetModified: filters.moodPresetModified ?? moodPreset.modified ?? false,
    bpmPresetId: filters.bpmPresetId ?? bpmPreset.id,
    bpmPresetName: filters.bpmPresetName ?? bpmPreset.name,
    bpmPresetVersion: filters.bpmPresetVersion ?? bpmPreset.version,
    bpmPresetModified: filters.bpmPresetModified ?? bpmPreset.modified ?? false,
  };
}

function normalizeImportedRecipe(rawRecipe: unknown) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recipe = rawRecipe && typeof rawRecipe === "object" ? rawRecipe as any : {};
  const name = typeof recipe.name === "string" ? recipe.name.trim() : "";
  const description = typeof recipe.description === "string" ? recipe.description.trim() : null;

  if (!name) errors.push("Missing name");

  let filters: PlaylistConfigInput | null = null;
  if (!recipe.filters || typeof recipe.filters !== "object" || Array.isArray(recipe.filters)) {
    errors.push("Invalid filters");
  } else {
    try {
      const candidate = applyPresetMetadata(recipe.filters, recipe);
      filters = playlistConfigSchema.parse({
        ...candidate,
        serverId: null,
        libraryId: null,
        pinnedTrackIds: [],
        excludedTrackIds: [],
        safetyRules: playlistSafetyRulesSchema.parse(candidate.safetyRules || {}),
      });
    } catch {
      errors.push("Invalid filters");
    }
  }

  if (Array.isArray(recipe.exportMetadata?.omittedLocalFields) && recipe.exportMetadata.omittedLocalFields.length > 0) {
    warnings.push("Local library or track selections from the source install were not imported.");
  }

  if (errors.length > 0 || !filters) {
    return {
      input: null,
      preview: {
        name: name || "(Missing name)",
        description,
        filterSummary: "",
        smartPresetName: null,
        moodPresetName: null,
        bpmPresetName: null,
        warnings,
        errors,
      },
    };
  }

  const parsed = playlistRecipeSchema.parse({
    name,
    description,
    filters,
  });

  return {
    input: parsed,
    preview: {
      name: parsed.name,
      description: parsed.description || null,
      filterSummary: summarizePlaylistRecipeFilters(parsed.filters),
      smartPresetName: parsed.filters.smartPresetName || null,
      moodPresetName: parsed.filters.moodPresetName || null,
      bpmPresetName: parsed.filters.bpmPresetName || null,
      warnings,
      errors,
    },
  };
}

export function buildImportPreview(content: unknown, existingNames: string[] = []): ImportPreview {
  const extracted = extractRecipeItems(content);
  const usedNames = [...existingNames];
  const recipes = extracted.items.map((item, index) => {
    const normalized = normalizeImportedRecipe(item);
    const name = normalized.input?.name || normalized.preview.name;
    const hasConflict = Boolean(normalized.input && usedNames.some((existingName) => existingName.trim().toLowerCase() === name.trim().toLowerCase()));
    const proposedName = hasConflict ? importedRecipeName(name, usedNames) : name;
    if (normalized.input) usedNames.push(proposedName);

    return {
      index,
      ...normalized.preview,
      hasConflict,
      proposedName,
    };
  });

  return {
    format: extracted.format,
    formatVersion: extracted.formatVersion,
    recipeCount: recipes.length,
    validCount: recipes.filter((recipe) => recipe.errors.length === 0).length,
    invalidCount: recipes.filter((recipe) => recipe.errors.length > 0).length,
    recipes,
  };
}

export function prepareImportedRecipes(
  content: unknown,
  existingNames: string[] = [],
  conflictStrategy: RecipeConflictStrategy = "rename",
): ImportResult {
  const extracted = extractRecipeItems(content);
  const usedNames = [...existingNames];
  const result: ImportResult = {
    imported: 0,
    renamed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    recipes: [],
  };

  extracted.items.forEach((item, index) => {
    const normalized = normalizeImportedRecipe(item);
    const input = normalized.input;
    const name = input?.name || normalized.preview.name;

    if (!input) {
      result.failed += 1;
      result.failures.push({ index, name, reason: normalized.preview.errors.join(", ") || "Invalid recipe" });
      return;
    }

    const hasConflict = usedNames.some((existingName) => existingName.trim().toLowerCase() === input.name.trim().toLowerCase());
    if (hasConflict && conflictStrategy === "skip") {
      result.skipped += 1;
      result.failures.push({ index, name: input.name, reason: "Duplicate skipped" });
      return;
    }

    const finalName = hasConflict ? importedRecipeName(input.name, usedNames) : input.name;
    if (finalName !== input.name) result.renamed += 1;
    usedNames.push(finalName);
    result.recipes.push({ ...input, name: finalName });
    result.imported += 1;
  });

  return result;
}
