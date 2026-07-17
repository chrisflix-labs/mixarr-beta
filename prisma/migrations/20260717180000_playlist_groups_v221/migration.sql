-- Mixarr v2.2.1 Playlist Groups & Collections
-- Additive only: existing playlists and their settings are unchanged.

CREATE TABLE "PlaylistGroup" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "artworkUrl" TEXT,
  "artworkSource" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isPaused" BOOLEAN NOT NULL DEFAULT false,
  "settingsSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "settingsJson" JSONB NOT NULL DEFAULT '{}',
  "scheduleJson" JSONB,
  "lastRegeneratedAt" TIMESTAMP(3),
  "lastHealthCalculatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistGroupMembership" (
  "id" TEXT NOT NULL,
  "playlistGroupId" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "inheritsSettings" BOOLEAN NOT NULL DEFAULT false,
  "isPrimarySettingsGroup" BOOLEAN NOT NULL DEFAULT false,
  "inheritanceJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistGroupMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistGroupExclusionRule" (
  "id" TEXT NOT NULL,
  "playlistGroupId" TEXT NOT NULL,
  "ruleType" TEXT NOT NULL,
  "ruleValue" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "source" TEXT NOT NULL DEFAULT 'user',
  "allowOverride" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistGroupExclusionRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistGroupActivity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playlistGroupId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistGroupActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlaylistGroup_userId_sortOrder_idx" ON "PlaylistGroup"("userId", "sortOrder");
CREATE INDEX "PlaylistGroup_userId_isPaused_idx" ON "PlaylistGroup"("userId", "isPaused");
CREATE INDEX "PlaylistGroup_userId_updatedAt_idx" ON "PlaylistGroup"("userId", "updatedAt");
CREATE INDEX "PlaylistGroup_userId_lastRegeneratedAt_idx" ON "PlaylistGroup"("userId", "lastRegeneratedAt");
CREATE UNIQUE INDEX "PlaylistGroupMembership_playlistGroupId_playlistId_key" ON "PlaylistGroupMembership"("playlistGroupId", "playlistId");
CREATE INDEX "PlaylistGroupMembership_playlistGroupId_sortOrder_idx" ON "PlaylistGroupMembership"("playlistGroupId", "sortOrder");
CREATE INDEX "PlaylistGroupMembership_playlistId_isPrimarySettingsGroup_idx" ON "PlaylistGroupMembership"("playlistId", "isPrimarySettingsGroup");
CREATE INDEX "PlaylistGroupMembership_playlistId_createdAt_idx" ON "PlaylistGroupMembership"("playlistId", "createdAt");
CREATE UNIQUE INDEX "PlaylistGroupMembership_one_primary_per_playlist" ON "PlaylistGroupMembership"("playlistId") WHERE "isPrimarySettingsGroup" = true;
CREATE UNIQUE INDEX "PlaylistGroupExclusionRule_playlistGroupId_ruleType_ruleValue_key" ON "PlaylistGroupExclusionRule"("playlistGroupId", "ruleType", "ruleValue");
CREATE INDEX "PlaylistGroupExclusionRule_playlistGroupId_isEnabled_idx" ON "PlaylistGroupExclusionRule"("playlistGroupId", "isEnabled");
CREATE INDEX "PlaylistGroupExclusionRule_ruleType_ruleValue_idx" ON "PlaylistGroupExclusionRule"("ruleType", "ruleValue");
CREATE INDEX "PlaylistGroupActivity_playlistGroupId_createdAt_idx" ON "PlaylistGroupActivity"("playlistGroupId", "createdAt");
CREATE INDEX "PlaylistGroupActivity_userId_createdAt_idx" ON "PlaylistGroupActivity"("userId", "createdAt");

ALTER TABLE "PlaylistGroup" ADD CONSTRAINT "PlaylistGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistGroupMembership" ADD CONSTRAINT "PlaylistGroupMembership_playlistGroupId_fkey" FOREIGN KEY ("playlistGroupId") REFERENCES "PlaylistGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistGroupMembership" ADD CONSTRAINT "PlaylistGroupMembership_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistGroupExclusionRule" ADD CONSTRAINT "PlaylistGroupExclusionRule_playlistGroupId_fkey" FOREIGN KEY ("playlistGroupId") REFERENCES "PlaylistGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistGroupActivity" ADD CONSTRAINT "PlaylistGroupActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistGroupActivity" ADD CONSTRAINT "PlaylistGroupActivity_playlistGroupId_fkey" FOREIGN KEY ("playlistGroupId") REFERENCES "PlaylistGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
