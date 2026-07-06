-- CreateTable
CREATE TABLE "PlaylistHistoryEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generatedPlaylistId" TEXT,
    "serverId" TEXT,
    "plexPlaylistRatingKey" TEXT,
    "playlistName" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'unknown',
    "recipeId" TEXT,
    "recipeName" TEXT,
    "smartPresetId" TEXT,
    "smartPresetName" TEXT,
    "moodPresetId" TEXT,
    "moodPresetName" TEXT,
    "bpmPresetId" TEXT,
    "bpmPresetName" TEXT,
    "regenerationMode" TEXT,
    "keepPercent" INTEGER,
    "preferDifferentTracks" BOOLEAN NOT NULL DEFAULT false,
    "trackCount" INTEGER NOT NULL DEFAULT 0,
    "previousTrackCount" INTEGER,
    "keptCount" INTEGER,
    "replacedCount" INTEGER,
    "newCount" INTEGER,
    "removedCount" INTEGER,
    "manualExclusionsRemoved" INTEGER NOT NULL DEFAULT 0,
    "safetyRulesApplied" BOOLEAN NOT NULL DEFAULT false,
    "safetyRulesRemoved" INTEGER NOT NULL DEFAULT 0,
    "warningsJson" JSONB,
    "filtersJson" JSONB,
    "safetyRulesJson" JSONB,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistHistoryTrack" (
    "id" TEXT NOT NULL,
    "historyEntryId" TEXT NOT NULL,
    "trackId" TEXT,
    "plexTrackRatingKey" TEXT,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "album" TEXT,
    "duration" INTEGER,
    "bpm" DOUBLE PRECISION,
    "energy" DOUBLE PRECISION,
    "mood" DOUBLE PRECISION,
    "popularity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistHistoryTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaylistHistoryEntry_userId_createdAt_idx" ON "PlaylistHistoryEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PlaylistHistoryEntry_userId_eventType_createdAt_idx" ON "PlaylistHistoryEntry"("userId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "PlaylistHistoryEntry_userId_sourceType_createdAt_idx" ON "PlaylistHistoryEntry"("userId", "sourceType", "createdAt");

-- CreateIndex
CREATE INDEX "PlaylistHistoryEntry_generatedPlaylistId_createdAt_idx" ON "PlaylistHistoryEntry"("generatedPlaylistId", "createdAt");

-- CreateIndex
CREATE INDEX "PlaylistHistoryEntry_plexPlaylistRatingKey_createdAt_idx" ON "PlaylistHistoryEntry"("plexPlaylistRatingKey", "createdAt");

-- CreateIndex
CREATE INDEX "PlaylistHistoryTrack_historyEntryId_position_idx" ON "PlaylistHistoryTrack"("historyEntryId", "position");

-- CreateIndex
CREATE INDEX "PlaylistHistoryTrack_trackId_idx" ON "PlaylistHistoryTrack"("trackId");

-- AddForeignKey
ALTER TABLE "PlaylistHistoryEntry" ADD CONSTRAINT "PlaylistHistoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistHistoryEntry" ADD CONSTRAINT "PlaylistHistoryEntry_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistHistoryEntry" ADD CONSTRAINT "PlaylistHistoryEntry_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistHistoryTrack" ADD CONSTRAINT "PlaylistHistoryTrack_historyEntryId_fkey" FOREIGN KEY ("historyEntryId") REFERENCES "PlaylistHistoryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
