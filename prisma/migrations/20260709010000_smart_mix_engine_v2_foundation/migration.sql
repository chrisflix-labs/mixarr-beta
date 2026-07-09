ALTER TABLE "GeneratedPlaylist"
  ADD COLUMN IF NOT EXISTS "engineVersion" TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE "PlaylistHistoryEntry"
  ADD COLUMN IF NOT EXISTS "engineVersion" TEXT NOT NULL DEFAULT 'v1';
