-- Mixarr v2.0.9: Recently Added Automation. All master and destructive
-- automation switches default to disabled for existing installations.
ALTER TABLE "Track"
  ADD COLUMN IF NOT EXISTS "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "plexAddedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recentlyAddedProcessedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recentlyAddedStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "recentlyAddedBatchId" TEXT;

CREATE TABLE IF NOT EXISTS "RecentlyAddedSettings" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "timeWindowDays" INTEGER NOT NULL DEFAULT 7, "customTimeWindowDays" INTEGER,
  "maxTracksPerRun" INTEGER NOT NULL DEFAULT 500,
  "createRecentlyAddedPlaylists" BOOLEAN NOT NULL DEFAULT false,
  "suggestExistingPlaylistMatches" BOOLEAN NOT NULL DEFAULT true,
  "autoAddStrongMatches" BOOLEAN NOT NULL DEFAULT false,
  "quarantineUntilAnalyzed" BOOLEAN NOT NULL DEFAULT true,
  "quarantineRule" TEXT NOT NULL DEFAULT 'all_core', "quarantineTimeoutHours" INTEGER,
  "allowLowConfidenceAutomation" BOOLEAN NOT NULL DEFAULT false,
  "scheduledRegenerationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "notificationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "notifyStrongMatches" BOOLEAN NOT NULL DEFAULT true, "notifySuggestionsReady" BOOLEAN NOT NULL DEFAULT true,
  "notifyAutomaticAdditions" BOOLEAN NOT NULL DEFAULT true, "notifyMixCreated" BOOLEAN NOT NULL DEFAULT true,
  "notifyLowConfidence" BOOLEAN NOT NULL DEFAULT true, "notifyFailures" BOOLEAN NOT NULL DEFAULT true,
  "matchThreshold" DOUBLE PRECISION NOT NULL DEFAULT 90, "metadataConfidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 75,
  "maxAddsPerPlaylist" INTEGER NOT NULL DEFAULT 3, "maxAddsPerRun" INTEGER NOT NULL DEFAULT 25,
  "requirePreview" BOOLEAN NOT NULL DEFAULT true, "automationPreset" TEXT NOT NULL DEFAULT 'balanced',
  "scheduleType" TEXT NOT NULL DEFAULT 'manual', "scheduleExpression" TEXT, "scheduleTime" TEXT NOT NULL DEFAULT '02:00',
  "scheduleDayOfWeek" INTEGER NOT NULL DEFAULT 0, "regenerationBehavior" TEXT NOT NULL DEFAULT 'add_only',
  "staleLockTimeoutMinutes" INTEGER NOT NULL DEFAULT 60,
  "playlistNameTemplate" TEXT NOT NULL DEFAULT 'Recently Added — {week}',
  "recentMixMinimumTrackCount" INTEGER NOT NULL DEFAULT 5, "recentMixMaximumTrackCount" INTEGER NOT NULL DEFAULT 100,
  "recentMixMinimumScore" DOUBLE PRECISION NOT NULL DEFAULT 60, "recentMixMinimumConfidence" DOUBLE PRECISION NOT NULL DEFAULT 60,
  "recentMixPublishToPlex" BOOLEAN NOT NULL DEFAULT false, "recentMixVersioned" BOOLEAN NOT NULL DEFAULT false,
  "recentMixLibraryId" TEXT, "exclusionsJson" JSONB, "lastScanAt" TIMESTAMP(3), "lastSuccessfulRunAt" TIMESTAMP(3),
  "nextScheduledRunAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecentlyAddedSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecentlyAddedBatch" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "libraryId" TEXT, "syncLogId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual', "status" TEXT NOT NULL DEFAULT 'detected',
  "discoveredCount" INTEGER NOT NULL DEFAULT 0, "processedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecentlyAddedBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecentlyAddedTrackState" (
  "id" TEXT NOT NULL, "trackId" TEXT NOT NULL, "batchId" TEXT, "status" TEXT NOT NULL DEFAULT 'new',
  "newMusicScore" DOUBLE PRECISION, "confidenceScore" DOUBLE PRECISION, "scoreBreakdownJson" JSONB,
  "quarantineReason" TEXT, "quarantinedAt" TIMESTAMP(3), "releasedAt" TIMESTAMP(3),
  "manualOverride" BOOLEAN NOT NULL DEFAULT false, "ignored" BOOLEAN NOT NULL DEFAULT false,
  "neverAutoAdd" BOOLEAN NOT NULL DEFAULT false, "doNotSuggest" BOOLEAN NOT NULL DEFAULT false,
  "manualUseOnly" BOOLEAN NOT NULL DEFAULT false, "failureReason" TEXT, "analyzedAt" TIMESTAMP(3),
  "matchedAt" TIMESTAMP(3), "processedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecentlyAddedTrackState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlaylistAutomationSettings" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "generatedPlaylistId" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'suggestions', "excludeFromScheduledRegeneration" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistAutomationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecentlyAddedPlaylistMatch" (
  "id" TEXT NOT NULL, "batchId" TEXT, "trackId" TEXT NOT NULL, "generatedPlaylistId" TEXT NOT NULL,
  "compatibilityScore" DOUBLE PRECISION NOT NULL, "newMusicScore" DOUBLE PRECISION NOT NULL,
  "confidenceScore" DOUBLE PRECISION NOT NULL, "recommendedSection" TEXT, "matchReasonsJson" JSONB NOT NULL,
  "warningsJson" JSONB, "expectedScoreChange" DOUBLE PRECISION, "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3), "appliedAt" TIMESTAMP(3),
  CONSTRAINT "RecentlyAddedPlaylistMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecentlyAddedAutomationRun" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "batchId" TEXT, "triggerType" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'scanning', "phase" TEXT NOT NULL DEFAULT 'scanning',
  "tracksDiscovered" INTEGER NOT NULL DEFAULT 0, "tracksAnalyzed" INTEGER NOT NULL DEFAULT 0,
  "tracksQuarantined" INTEGER NOT NULL DEFAULT 0, "playlistMatches" INTEGER NOT NULL DEFAULT 0,
  "suggestions" INTEGER NOT NULL DEFAULT 0, "automaticallyAdded" INTEGER NOT NULL DEFAULT 0,
  "rejectedOrIgnored" INTEGER NOT NULL DEFAULT 0, "playlistsModified" INTEGER NOT NULL DEFAULT 0,
  "warningsJson" JSONB, "errorsJson" JSONB, "engineVersion" TEXT NOT NULL DEFAULT 'v2.0.9',
  "settingsSnapshot" JSONB NOT NULL, "progressJson" JSONB, "lockKey" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), "approvedBy" TEXT,
  CONSTRAINT "RecentlyAddedAutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecentlyAddedAutomationChange" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "matchId" TEXT, "trackId" TEXT NOT NULL,
  "generatedPlaylistId" TEXT NOT NULL, "action" TEXT NOT NULL DEFAULT 'add', "status" TEXT NOT NULL DEFAULT 'pending',
  "beforePosition" INTEGER, "afterPosition" INTEGER, "scoreBefore" DOUBLE PRECISION, "scoreAfter" DOUBLE PRECISION,
  "reasonsJson" JSONB, "approvedBy" TEXT, "reviewedAt" TIMESTAMP(3), "appliedAt" TIMESTAMP(3), "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecentlyAddedAutomationChange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecentlyAddedNotificationState" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "batchKey" TEXT NOT NULL, "triggerType" TEXT NOT NULL,
  "title" TEXT NOT NULL, "message" TEXT NOT NULL, "link" TEXT, "readAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecentlyAddedNotificationState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecentlyAddedSettings_userId_key" ON "RecentlyAddedSettings"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "RecentlyAddedTrackState_trackId_key" ON "RecentlyAddedTrackState"("trackId");
CREATE UNIQUE INDEX IF NOT EXISTS "PlaylistAutomationSettings_generatedPlaylistId_key" ON "PlaylistAutomationSettings"("generatedPlaylistId");
CREATE UNIQUE INDEX IF NOT EXISTS "RecentlyAddedPlaylistMatch_trackId_generatedPlaylistId_key" ON "RecentlyAddedPlaylistMatch"("trackId", "generatedPlaylistId");
CREATE UNIQUE INDEX IF NOT EXISTS "RecentlyAddedAutomationChange_runId_trackId_generatedPlaylistId_action_key" ON "RecentlyAddedAutomationChange"("runId", "trackId", "generatedPlaylistId", "action");
CREATE UNIQUE INDEX IF NOT EXISTS "RecentlyAddedNotificationState_userId_batchKey_triggerType_key" ON "RecentlyAddedNotificationState"("userId", "batchKey", "triggerType");
CREATE INDEX IF NOT EXISTS "RecentlyAddedBatch_userId_createdAt_idx" ON "RecentlyAddedBatch"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RecentlyAddedBatch_libraryId_createdAt_idx" ON "RecentlyAddedBatch"("libraryId", "createdAt");
CREATE INDEX IF NOT EXISTS "RecentlyAddedBatch_syncLogId_idx" ON "RecentlyAddedBatch"("syncLogId");
CREATE INDEX IF NOT EXISTS "RecentlyAddedTrackState_batchId_status_idx" ON "RecentlyAddedTrackState"("batchId", "status");
CREATE INDEX IF NOT EXISTS "RecentlyAddedTrackState_status_createdAt_idx" ON "RecentlyAddedTrackState"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PlaylistAutomationSettings_userId_mode_idx" ON "PlaylistAutomationSettings"("userId", "mode");
CREATE INDEX IF NOT EXISTS "RecentlyAddedPlaylistMatch_generatedPlaylistId_status_idx" ON "RecentlyAddedPlaylistMatch"("generatedPlaylistId", "status");
CREATE INDEX IF NOT EXISTS "RecentlyAddedPlaylistMatch_batchId_status_idx" ON "RecentlyAddedPlaylistMatch"("batchId", "status");
CREATE INDEX IF NOT EXISTS "RecentlyAddedAutomationRun_userId_startedAt_idx" ON "RecentlyAddedAutomationRun"("userId", "startedAt");
CREATE INDEX IF NOT EXISTS "RecentlyAddedAutomationRun_status_startedAt_idx" ON "RecentlyAddedAutomationRun"("status", "startedAt");
CREATE INDEX IF NOT EXISTS "RecentlyAddedAutomationChange_runId_status_idx" ON "RecentlyAddedAutomationChange"("runId", "status");
CREATE INDEX IF NOT EXISTS "RecentlyAddedAutomationChange_generatedPlaylistId_status_idx" ON "RecentlyAddedAutomationChange"("generatedPlaylistId", "status");
CREATE INDEX IF NOT EXISTS "RecentlyAddedNotificationState_userId_readAt_sentAt_idx" ON "RecentlyAddedNotificationState"("userId", "readAt", "sentAt");

DO $$ BEGIN
  ALTER TABLE "RecentlyAddedSettings" ADD CONSTRAINT "RecentlyAddedSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedBatch" ADD CONSTRAINT "RecentlyAddedBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedBatch" ADD CONSTRAINT "RecentlyAddedBatch_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedTrackState" ADD CONSTRAINT "RecentlyAddedTrackState_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedTrackState" ADD CONSTRAINT "RecentlyAddedTrackState_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RecentlyAddedBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PlaylistAutomationSettings" ADD CONSTRAINT "PlaylistAutomationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PlaylistAutomationSettings" ADD CONSTRAINT "PlaylistAutomationSettings_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedPlaylistMatch" ADD CONSTRAINT "RecentlyAddedPlaylistMatch_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RecentlyAddedBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedPlaylistMatch" ADD CONSTRAINT "RecentlyAddedPlaylistMatch_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedPlaylistMatch" ADD CONSTRAINT "RecentlyAddedPlaylistMatch_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedAutomationRun" ADD CONSTRAINT "RecentlyAddedAutomationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedAutomationRun" ADD CONSTRAINT "RecentlyAddedAutomationRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RecentlyAddedBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedAutomationChange" ADD CONSTRAINT "RecentlyAddedAutomationChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "RecentlyAddedAutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedAutomationChange" ADD CONSTRAINT "RecentlyAddedAutomationChange_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "RecentlyAddedPlaylistMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedAutomationChange" ADD CONSTRAINT "RecentlyAddedAutomationChange_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedAutomationChange" ADD CONSTRAINT "RecentlyAddedAutomationChange_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecentlyAddedNotificationState" ADD CONSTRAINT "RecentlyAddedNotificationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

