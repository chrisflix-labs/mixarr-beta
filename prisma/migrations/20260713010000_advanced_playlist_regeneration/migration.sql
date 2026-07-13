ALTER TABLE "GeneratedPlaylistTrack"
  ADD COLUMN IF NOT EXISTS "locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "liked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "regenerationExcluded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "SmartMixTuningPreset" ALTER COLUMN "tuningVersion" SET DEFAULT '2.0.6';

CREATE TABLE IF NOT EXISTS "PlaylistRegeneration" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "generatedPlaylistId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'preview',
  "settingsJson" JSONB NOT NULL,
  "warningsJson" JSONB,
  "originalScore" DOUBLE PRECISION,
  "proposedScore" DOUBLE PRECISION,
  "appliedScore" DOUBLE PRECISION,
  "originalDurationMs" INTEGER NOT NULL DEFAULT 0,
  "proposedDurationMs" INTEGER NOT NULL DEFAULT 0,
  "tracksAnalyzed" INTEGER NOT NULL DEFAULT 0,
  "tracksProposed" INTEGER NOT NULL DEFAULT 0,
  "tracksApplied" INTEGER NOT NULL DEFAULT 0,
  "engineVersion" TEXT NOT NULL DEFAULT 'v2.0.6',
  "playlistUpdatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  "undoneAt" TIMESTAMP(3),
  CONSTRAINT "PlaylistRegeneration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlaylistRegenerationChange" (
  "id" TEXT NOT NULL,
  "regenerationId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "originalTrackId" TEXT NOT NULL,
  "proposedTrackId" TEXT NOT NULL,
  "originalScore" DOUBLE PRECISION,
  "proposedScore" DOUBLE PRECISION,
  "improvement" DOUBLE PRECISION,
  "reasonsJson" JSONB,
  "originalMetricsJson" JSONB,
  "proposedMetricsJson" JSONB,
  "accepted" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistRegenerationChange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlaylistRevision" (
  "id" TEXT NOT NULL,
  "generatedPlaylistId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "regenerationId" TEXT,
  "reason" TEXT NOT NULL,
  "engineVersion" TEXT,
  "settingsSnapshot" JSONB,
  "trackSnapshot" JSONB NOT NULL,
  "scoreSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistRevision_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistRegeneration_userId_fkey') THEN
    ALTER TABLE "PlaylistRegeneration" ADD CONSTRAINT "PlaylistRegeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistRegeneration_generatedPlaylistId_fkey') THEN
    ALTER TABLE "PlaylistRegeneration" ADD CONSTRAINT "PlaylistRegeneration_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistRegenerationChange_regenerationId_fkey') THEN
    ALTER TABLE "PlaylistRegenerationChange" ADD CONSTRAINT "PlaylistRegenerationChange_regenerationId_fkey" FOREIGN KEY ("regenerationId") REFERENCES "PlaylistRegeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistRevision_generatedPlaylistId_fkey') THEN
    ALTER TABLE "PlaylistRevision" ADD CONSTRAINT "PlaylistRevision_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PlaylistRegenerationChange_regenerationId_position_key" ON "PlaylistRegenerationChange"("regenerationId", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "PlaylistRevision_generatedPlaylistId_revisionNumber_key" ON "PlaylistRevision"("generatedPlaylistId", "revisionNumber");
CREATE INDEX IF NOT EXISTS "PlaylistRegeneration_userId_createdAt_idx" ON "PlaylistRegeneration"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "PlaylistRegeneration_generatedPlaylistId_createdAt_idx" ON "PlaylistRegeneration"("generatedPlaylistId", "createdAt");
CREATE INDEX IF NOT EXISTS "PlaylistRegeneration_generatedPlaylistId_status_idx" ON "PlaylistRegeneration"("generatedPlaylistId", "status");
CREATE INDEX IF NOT EXISTS "PlaylistRegenerationChange_regenerationId_accepted_idx" ON "PlaylistRegenerationChange"("regenerationId", "accepted");
CREATE INDEX IF NOT EXISTS "PlaylistRevision_generatedPlaylistId_createdAt_idx" ON "PlaylistRevision"("generatedPlaylistId", "createdAt");
CREATE INDEX IF NOT EXISTS "PlaylistRevision_regenerationId_idx" ON "PlaylistRevision"("regenerationId");
