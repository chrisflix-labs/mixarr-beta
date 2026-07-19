import { ZodError } from "zod";
import { CURRENT_RECIPE_SCHEMA_VERSION, mixRecipeDocumentSchema, type MixRecipeDocument } from "./schema";
import { migrateRecipeDocument } from "./migration";

export type RecipeValidationMessage = { path: string; code: string; message: string };
export type RecipeValidationResult = {
  valid: boolean;
  normalizedRecipe: MixRecipeDocument | null;
  errors: RecipeValidationMessage[];
  warnings: RecipeValidationMessage[];
};

export function validateRecipe(input: unknown): RecipeValidationResult {
  const errors: RecipeValidationMessage[] = [];
  const warnings: RecipeValidationMessage[] = [];
  let migrated: ReturnType<typeof migrateRecipeDocument>;
  try {
    migrated = migrateRecipeDocument(input);
    warnings.push(...migrated.warnings.map((item) => ({ path: "schemaVersion", code: item.code, message: item.message })));
  } catch (error) {
    if (error instanceof ZodError) {
      errors.push(...error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })));
    } else {
      errors.push({ path: "schemaVersion", code: "migration_failed", message: error instanceof Error ? error.message : "Recipe migration failed." });
    }
    return { valid: false, normalizedRecipe: null, errors, warnings };
  }
  const parsed = mixRecipeDocumentSchema.safeParse(migrated.recipe);
  if (!parsed.success) {
    errors.push(...parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })));
    return { valid: false, normalizedRecipe: null, errors, warnings };
  }
  const recipe = parsed.data;
  if ((recipe.bpmFlow.minimumBpm ?? -Infinity) > (recipe.bpmFlow.maximumBpm ?? Infinity)) errors.push({ path: "bpmFlow.minimumBpm", code: "invalid_bpm_range", message: "Minimum BPM cannot be higher than maximum BPM." });
  if ((recipe.targets.minimumEnergy ?? -Infinity) > (recipe.targets.maximumEnergy ?? Infinity)) errors.push({ path: "targets.minimumEnergy", code: "invalid_energy_range", message: "Minimum energy cannot be higher than maximum energy." });
  if (recipe.targets.strictMoodMatching && recipe.targets.selectedMoods.length === 0) errors.push({ path: "targets.selectedMoods", code: "moods_required", message: "Select at least one mood when strict mood matching is enabled." });
  if (recipe.refreshPolicy.mode === "scheduled" && !recipe.refreshPolicy.frequencyDays) errors.push({ path: "refreshPolicy.frequencyDays", code: "interval_required", message: "Scheduled refresh requires a valid frequency." });
  if (recipe.refreshPolicy.minimumReplacements > recipe.refreshPolicy.maximumReplacements) errors.push({ path: "refreshPolicy.minimumReplacements", code: "invalid_replacement_range", message: "Minimum replacements cannot exceed maximum replacements." });
  if (!["stable-v2", "experimental-balanced"].includes(recipe.scoring.scoringModel)) errors.push({ path: "scoring.scoringModel", code: "unsupported_scoring_model", message: `Scoring model "${recipe.scoring.scoringModel}" is not supported.` });
  if (recipe.automationPolicy.enabled && !recipe.automationPolicy.libraryId && !recipe.generation.libraryId) errors.push({ path: "automationPolicy.libraryId", code: "library_required", message: "Automation requires a target library." });
  if (recipe.automationPolicy.enabled) warnings.push({ path: "automationPolicy.enabled", code: "confirmation_required", message: "Automation will remain inactive until explicitly confirmed for a generated playlist." });
  if (!recipe.metadata.description) warnings.push({ path: "metadata.description", code: "description_missing", message: "Add a description to make this recipe easier to recognize." });
  if (!recipe.metadata.artworkUrl) warnings.push({ path: "metadata.artworkUrl", code: "artwork_fallback", message: `Category artwork will be used for this ${recipe.metadata.category} recipe.` });
  if (recipe.schemaVersion !== CURRENT_RECIPE_SCHEMA_VERSION) errors.push({ path: "schemaVersion", code: "unsupported_schema", message: `Schema v${recipe.schemaVersion} is not supported.` });
  return { valid: errors.length === 0, normalizedRecipe: errors.length === 0 ? recipe : null, errors, warnings };
}
