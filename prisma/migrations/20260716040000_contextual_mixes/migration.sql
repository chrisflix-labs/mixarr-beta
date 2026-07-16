-- Mixarr v2.1.6 Contextual Mixes. Additive and safe for existing users/playlists.
CREATE TABLE "ContextProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT,
  "tagsJson" JSONB,
  "contextType" TEXT NOT NULL DEFAULT 'CUSTOM',
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "clonedFromBuiltInKey" TEXT,
  "clonedFromBuiltInVersion" TEXT,
  "availabilityJson" JSONB NOT NULL,
  "behaviorJson" JSONB NOT NULL,
  "profileVersion" TEXT NOT NULL DEFAULT '1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContextProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContextProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContextProfile_userId_name_key" ON "ContextProfile"("userId", "name");
CREATE INDEX "ContextProfile_userId_isEnabled_updatedAt_idx" ON "ContextProfile"("userId", "isEnabled", "updatedAt");
CREATE INDEX "ContextProfile_userId_contextType_idx" ON "ContextProfile"("userId", "contextType");

CREATE TABLE "ContextualMixSetting" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "showSuggestions" BOOLEAN NOT NULL DEFAULT true,
  "defaultInfluence" TEXT NOT NULL DEFAULT 'BALANCED',
  "showBuiltInCards" BOOLEAN NOT NULL DEFAULT true,
  "showCustomCards" BOOLEAN NOT NULL DEFAULT true,
  "autoSuggestTimeAndDay" BOOLEAN NOT NULL DEFAULT true,
  "confirmBeforeReplacingManual" BOOLEAN NOT NULL DEFAULT true,
  "timeZone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContextualMixSetting_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContextualMixSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContextualMixSetting_userId_key" ON "ContextualMixSetting"("userId");

ALTER TABLE "GeneratedPlaylist"
  ADD COLUMN "contextProfileId" TEXT,
  ADD COLUMN "contextProfileName" TEXT,
  ADD COLUMN "contextInfluence" TEXT,
  ADD COLUMN "contextSnapshotJson" JSONB,
  ADD COLUMN "contextOverridesJson" JSONB;

ALTER TABLE "PlaylistHistoryEntry"
  ADD COLUMN "contextProfileId" TEXT,
  ADD COLUMN "contextProfileName" TEXT,
  ADD COLUMN "contextInfluence" TEXT,
  ADD COLUMN "contextSnapshotJson" JSONB,
  ADD COLUMN "contextOverridesJson" JSONB;
