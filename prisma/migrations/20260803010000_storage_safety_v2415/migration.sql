-- Mixarr v2.4.15 storage safety and large-library scan staging.
-- UNLOGGED avoids producing PostgreSQL WAL for ephemeral per-scan identities.
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "recordingFingerprint" TEXT;
CREATE INDEX IF NOT EXISTS "Track_libraryId_recordingFingerprint_idx" ON "Track"("libraryId", "recordingFingerprint");
CREATE INDEX IF NOT EXISTS "Track_libraryId_mediaPath_idx" ON "Track"("libraryId", "mediaPath");
CREATE INDEX IF NOT EXISTS "Track_libraryId_updatedAt_idx" ON "Track"("libraryId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Track_albumId_syncStatus_idx" ON "Track"("albumId", "syncStatus");
CREATE INDEX IF NOT EXISTS "Track_artistId_syncStatus_idx" ON "Track"("artistId", "syncStatus");

CREATE UNLOGGED TABLE IF NOT EXISTS "PlexScanSeenTrack" (
  "scanId" TEXT NOT NULL,
  "libraryId" TEXT NOT NULL,
  "plexRatingKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlexScanSeenTrack_pkey" PRIMARY KEY ("scanId", "plexRatingKey")
);
-- `prisma db push` creates ordinary logged tables. Enforce the intended
-- persistence mode idempotently after both db-push and migrate workflows.
ALTER TABLE "PlexScanSeenTrack" SET UNLOGGED;

CREATE INDEX IF NOT EXISTS "PlexScanSeenTrack_libraryId_scanId_idx" ON "PlexScanSeenTrack"("libraryId", "scanId");
CREATE INDEX IF NOT EXISTS "PlexScanSeenTrack_createdAt_idx" ON "PlexScanSeenTrack"("createdAt");
CREATE INDEX IF NOT EXISTS "SyncLog_status_startedAt_idx" ON "SyncLog"("status", "startedAt");
CREATE INDEX IF NOT EXISTS "JobHistory_status_startedAt_idx" ON "JobHistory"("status", "startedAt");
CREATE INDEX IF NOT EXISTS "AiGovernanceAudit_createdAt_idx" ON "AiGovernanceAudit"("createdAt");
CREATE INDEX IF NOT EXISTS "NaturalLanguageRequest_status_createdAt_idx" ON "NaturalLanguageRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "RecommendationExplanation_createdAt_idx" ON "RecommendationExplanation"("createdAt");
CREATE INDEX IF NOT EXISTS "PlaylistAnalysisSnapshot_createdAt_idx" ON "PlaylistAnalysisSnapshot"("createdAt");
