-- Mixarr v2.3.1 - secure, staged Recipe Import & Export.
-- Additive only: existing recipes and generated playlists remain unchanged.

ALTER TABLE "PlaylistRecipe"
  ADD COLUMN "portableChecksum" TEXT,
  ADD COLUMN "portableContentChecksum" TEXT,
  ADD COLUMN "importedAt" TIMESTAMP(3),
  ADD COLUMN "lastExportedAt" TIMESTAMP(3);

CREATE TABLE "RecipeImportStage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "detectedFormat" TEXT NOT NULL,
  "formatVersion" INTEGER NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "sanitizedPayloadJson" JSONB NOT NULL,
  "previewJson" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STAGED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipeImportStage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeImportHistory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "originalFilename" TEXT NOT NULL,
  "detectedFormat" TEXT NOT NULL,
  "formatVersion" INTEGER NOT NULL,
  "importMode" TEXT NOT NULL,
  "recipeCount" INTEGER NOT NULL DEFAULT 0,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "adaptedCount" INTEGER NOT NULL DEFAULT 0,
  "replacedCount" INTEGER NOT NULL DEFAULT 0,
  "renamedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "checksumResult" TEXT NOT NULL,
  "sensitiveDataScanResult" TEXT NOT NULL,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "resultSummaryJson" JSONB NOT NULL,
  "diagnosticJson" JSONB,
  "status" TEXT NOT NULL,
  CONSTRAINT "RecipeImportHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeExportHistory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exportType" TEXT NOT NULL,
  "recipeCount" INTEGER NOT NULL,
  "recipeNamesJson" JSONB NOT NULL,
  "formatVersion" INTEGER NOT NULL,
  "includedArtwork" BOOLEAN NOT NULL DEFAULT false,
  "sanitizationResult" TEXT NOT NULL,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "diagnosticJson" JSONB,
  CONSTRAINT "RecipeExportHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RecipeImportStage" ADD CONSTRAINT "RecipeImportStage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeImportHistory" ADD CONSTRAINT "RecipeImportHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeExportHistory" ADD CONSTRAINT "RecipeExportHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PlaylistRecipe_userId_portableChecksum_idx" ON "PlaylistRecipe"("userId", "portableChecksum");
CREATE INDEX "PlaylistRecipe_userId_portableContentChecksum_idx" ON "PlaylistRecipe"("userId", "portableContentChecksum");
CREATE INDEX "RecipeImportStage_userId_status_expiresAt_idx" ON "RecipeImportStage"("userId", "status", "expiresAt");
CREATE INDEX "RecipeImportStage_expiresAt_idx" ON "RecipeImportStage"("expiresAt");
CREATE INDEX "RecipeImportHistory_userId_startedAt_idx" ON "RecipeImportHistory"("userId", "startedAt");
CREATE INDEX "RecipeImportHistory_userId_status_startedAt_idx" ON "RecipeImportHistory"("userId", "status", "startedAt");
CREATE INDEX "RecipeExportHistory_userId_createdAt_idx" ON "RecipeExportHistory"("userId", "createdAt");
CREATE INDEX "RecipeExportHistory_userId_status_createdAt_idx" ON "RecipeExportHistory"("userId", "status", "createdAt");
