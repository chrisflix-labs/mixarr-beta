-- Mixarr v2.3.0 - first-class Mix Recipe foundation.
-- Existing PlaylistRecipe rows remain usable and receive safe schema-v1 defaults.

ALTER TABLE "PlaylistRecipe"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Custom',
  ADD COLUMN "artworkUrl" TEXT,
  ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "recipeVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "scoringJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "targetsJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "bpmFlowJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "discoveryJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "varietyJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "identityDefaultsJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "refreshPolicyJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "automationPolicyJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "sourcePlaylistId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "PlaylistRecipe"
SET "slug" = CONCAT(
  LEFT(COALESCE(NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER("name"), '[^a-z0-9]+', '-', 'g')), ''), 'recipe'), 100),
  '-',
  LOWER("id")
)
WHERE "slug" IS NULL;

ALTER TABLE "PlaylistRecipe" ALTER COLUMN "slug" SET NOT NULL;

CREATE TABLE "PlaylistRecipeRevision" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "recipeVersion" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "changeType" TEXT NOT NULL,
  "changedFieldsJson" JSONB,
  "portableSnapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistRecipeRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GeneratedPlaylist"
  ADD COLUMN "recipeVersionUsed" INTEGER,
  ADD COLUMN "recipeSchemaVersionUsed" INTEGER,
  ADD COLUMN "resolvedRecipeSnapshotJson" JSONB,
  ADD COLUMN "playlistOverridesJson" JSONB;

ALTER TABLE "PlaylistRegeneration"
  ADD COLUMN "resolvedRecipeSnapshotJson" JSONB,
  ADD COLUMN "playlistOverridesJson" JSONB;

-- recipeId was historically an informational string with no foreign key.
-- Preserve its display name/snapshot data while clearing only orphaned IDs.
UPDATE "GeneratedPlaylist" generated
SET "recipeId" = NULL
WHERE generated."recipeId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "PlaylistRecipe" recipe WHERE recipe."id" = generated."recipeId");

ALTER TABLE "PlaylistRecipe"
  ADD CONSTRAINT "PlaylistRecipe_sourcePlaylistId_fkey"
  FOREIGN KEY ("sourcePlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GeneratedPlaylist"
  ADD CONSTRAINT "GeneratedPlaylist_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlaylistRecipeRevision"
  ADD CONSTRAINT "PlaylistRecipeRevision_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PlaylistRecipe_userId_slug_key" ON "PlaylistRecipe"("userId", "slug");
CREATE INDEX "PlaylistRecipe_userId_enabled_updatedAt_idx" ON "PlaylistRecipe"("userId", "enabled", "updatedAt");
CREATE INDEX "PlaylistRecipe_userId_category_updatedAt_idx" ON "PlaylistRecipe"("userId", "category", "updatedAt");
CREATE INDEX "PlaylistRecipe_sourcePlaylistId_idx" ON "PlaylistRecipe"("sourcePlaylistId");
CREATE UNIQUE INDEX "PlaylistRecipeRevision_recipeId_recipeVersion_key" ON "PlaylistRecipeRevision"("recipeId", "recipeVersion");
CREATE INDEX "PlaylistRecipeRevision_recipeId_createdAt_idx" ON "PlaylistRecipeRevision"("recipeId", "createdAt");
CREATE INDEX "GeneratedPlaylist_recipeId_createdAt_idx" ON "GeneratedPlaylist"("recipeId", "createdAt");
