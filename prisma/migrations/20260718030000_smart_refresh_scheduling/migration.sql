-- Mixarr v2.2.4 Smart Refresh Scheduling.
-- Additive and conservative: existing playlists remain MANUAL_ONLY and no Plex writes
-- are enabled by this migration.

CREATE TABLE "SmartRefreshGlobalSetting" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  "quietHoursStart" TEXT NOT NULL DEFAULT '22:00',
  "quietHoursEnd" TEXT NOT NULL DEFAULT '07:00',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "allowEvaluationsQuietHours" BOOLEAN NOT NULL DEFAULT true,
  "allowGenerationQuietHours" BOOLEAN NOT NULL DEFAULT false,
  "allowUrgentRepairs" BOOLEAN NOT NULL DEFAULT true,
  "runDeferredAfterQuietHours" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartRefreshGlobalSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartRefreshSettings" (
  "id" TEXT NOT NULL,
  "generatedPlaylistId" TEXT NOT NULL,
  "refreshMode" TEXT NOT NULL DEFAULT 'MANUAL_ONLY',
  "sensitivity" TEXT NOT NULL DEFAULT 'BALANCED',
  "customSettingsJson" JSONB,
  "minimumEstimatedImprovement" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "minimumCompatibleTracks" INTEGER NOT NULL DEFAULT 5,
  "weakTrackThreshold" INTEGER NOT NULL DEFAULT 50,
  "identityDriftThreshold" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "repetitionThreshold" DOUBLE PRECISION NOT NULL DEFAULT 60,
  "metadataImprovementThreshold" INTEGER NOT NULL DEFAULT 2,
  "evaluationIntervalHours" INTEGER NOT NULL DEFAULT 24,
  "minimumRefreshIntervalHours" INTEGER NOT NULL DEFAULT 168,
  "maximumRefreshesPerWeek" INTEGER DEFAULT 1,
  "fallbackAfterHours" INTEGER,
  "quietHoursOverrideJson" JSONB,
  "allowPlaylistGrowth" BOOLEAN NOT NULL DEFAULT false,
  "allowAutomaticWeakTrackRefresh" BOOLEAN NOT NULL DEFAULT true,
  "allowAutomaticFullRegeneration" BOOLEAN NOT NULL DEFAULT false,
  "lastEvaluatedAt" TIMESTAMP(3),
  "lastSuccessfulRefreshAt" TIMESTAMP(3),
  "lastRecommendation" TEXT,
  "lastEstimatedImprovement" DOUBLE PRECISION,
  "deferredUntil" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "invalidationVersion" INTEGER NOT NULL DEFAULT 0,
  "evaluatedInvalidationVersion" INTEGER NOT NULL DEFAULT -1,
  "pendingTriggerSource" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartRefreshSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartRefreshEvaluation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "generatedPlaylistId" TEXT NOT NULL,
  "triggerSource" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "recommendation" TEXT NOT NULL,
  "shouldRefresh" BOOLEAN NOT NULL DEFAULT false,
  "automatic" BOOLEAN NOT NULL DEFAULT false,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currentScore" DOUBLE PRECISION,
  "estimatedScoreAfterRefresh" DOUBLE PRECISION,
  "estimatedImprovement" DOUBLE PRECISION,
  "compatibleNewTrackCount" INTEGER NOT NULL DEFAULT 0,
  "weakTrackCount" INTEGER NOT NULL DEFAULT 0,
  "repetitivePlaybackScore" DOUBLE PRECISION,
  "identityDriftScore" DOUBLE PRECISION,
  "improvedMetadataTrackCount" INTEGER NOT NULL DEFAULT 0,
  "reasonsJson" JSONB NOT NULL,
  "blockersJson" JSONB NOT NULL,
  "suggestedActionsJson" JSONB NOT NULL,
  "thresholdsJson" JSONB NOT NULL,
  "signalSummaryJson" JSONB,
  "previewId" TEXT,
  "playlistUpdatedAt" TIMESTAMP(3) NOT NULL,
  "settingsUpdatedAt" TIMESTAMP(3) NOT NULL,
  "invalidationVersion" INTEGER NOT NULL DEFAULT 0,
  "deferredUntil" TIMESTAMP(3),
  "executionAction" TEXT,
  "actualImprovement" DOUBLE PRECISION,
  "tracksAdded" INTEGER NOT NULL DEFAULT 0,
  "tracksRemoved" INTEGER NOT NULL DEFAULT 0,
  "tracksReordered" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartRefreshEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartRefreshGlobalSetting_userId_key" ON "SmartRefreshGlobalSetting"("userId");
CREATE UNIQUE INDEX "SmartRefreshSettings_generatedPlaylistId_key" ON "SmartRefreshSettings"("generatedPlaylistId");
CREATE INDEX "SmartRefreshSettings_refreshMode_lastEvaluatedAt_idx" ON "SmartRefreshSettings"("refreshMode", "lastEvaluatedAt");
CREATE INDEX "SmartRefreshSettings_refreshMode_deferredUntil_idx" ON "SmartRefreshSettings"("refreshMode", "deferredUntil");
CREATE INDEX "SmartRefreshSettings_lastSuccessfulRefreshAt_idx" ON "SmartRefreshSettings"("lastSuccessfulRefreshAt");
CREATE INDEX "SmartRefreshSettings_lastRecommendation_lastEvaluatedAt_idx" ON "SmartRefreshSettings"("lastRecommendation", "lastEvaluatedAt");
CREATE INDEX "SmartRefreshEvaluation_generatedPlaylistId_evaluatedAt_idx" ON "SmartRefreshEvaluation"("generatedPlaylistId", "evaluatedAt");
CREATE INDEX "SmartRefreshEvaluation_userId_status_evaluatedAt_idx" ON "SmartRefreshEvaluation"("userId", "status", "evaluatedAt");
CREATE INDEX "SmartRefreshEvaluation_status_deferredUntil_idx" ON "SmartRefreshEvaluation"("status", "deferredUntil");
CREATE INDEX "SmartRefreshEvaluation_recommendation_shouldRefresh_evaluatedAt_idx" ON "SmartRefreshEvaluation"("recommendation", "shouldRefresh", "evaluatedAt");
CREATE INDEX "SmartRefreshEvaluation_previewId_idx" ON "SmartRefreshEvaluation"("previewId");

ALTER TABLE "SmartRefreshGlobalSetting" ADD CONSTRAINT "SmartRefreshGlobalSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartRefreshSettings" ADD CONSTRAINT "SmartRefreshSettings_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartRefreshEvaluation" ADD CONSTRAINT "SmartRefreshEvaluation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartRefreshEvaluation" ADD CONSTRAINT "SmartRefreshEvaluation_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
