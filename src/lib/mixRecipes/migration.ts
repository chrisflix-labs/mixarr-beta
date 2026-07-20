import { CURRENT_RECIPE_SCHEMA_VERSION, defaultMixRecipeDocument, mixRecipeDocumentSchema, type MixRecipeDocument } from "./schema";

export type RecipeMigrationWarning = { code: string; message: string; path?: string; replacement?: string; deprecatedSince?: string; removalVersion?: string | null; migrationAvailable?: boolean; severity?: "information" | "warning" | "error" };
export type RecipeMigrationResult = { recipe: MixRecipeDocument; fromVersion: number; toVersion: number; migrated: boolean; warnings: RecipeMigrationWarning[] };

type Migration = (source: Record<string, any>) => { value: Record<string, any>; warnings?: RecipeMigrationWarning[] };

const migrations = new Map<number, Migration>([
  [0, (source) => ({
    value: { ...defaultMixRecipeDocument({
      name: String(source.name || source.metadata?.name || "Imported Recipe"),
      description: source.description || source.metadata?.description || null,
      category: source.category || source.metadata?.category || "Custom",
      artworkUrl: source.artworkUrl || source.metadata?.artworkUrl || null,
    }, source.filters || source.generation || {}), schemaVersion: 1 },
    warnings: [{ code: "legacy_recipe_migrated", message: "Legacy saved builder filters were migrated to recipe schema v1." }],
  })],
  [1, (source) => ({
    value: {
      ...source,
      schemaVersion: 2,
      permissions: Array.isArray(source.permissions) ? source.permissions : [],
      dependencies: Array.isArray(source.dependencies) ? source.dependencies : [],
      compatibility: source.compatibility || { minMixarrVersion: "2.3.8", maxMixarrVersion: "2.x", recipeSchemaVersion: 2 },
    },
    warnings: [{ code: "recipe.permissions.inferred", message: "This legacy recipe has no explicit permission declaration; permissions will be inferred and require review." }],
  })],
  [2, (source) => ({
    value: {
      ...source,
      schemaVersion: 3,
      compatibility: { ...(source.compatibility || {}), recipeSchemaVersion: 3 },
      signature: source.signature || null,
    },
    warnings: [{ code: "recipe.schema.migrated_v3", message: "The recipe was normalized to the v3 safety and signature schema." }],
  })],
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function normalizeDeprecatedFields(source: Record<string, any>) {
  const value = clone(source);
  const warnings: RecipeMigrationWarning[] = [];
  const automation = value.automationPolicy;
  if (automation && typeof automation === "object" && Object.prototype.hasOwnProperty.call(automation, "autoRegenerate")) {
    if (automation.enabled == null) automation.enabled = Boolean(automation.autoRegenerate);
    delete automation.autoRegenerate;
    warnings.push({ code: "recipe.field.deprecated", path: "automationPolicy.autoRegenerate", replacement: "automationPolicy.enabled", deprecatedSince: "2.3.0", removalVersion: "3.0.0", migrationAvailable: true, severity: "warning", message: "automationPolicy.autoRegenerate is deprecated and was migrated to automationPolicy.enabled; inferred automation permissions require review." });
  }
  if (value.automation && typeof value.automation === "object" && Object.prototype.hasOwnProperty.call(value.automation, "auto_regenerate")) {
    value.automationPolicy = { ...(value.automationPolicy || {}), enabled: value.automationPolicy?.enabled ?? Boolean(value.automation.auto_regenerate), requireExplicitConfirmation: true };
    delete value.automation.auto_regenerate;
    if (!Object.keys(value.automation).length) delete value.automation;
    warnings.push({ code: "recipe.field.deprecated", path: "automation.auto_regenerate", replacement: "automationPolicy.enabled", deprecatedSince: "2.3.0", removalVersion: "3.0.0", migrationAvailable: true, severity: "warning", message: "automation.auto_regenerate is deprecated and was migrated to explicit automation policy; local approval is required." });
  }
  return { value, warnings };
}

export function migrateRecipeDocument(input: unknown): RecipeMigrationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Recipe must be an object.");
  const original = clone(input as Record<string, any>);
  const detected = Number.isInteger(original.schemaVersion) ? Number(original.schemaVersion) : 0;
  if (detected > CURRENT_RECIPE_SCHEMA_VERSION) {
    throw new Error(`Recipe schema v${detected} is newer than supported schema v${CURRENT_RECIPE_SCHEMA_VERSION}.`);
  }
  const deprecated = normalizeDeprecatedFields(original);
  let value = deprecated.value;
  let version = detected;
  const warnings: RecipeMigrationWarning[] = [...deprecated.warnings];
  while (version < CURRENT_RECIPE_SCHEMA_VERSION) {
    const migration = migrations.get(version);
    if (!migration) throw new Error(`No recipe migration is registered from schema v${version}.`);
    const result = migration(clone(value));
    value = clone(result.value);
    warnings.push(...(result.warnings || []));
    version += 1;
  }
  const recipe = mixRecipeDocumentSchema.parse(value);
  return { recipe, fromVersion: detected, toVersion: CURRENT_RECIPE_SCHEMA_VERSION, migrated: detected !== CURRENT_RECIPE_SCHEMA_VERSION, warnings };
}
