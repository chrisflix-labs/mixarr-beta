-- Mixarr v2.3.5: additive community recipe provenance and attribution.
ALTER TABLE "PlaylistRecipe"
  ADD COLUMN "communityRecipeId" TEXT,
  ADD COLUMN "communityVersion" TEXT,
  ADD COLUMN "communityFormatVersion" INTEGER,
  ADD COLUMN "communityAuthorName" TEXT,
  ADD COLUMN "communityAuthorUrl" TEXT,
  ADD COLUMN "communityLicense" TEXT,
  ADD COLUMN "minimumMixarrVersion" TEXT,
  ADD COLUMN "communityHomepageUrl" TEXT,
  ADD COLUMN "communityDocumentationUrl" TEXT,
  ADD COLUMN "communitySourceUrl" TEXT,
  ADD COLUMN "communityTagsJson" JSONB,
  ADD COLUMN "communityChangelog" TEXT,
  ADD COLUMN "communityScreenshotsJson" JSONB,
  ADD COLUMN "communityImportSource" TEXT,
  ADD COLUMN "communityImportMethod" TEXT,
  ADD COLUMN "communityTrustState" TEXT,
  ADD COLUMN "communityValidationJson" JSONB,
  ADD COLUMN "communityOriginalChecksum" TEXT,
  ADD COLUMN "communityImportedVersion" TEXT,
  ADD COLUMN "communityUpdatedAt" TIMESTAMP(3);

CREATE INDEX "PlaylistRecipe_userId_communityRecipeId_idx"
  ON "PlaylistRecipe"("userId", "communityRecipeId");
