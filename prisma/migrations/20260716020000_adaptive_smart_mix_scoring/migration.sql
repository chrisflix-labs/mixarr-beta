-- Mixarr v2.1.4 Adaptive Smart Mix Scoring.
-- Additive only: existing personalization, feedback, playlist identity, history,
-- generated playlists, and playlist revisions remain unchanged.

ALTER TABLE "GeneratedPlaylist" ADD COLUMN "adaptiveScoringVersion" TEXT;
ALTER TABLE "GeneratedPlaylist" ADD COLUMN "adaptiveSettingsJson" JSONB;
ALTER TABLE "GeneratedPlaylistTrack" ADD COLUMN "adaptiveScoreJson" JSONB;

CREATE TABLE "AdaptiveScoringProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "preset" TEXT NOT NULL DEFAULT 'balanced',
    "maximumInfluence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "showExplanationsByDefault" BOOLEAN NOT NULL DEFAULT false,
    "includeInferredBehavior" BOOLEAN NOT NULL DEFAULT true,
    "includePlaylistHistory" BOOLEAN NOT NULL DEFAULT true,
    "includePlaylistIdentity" BOOLEAN NOT NULL DEFAULT true,
    "includeArtistPreferences" BOOLEAN NOT NULL DEFAULT true,
    "includeMoodPreferences" BOOLEAN NOT NULL DEFAULT true,
    "includeDiscoveryTolerance" BOOLEAN NOT NULL DEFAULT true,
    "includeRepeatTolerance" BOOLEAN NOT NULL DEFAULT true,
    "minimumConfidence" TEXT NOT NULL DEFAULT 'low',
    "preferExplicitFeedback" BOOLEAN NOT NULL DEFAULT true,
    "reduceOldFeedback" BOOLEAN NOT NULL DEFAULT true,
    "positiveAdjustmentLimit" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "negativeAdjustmentLimit" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "componentWeightsJson" JSONB NOT NULL DEFAULT '{"personalPreference":1,"playlistIdentity":1,"historicalAcceptance":1,"historicalRejection":1,"artistPreference":1,"moodPreference":1,"discoveryTolerance":1,"repeatTolerance":1}',
    "scoringVersion" TEXT NOT NULL DEFAULT '1',
    "needsRecalculation" BOOLEAN NOT NULL DEFAULT false,
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "statisticCount" INTEGER NOT NULL DEFAULT 0,
    "lastRecalculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdaptiveScoringProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdaptivePlaylistScoringSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "enabledOverride" BOOLEAN,
    "maximumInfluenceOverride" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdaptivePlaylistScoringSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdaptivePreferenceStatistic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playlistId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "positiveWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "negativeWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "explicitCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastObservedAt" TIMESTAMP(3),
    "sourceSummaryJson" JSONB,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdaptivePreferenceStatistic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdaptiveScoringProfile_userId_key" ON "AdaptiveScoringProfile"("userId");
CREATE INDEX "AdaptiveScoringProfile_enabled_needsRecalculation_idx" ON "AdaptiveScoringProfile"("enabled", "needsRecalculation");
CREATE INDEX "AdaptiveScoringProfile_lastRecalculatedAt_idx" ON "AdaptiveScoringProfile"("lastRecalculatedAt");
CREATE UNIQUE INDEX "AdaptivePlaylistScoringSetting_playlistId_key" ON "AdaptivePlaylistScoringSetting"("playlistId");
CREATE INDEX "AdaptivePlaylistScoringSetting_userId_updatedAt_idx" ON "AdaptivePlaylistScoringSetting"("userId", "updatedAt");
CREATE UNIQUE INDEX "AdaptivePreferenceStatistic_userId_scopeKey_dimension_featureKey_key" ON "AdaptivePreferenceStatistic"("userId", "scopeKey", "dimension", "featureKey");
CREATE INDEX "AdaptivePreferenceStatistic_userId_playlistId_dimension_idx" ON "AdaptivePreferenceStatistic"("userId", "playlistId", "dimension");
CREATE INDEX "AdaptivePreferenceStatistic_userId_confidence_idx" ON "AdaptivePreferenceStatistic"("userId", "confidence");

ALTER TABLE "AdaptiveScoringProfile" ADD CONSTRAINT "AdaptiveScoringProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdaptivePlaylistScoringSetting" ADD CONSTRAINT "AdaptivePlaylistScoringSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdaptivePlaylistScoringSetting" ADD CONSTRAINT "AdaptivePlaylistScoringSetting_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdaptivePreferenceStatistic" ADD CONSTRAINT "AdaptivePreferenceStatistic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
