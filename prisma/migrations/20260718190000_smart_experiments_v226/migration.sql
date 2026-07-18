-- Mixarr v2.2.6: Smart Experiments & Playlist A/B Testing
-- Additive only. Existing playlists, Smart Mix settings, playback data, and
-- playlist-version history are not modified.

CREATE TABLE "SmartExperiment" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "sourcePlaylistId" TEXT NOT NULL,
  "originalPlaylistVersionId" TEXT NOT NULL, "name" TEXT NOT NULL, "hypothesis" TEXT,
  "experimentType" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publicationMode" TEXT NOT NULL DEFAULT 'PREVIEW_ONLY', "durationType" TEXT NOT NULL DEFAULT 'MANUAL',
  "durationTarget" INTEGER, "startAt" TIMESTAMP(3), "plannedEndAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3), "pausedAt" TIMESTAMP(3), "pausedDurationSeconds" INTEGER NOT NULL DEFAULT 0,
  "completionReason" TEXT, "suggestedWinner" TEXT, "selectedWinner" TEXT, "winnerConfidence" TEXT,
  "recommendationExplanation" JSONB, "configurationSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "constantConfiguration" JSONB NOT NULL, "originalSnapshot" JSONB NOT NULL,
  "candidatePoolReference" TEXT, "librarySnapshotReference" TEXT, "metadataSnapshotReference" TEXT,
  "randomSeed" TEXT, "overlapPercentage" DOUBLE PRECISION, "generatedAt" TIMESTAMP(3),
  "finalPlexPlaylistId" TEXT, "alternatingIntervalHours" INTEGER NOT NULL DEFAULT 24,
  "activeVariant" TEXT, "lastRotatedAt" TIMESTAMP(3), "idempotencyKey" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartExperiment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartExperimentVariant" (
  "id" TEXT NOT NULL, "experimentId" TEXT NOT NULL, "variant" TEXT NOT NULL,
  "generatedPlaylistId" TEXT, "playlistVersionId" TEXT, "plexPlaylistId" TEXT,
  "engineVersion" TEXT NOT NULL, "randomSeed" TEXT NOT NULL,
  "configurationSchemaVersion" INTEGER NOT NULL DEFAULT 1, "configurationSnapshot" JSONB NOT NULL,
  "librarySnapshotReference" TEXT, "candidatePoolReference" TEXT, "fallbackBehavior" JSONB,
  "missingMetadataConditions" JSONB, "personalizationSnapshot" JSONB,
  "generatedTrackCount" INTEGER NOT NULL DEFAULT 0, "playlistScore" DOUBLE PRECISION,
  "generationStatus" TEXT NOT NULL DEFAULT 'PENDING', "generationError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartExperimentVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartExperimentMetric" (
  "id" TEXT NOT NULL, "experimentId" TEXT NOT NULL, "variantId" TEXT NOT NULL,
  "metricType" TEXT NOT NULL, "metricValue" DOUBLE PRECISION NOT NULL, "sampleSize" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL, "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartExperimentMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartExperimentTrack" (
  "id" TEXT NOT NULL, "experimentId" TEXT NOT NULL, "variantId" TEXT NOT NULL, "trackId" TEXT NOT NULL,
  "position" INTEGER NOT NULL, "selectionScore" DOUBLE PRECISION, "selectionExplanation" JSONB,
  "personalizationInfluenced" BOOLEAN NOT NULL DEFAULT false, "sharedBetweenVariants" BOOLEAN NOT NULL DEFAULT false,
  "evaluated" BOOLEAN NOT NULL DEFAULT false, "accepted" BOOLEAN NOT NULL DEFAULT false,
  "rejected" BOOLEAN NOT NULL DEFAULT false, "kept" BOOLEAN NOT NULL DEFAULT false,
  "removed" BOOLEAN NOT NULL DEFAULT false, "replaced" BOOLEAN NOT NULL DEFAULT false,
  "liked" BOOLEAN NOT NULL DEFAULT false, "disliked" BOOLEAN NOT NULL DEFAULT false,
  "neverRecommend" BOOLEAN NOT NULL DEFAULT false, "goodPlaylistFit" BOOLEAN NOT NULL DEFAULT false,
  "poorTransition" BOOLEAN NOT NULL DEFAULT false, "explicitFeedbackCount" INTEGER NOT NULL DEFAULT 0,
  "skipCount" INTEGER NOT NULL DEFAULT 0, "earlySkipCount" INTEGER NOT NULL DEFAULT 0,
  "playbackCount" INTEGER NOT NULL DEFAULT 0, "listeningDurationMs" BIGINT NOT NULL DEFAULT 0,
  "lastPlaybackAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SmartExperimentTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartExperimentEvent" (
  "id" TEXT NOT NULL, "experimentId" TEXT NOT NULL, "eventType" TEXT NOT NULL, "actorUserId" TEXT,
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartExperimentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartExperimentDecision" (
  "id" TEXT NOT NULL, "experimentId" TEXT NOT NULL, "decisionType" TEXT NOT NULL,
  "selectedVariant" TEXT, "mergedConfiguration" JSONB, "explanation" TEXT, "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartExperimentDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartExperimentSetting" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "defaultDurationType" TEXT NOT NULL DEFAULT 'DAYS', "defaultDurationTarget" INTEGER NOT NULL DEFAULT 7,
  "defaultPublicationMode" TEXT NOT NULL DEFAULT 'PREVIEW_ONLY', "minimumPlaybackSessions" INTEGER NOT NULL DEFAULT 3,
  "minimumTrackInteractions" INTEGER NOT NULL DEFAULT 10, "minimumDurationHours" INTEGER NOT NULL DEFAULT 24,
  "minimumResultDifference" DOUBLE PRECISION NOT NULL DEFAULT 5, "minimumConfidence" TEXT NOT NULL DEFAULT 'LOW',
  "allowPlaybackMetrics" BOOLEAN NOT NULL DEFAULT true, "automaticallyEvaluate" BOOLEAN NOT NULL DEFAULT true,
  "automaticallyPauseMissingPlaylists" BOOLEAN NOT NULL DEFAULT true, "historyRetentionDays" INTEGER,
  "showAdvancedControls" BOOLEAN NOT NULL DEFAULT false, "allowMultiVariableExperiments" BOOLEAN NOT NULL DEFAULT true,
  "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SmartExperimentSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartExperiment_userId_idempotencyKey_key" ON "SmartExperiment"("userId", "idempotencyKey");
CREATE INDEX "SmartExperiment_userId_status_updatedAt_idx" ON "SmartExperiment"("userId", "status", "updatedAt");
CREATE INDEX "SmartExperiment_sourcePlaylistId_createdAt_idx" ON "SmartExperiment"("sourcePlaylistId", "createdAt");
CREATE INDEX "SmartExperiment_status_plannedEndAt_idx" ON "SmartExperiment"("status", "plannedEndAt");
CREATE INDEX "SmartExperiment_status_publicationMode_lastRotatedAt_idx" ON "SmartExperiment"("status", "publicationMode", "lastRotatedAt");
CREATE INDEX "SmartExperiment_completedAt_idx" ON "SmartExperiment"("completedAt");
CREATE UNIQUE INDEX "SmartExperimentVariant_experimentId_variant_key" ON "SmartExperimentVariant"("experimentId", "variant");
CREATE INDEX "SmartExperimentVariant_experimentId_generationStatus_idx" ON "SmartExperimentVariant"("experimentId", "generationStatus");
CREATE INDEX "SmartExperimentVariant_plexPlaylistId_idx" ON "SmartExperimentVariant"("plexPlaylistId");
CREATE UNIQUE INDEX "SmartExperimentMetric_variantId_metricType_source_key" ON "SmartExperimentMetric"("variantId", "metricType", "source");
CREATE INDEX "SmartExperimentMetric_experimentId_metricType_idx" ON "SmartExperimentMetric"("experimentId", "metricType");
CREATE INDEX "SmartExperimentMetric_experimentId_calculatedAt_idx" ON "SmartExperimentMetric"("experimentId", "calculatedAt");
CREATE UNIQUE INDEX "SmartExperimentTrack_variantId_trackId_key" ON "SmartExperimentTrack"("variantId", "trackId");
CREATE INDEX "SmartExperimentTrack_experimentId_trackId_idx" ON "SmartExperimentTrack"("experimentId", "trackId");
CREATE INDEX "SmartExperimentTrack_variantId_position_idx" ON "SmartExperimentTrack"("variantId", "position");
CREATE INDEX "SmartExperimentTrack_trackId_experimentId_idx" ON "SmartExperimentTrack"("trackId", "experimentId");
CREATE INDEX "SmartExperimentEvent_experimentId_createdAt_idx" ON "SmartExperimentEvent"("experimentId", "createdAt");
CREATE INDEX "SmartExperimentEvent_eventType_createdAt_idx" ON "SmartExperimentEvent"("eventType", "createdAt");
CREATE INDEX "SmartExperimentDecision_experimentId_createdAt_idx" ON "SmartExperimentDecision"("experimentId", "createdAt");
CREATE INDEX "SmartExperimentDecision_decisionType_createdAt_idx" ON "SmartExperimentDecision"("decisionType", "createdAt");
CREATE UNIQUE INDEX "SmartExperimentSetting_userId_key" ON "SmartExperimentSetting"("userId");

ALTER TABLE "SmartExperiment" ADD CONSTRAINT "SmartExperiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartExperiment" ADD CONSTRAINT "SmartExperiment_sourcePlaylistId_fkey" FOREIGN KEY ("sourcePlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SmartExperiment" ADD CONSTRAINT "SmartExperiment_originalPlaylistVersionId_fkey" FOREIGN KEY ("originalPlaylistVersionId") REFERENCES "PlaylistRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentVariant" ADD CONSTRAINT "SmartExperimentVariant_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "SmartExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentVariant" ADD CONSTRAINT "SmartExperimentVariant_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentVariant" ADD CONSTRAINT "SmartExperimentVariant_playlistVersionId_fkey" FOREIGN KEY ("playlistVersionId") REFERENCES "PlaylistRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentMetric" ADD CONSTRAINT "SmartExperimentMetric_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "SmartExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentMetric" ADD CONSTRAINT "SmartExperimentMetric_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "SmartExperimentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentTrack" ADD CONSTRAINT "SmartExperimentTrack_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "SmartExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentTrack" ADD CONSTRAINT "SmartExperimentTrack_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "SmartExperimentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentTrack" ADD CONSTRAINT "SmartExperimentTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentEvent" ADD CONSTRAINT "SmartExperimentEvent_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "SmartExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentEvent" ADD CONSTRAINT "SmartExperimentEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentDecision" ADD CONSTRAINT "SmartExperimentDecision_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "SmartExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentDecision" ADD CONSTRAINT "SmartExperimentDecision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartExperimentSetting" ADD CONSTRAINT "SmartExperimentSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
