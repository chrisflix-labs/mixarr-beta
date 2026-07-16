-- Mixarr v2.1.5 Listening History & Playback Awareness.
-- Additive and disabled by default. Existing playlists and scoring remain valid.

ALTER TABLE "GeneratedPlaylist" ADD COLUMN "playbackSettingsJson" JSONB;
ALTER TABLE "GeneratedPlaylistTrack" ADD COLUMN "playbackScoreJson" JSONB;

CREATE TABLE "PlexAccount" (
  "id" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "plexUserId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "email" TEXT,
  "thumb" TEXT,
  "accountType" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlexAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlexUserMapping" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "plexAccountId" TEXT NOT NULL,
  "plexUserId" TEXT NOT NULL,
  "plexUsername" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlexUserMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaybackAwarenessSetting" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "influence" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  "recentlyPlayedBehavior" TEXT NOT NULL DEFAULT 'soft',
  "recentlyPlayedWindowDays" INTEGER,
  "forgottenFavoriteDays" INTEGER,
  "useSkipHistory" BOOLEAN NOT NULL DEFAULT true,
  "useCompletionHistory" BOOLEAN NOT NULL DEFAULT true,
  "useReplayHistory" BOOLEAN NOT NULL DEFAULT true,
  "playbackAwareDiscovery" BOOLEAN NOT NULL DEFAULT true,
  "completionThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
  "skipThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
  "minimumSkipDurationMs" INTEGER NOT NULL DEFAULT 10000,
  "minimumObservations" INTEGER NOT NULL DEFAULT 3,
  "maximumAdjustment" DOUBLE PRECISION NOT NULL DEFAULT 8,
  "historyRetentionDays" INTEGER NOT NULL DEFAULT 730,
  "syncIntervalHours" INTEGER NOT NULL DEFAULT 24,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaybackAwarenessSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlexPlaybackEvent" (
  "id" TEXT NOT NULL,
  "importKey" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "libraryId" TEXT,
  "plexUserId" TEXT NOT NULL,
  "plexUsername" TEXT,
  "trackId" TEXT,
  "plexRatingKey" TEXT,
  "playedAt" TIMESTAMP(3) NOT NULL,
  "durationMs" INTEGER,
  "viewOffsetMs" INTEGER,
  "completionPercent" DOUBLE PRECISION,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "skipped" BOOLEAN NOT NULL DEFAULT false,
  "playCountContribution" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL DEFAULT 'plex_history',
  "rawEventType" TEXT,
  "unmatchedReason" TEXT,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlexPlaybackEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserTrackPlaybackProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "plexUserId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "totalPlayCount" INTEGER NOT NULL DEFAULT 0,
  "completedPlayCount" INTEGER NOT NULL DEFAULT 0,
  "skipCount" INTEGER NOT NULL DEFAULT 0,
  "replayCount" INTEGER NOT NULL DEFAULT 0,
  "completionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "skipRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "firstPlayedAt" TIMESTAMP(3),
  "lastPlayedAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "lastSkippedAt" TIMESTAMP(3),
  "averageCompletionPercent" DOUBLE PRECISION,
  "recentPlayCount7Days" INTEGER NOT NULL DEFAULT 0,
  "recentPlayCount14Days" INTEGER NOT NULL DEFAULT 0,
  "recentPlayCount30Days" INTEGER NOT NULL DEFAULT 0,
  "recentPlayCount90Days" INTEGER NOT NULL DEFAULT 0,
  "forgottenFavoriteScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "playbackAffinityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "playbackConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserTrackPlaybackProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaybackSyncState" (
  "id" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "lastSuccessfulSyncAt" TIMESTAMP(3),
  "lastAttemptedSyncAt" TIMESTAMP(3),
  "lastImportedPlexHistoryAt" TIMESTAMP(3),
  "currentState" TEXT NOT NULL DEFAULT 'idle',
  "importedEventCount" INTEGER NOT NULL DEFAULT 0,
  "updatedProfileCount" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "syncDurationMs" INTEGER,
  "syncMode" TEXT,
  "oldestAvailablePlexHistoryAt" TIMESTAMP(3),
  "discoveredUserCount" INTEGER NOT NULL DEFAULT 0,
  "unmatchedEventCount" INTEGER NOT NULL DEFAULT 0,
  "nextScheduledSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaybackSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlexAccount_serverId_plexUserId_key" ON "PlexAccount"("serverId", "plexUserId");
CREATE INDEX "PlexAccount_serverId_username_idx" ON "PlexAccount"("serverId", "username");
CREATE INDEX "PlexAccount_lastSeenAt_idx" ON "PlexAccount"("lastSeenAt");
CREATE UNIQUE INDEX "PlexUserMapping_userId_serverId_key" ON "PlexUserMapping"("userId", "serverId");
CREATE INDEX "PlexUserMapping_serverId_plexUserId_idx" ON "PlexUserMapping"("serverId", "plexUserId");
CREATE INDEX "PlexUserMapping_userId_enabled_idx" ON "PlexUserMapping"("userId", "enabled");
CREATE UNIQUE INDEX "PlaybackAwarenessSetting_userId_key" ON "PlaybackAwarenessSetting"("userId");
CREATE INDEX "PlaybackAwarenessSetting_enabled_updatedAt_idx" ON "PlaybackAwarenessSetting"("enabled", "updatedAt");
CREATE UNIQUE INDEX "PlexPlaybackEvent_importKey_key" ON "PlexPlaybackEvent"("importKey");
CREATE INDEX "PlexPlaybackEvent_serverId_playedAt_idx" ON "PlexPlaybackEvent"("serverId", "playedAt");
CREATE INDEX "PlexPlaybackEvent_libraryId_playedAt_idx" ON "PlexPlaybackEvent"("libraryId", "playedAt");
CREATE INDEX "PlexPlaybackEvent_plexUserId_playedAt_idx" ON "PlexPlaybackEvent"("plexUserId", "playedAt");
CREATE INDEX "PlexPlaybackEvent_trackId_playedAt_idx" ON "PlexPlaybackEvent"("trackId", "playedAt");
CREATE INDEX "PlexPlaybackEvent_serverId_plexRatingKey_idx" ON "PlexPlaybackEvent"("serverId", "plexRatingKey");
CREATE INDEX "PlexPlaybackEvent_unmatchedReason_playedAt_idx" ON "PlexPlaybackEvent"("unmatchedReason", "playedAt");
CREATE UNIQUE INDEX "UserTrackPlaybackProfile_userId_trackId_key" ON "UserTrackPlaybackProfile"("userId", "trackId");
CREATE INDEX "UserTrackPlaybackProfile_userId_lastPlayedAt_idx" ON "UserTrackPlaybackProfile"("userId", "lastPlayedAt");
CREATE INDEX "UserTrackPlaybackProfile_userId_playbackConfidence_idx" ON "UserTrackPlaybackProfile"("userId", "playbackConfidence");
CREATE INDEX "UserTrackPlaybackProfile_userId_forgottenFavoriteScore_idx" ON "UserTrackPlaybackProfile"("userId", "forgottenFavoriteScore");
CREATE INDEX "UserTrackPlaybackProfile_trackId_idx" ON "UserTrackPlaybackProfile"("trackId");
CREATE UNIQUE INDEX "PlaybackSyncState_serverId_key" ON "PlaybackSyncState"("serverId");
CREATE INDEX "PlaybackSyncState_currentState_updatedAt_idx" ON "PlaybackSyncState"("currentState", "updatedAt");
CREATE INDEX "PlaybackSyncState_lastSuccessfulSyncAt_idx" ON "PlaybackSyncState"("lastSuccessfulSyncAt");

ALTER TABLE "PlexAccount" ADD CONSTRAINT "PlexAccount_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlexUserMapping" ADD CONSTRAINT "PlexUserMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlexUserMapping" ADD CONSTRAINT "PlexUserMapping_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlexUserMapping" ADD CONSTRAINT "PlexUserMapping_plexAccountId_fkey" FOREIGN KEY ("plexAccountId") REFERENCES "PlexAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaybackAwarenessSetting" ADD CONSTRAINT "PlaybackAwarenessSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlexPlaybackEvent" ADD CONSTRAINT "PlexPlaybackEvent_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlexPlaybackEvent" ADD CONSTRAINT "PlexPlaybackEvent_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlexPlaybackEvent" ADD CONSTRAINT "PlexPlaybackEvent_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserTrackPlaybackProfile" ADD CONSTRAINT "UserTrackPlaybackProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTrackPlaybackProfile" ADD CONSTRAINT "UserTrackPlaybackProfile_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaybackSyncState" ADD CONSTRAINT "PlaybackSyncState_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
