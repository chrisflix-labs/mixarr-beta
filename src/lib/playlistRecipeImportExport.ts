// Compatibility facade for the v2.3.0 module path. The canonical implementation
// lives with the v2.3.0 recipe schema so editing, generation, and transfers share
// the same validation and migration services.
export {
  MAX_RECIPE_ARCHIVE_BYTES,
  MAX_RECIPE_JSON_BYTES,
  RECIPE_BUNDLE_FORMAT,
  RECIPE_EXPORT_FORMAT,
  RECIPE_EXPORT_FORMAT_VERSION,
  addConflictAnalysis,
  buildBundleEnvelope,
  buildRecipeEnvelope,
  canonicalize,
  diagnosticForTransfer,
  normalizedRecipeName,
  parseTransferJson,
  portableRecipePayloadFromDocument,
  portableRecipePayloadFromRecord,
  publicImportPreview,
  recipeChecksum,
  recipeContentChecksum,
  safeImportedName as importedRecipeName,
  safeRecipeFilename as sanitizeRecipeFilename,
  scanSensitiveData,
  sha256,
  summarizePortableRecipe,
} from "./mixRecipes/transfer";

export {
  MAX_ARCHIVE_FILES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_ARTWORK_BYTES,
  MAX_ARTWORK_DIMENSION,
  buildRecipeArchive,
  parseRecipeArchive,
  validateArchivePath,
  validateArtwork,
} from "./mixRecipes/archive";
