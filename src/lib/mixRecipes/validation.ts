import { ZodError } from "zod";
import { CURRENT_RECIPE_SCHEMA_VERSION, mixRecipeDocumentSchema, type MixRecipeDocument } from "./schema";
import { migrateRecipeDocument } from "./migration";
import { analyzeImpossibleRequirements, evaluateRecipeCompatibility, scanForbiddenRecipeActions } from "./governance";
import { SCORING_MODELS } from "../scoringModelCatalog";

export type RecipeValidationMessage = {
  path: string;
  code: string;
  message: string;
  severity?: "information" | "warning" | "error";
  suggestedValue?: unknown;
  receivedValue?: unknown;
  supportedValues?: readonly string[];
};
export type RecipeValidationResult = {
  valid: boolean;
  normalizedRecipe: MixRecipeDocument | null;
  errors: RecipeValidationMessage[];
  warnings: RecipeValidationMessage[];
};

function valueAtPath(input: unknown, path: PropertyKey[]) {
  return path.reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<PropertyKey, unknown>)[key];
  }, input);
}

function zodMessages(error: ZodError, input: unknown): RecipeValidationMessage[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    if (path === "scoring.scoringModel" || path === "generation.scoringModel") {
      return {
        path,
        code: "RECIPE_SCORING_MODEL_UNSUPPORTED",
        message: "The selected scoring model is not supported.",
        severity: "error" as const,
        receivedValue: valueAtPath(input, issue.path),
        supportedValues: SCORING_MODELS,
      };
    }
    return { path, code: issue.code, message: issue.message, severity: "error" as const };
  });
}

export function validateRecipe(input: unknown): RecipeValidationResult {
  const errors: RecipeValidationMessage[] = [];
  const warnings: RecipeValidationMessage[] = [];
  const forbidden = scanForbiddenRecipeActions(input);
  errors.push(...forbidden.map((item) => ({ path: item.path, code: item.code, message: item.message, severity: "error" as const, ...(item.suggestedValue === undefined ? {} : { suggestedValue: item.suggestedValue }) })));
  let migrated: ReturnType<typeof migrateRecipeDocument>;
  try {
    migrated = migrateRecipeDocument(input);
    warnings.push(...migrated.warnings.map((item) => ({ path: item.path || "schemaVersion", code: item.code, message: item.message, severity: item.severity || "warning" as const, ...(item.replacement ? { suggestedValue: item.replacement } : {}) })));
  } catch (error) {
    if (error instanceof ZodError) {
      errors.push(...zodMessages(error, input));
    } else {
      errors.push({ path: "schemaVersion", code: "migration_failed", message: error instanceof Error ? error.message : "Recipe migration failed.", severity: "error" });
    }
    return { valid: false, normalizedRecipe: null, errors, warnings };
  }
  const parsed = mixRecipeDocumentSchema.safeParse(migrated.recipe);
  if (!parsed.success) {
    errors.push(...zodMessages(parsed.error, migrated.recipe));
    return { valid: false, normalizedRecipe: null, errors, warnings };
  }
  // scoring.scoringModel is the user-facing source. The generation copy is a
  // derived execution field and is always synchronized before persistence.
  const recipe: MixRecipeDocument = parsed.data.generation.scoringModel === parsed.data.scoring.scoringModel
    ? parsed.data
    : {
        ...parsed.data,
        generation: {
          ...parsed.data.generation,
          scoringModel: parsed.data.scoring.scoringModel,
        },
      };
  if ((recipe.bpmFlow.minimumBpm ?? -Infinity) > (recipe.bpmFlow.maximumBpm ?? Infinity)) errors.push({ path: "bpmFlow.minimumBpm", code: "invalid_bpm_range", message: "Minimum BPM cannot be higher than maximum BPM.", severity: "error" });
  if ((recipe.targets.minimumEnergy ?? -Infinity) > (recipe.targets.maximumEnergy ?? Infinity)) errors.push({ path: "targets.minimumEnergy", code: "invalid_energy_range", message: "Minimum energy cannot be higher than maximum energy.", severity: "error" });
  if (recipe.targets.strictMoodMatching && recipe.targets.selectedMoods.length === 0) errors.push({ path: "targets.selectedMoods", code: "moods_required", message: "Select at least one mood when strict mood matching is enabled.", severity: "error" });
  if (recipe.refreshPolicy.mode === "scheduled" && !recipe.refreshPolicy.frequencyDays) errors.push({ path: "refreshPolicy.frequencyDays", code: "interval_required", message: "Scheduled refresh requires a valid frequency.", severity: "error" });
  if (recipe.refreshPolicy.minimumReplacements > recipe.refreshPolicy.maximumReplacements) errors.push({ path: "refreshPolicy.minimumReplacements", code: "invalid_replacement_range", message: "Minimum replacements cannot exceed maximum replacements.", severity: "error" });
  if (recipe.automationPolicy.enabled && !recipe.automationPolicy.libraryId && !recipe.generation.libraryId) errors.push({ path: "automationPolicy.libraryId", code: "library_required", message: "Automation requires a target library.", severity: "error" });
  if (recipe.automationPolicy.enabled) warnings.push({ path: "automationPolicy.enabled", code: "confirmation_required", message: "Automation will remain inactive until explicitly confirmed for a generated playlist.", severity: "warning" });
  if (!recipe.metadata.description) warnings.push({ path: "metadata.description", code: "description_missing", message: "Add a description to make this recipe easier to recognize.", severity: "warning" });
  if (!recipe.metadata.artworkUrl) warnings.push({ path: "metadata.artworkUrl", code: "artwork_fallback", message: `Category artwork will be used for this ${recipe.metadata.category} recipe.`, severity: "warning" });
  if (recipe.schemaVersion !== CURRENT_RECIPE_SCHEMA_VERSION) errors.push({ path: "schemaVersion", code: "unsupported_schema", message: `Schema v${recipe.schemaVersion} is not supported.`, severity: "error" });
  const declared = recipe.permissions.map((item) => item.permission);
  if (new Set(declared).size !== declared.length) errors.push({ path: "permissions", code: "recipe.permission.duplicate", message: "Each requested recipe permission may be declared only once.", severity: "error" });
  const compatibility = evaluateRecipeCompatibility(recipe);
  errors.push(...compatibility.findings.map((item) => ({ path: item.path, code: item.code, message: item.message, severity: "error" as const })));
  errors.push(...analyzeImpossibleRequirements(recipe).filter((item) => item.severity === "error").map((item) => ({ path: item.path, code: item.code, message: item.message, severity: "error" as const, ...(item.suggestedValue === undefined ? {} : { suggestedValue: item.suggestedValue }) })));
  return { valid: errors.length === 0, normalizedRecipe: errors.length === 0 ? recipe : null, errors, warnings };
}
