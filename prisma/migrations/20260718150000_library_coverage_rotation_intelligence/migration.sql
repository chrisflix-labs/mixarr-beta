-- Mixarr v2.2.5 Library Coverage & Rotation Intelligence.
-- Additive only: historical playlist and personalization data is never rewritten.

CREATE TABLE "LibraryCoverageSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "snapshotFrequencyHours" INTEGER NOT NULL DEFAULT 24,
    "snapshotRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "coverageHistoryPeriodDays" INTEGER NOT NULL DEFAULT 365,
    "includeManualTracks" BOOLEAN NOT NULL DEFAULT false,
    "includeImportedPlaylists" BOOLEAN NOT NULL DEFAULT false,
    "includeDeletedPlaylistHistory" BOOLEAN NOT NULL DEFAULT true,
    "minimumMetadataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "minimumAudioFeatureConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "minimumOpportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 70,
    "overuseThreshold" DOUBLE PRECISION NOT NULL DEFAULT 70,
    "selectionCooldownDays" INTEGER NOT NULL DEFAULT 14,
    "maximumRotationInfluence" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "recentlyAddedWindowDays" INTEGER NOT NULL DEFAULT 90,
    "excludeExplicitDislikes" BOOLEAN NOT NULL DEFAULT true,
    "excludeNeverRecommend" BOOLEAN NOT NULL DEFAULT true,
    "excludeMissingPlexTracks" BOOLEAN NOT NULL DEFAULT true,
    "excludeDuplicateVersions" BOOLEAN NOT NULL DEFAULT true,
    "allowLiveTracks" BOOLEAN NOT NULL DEFAULT false,
    "allowCompilations" BOOLEAN NOT NULL DEFAULT true,
    "coverageAwareScoringEnabled" BOOLEAN NOT NULL DEFAULT false,
    "coverageInfluenceLevel" TEXT NOT NULL DEFAULT 'disabled',
    "customInfluenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LibraryCoverageSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackRotationStatistic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "exclusionReason" TEXT,
    "analyzed" BOOLEAN NOT NULL DEFAULT false,
    "currentlySelected" BOOLEAN NOT NULL DEFAULT false,
    "firstSelectedAt" TIMESTAMP(3),
    "lastSelectedAt" TIMESTAMP(3),
    "selectionCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedSelectionCount" INTEGER NOT NULL DEFAULT 0,
    "rejectionCount" INTEGER NOT NULL DEFAULT 0,
    "removalCount" INTEGER NOT NULL DEFAULT 0,
    "lockedCount" INTEGER NOT NULL DEFAULT 0,
    "manualAdditionCount" INTEGER NOT NULL DEFAULT 0,
    "importedSelectionCount" INTEGER NOT NULL DEFAULT 0,
    "uniquePlaylistCount" INTEGER NOT NULL DEFAULT 0,
    "generationSelectionCount" INTEGER NOT NULL DEFAULT 0,
    "generationConsiderationCount" INTEGER NOT NULL DEFAULT 0,
    "qualifiedNotSelectedCount" INTEGER NOT NULL DEFAULT 0,
    "recentSelectionCount" INTEGER NOT NULL DEFAULT 0,
    "historicalBestScore" DOUBLE PRECISION,
    "averageSelectionScore" DOUBLE PRECISION,
    "baseQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "personalizedQualityScore" DOUBLE PRECISION,
    "metadataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "audioFeatureConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "compatibilityPotential" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overuseScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasonNeverSelected" TEXT,
    "explanationJson" JSONB,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackRotationStatistic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryCoverageSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "libraryId" TEXT,
    "period" TEXT NOT NULL DEFAULT 'all_time',
    "totalTracks" INTEGER NOT NULL DEFAULT 0,
    "eligibleTracks" INTEGER NOT NULL DEFAULT 0,
    "excludedTracks" INTEGER NOT NULL DEFAULT 0,
    "analyzedTracks" INTEGER NOT NULL DEFAULT 0,
    "usedTracks" INTEGER NOT NULL DEFAULT 0,
    "activeTracks" INTEGER NOT NULL DEFAULT 0,
    "neverSelectedTracks" INTEGER NOT NULL DEFAULT 0,
    "highConfidenceNeglected" INTEGER NOT NULL DEFAULT 0,
    "overusedTracks" INTEGER NOT NULL DEFAULT 0,
    "eligibleArtists" INTEGER NOT NULL DEFAULT 0,
    "usedArtists" INTEGER NOT NULL DEFAULT 0,
    "eligibleAlbums" INTEGER NOT NULL DEFAULT 0,
    "usedAlbums" INTEGER NOT NULL DEFAULT 0,
    "artistCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "albumCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coveragePercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotationFairnessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recentlyAddedCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "partialHistory" BOOLEAN NOT NULL DEFAULT false,
    "explanationJson" JSONB,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryCoverageSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibrarySegmentCoverage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentKey" TEXT,
    "eligibleTracks" INTEGER NOT NULL DEFAULT 0,
    "analyzedTracks" INTEGER NOT NULL DEFAULT 0,
    "selectedTracks" INTEGER NOT NULL DEFAULT 0,
    "neverSelectedTracks" INTEGER NOT NULL DEFAULT 0,
    "playlistAppearances" INTEGER NOT NULL DEFAULT 0,
    "opportunityCount" INTEGER NOT NULL DEFAULT 0,
    "overuseCount" INTEGER NOT NULL DEFAULT 0,
    "coveragePercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageUseCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageQuality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "demandPercentage" DOUBLE PRECISION,
    "preferenceInfluence" DOUBLE PRECISION,
    "lastSelectedAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibrarySegmentCoverage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoverageCalculationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "libraryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "currentStage" TEXT NOT NULL DEFAULT 'queued',
    "currentStageNumber" INTEGER NOT NULL DEFAULT 0,
    "totalStages" INTEGER NOT NULL DEFAULT 10,
    "processedTracks" INTEGER NOT NULL DEFAULT 0,
    "totalTracks" INTEGER NOT NULL DEFAULT 0,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cursorTrackId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "settingsSnapshot" JSONB,
    "resultJson" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoverageCalculationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryCoverageSetting_userId_key" ON "LibraryCoverageSetting"("userId");
CREATE UNIQUE INDEX "TrackRotationStatistic_userId_trackId_key" ON "TrackRotationStatistic"("userId", "trackId");
CREATE INDEX "TrackRotationStatistic_userId_eligible_analyzed_idx" ON "TrackRotationStatistic"("userId", "eligible", "analyzed");
CREATE INDEX "TrackRotationStatistic_userId_opportunityScore_idx" ON "TrackRotationStatistic"("userId", "opportunityScore");
CREATE INDEX "TrackRotationStatistic_userId_overuseScore_idx" ON "TrackRotationStatistic"("userId", "overuseScore");
CREATE INDEX "TrackRotationStatistic_userId_firstSelectedAt_idx" ON "TrackRotationStatistic"("userId", "firstSelectedAt");
CREATE INDEX "TrackRotationStatistic_userId_lastSelectedAt_idx" ON "TrackRotationStatistic"("userId", "lastSelectedAt");
CREATE INDEX "TrackRotationStatistic_trackId_idx" ON "TrackRotationStatistic"("trackId");
CREATE INDEX "TrackRotationStatistic_calculatedAt_idx" ON "TrackRotationStatistic"("calculatedAt");
CREATE INDEX "LibraryCoverageSnapshot_userId_period_createdAt_idx" ON "LibraryCoverageSnapshot"("userId", "period", "createdAt");
CREATE INDEX "LibraryCoverageSnapshot_libraryId_createdAt_idx" ON "LibraryCoverageSnapshot"("libraryId", "createdAt");
CREATE INDEX "LibraryCoverageSnapshot_fingerprint_idx" ON "LibraryCoverageSnapshot"("fingerprint");
CREATE UNIQUE INDEX "LibrarySegmentCoverage_snapshotId_dimension_segmentKey_key" ON "LibrarySegmentCoverage"("snapshotId", "dimension", "segmentKey");
CREATE INDEX "LibrarySegmentCoverage_userId_dimension_coveragePercentage_idx" ON "LibrarySegmentCoverage"("userId", "dimension", "coveragePercentage");
CREATE INDEX "LibrarySegmentCoverage_snapshotId_dimension_idx" ON "LibrarySegmentCoverage"("snapshotId", "dimension");
CREATE INDEX "CoverageCalculationJob_userId_status_createdAt_idx" ON "CoverageCalculationJob"("userId", "status", "createdAt");
CREATE INDEX "CoverageCalculationJob_status_lastHeartbeatAt_idx" ON "CoverageCalculationJob"("status", "lastHeartbeatAt");
CREATE INDEX "CoverageCalculationJob_libraryId_status_idx" ON "CoverageCalculationJob"("libraryId", "status");

ALTER TABLE "LibraryCoverageSetting" ADD CONSTRAINT "LibraryCoverageSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackRotationStatistic" ADD CONSTRAINT "TrackRotationStatistic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackRotationStatistic" ADD CONSTRAINT "TrackRotationStatistic_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryCoverageSnapshot" ADD CONSTRAINT "LibraryCoverageSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryCoverageSnapshot" ADD CONSTRAINT "LibraryCoverageSnapshot_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibrarySegmentCoverage" ADD CONSTRAINT "LibrarySegmentCoverage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibrarySegmentCoverage" ADD CONSTRAINT "LibrarySegmentCoverage_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LibraryCoverageSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoverageCalculationJob" ADD CONSTRAINT "CoverageCalculationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
