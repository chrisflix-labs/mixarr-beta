-- Mixarr v2.1.2: explicit, user-scoped recommendation feedback.
-- All additions are nullable/defaulted or new tables, so existing installations remain non-destructive.

CREATE TABLE "UserTrackPreference" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "trackId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'NEUTRAL', "scoreAdjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastFeedbackEventId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserTrackPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserTrackPreference_userId_trackId_key" ON "UserTrackPreference"("userId", "trackId");
CREATE INDEX "UserTrackPreference_userId_state_updatedAt_idx" ON "UserTrackPreference"("userId", "state", "updatedAt");
CREATE INDEX "UserTrackPreference_trackId_idx" ON "UserTrackPreference"("trackId");

CREATE TABLE "UserArtistPreference" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "artistId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'NEUTRAL', "scoreAdjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastFeedbackEventId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserArtistPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserArtistPreference_userId_artistId_key" ON "UserArtistPreference"("userId", "artistId");
CREATE INDEX "UserArtistPreference_userId_state_updatedAt_idx" ON "UserArtistPreference"("userId", "state", "updatedAt");
CREATE INDEX "UserArtistPreference_artistId_idx" ON "UserArtistPreference"("artistId");

CREATE TABLE "PlaylistFitFeedback" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "trackId" TEXT NOT NULL, "playlistId" TEXT,
  "playlistProfileId" TEXT, "scopeKey" TEXT NOT NULL, "state" TEXT NOT NULL, "reason" TEXT,
  "note" TEXT, "generationId" TEXT, "engineVersion" TEXT, "lastFeedbackEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistFitFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlaylistFitFeedback_userId_trackId_scopeKey_key" ON "PlaylistFitFeedback"("userId", "trackId", "scopeKey");
CREATE INDEX "PlaylistFitFeedback_userId_playlistId_updatedAt_idx" ON "PlaylistFitFeedback"("userId", "playlistId", "updatedAt");
CREATE INDEX "PlaylistFitFeedback_userId_playlistProfileId_updatedAt_idx" ON "PlaylistFitFeedback"("userId", "playlistProfileId", "updatedAt");
CREATE INDEX "PlaylistFitFeedback_trackId_idx" ON "PlaylistFitFeedback"("trackId");

CREATE TABLE "TransitionFeedback" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "playlistId" TEXT, "playlistProfileId" TEXT,
  "previousTrackId" TEXT NOT NULL, "currentTrackId" TEXT NOT NULL, "nextTrackId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'POOR_TRANSITION', "reason" TEXT, "note" TEXT,
  "transitionPosition" INTEGER, "generationId" TEXT, "engineVersion" TEXT, "contextJson" JSONB,
  "feedbackEventId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransitionFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TransitionFeedback_userId_previousTrackId_currentTrackId_idx" ON "TransitionFeedback"("userId", "previousTrackId", "currentTrackId");
CREATE INDEX "TransitionFeedback_userId_playlistId_createdAt_idx" ON "TransitionFeedback"("userId", "playlistId", "createdAt");
CREATE INDEX "TransitionFeedback_userId_playlistProfileId_createdAt_idx" ON "TransitionFeedback"("userId", "playlistProfileId", "createdAt");

CREATE TABLE "FeedbackEvent" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "feedbackType" TEXT NOT NULL, "targetType" TEXT NOT NULL,
  "targetIdsJson" JSONB NOT NULL, "previousState" TEXT, "newState" TEXT, "reason" TEXT, "note" TEXT,
  "sourceSurface" TEXT NOT NULL, "playlistId" TEXT, "playlistProfileId" TEXT, "generationId" TEXT,
  "engineVersion" TEXT, "contextJson" JSONB, "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeedbackEvent_idempotencyKey_key" ON "FeedbackEvent"("idempotencyKey");
CREATE INDEX "FeedbackEvent_userId_feedbackType_createdAt_idx" ON "FeedbackEvent"("userId", "feedbackType", "createdAt");
CREATE INDEX "FeedbackEvent_userId_targetType_createdAt_idx" ON "FeedbackEvent"("userId", "targetType", "createdAt");
CREATE INDEX "FeedbackEvent_playlistId_createdAt_idx" ON "FeedbackEvent"("playlistId", "createdAt");
CREATE INDEX "FeedbackEvent_playlistProfileId_createdAt_idx" ON "FeedbackEvent"("playlistProfileId", "createdAt");

ALTER TABLE "UserTrackPreference" ADD CONSTRAINT "UserTrackPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTrackPreference" ADD CONSTRAINT "UserTrackPreference_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserArtistPreference" ADD CONSTRAINT "UserArtistPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserArtistPreference" ADD CONSTRAINT "UserArtistPreference_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistFitFeedback" ADD CONSTRAINT "PlaylistFitFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistFitFeedback" ADD CONSTRAINT "PlaylistFitFeedback_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistFitFeedback" ADD CONSTRAINT "PlaylistFitFeedback_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistFitFeedback" ADD CONSTRAINT "PlaylistFitFeedback_playlistProfileId_fkey" FOREIGN KEY ("playlistProfileId") REFERENCES "PlaylistPreferenceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransitionFeedback" ADD CONSTRAINT "TransitionFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransitionFeedback" ADD CONSTRAINT "TransitionFeedback_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransitionFeedback" ADD CONSTRAINT "TransitionFeedback_playlistProfileId_fkey" FOREIGN KEY ("playlistProfileId") REFERENCES "PlaylistPreferenceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransitionFeedback" ADD CONSTRAINT "TransitionFeedback_previousTrackId_fkey" FOREIGN KEY ("previousTrackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransitionFeedback" ADD CONSTRAINT "TransitionFeedback_currentTrackId_fkey" FOREIGN KEY ("currentTrackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransitionFeedback" ADD CONSTRAINT "TransitionFeedback_nextTrackId_fkey" FOREIGN KEY ("nextTrackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
