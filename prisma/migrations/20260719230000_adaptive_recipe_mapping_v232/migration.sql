ALTER TABLE "PlaylistRecipe"
  ADD COLUMN "originalImportedRecipeJson" JSONB,
  ADD COLUMN "adaptedFromImport" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "importSchemaVersion" INTEGER,
  ADD COLUMN "importEngineVersion" TEXT,
  ADD COLUMN "importWarningsJson" JSONB;

CREATE TABLE "RecipeImportAnalysis" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "libraryId" TEXT NOT NULL,
  "stageId" TEXT,
  "recipeId" TEXT,
  "recipeIndex" INTEGER NOT NULL DEFAULT 0,
  "originalRecipeJson" JSONB NOT NULL,
  "adaptedRecipeJson" JSONB NOT NULL,
  "compatibilityScore" INTEGER NOT NULL,
  "compatibilityBreakdownJson" JSONB NOT NULL,
  "originalCandidateEstimate" INTEGER NOT NULL,
  "adaptedCandidateEstimate" INTEGER NOT NULL,
  "coverageEstimate" DOUBLE PRECISION NOT NULL,
  "warningSummaryJson" JSONB NOT NULL,
  "identityImpact" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "schemaVersion" INTEGER NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "mappingStateHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RecipeImportAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeValueMapping" (
  "id" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "mappingType" TEXT NOT NULL,
  "originalValue" TEXT NOT NULL,
  "originalValueNormalized" TEXT NOT NULL,
  "mappedValuesJson" JSONB NOT NULL,
  "matchStatus" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "originalCandidateContribution" INTEGER NOT NULL DEFAULT 0,
  "adaptedCandidateContribution" INTEGER NOT NULL DEFAULT 0,
  "manuallyModified" BOOLEAN NOT NULL DEFAULT false,
  "accepted" BOOLEAN NOT NULL DEFAULT false,
  "saveForFuture" BOOLEAN NOT NULL DEFAULT false,
  "identityImpact" TEXT NOT NULL DEFAULT 'identity_preserving',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipeValueMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedRecipeMappingRule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "libraryId" TEXT,
  "mappingType" TEXT NOT NULL,
  "sourceValueNormalized" TEXT NOT NULL,
  "sourceValueDisplay" TEXT NOT NULL,
  "destinationValuesJson" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL DEFAULT 'manual_import',
  "manuallyConfirmed" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedRecipeMappingRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecipeImportAnalysis_recipeId_key" ON "RecipeImportAnalysis"("recipeId");
CREATE UNIQUE INDEX "RecipeImportAnalysis_stageId_recipeIndex_mappingStateHash_key" ON "RecipeImportAnalysis"("stageId", "recipeIndex", "mappingStateHash");
CREATE INDEX "RecipeImportAnalysis_userId_status_createdAt_idx" ON "RecipeImportAnalysis"("userId", "status", "createdAt");
CREATE INDEX "RecipeImportAnalysis_libraryId_status_updatedAt_idx" ON "RecipeImportAnalysis"("libraryId", "status", "updatedAt");
CREATE INDEX "RecipeImportAnalysis_stageId_recipeIndex_idx" ON "RecipeImportAnalysis"("stageId", "recipeIndex");
CREATE INDEX "RecipeValueMapping_analysisId_mappingType_idx" ON "RecipeValueMapping"("analysisId", "mappingType");
CREATE INDEX "RecipeValueMapping_mappingType_originalValueNormalized_idx" ON "RecipeValueMapping"("mappingType", "originalValueNormalized");
CREATE UNIQUE INDEX "SavedRecipeMappingRule_userId_libraryId_mappingType_sourceValueNormalized_key" ON "SavedRecipeMappingRule"("userId", "libraryId", "mappingType", "sourceValueNormalized");
CREATE INDEX "SavedRecipeMappingRule_userId_mappingType_sourceValueNormalized_enabled_idx" ON "SavedRecipeMappingRule"("userId", "mappingType", "sourceValueNormalized", "enabled");
CREATE INDEX "SavedRecipeMappingRule_libraryId_mappingType_enabled_idx" ON "SavedRecipeMappingRule"("libraryId", "mappingType", "enabled");
CREATE INDEX "SavedRecipeMappingRule_userId_enabled_updatedAt_idx" ON "SavedRecipeMappingRule"("userId", "enabled", "updatedAt");

ALTER TABLE "RecipeImportAnalysis" ADD CONSTRAINT "RecipeImportAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeImportAnalysis" ADD CONSTRAINT "RecipeImportAnalysis_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeImportAnalysis" ADD CONSTRAINT "RecipeImportAnalysis_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "RecipeImportStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeImportAnalysis" ADD CONSTRAINT "RecipeImportAnalysis_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeValueMapping" ADD CONSTRAINT "RecipeValueMapping_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "RecipeImportAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedRecipeMappingRule" ADD CONSTRAINT "SavedRecipeMappingRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedRecipeMappingRule" ADD CONSTRAINT "SavedRecipeMappingRule_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE SET NULL ON UPDATE CASCADE;
