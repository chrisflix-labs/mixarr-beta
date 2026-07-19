import { CURRENT_RECIPE_SCHEMA_VERSION, defaultMixRecipeDocument, mixRecipeDocumentSchema, type MixRecipeDocument } from "./schema";

export type RecipeMigrationWarning = { code: string; message: string };
export type RecipeMigrationResult = { recipe: MixRecipeDocument; fromVersion: number; toVersion: number; migrated: boolean; warnings: RecipeMigrationWarning[] };

type Migration = (source: Record<string, any>) => { value: Record<string, any>; warnings?: RecipeMigrationWarning[] };

const migrations = new Map<number, Migration>([
  [0, (source) => ({
    value: defaultMixRecipeDocument({
      name: String(source.name || source.metadata?.name || "Imported Recipe"),
      description: source.description || source.metadata?.description || null,
      category: source.category || source.metadata?.category || "Custom",
      artworkUrl: source.artworkUrl || source.metadata?.artworkUrl || null,
    }, source.filters || source.generation || {}),
    warnings: [{ code: "legacy_recipe_migrated", message: "Legacy saved builder filters were migrated to recipe schema v1." }],
  })],
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function migrateRecipeDocument(input: unknown): RecipeMigrationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Recipe must be an object.");
  const original = clone(input as Record<string, any>);
  const detected = Number.isInteger(original.schemaVersion) ? Number(original.schemaVersion) : 0;
  if (detected > CURRENT_RECIPE_SCHEMA_VERSION) {
    throw new Error(`Recipe schema v${detected} is newer than supported schema v${CURRENT_RECIPE_SCHEMA_VERSION}.`);
  }
  let value = original;
  let version = detected;
  const warnings: RecipeMigrationWarning[] = [];
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

