ALTER TABLE "GeneratedPlaylistTrack" ADD COLUMN "explanationJson" JSONB;

CREATE TABLE "SmartMixExplanationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "detailLevel" TEXT NOT NULL DEFAULT 'SIMPLE',
  "rejectedCandidateLimit" INTEGER NOT NULL DEFAULT 100,
  "rejectedRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartMixExplanationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartMixExplanationGeneration" (
  "id" TEXT NOT NULL,
  "generationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "generatedPlaylistId" TEXT,
  "engineVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'complete',
  "settingsSnapshotJson" JSONB,
  "identitySnapshotJson" JSONB,
  "personalizationSnapshotJson" JSONB,
  "insightsJson" JSONB NOT NULL,
  "rejectionSummaryJson" JSONB,
  "evaluatedCount" INTEGER NOT NULL DEFAULT 0,
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "selectedCount" INTEGER NOT NULL DEFAULT 0,
  "hardRejectedCount" INTEGER NOT NULL DEFAULT 0,
  "rankedRejectedCount" INTEGER NOT NULL DEFAULT 0,
  "traceDurationMs" INTEGER NOT NULL DEFAULT 0,
  "fullTraceExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartMixExplanationGeneration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartMixDecisionTrace" (
  "id" TEXT NOT NULL,
  "generationRecordId" TEXT NOT NULL,
  "generationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "generatedPlaylistId" TEXT,
  "trackId" TEXT,
  "trackTitle" TEXT,
  "artistName" TEXT,
  "decision" TEXT NOT NULL,
  "rank" INTEGER,
  "rejectionStage" TEXT,
  "rejectionCode" TEXT,
  "finalScore" DOUBLE PRECISION,
  "confidenceScore" INTEGER NOT NULL,
  "confidenceLabel" TEXT NOT NULL,
  "explanationJson" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartMixDecisionTrace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartMixExplanationPreference_userId_key" ON "SmartMixExplanationPreference"("userId");
CREATE UNIQUE INDEX "SmartMixExplanationGeneration_generationId_key" ON "SmartMixExplanationGeneration"("generationId");
CREATE INDEX "SmartMixExplanationGeneration_userId_createdAt_idx" ON "SmartMixExplanationGeneration"("userId", "createdAt");
CREATE INDEX "SmartMixExplanationGeneration_generatedPlaylistId_createdAt_idx" ON "SmartMixExplanationGeneration"("generatedPlaylistId", "createdAt");
CREATE INDEX "SmartMixExplanationGeneration_fullTraceExpiresAt_idx" ON "SmartMixExplanationGeneration"("fullTraceExpiresAt");
CREATE INDEX "SmartMixDecisionTrace_generationId_decision_rank_idx" ON "SmartMixDecisionTrace"("generationId", "decision", "rank");
CREATE INDEX "SmartMixDecisionTrace_userId_trackId_createdAt_idx" ON "SmartMixDecisionTrace"("userId", "trackId", "createdAt");
CREATE INDEX "SmartMixDecisionTrace_generatedPlaylistId_decision_idx" ON "SmartMixDecisionTrace"("generatedPlaylistId", "decision");
CREATE INDEX "SmartMixDecisionTrace_rejectionCode_idx" ON "SmartMixDecisionTrace"("rejectionCode");
CREATE INDEX "SmartMixDecisionTrace_expiresAt_idx" ON "SmartMixDecisionTrace"("expiresAt");

ALTER TABLE "SmartMixExplanationPreference" ADD CONSTRAINT "SmartMixExplanationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartMixExplanationGeneration" ADD CONSTRAINT "SmartMixExplanationGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartMixExplanationGeneration" ADD CONSTRAINT "SmartMixExplanationGeneration_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartMixDecisionTrace" ADD CONSTRAINT "SmartMixDecisionTrace_generationRecordId_fkey" FOREIGN KEY ("generationRecordId") REFERENCES "SmartMixExplanationGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartMixDecisionTrace" ADD CONSTRAINT "SmartMixDecisionTrace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartMixDecisionTrace" ADD CONSTRAINT "SmartMixDecisionTrace_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
