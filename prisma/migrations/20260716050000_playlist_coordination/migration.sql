-- Mixarr v2.1.7: additive playlist relationships and coordination storage.
ALTER TABLE "GeneratedPlaylistTrack" ADD COLUMN "coordinationScoreJson" JSONB;

CREATE TABLE "PlaylistRelationship" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourcePlaylistId" TEXT NOT NULL,
  "targetPlaylistId" TEXT NOT NULL,
  "relationshipType" TEXT NOT NULL,
  "coordinationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "bidirectional" BOOLEAN NOT NULL DEFAULT true,
  "sharedCoreAllowed" BOOLEAN NOT NULL DEFAULT false,
  "maximumSharedTrackPercentage" DOUBLE PRECISION,
  "maximumSharedArtistPercentage" DOUBLE PRECISION,
  "preset" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistRelationship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistCoordinationSetting" (
  "id" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "coordinationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "maximumSharedTrackPercentage" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "overlapEnforcement" TEXT NOT NULL DEFAULT 'SOFT_TARGET',
  "keepDistinct" BOOLEAN NOT NULL DEFAULT false,
  "allowSharedCoreTracks" BOOLEAN NOT NULL DEFAULT false,
  "maximumSharedCoreTracks" INTEGER,
  "preferGloballyUnusedTracks" BOOLEAN NOT NULL DEFAULT false,
  "unusedTrackPreferenceStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "maximumCoordinationInfluence" DOUBLE PRECISION NOT NULL DEFAULT 12,
  "crossPlaylistArtistBalancingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "maximumSharedArtistPercentage" DOUBLE PRECISION DEFAULT 40,
  "maximumTracksPerArtistAcrossGroup" INTEGER DEFAULT 6,
  "featuredArtistMatching" TEXT NOT NULL DEFAULT 'PRIMARY_ONLY',
  "warnBeforeExceedingOverlap" BOOLEAN NOT NULL DEFAULT true,
  "excludedPlaylistIdsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistCoordinationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistSharedCoreTrack" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "relationshipId" TEXT,
  "scopeKey" TEXT NOT NULL DEFAULT 'GLOBAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistSharedCoreTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistProgressionChain" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "maximumAdjacentOverlapPercentage" DOUBLE PRECISION DEFAULT 15,
  "maximumChainOverlapPercentage" DOUBLE PRECISION DEFAULT 20,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistProgressionChain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistProgressionMember" (
  "id" TEXT NOT NULL,
  "chainId" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "sequencePosition" INTEGER NOT NULL,
  "targetMood" TEXT,
  "minimumEnergy" DOUBLE PRECISION,
  "maximumEnergy" DOUBLE PRECISION,
  "minimumBpm" DOUBLE PRECISION,
  "maximumBpm" DOUBLE PRECISION,
  "recommendedDuration" INTEGER,
  "handoffBehavior" TEXT NOT NULL DEFAULT 'SMOOTH',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistProgressionMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistOverlapSummary" (
  "id" TEXT NOT NULL,
  "playlistAId" TEXT NOT NULL,
  "playlistBId" TEXT NOT NULL,
  "sharedTrackCount" INTEGER NOT NULL DEFAULT 0,
  "sharedTrackPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "jaccardSimilarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sharedArtistCount" INTEGER NOT NULL DEFAULT 0,
  "sharedArtistPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sharedAlbumCount" INTEGER NOT NULL DEFAULT 0,
  "sharedAlbumPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sharedCoreTrackCount" INTEGER NOT NULL DEFAULT 0,
  "similarityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistOverlapSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaylistRelationship_userId_sourcePlaylistId_targetPlaylistId_relationshipType_key" ON "PlaylistRelationship"("userId", "sourcePlaylistId", "targetPlaylistId", "relationshipType");
CREATE INDEX "PlaylistRelationship_userId_sourcePlaylistId_idx" ON "PlaylistRelationship"("userId", "sourcePlaylistId");
CREATE INDEX "PlaylistRelationship_userId_targetPlaylistId_idx" ON "PlaylistRelationship"("userId", "targetPlaylistId");
CREATE UNIQUE INDEX "PlaylistCoordinationSetting_playlistId_key" ON "PlaylistCoordinationSetting"("playlistId");
CREATE UNIQUE INDEX "PlaylistSharedCoreTrack_playlistId_trackId_scopeKey_key" ON "PlaylistSharedCoreTrack"("playlistId", "trackId", "scopeKey");
CREATE INDEX "PlaylistSharedCoreTrack_userId_trackId_idx" ON "PlaylistSharedCoreTrack"("userId", "trackId");
CREATE INDEX "PlaylistSharedCoreTrack_relationshipId_trackId_idx" ON "PlaylistSharedCoreTrack"("relationshipId", "trackId");
CREATE UNIQUE INDEX "PlaylistProgressionChain_userId_name_key" ON "PlaylistProgressionChain"("userId", "name");
CREATE INDEX "PlaylistProgressionChain_userId_updatedAt_idx" ON "PlaylistProgressionChain"("userId", "updatedAt");
CREATE UNIQUE INDEX "PlaylistProgressionMember_chainId_playlistId_key" ON "PlaylistProgressionMember"("chainId", "playlistId");
CREATE UNIQUE INDEX "PlaylistProgressionMember_chainId_sequencePosition_key" ON "PlaylistProgressionMember"("chainId", "sequencePosition");
CREATE INDEX "PlaylistProgressionMember_playlistId_idx" ON "PlaylistProgressionMember"("playlistId");
CREATE UNIQUE INDEX "PlaylistOverlapSummary_playlistAId_playlistBId_key" ON "PlaylistOverlapSummary"("playlistAId", "playlistBId");
CREATE INDEX "PlaylistOverlapSummary_calculatedAt_idx" ON "PlaylistOverlapSummary"("calculatedAt");
CREATE INDEX "PlaylistOverlapSummary_sharedTrackPercentage_idx" ON "PlaylistOverlapSummary"("sharedTrackPercentage");

ALTER TABLE "PlaylistRelationship" ADD CONSTRAINT "PlaylistRelationship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistRelationship" ADD CONSTRAINT "PlaylistRelationship_sourcePlaylistId_fkey" FOREIGN KEY ("sourcePlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistRelationship" ADD CONSTRAINT "PlaylistRelationship_targetPlaylistId_fkey" FOREIGN KEY ("targetPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistCoordinationSetting" ADD CONSTRAINT "PlaylistCoordinationSetting_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistSharedCoreTrack" ADD CONSTRAINT "PlaylistSharedCoreTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistSharedCoreTrack" ADD CONSTRAINT "PlaylistSharedCoreTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistSharedCoreTrack" ADD CONSTRAINT "PlaylistSharedCoreTrack_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "PlaylistRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistProgressionChain" ADD CONSTRAINT "PlaylistProgressionChain_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistProgressionMember" ADD CONSTRAINT "PlaylistProgressionMember_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "PlaylistProgressionChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistProgressionMember" ADD CONSTRAINT "PlaylistProgressionMember_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistOverlapSummary" ADD CONSTRAINT "PlaylistOverlapSummary_playlistAId_fkey" FOREIGN KEY ("playlistAId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistOverlapSummary" ADD CONSTRAINT "PlaylistOverlapSummary_playlistBId_fkey" FOREIGN KEY ("playlistBId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlaylistRelationship" ADD CONSTRAINT "PlaylistRelationship_no_self" CHECK ("sourcePlaylistId" <> "targetPlaylistId");
