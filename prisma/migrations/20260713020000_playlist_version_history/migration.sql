ALTER TABLE "GeneratedPlaylist"
  ADD COLUMN IF NOT EXISTS "revisionCounter" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SyncSettings"
  ADD COLUMN IF NOT EXISTS "playlistVersionHistoryEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "playlistVersionRetention" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS "saveManualPlaylistVersions" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "savePlaylistScoreSnapshots" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "cleanupPlaylistVersionsAutomatically" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlaylistRevision"
  ADD COLUMN IF NOT EXISTS "label" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "engineFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "applicationVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "trackCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "durationMs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "restoredFromVersionId" TEXT,
  ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isAutomatic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "syncStatus" TEXT NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS "snapshotSizeBytes" INTEGER;

-- Preserve v2.0.6 revisions. Their trackSnapshot arrays are valid legacy state
-- snapshots and are migrated in memory by the v2.0.7 snapshot reader.
UPDATE "PlaylistRevision"
SET "trackCount" = CASE
  WHEN jsonb_typeof("trackSnapshot") = 'array' THEN jsonb_array_length("trackSnapshot")
  ELSE "trackCount"
END
WHERE "trackCount" = 0;

UPDATE "GeneratedPlaylist" gp
SET "revisionCounter" = revisions.maximum
FROM (
  SELECT "generatedPlaylistId", MAX("revisionNumber") AS maximum
  FROM "PlaylistRevision"
  GROUP BY "generatedPlaylistId"
) revisions
WHERE gp."id" = revisions."generatedPlaylistId";

CREATE INDEX IF NOT EXISTS "PlaylistRevision_generatedPlaylistId_isCurrent_idx" ON "PlaylistRevision"("generatedPlaylistId", "isCurrent");
CREATE INDEX IF NOT EXISTS "PlaylistRevision_generatedPlaylistId_isPinned_idx" ON "PlaylistRevision"("generatedPlaylistId", "isPinned");
