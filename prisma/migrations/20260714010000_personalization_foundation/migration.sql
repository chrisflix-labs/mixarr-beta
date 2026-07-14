-- Mixarr v2.1.0: optional, locally stored personalization foundation.
CREATE TABLE "UserRecommendationProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "learningEnabled" BOOLEAN NOT NULL DEFAULT false,
  "profileVersion" TEXT NOT NULL DEFAULT '1',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidenceState" TEXT NOT NULL DEFAULT 'NOT_ENOUGH_DATA',
  "minimumEventsRequired" INTEGER NOT NULL DEFAULT 10,
  "interactionCount" INTEGER NOT NULL DEFAULT 0,
  "lastCalculatedAt" TIMESTAMP(3),
  "preferredEnergyMin" DOUBLE PRECISION,
  "preferredEnergyMax" DOUBLE PRECISION,
  "preferredBpmMin" DOUBLE PRECISION,
  "preferredBpmMax" DOUBLE PRECISION,
  "preferredDiscoveryLevel" DOUBLE PRECISION,
  "preferredDeepCutWeight" DOUBLE PRECISION,
  "preferredPopularityWeight" DOUBLE PRECISION,
  "preferredMoodWeight" DOUBLE PRECISION,
  "preferredEnergyWeight" DOUBLE PRECISION,
  "preferredBpmWeight" DOUBLE PRECISION,
  "preferredArtistVariety" DOUBLE PRECISION,
  "preferredAlbumVariety" DOUBLE PRECISION,
  "avoidRecentlyPlayed" BOOLEAN NOT NULL DEFAULT false,
  "avoidRecentlyUsedArtists" BOOLEAN NOT NULL DEFAULT false,
  "avoidLiveRecordings" BOOLEAN NOT NULL DEFAULT false,
  "avoidLowConfidenceMetadata" BOOLEAN NOT NULL DEFAULT false,
  "secondaryTraits" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserRecommendationProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistPreferenceProfile" (
  "id" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "mode" TEXT NOT NULL DEFAULT 'GENERAL_PROFILE',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "isLearned" BOOLEAN NOT NULL DEFAULT false,
  "energyMin" DOUBLE PRECISION,
  "energyMax" DOUBLE PRECISION,
  "bpmMin" DOUBLE PRECISION,
  "bpmMax" DOUBLE PRECISION,
  "discoveryPreference" DOUBLE PRECISION,
  "deepCutPreference" DOUBLE PRECISION,
  "artistVarietyPreference" DOUBLE PRECISION,
  "albumVarietyPreference" DOUBLE PRECISION,
  "repetitionTolerance" DOUBLE PRECISION,
  "avoidLiveRecordings" BOOLEAN,
  "avoidLowConfidenceMetadata" BOOLEAN,
  "avoidRecentlyPlayedTracks" BOOLEAN,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "evidenceCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistPreferenceProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackInteractionEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "playlistId" TEXT,
  "playlistVersionId" TEXT,
  "eventType" TEXT NOT NULL,
  "eventSource" TEXT NOT NULL,
  "generationId" TEXT,
  "idempotencyKey" TEXT,
  "contextJson" JSONB,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrackInteractionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonalScoringAdjustment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "featureType" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "adjustment" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sampleSize" INTEGER NOT NULL DEFAULT 0,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  CONSTRAINT "PersonalScoringAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserRecommendationProfile_userId_key" ON "UserRecommendationProfile"("userId");
CREATE INDEX "UserRecommendationProfile_enabled_learningEnabled_idx" ON "UserRecommendationProfile"("enabled", "learningEnabled");
CREATE INDEX "UserRecommendationProfile_lastCalculatedAt_idx" ON "UserRecommendationProfile"("lastCalculatedAt");
CREATE UNIQUE INDEX "PlaylistPreferenceProfile_playlistId_key" ON "PlaylistPreferenceProfile"("playlistId");
CREATE INDEX "PlaylistPreferenceProfile_userId_updatedAt_idx" ON "PlaylistPreferenceProfile"("userId", "updatedAt");
CREATE INDEX "PlaylistPreferenceProfile_userId_source_idx" ON "PlaylistPreferenceProfile"("userId", "source");
CREATE UNIQUE INDEX "TrackInteractionEvent_idempotencyKey_key" ON "TrackInteractionEvent"("idempotencyKey");
CREATE INDEX "TrackInteractionEvent_userId_occurredAt_idx" ON "TrackInteractionEvent"("userId", "occurredAt");
CREATE INDEX "TrackInteractionEvent_userId_trackId_idx" ON "TrackInteractionEvent"("userId", "trackId");
CREATE INDEX "TrackInteractionEvent_userId_eventType_idx" ON "TrackInteractionEvent"("userId", "eventType");
CREATE INDEX "TrackInteractionEvent_playlistId_occurredAt_idx" ON "TrackInteractionEvent"("playlistId", "occurredAt");
CREATE INDEX "TrackInteractionEvent_generationId_idx" ON "TrackInteractionEvent"("generationId");
CREATE INDEX "TrackInteractionEvent_playlistVersionId_idx" ON "TrackInteractionEvent"("playlistVersionId");
CREATE UNIQUE INDEX "PersonalScoringAdjustment_userId_featureType_featureKey_key" ON "PersonalScoringAdjustment"("userId", "featureType", "featureKey");
CREATE INDEX "PersonalScoringAdjustment_userId_calculatedAt_idx" ON "PersonalScoringAdjustment"("userId", "calculatedAt");
CREATE INDEX "PersonalScoringAdjustment_expiresAt_idx" ON "PersonalScoringAdjustment"("expiresAt");

ALTER TABLE "UserRecommendationProfile" ADD CONSTRAINT "UserRecommendationProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistPreferenceProfile" ADD CONSTRAINT "PlaylistPreferenceProfile_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistPreferenceProfile" ADD CONSTRAINT "PlaylistPreferenceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackInteractionEvent" ADD CONSTRAINT "TrackInteractionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackInteractionEvent" ADD CONSTRAINT "TrackInteractionEvent_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackInteractionEvent" ADD CONSTRAINT "TrackInteractionEvent_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonalScoringAdjustment" ADD CONSTRAINT "PersonalScoringAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecentlyAddedAutomationRun" ALTER COLUMN "engineVersion" SET DEFAULT 'v2.1.0';
