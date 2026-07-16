-- Mixarr v2.1.3 Playlist Identity & Memory.
-- Additive only: legacy playlists are initialized lazily by the service.
ALTER TABLE "SyncSettings" ADD COLUMN "playlistIdentityLearningEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "PlaylistIdentity" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plexPlaylistId" TEXT,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "learningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "preservationMode" TEXT NOT NULL DEFAULT 'BALANCED',
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceState" TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "creationSource" TEXT NOT NULL DEFAULT 'GENERATED',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "trainingSampleCount" INTEGER NOT NULL DEFAULT 0,
    "historicalTrackCount" INTEGER NOT NULL DEFAULT 0,
    "currentTrackCount" INTEGER NOT NULL DEFAULT 0,
    "versionCount" INTEGER NOT NULL DEFAULT 0,
    "moodConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "energyConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bpmConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "artistConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "genreConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discoveryConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avoidanceConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transitionConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "learnedProfileJson" JSONB,
    "userProfileJson" JSONB,
    "effectiveProfileJson" JSONB,
    "confidenceReasonsJson" JSONB,
    "learningSettingsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastTrainedAt" TIMESTAMP(3),
    "lastRegeneratedAt" TIMESTAMP(3),
    CONSTRAINT "PlaylistIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistIdentityAttribute" (
    "id" TEXT NOT NULL,
    "playlistIdentityId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userValueJson" JSONB,
    "learnedValueJson" JSONB,
    "effectiveValueJson" JSONB,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "inherited" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'LEARNED',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "insufficientData" BOOLEAN NOT NULL DEFAULT true,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlaylistIdentityAttribute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistTrackMemory" (
    "id" TEXT NOT NULL,
    "playlistIdentityId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "importance" TEXT NOT NULL DEFAULT 'NORMAL',
    "section" TEXT,
    "positionLocked" BOOLEAN NOT NULL DEFAULT false,
    "rejectionState" TEXT NOT NULL DEFAULT 'NONE',
    "rejectionReason" TEXT,
    "rejectionSource" TEXT,
    "rejectionCount" INTEGER NOT NULL DEFAULT 0,
    "firstRejectedAt" TIMESTAMP(3),
    "lastRejectedAt" TIMESTAMP(3),
    "rejectionExpiresAt" TIMESTAMP(3),
    "permanentRejection" BOOLEAN NOT NULL DEFAULT false,
    "userConfirmedRejection" BOOLEAN NOT NULL DEFAULT false,
    "inferenceConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "acceptanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "membershipCount" INTEGER NOT NULL DEFAULT 0,
    "retainedCount" INTEGER NOT NULL DEFAULT 0,
    "restoredCount" INTEGER NOT NULL DEFAULT 0,
    "manualAddCount" INTEGER NOT NULL DEFAULT 0,
    "manualRemoveCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlaylistTrackMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistMembershipEvent" (
    "id" TEXT NOT NULL,
    "playlistIdentityId" TEXT NOT NULL,
    "trackId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventSource" TEXT NOT NULL,
    "previousPosition" INTEGER,
    "newPosition" INTEGER,
    "playlistVersionId" TEXT,
    "engineVersion" TEXT,
    "generationRunId" TEXT,
    "userId" TEXT,
    "feedbackReason" TEXT,
    "eventKey" TEXT NOT NULL,
    "snapshotJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistMembershipEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistArtistPreference" (
    "id" TEXT NOT NULL,
    "playlistIdentityId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "positiveEvidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "negativeEvidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userDefined" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlaylistArtistPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistGenrePreference" (
    "id" TEXT NOT NULL,
    "playlistIdentityId" TEXT NOT NULL,
    "genreKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "genreType" TEXT NOT NULL DEFAULT 'genre',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "positiveEvidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "negativeEvidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userDefined" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlaylistGenrePreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistIdentityTrainingRun" (
    "id" TEXT NOT NULL,
    "playlistIdentityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "source" TEXT NOT NULL,
    "stagesJson" JSONB,
    "inputSummaryJson" JSONB,
    "beforeProfileJson" JSONB,
    "afterProfileJson" JSONB,
    "comparisonJson" JSONB,
    "tracksAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "eventsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "versionsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "PlaylistIdentityTrainingRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistIdentitySnapshot" (
    "id" TEXT NOT NULL,
    "playlistIdentityId" TEXT NOT NULL,
    "playlistVersionId" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "profileJson" JSONB NOT NULL,
    "confidenceJson" JSONB,
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistIdentitySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaylistIdentity_playlistId_key" ON "PlaylistIdentity"("playlistId");
CREATE INDEX "PlaylistIdentity_userId_updatedAt_idx" ON "PlaylistIdentity"("userId", "updatedAt");
CREATE INDEX "PlaylistIdentity_plexPlaylistId_idx" ON "PlaylistIdentity"("plexPlaylistId");
CREATE INDEX "PlaylistIdentity_enabled_learningEnabled_idx" ON "PlaylistIdentity"("enabled", "learningEnabled");
CREATE UNIQUE INDEX "PlaylistIdentityAttribute_playlistIdentityId_key_key" ON "PlaylistIdentityAttribute"("playlistIdentityId", "key");
CREATE INDEX "PlaylistIdentityAttribute_playlistIdentityId_source_idx" ON "PlaylistIdentityAttribute"("playlistIdentityId", "source");
CREATE UNIQUE INDEX "PlaylistTrackMemory_playlistIdentityId_trackId_key" ON "PlaylistTrackMemory"("playlistIdentityId", "trackId");
CREATE INDEX "PlaylistTrackMemory_playlistIdentityId_rejectionState_updatedAt_idx" ON "PlaylistTrackMemory"("playlistIdentityId", "rejectionState", "updatedAt");
CREATE INDEX "PlaylistTrackMemory_playlistIdentityId_importance_idx" ON "PlaylistTrackMemory"("playlistIdentityId", "importance");
CREATE INDEX "PlaylistTrackMemory_trackId_idx" ON "PlaylistTrackMemory"("trackId");
CREATE UNIQUE INDEX "PlaylistMembershipEvent_eventKey_key" ON "PlaylistMembershipEvent"("eventKey");
CREATE INDEX "PlaylistMembershipEvent_playlistIdentityId_occurredAt_idx" ON "PlaylistMembershipEvent"("playlistIdentityId", "occurredAt");
CREATE INDEX "PlaylistMembershipEvent_playlistIdentityId_trackId_occurredAt_idx" ON "PlaylistMembershipEvent"("playlistIdentityId", "trackId", "occurredAt");
CREATE INDEX "PlaylistMembershipEvent_playlistVersionId_idx" ON "PlaylistMembershipEvent"("playlistVersionId");
CREATE INDEX "PlaylistMembershipEvent_generationRunId_idx" ON "PlaylistMembershipEvent"("generationRunId");
CREATE UNIQUE INDEX "PlaylistArtistPreference_playlistIdentityId_artistId_key" ON "PlaylistArtistPreference"("playlistIdentityId", "artistId");
CREATE INDEX "PlaylistArtistPreference_playlistIdentityId_score_idx" ON "PlaylistArtistPreference"("playlistIdentityId", "score");
CREATE INDEX "PlaylistArtistPreference_artistId_idx" ON "PlaylistArtistPreference"("artistId");
CREATE UNIQUE INDEX "PlaylistGenrePreference_playlistIdentityId_genreKey_key" ON "PlaylistGenrePreference"("playlistIdentityId", "genreKey");
CREATE INDEX "PlaylistGenrePreference_playlistIdentityId_score_idx" ON "PlaylistGenrePreference"("playlistIdentityId", "score");
CREATE INDEX "PlaylistIdentityTrainingRun_playlistIdentityId_startedAt_idx" ON "PlaylistIdentityTrainingRun"("playlistIdentityId", "startedAt");
CREATE INDEX "PlaylistIdentityTrainingRun_status_startedAt_idx" ON "PlaylistIdentityTrainingRun"("status", "startedAt");
CREATE UNIQUE INDEX "PlaylistIdentitySnapshot_playlistVersionId_key" ON "PlaylistIdentitySnapshot"("playlistVersionId");
CREATE INDEX "PlaylistIdentitySnapshot_playlistIdentityId_createdAt_idx" ON "PlaylistIdentitySnapshot"("playlistIdentityId", "createdAt");

ALTER TABLE "PlaylistIdentity" ADD CONSTRAINT "PlaylistIdentity_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistIdentity" ADD CONSTRAINT "PlaylistIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistIdentityAttribute" ADD CONSTRAINT "PlaylistIdentityAttribute_playlistIdentityId_fkey" FOREIGN KEY ("playlistIdentityId") REFERENCES "PlaylistIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistTrackMemory" ADD CONSTRAINT "PlaylistTrackMemory_playlistIdentityId_fkey" FOREIGN KEY ("playlistIdentityId") REFERENCES "PlaylistIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistTrackMemory" ADD CONSTRAINT "PlaylistTrackMemory_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistMembershipEvent" ADD CONSTRAINT "PlaylistMembershipEvent_playlistIdentityId_fkey" FOREIGN KEY ("playlistIdentityId") REFERENCES "PlaylistIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistMembershipEvent" ADD CONSTRAINT "PlaylistMembershipEvent_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistArtistPreference" ADD CONSTRAINT "PlaylistArtistPreference_playlistIdentityId_fkey" FOREIGN KEY ("playlistIdentityId") REFERENCES "PlaylistIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistArtistPreference" ADD CONSTRAINT "PlaylistArtistPreference_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistGenrePreference" ADD CONSTRAINT "PlaylistGenrePreference_playlistIdentityId_fkey" FOREIGN KEY ("playlistIdentityId") REFERENCES "PlaylistIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistIdentityTrainingRun" ADD CONSTRAINT "PlaylistIdentityTrainingRun_playlistIdentityId_fkey" FOREIGN KEY ("playlistIdentityId") REFERENCES "PlaylistIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistIdentitySnapshot" ADD CONSTRAINT "PlaylistIdentitySnapshot_playlistIdentityId_fkey" FOREIGN KEY ("playlistIdentityId") REFERENCES "PlaylistIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistIdentitySnapshot" ADD CONSTRAINT "PlaylistIdentitySnapshot_playlistVersionId_fkey" FOREIGN KEY ("playlistVersionId") REFERENCES "PlaylistRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
