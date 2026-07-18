-- Mixarr v2.2.2: additive cross-playlist variety policies, designations,
-- cached analysis metadata, and revision-bound repair previews.
-- This migration never analyzes or rewrites Plex playlists.

ALTER TABLE "PlaylistCoordinationSetting"
  ADD COLUMN "maximumSharedAlbumPercentage" DOUBLE PRECISION DEFAULT 25,
  ADD COLUMN "maximumSharedTrackCount" INTEGER,
  ADD COLUMN "minimumUniqueTrackPercentage" DOUBLE PRECISION NOT NULL DEFAULT 70,
  ADD COLUMN "minimumUniqueTrackCount" INTEGER,
  ADD COLUMN "uniqueTargetMode" TEXT NOT NULL DEFAULT 'PREFERRED',
  ADD COLUMN "recentUsageLookbackDays" INTEGER DEFAULT 30,
  ADD COLUMN "recentUsagePenaltyStrength" TEXT NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "sharedTrackAllowance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "coreTrackAllowance" INTEGER,
  ADD COLUMN "comparisonScope" TEXT NOT NULL DEFAULT 'ALL_MANAGED',
  ADD COLUMN "comparisonGroupIdsJson" JSONB,
  ADD COLUMN "automaticRepairEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireRepairPreview" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "excludedFromEnforcement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "exclusivityBehavior" TEXT NOT NULL DEFAULT 'OFF',
  ADD COLUMN "exclusivityLookbackDays" INTEGER,
  ADD COLUMN "ignoreManualAdditionsForExclusivity" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "analysisStale" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "PlaylistOverlapSummary"
  ADD COLUMN "playlistASize" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "playlistBSize" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overlapPercentA" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "overlapPercentB" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "uniquePercentA" DOUBLE PRECISION NOT NULL DEFAULT 100,
  ADD COLUMN "uniquePercentB" DOUBLE PRECISION NOT NULL DEFAULT 100,
  ADD COLUMN "policySharedTrackCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "excessSharedTrackCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tracksFromSharedArtists" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "artistConcentrationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "albumsDominatingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "withinPolicy" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "policySnapshotJson" JSONB,
  ADD COLUMN "warningsJson" JSONB,
  ADD COLUMN "stale" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "CrossPlaylistVarietySetting" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "maximumTrackOverlapPercent" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "maximumArtistOverlapPercent" DOUBLE PRECISION NOT NULL DEFAULT 35,
  "maximumAlbumOverlapPercent" DOUBLE PRECISION NOT NULL DEFAULT 25,
  "maximumSharedTrackCount" INTEGER,
  "minimumUniqueTrackPercent" DOUBLE PRECISION NOT NULL DEFAULT 70,
  "minimumUniqueTrackCount" INTEGER,
  "recentUsageLookbackDays" INTEGER DEFAULT 30,
  "recentUsagePenaltyStrength" TEXT NOT NULL DEFAULT 'MEDIUM',
  "sharedTrackAllowance" INTEGER NOT NULL DEFAULT 0,
  "coreTrackAllowance" INTEGER,
  "exclusivityBehavior" TEXT NOT NULL DEFAULT 'OFF',
  "automaticRepairEnabled" BOOLEAN NOT NULL DEFAULT false,
  "requireRepairPreview" BOOLEAN NOT NULL DEFAULT true,
  "comparisonScope" TEXT NOT NULL DEFAULT 'ALL_MANAGED',
  "analysisConcurrency" INTEGER NOT NULL DEFAULT 2,
  "analysisBatchSize" INTEGER NOT NULL DEFAULT 20,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrossPlaylistVarietySetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistPairPolicy" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playlistAId" TEXT NOT NULL,
  "playlistBId" TEXT NOT NULL,
  "ignored" BOOLEAN NOT NULL DEFAULT false,
  "allowedTrackOverlapPercent" DOUBLE PRECISION,
  "allowedArtistOverlapPercent" DOUBLE PRECISION,
  "allowedAlbumOverlapPercent" DOUBLE PRECISION,
  "maximumSharedTrackCount" INTEGER,
  "sharedTrackAllowance" INTEGER,
  "allowedArtistIdsJson" JSONB,
  "allowedAlbumIdsJson" JSONB,
  "similarPlaylistAllowance" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistPairPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlaylistPairPolicy_no_self" CHECK ("playlistAId" <> "playlistBId"),
  CONSTRAINT "PlaylistPairPolicy_canonical_pair" CHECK ("playlistAId" < "playlistBId")
);

CREATE TABLE "PlaylistTrackDesignation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "isCore" BOOLEAN NOT NULL DEFAULT false,
  "isSharedAllowed" BOOLEAN NOT NULL DEFAULT false,
  "exclusivityMode" TEXT NOT NULL DEFAULT 'NONE',
  "excludedPlaylistIdsJson" JSONB,
  "exclusiveGroupId" TEXT,
  "exclusiveUntil" TIMESTAMP(3),
  "ignoreWhenManuallyAdded" BOOLEAN NOT NULL DEFAULT true,
  "designationSource" TEXT NOT NULL DEFAULT 'USER',
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistTrackDesignation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistRepairPreview" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "comparisonPlaylistId" TEXT,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "playlistRevision" INTEGER NOT NULL,
  "playlistContentHash" TEXT NOT NULL,
  "policySnapshotJson" JSONB NOT NULL,
  "overlapBeforeJson" JSONB NOT NULL,
  "overlapAfterJson" JSONB NOT NULL,
  "proposalsJson" JSONB NOT NULL,
  "relaxedConstraintsJson" JSONB,
  "engineVersion" TEXT NOT NULL DEFAULT '2.2.2',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistRepairPreview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrossPlaylistVarietySetting_userId_key" ON "CrossPlaylistVarietySetting"("userId");
CREATE UNIQUE INDEX "PlaylistPairPolicy_userId_playlistAId_playlistBId_key" ON "PlaylistPairPolicy"("userId", "playlistAId", "playlistBId");
CREATE INDEX "PlaylistPairPolicy_userId_updatedAt_idx" ON "PlaylistPairPolicy"("userId", "updatedAt");
CREATE INDEX "PlaylistPairPolicy_playlistAId_idx" ON "PlaylistPairPolicy"("playlistAId");
CREATE INDEX "PlaylistPairPolicy_playlistBId_idx" ON "PlaylistPairPolicy"("playlistBId");
CREATE UNIQUE INDEX "PlaylistTrackDesignation_playlistId_trackId_key" ON "PlaylistTrackDesignation"("playlistId", "trackId");
CREATE INDEX "PlaylistTrackDesignation_userId_trackId_idx" ON "PlaylistTrackDesignation"("userId", "trackId");
CREATE INDEX "PlaylistTrackDesignation_playlistId_isCore_idx" ON "PlaylistTrackDesignation"("playlistId", "isCore");
CREATE INDEX "PlaylistTrackDesignation_playlistId_isSharedAllowed_idx" ON "PlaylistTrackDesignation"("playlistId", "isSharedAllowed");
CREATE INDEX "PlaylistTrackDesignation_exclusivityMode_exclusiveUntil_idx" ON "PlaylistTrackDesignation"("exclusivityMode", "exclusiveUntil");
CREATE INDEX "PlaylistRepairPreview_userId_createdAt_idx" ON "PlaylistRepairPreview"("userId", "createdAt");
CREATE INDEX "PlaylistRepairPreview_playlistId_status_expiresAt_idx" ON "PlaylistRepairPreview"("playlistId", "status", "expiresAt");
CREATE INDEX "PlaylistOverlapSummary_withinPolicy_sharedTrackPercentage_idx" ON "PlaylistOverlapSummary"("withinPolicy", "sharedTrackPercentage");
CREATE INDEX "PlaylistOverlapSummary_stale_calculatedAt_idx" ON "PlaylistOverlapSummary"("stale", "calculatedAt");

ALTER TABLE "CrossPlaylistVarietySetting" ADD CONSTRAINT "CrossPlaylistVarietySetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistPairPolicy" ADD CONSTRAINT "PlaylistPairPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistPairPolicy" ADD CONSTRAINT "PlaylistPairPolicy_playlistAId_fkey" FOREIGN KEY ("playlistAId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistPairPolicy" ADD CONSTRAINT "PlaylistPairPolicy_playlistBId_fkey" FOREIGN KEY ("playlistBId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistTrackDesignation" ADD CONSTRAINT "PlaylistTrackDesignation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistTrackDesignation" ADD CONSTRAINT "PlaylistTrackDesignation_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistTrackDesignation" ADD CONSTRAINT "PlaylistTrackDesignation_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistRepairPreview" ADD CONSTRAINT "PlaylistRepairPreview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistRepairPreview" ADD CONSTRAINT "PlaylistRepairPreview_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistRepairPreview" ADD CONSTRAINT "PlaylistRepairPreview_comparisonPlaylistId_fkey" FOREIGN KEY ("comparisonPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PlaylistOverlapSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playlistAId" TEXT NOT NULL,
  "playlistBId" TEXT NOT NULL,
  "sharedTrackCount" INTEGER NOT NULL,
  "sharedTrackPercentage" DOUBLE PRECISION NOT NULL,
  "sharedArtistPercentage" DOUBLE PRECISION NOT NULL,
  "sharedAlbumPercentage" DOUBLE PRECISION NOT NULL,
  "uniquePercentA" DOUBLE PRECISION NOT NULL,
  "uniquePercentB" DOUBLE PRECISION NOT NULL,
  "withinPolicy" BOOLEAN NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistOverlapSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlaylistOverlapSnapshot_no_self" CHECK ("playlistAId" <> "playlistBId"),
  CONSTRAINT "PlaylistOverlapSnapshot_canonical_pair" CHECK ("playlistAId" < "playlistBId")
);
CREATE INDEX "PlaylistOverlapSnapshot_userId_calculatedAt_idx" ON "PlaylistOverlapSnapshot"("userId", "calculatedAt");
CREATE INDEX "PlaylistOverlapSnapshot_playlistAId_playlistBId_calculatedAt_idx" ON "PlaylistOverlapSnapshot"("playlistAId", "playlistBId", "calculatedAt");
ALTER TABLE "PlaylistOverlapSnapshot" ADD CONSTRAINT "PlaylistOverlapSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistOverlapSnapshot" ADD CONSTRAINT "PlaylistOverlapSnapshot_playlistAId_fkey" FOREIGN KEY ("playlistAId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistOverlapSnapshot" ADD CONSTRAINT "PlaylistOverlapSnapshot_playlistBId_fkey" FOREIGN KEY ("playlistBId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
