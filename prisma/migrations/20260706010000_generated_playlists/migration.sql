-- CreateTable
CREATE TABLE "GeneratedPlaylist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT,
    "plexPlaylistRatingKey" TEXT,
    "plexPlaylistTitle" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'unknown',
    "recipeId" TEXT,
    "recipeName" TEXT,
    "smartPresetId" TEXT,
    "smartPresetName" TEXT,
    "moodPresetId" TEXT,
    "moodPresetName" TEXT,
    "bpmPresetId" TEXT,
    "bpmPresetName" TEXT,
    "filtersJson" JSONB NOT NULL,
    "safetyRulesJson" JSONB,
    "trackCount" INTEGER NOT NULL DEFAULT 0,
    "lastGeneratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRegeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedPlaylistTrack" (
    "id" TEXT NOT NULL,
    "generatedPlaylistId" TEXT NOT NULL,
    "trackId" TEXT,
    "plexTrackRatingKey" TEXT,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "album" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedPlaylistTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedPlaylist_userId_plexPlaylistRatingKey_key" ON "GeneratedPlaylist"("userId", "plexPlaylistRatingKey");

-- CreateIndex
CREATE INDEX "GeneratedPlaylist_userId_updatedAt_idx" ON "GeneratedPlaylist"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "GeneratedPlaylist_userId_sourceType_idx" ON "GeneratedPlaylist"("userId", "sourceType");

-- CreateIndex
CREATE INDEX "GeneratedPlaylistTrack_generatedPlaylistId_position_idx" ON "GeneratedPlaylistTrack"("generatedPlaylistId", "position");

-- CreateIndex
CREATE INDEX "GeneratedPlaylistTrack_trackId_idx" ON "GeneratedPlaylistTrack"("trackId");

-- AddForeignKey
ALTER TABLE "GeneratedPlaylist" ADD CONSTRAINT "GeneratedPlaylist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedPlaylistTrack" ADD CONSTRAINT "GeneratedPlaylistTrack_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
