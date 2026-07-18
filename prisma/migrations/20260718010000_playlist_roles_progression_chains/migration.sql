-- Mixarr v2.2.3: playlist roles and progression-chain journeys.
-- Additive defaults preserve all existing playlist and progression behavior.

ALTER TABLE "PlaylistProgressionChain"
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "guidanceEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoMaintenanceEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sharedTransitionMode" TEXT NOT NULL DEFAULT 'SUGGEST_ONLY',
  ADD COLUMN "masterPlaylistEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "masterGeneratedPlaylistId" TEXT,
  ADD COLUMN "settingsJson" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "analysisJson" JSONB,
  ADD COLUMN "qualityScore" DOUBLE PRECISION,
  ADD COLUMN "lastAnalyzedAt" TIMESTAMP(3),
  ADD COLUMN "lastOptimizedAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "versionCounter" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PlaylistProgressionMember"
  ADD COLUMN "roleDefinitionId" TEXT,
  ADD COLUMN "roleOverrideJson" JSONB,
  ADD COLUMN "expectedStartEnergy" DOUBLE PRECISION,
  ADD COLUMN "expectedEndEnergy" DOUBLE PRECISION,
  ADD COLUMN "expectedStartBpm" DOUBLE PRECISION,
  ADD COLUMN "expectedEndBpm" DOUBLE PRECISION,
  ADD COLUMN "handoffEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoHandoffGuidance" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS "PlaylistProgressionMember_chainId_playlistId_key";
CREATE INDEX "PlaylistProgressionMember_chainId_playlistId_idx" ON "PlaylistProgressionMember"("chainId", "playlistId");
CREATE INDEX "PlaylistProgressionMember_roleDefinitionId_idx" ON "PlaylistProgressionMember"("roleDefinitionId");
CREATE INDEX "PlaylistProgressionChain_userId_status_archivedAt_idx" ON "PlaylistProgressionChain"("userId", "status", "archivedAt");
CREATE INDEX "PlaylistProgressionChain_masterGeneratedPlaylistId_idx" ON "PlaylistProgressionChain"("masterGeneratedPlaylistId");

CREATE TABLE "PlaylistRoleDefinition" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
  "defaultEnergyStart" DOUBLE PRECISION,
  "defaultEnergyEnd" DOUBLE PRECISION,
  "defaultBpmMin" DOUBLE PRECISION,
  "defaultBpmMax" DOUBLE PRECISION,
  "defaultDiscoveryLevel" DOUBLE PRECISION,
  "defaultTransitionMode" TEXT,
  "defaultMoodDirection" TEXT,
  "defaultSettingsJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistRoleDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistRoleAssignment" (
  "id" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "roleDefinitionId" TEXT NOT NULL,
  "customRoleName" TEXT,
  "behaviorMode" TEXT NOT NULL DEFAULT 'SUGGEST',
  "settingsOverrideJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistRoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistChainHandoff" (
  "id" TEXT NOT NULL,
  "chainId" TEXT NOT NULL,
  "fromMemberId" TEXT NOT NULL,
  "toMemberId" TEXT NOT NULL,
  "energyMode" TEXT NOT NULL DEFAULT 'SMOOTH_CONTINUATION',
  "bpmMode" TEXT NOT NULL DEFAULT 'SMOOTH_CONTINUATION',
  "moodMode" TEXT NOT NULL DEFAULT 'SMOOTH_CONTINUATION',
  "sharedTrackMode" TEXT NOT NULL DEFAULT 'INHERIT',
  "handoffSettingsJson" JSONB NOT NULL DEFAULT '{}',
  "qualityScore" DOUBLE PRECISION,
  "energyScore" DOUBLE PRECISION,
  "bpmScore" DOUBLE PRECISION,
  "moodScore" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "analysisJson" JSONB,
  "lastAnalyzedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistChainHandoff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistChainTransitionTrack" (
  "id" TEXT NOT NULL,
  "handoffId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "placementMode" TEXT NOT NULL DEFAULT 'NEXT_OPENING',
  "score" DOUBLE PRECISION NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "explanationJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistChainTransitionTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistChainVersion" (
  "id" TEXT NOT NULL,
  "chainId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,
  CONSTRAINT "PlaylistChainVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistChainOptimizationPreview" (
  "id" TEXT NOT NULL,
  "chainId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "baseVersionNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEW',
  "suggestionsJson" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "PlaylistChainOptimizationPreview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistChainSetting" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rolesEnabled" BOOLEAN NOT NULL DEFAULT true,
  "chainsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "defaultRoleBehavior" TEXT NOT NULL DEFAULT 'SUGGEST',
  "sharedTransitionTracksEnabled" BOOLEAN NOT NULL DEFAULT true,
  "maximumSharedTransitionTracks" INTEGER NOT NULL DEFAULT 1,
  "masterJourneyPlaylistsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "automaticallyAnalyzeUpdatedChains" BOOLEAN NOT NULL DEFAULT true,
  "automaticallyRepairWeakHandoffs" BOOLEAN NOT NULL DEFAULT false,
  "minimumAutomaticRepairImprovement" DOUBLE PRECISION NOT NULL DEFAULT 10,
  "maximumTracksReplacedAutomatically" INTEGER NOT NULL DEFAULT 2,
  "preserveLockedBoundaryTracks" BOOLEAN NOT NULL DEFAULT true,
  "analysisConcurrency" INTEGER NOT NULL DEFAULT 1,
  "retainVersions" BOOLEAN NOT NULL DEFAULT true,
  "versionRetentionCount" INTEGER NOT NULL DEFAULT 20,
  "showExperimentalFeatures" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistChainSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaylistRoleDefinition_key_key" ON "PlaylistRoleDefinition"("key");
CREATE INDEX "PlaylistRoleDefinition_userId_isBuiltIn_name_idx" ON "PlaylistRoleDefinition"("userId", "isBuiltIn", "name");
CREATE UNIQUE INDEX "PlaylistRoleAssignment_playlistId_key" ON "PlaylistRoleAssignment"("playlistId");
CREATE INDEX "PlaylistRoleAssignment_roleDefinitionId_idx" ON "PlaylistRoleAssignment"("roleDefinitionId");
CREATE UNIQUE INDEX "PlaylistChainHandoff_chainId_fromMemberId_toMemberId_key" ON "PlaylistChainHandoff"("chainId", "fromMemberId", "toMemberId");
CREATE INDEX "PlaylistChainHandoff_chainId_updatedAt_idx" ON "PlaylistChainHandoff"("chainId", "updatedAt");
CREATE INDEX "PlaylistChainHandoff_fromMemberId_idx" ON "PlaylistChainHandoff"("fromMemberId");
CREATE INDEX "PlaylistChainHandoff_toMemberId_idx" ON "PlaylistChainHandoff"("toMemberId");
CREATE UNIQUE INDEX "PlaylistChainTransitionTrack_handoffId_trackId_placementMode_key" ON "PlaylistChainTransitionTrack"("handoffId", "trackId", "placementMode");
CREATE INDEX "PlaylistChainTransitionTrack_trackId_idx" ON "PlaylistChainTransitionTrack"("trackId");
CREATE UNIQUE INDEX "PlaylistChainVersion_chainId_versionNumber_key" ON "PlaylistChainVersion"("chainId", "versionNumber");
CREATE INDEX "PlaylistChainVersion_chainId_createdAt_idx" ON "PlaylistChainVersion"("chainId", "createdAt");
CREATE INDEX "PlaylistChainVersion_createdByUserId_createdAt_idx" ON "PlaylistChainVersion"("createdByUserId", "createdAt");
CREATE INDEX "PlaylistChainOptimizationPreview_chainId_status_expiresAt_idx" ON "PlaylistChainOptimizationPreview"("chainId", "status", "expiresAt");
CREATE INDEX "PlaylistChainOptimizationPreview_userId_createdAt_idx" ON "PlaylistChainOptimizationPreview"("userId", "createdAt");
CREATE UNIQUE INDEX "PlaylistChainSetting_userId_key" ON "PlaylistChainSetting"("userId");

ALTER TABLE "PlaylistProgressionChain" ADD CONSTRAINT "PlaylistProgressionChain_masterGeneratedPlaylistId_fkey" FOREIGN KEY ("masterGeneratedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistProgressionMember" ADD CONSTRAINT "PlaylistProgressionMember_roleDefinitionId_fkey" FOREIGN KEY ("roleDefinitionId") REFERENCES "PlaylistRoleDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistRoleDefinition" ADD CONSTRAINT "PlaylistRoleDefinition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistRoleAssignment" ADD CONSTRAINT "PlaylistRoleAssignment_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistRoleAssignment" ADD CONSTRAINT "PlaylistRoleAssignment_roleDefinitionId_fkey" FOREIGN KEY ("roleDefinitionId") REFERENCES "PlaylistRoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistChainHandoff" ADD CONSTRAINT "PlaylistChainHandoff_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "PlaylistProgressionChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistChainHandoff" ADD CONSTRAINT "PlaylistChainHandoff_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "PlaylistProgressionMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistChainHandoff" ADD CONSTRAINT "PlaylistChainHandoff_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "PlaylistProgressionMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistChainTransitionTrack" ADD CONSTRAINT "PlaylistChainTransitionTrack_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "PlaylistChainHandoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistChainTransitionTrack" ADD CONSTRAINT "PlaylistChainTransitionTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistChainVersion" ADD CONSTRAINT "PlaylistChainVersion_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "PlaylistProgressionChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistChainVersion" ADD CONSTRAINT "PlaylistChainVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistChainOptimizationPreview" ADD CONSTRAINT "PlaylistChainOptimizationPreview_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "PlaylistProgressionChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistChainSetting" ADD CONSTRAINT "PlaylistChainSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PlaylistRoleDefinition" (
  "id", "key", "name", "description", "isBuiltIn", "defaultEnergyStart", "defaultEnergyEnd",
  "defaultBpmMin", "defaultBpmMax", "defaultDiscoveryLevel", "defaultTransitionMode",
  "defaultMoodDirection", "defaultSettingsJson", "updatedAt"
) VALUES
  ('role-intro', 'intro', 'Intro', 'A smooth arrival that prepares the next playlist.', true, 0.25, 0.50, 70, 105, 0.25, 'VERY_SMOOTH', 'BUILD', '{"endingBehavior":"PREPARE_NEXT","artistVariety":0.7,"repeatTolerance":0.15}', CURRENT_TIMESTAMP),
  ('role-warm-up', 'warm-up', 'Warm-up', 'A gradual build into sustained activity.', true, 0.35, 0.65, 80, 115, 0.30, 'SMOOTH', 'BUILD', '{"endingBehavior":"PREPARE_NEXT","artistVariety":0.7,"repeatTolerance":0.15}', CURRENT_TIMESTAMP),
  ('role-main', 'main', 'Main', 'The central experience with balanced familiarity and discovery.', true, 0.60, 0.82, 100, 128, 0.50, 'SMOOTH', 'MAINTAIN', '{"endingBehavior":"MAINTAIN_MOMENTUM","artistVariety":0.65,"repeatTolerance":0.2}', CURRENT_TIMESTAMP),
  ('role-peak-energy', 'peak-energy', 'Peak Energy', 'High-intensity familiar anchors with strong continuity.', true, 0.82, 0.95, 118, 145, 0.30, 'STRONG_CONTINUITY', 'PEAK', '{"endingBehavior":"CONTROLLED_REDUCTION","artistVariety":0.55,"repeatTolerance":0.25}', CURRENT_TIMESTAMP),
  ('role-recovery', 'recovery', 'Recovery', 'A gentle reduction that retains enough momentum for what follows.', true, 0.65, 0.42, 90, 118, 0.50, 'GENTLE', 'RELEASE', '{"endingBehavior":"PREPARE_NEXT","artistVariety":0.7,"repeatTolerance":0.15}', CURRENT_TIMESTAMP),
  ('role-cooldown', 'cooldown', 'Cooldown', 'A soft, low-energy conclusion.', true, 0.42, 0.20, 65, 100, 0.20, 'VERY_SMOOTH', 'CALM', '{"endingBehavior":"SOFT_CONCLUSION","artistVariety":0.65,"repeatTolerance":0.1}', CURRENT_TIMESTAMP),
  ('role-discovery', 'discovery', 'Discovery', 'A flexible showcase for unfamiliar tracks supported by familiar anchors.', true, 0.45, 0.65, 70, 150, 0.85, 'MODERATELY_FLEXIBLE', 'FLEXIBLE', '{"endingBehavior":"PREPARE_NEXT","familiarityAnchors":true,"artistVariety":0.9,"repeatTolerance":0.05}', CURRENT_TIMESTAMP),
  ('role-intermission', 'intermission', 'Intermission', 'A short reset between major sections of a journey.', true, 0.40, 0.35, 65, 110, 0.35, 'GENTLE', 'RESET', '{"endingBehavior":"PREPARE_NEXT","artistVariety":0.7,"repeatTolerance":0.1}', CURRENT_TIMESTAMP),
  ('role-after-hours', 'after-hours', 'After-Hours', 'A late-session continuation with a looser, deeper character.', true, 0.58, 0.38, 80, 120, 0.60, 'SMOOTH', 'DARKER', '{"endingBehavior":"SOFT_CONCLUSION","artistVariety":0.8,"repeatTolerance":0.1}', CURRENT_TIMESTAMP),
  ('role-archive', 'archive', 'Archive', 'A preserved historical playlist excluded from automatic changes.', true, NULL, NULL, NULL, NULL, 0, 'NONE', 'NONE', '{"generationEnabled":false,"automaticChanges":false,"historicalPreservation":true}', CURRENT_TIMESTAMP),
  ('role-custom', 'custom', 'Custom', 'A user-named role with fully editable guidance.', true, NULL, NULL, NULL, NULL, 0.5, 'SMOOTH', 'FLEXIBLE', '{"endingBehavior":"NO_PREFERENCE","artistVariety":0.7,"repeatTolerance":0.15}', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "defaultEnergyStart" = EXCLUDED."defaultEnergyStart",
  "defaultEnergyEnd" = EXCLUDED."defaultEnergyEnd",
  "defaultBpmMin" = EXCLUDED."defaultBpmMin",
  "defaultBpmMax" = EXCLUDED."defaultBpmMax",
  "defaultDiscoveryLevel" = EXCLUDED."defaultDiscoveryLevel",
  "defaultTransitionMode" = EXCLUDED."defaultTransitionMode",
  "defaultMoodDirection" = EXCLUDED."defaultMoodDirection",
  "defaultSettingsJson" = EXCLUDED."defaultSettingsJson",
  "updatedAt" = CURRENT_TIMESTAMP;
