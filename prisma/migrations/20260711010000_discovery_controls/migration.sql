ALTER TABLE "GeneratedPlaylist"
  ADD COLUMN IF NOT EXISTS "discoveryConfigJson" JSONB,
  ADD COLUMN IF NOT EXISTS "discoveryResultJson" JSONB;

ALTER TABLE "SmartMixTuningPreset" ALTER COLUMN "tuningVersion" SET DEFAULT '2.0.5';

CREATE INDEX IF NOT EXISTS "GeneratedPlaylistTrack_generatedPlaylistId_trackId_idx"
  ON "GeneratedPlaylistTrack"("generatedPlaylistId", "trackId");
CREATE INDEX IF NOT EXISTS "PlaylistHistoryTrack_historyEntryId_trackId_idx"
  ON "PlaylistHistoryTrack"("historyEntryId", "trackId");
CREATE INDEX IF NOT EXISTS "Track_libraryId_viewCount_idx"
  ON "Track"("libraryId", "viewCount");
CREATE INDEX IF NOT EXISTS "Popularity_score_idx" ON "Popularity"("score");
