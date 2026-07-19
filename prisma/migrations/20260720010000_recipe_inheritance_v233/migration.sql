-- Mixarr v2.3.3: additive, non-destructive recipe inheritance foundation.
-- Existing recipe JSON remains explicit because inheritanceEnabled defaults false.
ALTER TABLE "PlaylistRecipe"
  ADD COLUMN "inheritanceEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "baseRecipeId" TEXT,
  ADD COLUMN "recipeCategoryId" TEXT,
  ADD COLUMN "transitionPresetId" TEXT,
  ADD COLUMN "discoveryPresetId" TEXT,
  ADD COLUMN "varietyPresetId" TEXT,
  ADD COLUMN "automationPresetId" TEXT,
  ADD COLUMN "localOverridesJson" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "inheritanceSchemaVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PlaylistRecipeRevision"
  ADD COLUMN "inheritanceSnapshotJson" JSONB,
  ADD COLUMN "resolverVersion" TEXT,
  ADD COLUMN "configurationFingerprint" TEXT;

CREATE TABLE "GlobalRecipeDefaults" (
  "id" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL DEFAULT 'system',
  "configJson" JSONB NOT NULL DEFAULT '{}',
  "locksJson" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlobalRecipeDefaults_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipePreset" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL,
  "configJson" JSONB NOT NULL DEFAULT '{}',
  "locksJson" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipePreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipePresetVersion" (
  "id" TEXT NOT NULL,
  "presetId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "configJson" JSONB NOT NULL,
  "locksJson" JSONB NOT NULL DEFAULT '{}',
  "changedFieldsJson" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipePresetVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeCategory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "presetId" TEXT,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipeCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeOverride" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "fieldPath" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipeOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistRecipeOverride" (
  "id" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "fieldPath" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistRecipeOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeGroupPolicy" (
  "id" TEXT NOT NULL,
  "playlistGroupId" TEXT NOT NULL,
  "configJson" JSONB NOT NULL DEFAULT '{}',
  "locksJson" JSONB NOT NULL DEFAULT '{}',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipeGroupPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserRecipePreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "configJson" JSONB NOT NULL DEFAULT '{}',
  "allowedFieldsJson" JSONB NOT NULL DEFAULT '[]',
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserRecipePreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeFieldLock" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fieldPath" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceEntityId" TEXT,
  "authority" INTEGER NOT NULL DEFAULT 100,
  "reason" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipeFieldLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EffectiveRecipeSnapshot" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT,
  "playlistId" TEXT,
  "contextType" TEXT NOT NULL,
  "effectiveConfigJson" JSONB NOT NULL,
  "provenanceJson" JSONB NOT NULL,
  "inheritanceChainJson" JSONB NOT NULL,
  "conflictsJson" JSONB NOT NULL,
  "warningsJson" JSONB NOT NULL,
  "resolverVersion" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EffectiveRecipeSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeConflict" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "fieldsJson" JSONB NOT NULL,
  "detailsJson" JSONB NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeConflict_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeInheritanceAudit" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "changedFieldsJson" JSONB,
  "previousJson" JSONB,
  "nextJson" JSONB,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeInheritanceAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalRecipeDefaults_scopeKey_key" ON "GlobalRecipeDefaults"("scopeKey");
CREATE UNIQUE INDEX "RecipePreset_ownerId_type_name_key" ON "RecipePreset"("ownerId", "type", "name");
CREATE INDEX "RecipePreset_ownerId_type_isArchived_updatedAt_idx" ON "RecipePreset"("ownerId", "type", "isArchived", "updatedAt");
CREATE UNIQUE INDEX "RecipePresetVersion_presetId_version_key" ON "RecipePresetVersion"("presetId", "version");
CREATE INDEX "RecipePresetVersion_presetId_createdAt_idx" ON "RecipePresetVersion"("presetId", "createdAt");
CREATE UNIQUE INDEX "RecipeCategory_userId_name_key" ON "RecipeCategory"("userId", "name");
CREATE INDEX "RecipeCategory_userId_isArchived_name_idx" ON "RecipeCategory"("userId", "isArchived", "name");
CREATE INDEX "RecipeCategory_presetId_idx" ON "RecipeCategory"("presetId");
CREATE UNIQUE INDEX "RecipeOverride_recipeId_fieldPath_key" ON "RecipeOverride"("recipeId", "fieldPath");
CREATE INDEX "RecipeOverride_recipeId_updatedAt_idx" ON "RecipeOverride"("recipeId", "updatedAt");
CREATE UNIQUE INDEX "PlaylistRecipeOverride_playlistId_fieldPath_key" ON "PlaylistRecipeOverride"("playlistId", "fieldPath");
CREATE INDEX "PlaylistRecipeOverride_playlistId_updatedAt_idx" ON "PlaylistRecipeOverride"("playlistId", "updatedAt");
CREATE UNIQUE INDEX "RecipeGroupPolicy_playlistGroupId_key" ON "RecipeGroupPolicy"("playlistGroupId");
CREATE UNIQUE INDEX "UserRecipePreference_userId_key" ON "UserRecipePreference"("userId");
CREATE UNIQUE INDEX "RecipeFieldLock_userId_fieldPath_sourceType_sourceEntityId_key" ON "RecipeFieldLock"("userId", "fieldPath", "sourceType", "sourceEntityId");
CREATE INDEX "RecipeFieldLock_userId_fieldPath_authority_idx" ON "RecipeFieldLock"("userId", "fieldPath", "authority");
CREATE INDEX "RecipeFieldLock_sourceType_sourceEntityId_idx" ON "RecipeFieldLock"("sourceType", "sourceEntityId");
CREATE INDEX "EffectiveRecipeSnapshot_recipeId_createdAt_idx" ON "EffectiveRecipeSnapshot"("recipeId", "createdAt");
CREATE INDEX "EffectiveRecipeSnapshot_playlistId_createdAt_idx" ON "EffectiveRecipeSnapshot"("playlistId", "createdAt");
CREATE INDEX "EffectiveRecipeSnapshot_fingerprint_idx" ON "EffectiveRecipeSnapshot"("fingerprint");
CREATE INDEX "RecipeConflict_recipeId_fingerprint_idx" ON "RecipeConflict"("recipeId", "fingerprint");
CREATE INDEX "RecipeConflict_severity_resolvedAt_idx" ON "RecipeConflict"("severity", "resolvedAt");
CREATE INDEX "RecipeInheritanceAudit_entityType_entityId_createdAt_idx" ON "RecipeInheritanceAudit"("entityType", "entityId", "createdAt");
CREATE INDEX "RecipeInheritanceAudit_actorId_createdAt_idx" ON "RecipeInheritanceAudit"("actorId", "createdAt");
CREATE INDEX "PlaylistRecipe_baseRecipeId_idx" ON "PlaylistRecipe"("baseRecipeId");
CREATE INDEX "PlaylistRecipe_recipeCategoryId_idx" ON "PlaylistRecipe"("recipeCategoryId");
CREATE INDEX "PlaylistRecipe_transitionPresetId_idx" ON "PlaylistRecipe"("transitionPresetId");
CREATE INDEX "PlaylistRecipe_discoveryPresetId_idx" ON "PlaylistRecipe"("discoveryPresetId");
CREATE INDEX "PlaylistRecipe_varietyPresetId_idx" ON "PlaylistRecipe"("varietyPresetId");
CREATE INDEX "PlaylistRecipe_automationPresetId_idx" ON "PlaylistRecipe"("automationPresetId");

ALTER TABLE "PlaylistRecipe" ADD CONSTRAINT "PlaylistRecipe_baseRecipeId_fkey" FOREIGN KEY ("baseRecipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistRecipe" ADD CONSTRAINT "PlaylistRecipe_recipeCategoryId_fkey" FOREIGN KEY ("recipeCategoryId") REFERENCES "RecipeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistRecipe" ADD CONSTRAINT "PlaylistRecipe_transitionPresetId_fkey" FOREIGN KEY ("transitionPresetId") REFERENCES "RecipePreset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistRecipe" ADD CONSTRAINT "PlaylistRecipe_discoveryPresetId_fkey" FOREIGN KEY ("discoveryPresetId") REFERENCES "RecipePreset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistRecipe" ADD CONSTRAINT "PlaylistRecipe_varietyPresetId_fkey" FOREIGN KEY ("varietyPresetId") REFERENCES "RecipePreset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistRecipe" ADD CONSTRAINT "PlaylistRecipe_automationPresetId_fkey" FOREIGN KEY ("automationPresetId") REFERENCES "RecipePreset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GlobalRecipeDefaults" ADD CONSTRAINT "GlobalRecipeDefaults_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipePreset" ADD CONSTRAINT "RecipePreset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipePresetVersion" ADD CONSTRAINT "RecipePresetVersion_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "RecipePreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeCategory" ADD CONSTRAINT "RecipeCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeCategory" ADD CONSTRAINT "RecipeCategory_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "RecipePreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeOverride" ADD CONSTRAINT "RecipeOverride_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistRecipeOverride" ADD CONSTRAINT "PlaylistRecipeOverride_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeGroupPolicy" ADD CONSTRAINT "RecipeGroupPolicy_playlistGroupId_fkey" FOREIGN KEY ("playlistGroupId") REFERENCES "PlaylistGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRecipePreference" ADD CONSTRAINT "UserRecipePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EffectiveRecipeSnapshot" ADD CONSTRAINT "EffectiveRecipeSnapshot_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EffectiveRecipeSnapshot" ADD CONSTRAINT "EffectiveRecipeSnapshot_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeInheritanceAudit" ADD CONSTRAINT "RecipeInheritanceAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
