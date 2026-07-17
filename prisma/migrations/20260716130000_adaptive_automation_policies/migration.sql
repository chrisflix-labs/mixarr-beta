-- Mixarr v2.1.9 Adaptive Automation Policies. All defaults are conservative and additive.
ALTER TABLE "GeneratedPlaylistTrack"
  ADD COLUMN "automationProtected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "protectionReason" TEXT,
  ADD COLUMN "protectedByUserId" TEXT,
  ADD COLUMN "protectedAt" TIMESTAMP(3);

ALTER TABLE "PlaylistAutomationSettings"
  ADD COLUMN "useGlobalPolicy" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "permissionLevel" TEXT,
  ADD COLUMN "preset" TEXT,
  ADD COLUMN "allowAdditions" BOOLEAN,
  ADD COLUMN "allowRemovals" BOOLEAN,
  ADD COLUMN "allowReorder" BOOLEAN,
  ADD COLUMN "maximumAdditionsPerUpdate" INTEGER,
  ADD COLUMN "maximumRemovalsPerUpdate" INTEGER,
  ADD COLUMN "minimumAdditionConfidence" INTEGER,
  ADD COLUMN "minimumRemovalConfidence" INTEGER,
  ADD COLUMN "requireApprovalForRegeneration" BOOLEAN,
  ADD COLUMN "protected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "protectionReason" TEXT,
  ADD COLUMN "protectedByUserId" TEXT,
  ADD COLUMN "protectedAt" TIMESTAMP(3),
  ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pauseReason" TEXT;

CREATE TABLE "AutomationPolicy" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permissionLevel" TEXT NOT NULL DEFAULT 'SUGGEST_ONLY',
  "preset" TEXT NOT NULL DEFAULT 'CONSERVATIVE',
  "isCustom" BOOLEAN NOT NULL DEFAULT false,
  "allowAdditions" BOOLEAN NOT NULL DEFAULT false,
  "allowRemovals" BOOLEAN NOT NULL DEFAULT false,
  "allowReorder" BOOLEAN NOT NULL DEFAULT false,
  "maximumAdditionsPerUpdate" INTEGER NOT NULL DEFAULT 3,
  "maximumRemovalsPerUpdate" INTEGER NOT NULL DEFAULT 0,
  "minimumAdditionConfidence" INTEGER NOT NULL DEFAULT 85,
  "minimumRemovalConfidence" INTEGER NOT NULL DEFAULT 90,
  "maximumChangesPerDay" INTEGER NOT NULL DEFAULT 10,
  "maximumChangesPerWeek" INTEGER NOT NULL DEFAULT 50,
  "maximumAdditionsPerDay" INTEGER NOT NULL DEFAULT 10,
  "maximumRemovalsPerDay" INTEGER NOT NULL DEFAULT 0,
  "maximumAdditionsPerWeek" INTEGER NOT NULL DEFAULT 50,
  "maximumRemovalsPerWeek" INTEGER NOT NULL DEFAULT 0,
  "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  "quietHoursStart" TEXT NOT NULL DEFAULT '22:00',
  "quietHoursEnd" TEXT NOT NULL DEFAULT '07:00',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "quietHoursDaysJson" JSONB,
  "allowAnalysisDuringQuietHours" BOOLEAN NOT NULL DEFAULT true,
  "allowProposalsDuringQuietHours" BOOLEAN NOT NULL DEFAULT true,
  "requireApprovalForRegeneration" BOOLEAN NOT NULL DEFAULT true,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "pauseReason" TEXT,
  "pausedAt" TIMESTAMP(3),
  "pausedByUserId" TEXT,
  "migratedNoticeDismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revisionCounter" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AutomationPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationProposal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "generatedPlaylistId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sourceRevisionNumber" INTEGER,
  "sourcePlaylistUpdatedAt" TIMESTAMP(3) NOT NULL,
  "policyDecisionJson" JSONB NOT NULL,
  "policySnapshotJson" JSONB NOT NULL,
  "summaryJson" JSONB,
  "warningsJson" JSONB,
  "requestingJobId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "appliedActivityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationProposalItem" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "trackId" TEXT,
  "plexRatingKey" TEXT,
  "positionBefore" INTEGER,
  "positionAfter" INTEGER,
  "confidence" INTEGER,
  "explanationJson" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationProposalItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationActivity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "generatedPlaylistId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "permissionLevel" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "proposedAdditions" INTEGER NOT NULL DEFAULT 0,
  "proposedRemovals" INTEGER NOT NULL DEFAULT 0,
  "appliedAdditions" INTEGER NOT NULL DEFAULT 0,
  "appliedRemovals" INTEGER NOT NULL DEFAULT 0,
  "appliedReorders" INTEGER NOT NULL DEFAULT 0,
  "usageAdjustment" INTEGER NOT NULL DEFAULT 0,
  "policySnapshotJson" JSONB NOT NULL,
  "decisionJson" JSONB NOT NULL,
  "jobId" TEXT,
  "proposalId" TEXT,
  "playlistRevisionId" TEXT,
  "plexStateFingerprint" TEXT,
  "rollbackStatus" TEXT,
  "rolledBackAt" TIMESTAMP(3),
  "rolledBackByUserId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AutomationActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationActivityItem" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "trackId" TEXT,
  "plexRatingKey" TEXT,
  "confidence" INTEGER,
  "outcome" TEXT NOT NULL,
  "reasonCode" TEXT,
  "explanationJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationActivityItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationPolicy_userId_key" ON "AutomationPolicy"("userId");
CREATE INDEX "AutomationPolicy_paused_idx" ON "AutomationPolicy"("paused");
CREATE UNIQUE INDEX "AutomationProposal_idempotencyKey_key" ON "AutomationProposal"("idempotencyKey");
CREATE INDEX "AutomationProposal_userId_status_createdAt_idx" ON "AutomationProposal"("userId", "status", "createdAt");
CREATE INDEX "AutomationProposal_generatedPlaylistId_status_idx" ON "AutomationProposal"("generatedPlaylistId", "status");
CREATE INDEX "AutomationProposal_expiresAt_idx" ON "AutomationProposal"("expiresAt");
CREATE INDEX "AutomationProposalItem_proposalId_status_idx" ON "AutomationProposalItem"("proposalId", "status");
CREATE INDEX "AutomationProposalItem_trackId_idx" ON "AutomationProposalItem"("trackId");
CREATE UNIQUE INDEX "AutomationActivity_playlistRevisionId_key" ON "AutomationActivity"("playlistRevisionId");
CREATE INDEX "AutomationActivity_userId_createdAt_idx" ON "AutomationActivity"("userId", "createdAt");
CREATE INDEX "AutomationActivity_generatedPlaylistId_createdAt_idx" ON "AutomationActivity"("generatedPlaylistId", "createdAt");
CREATE INDEX "AutomationActivity_userId_status_createdAt_idx" ON "AutomationActivity"("userId", "status", "createdAt");
CREATE INDEX "AutomationActivity_userId_source_createdAt_idx" ON "AutomationActivity"("userId", "source", "createdAt");
CREATE INDEX "AutomationActivityItem_activityId_outcome_idx" ON "AutomationActivityItem"("activityId", "outcome");
CREATE INDEX "AutomationActivityItem_trackId_idx" ON "AutomationActivityItem"("trackId");

ALTER TABLE "AutomationPolicy" ADD CONSTRAINT "AutomationPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationProposal" ADD CONSTRAINT "AutomationProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationProposal" ADD CONSTRAINT "AutomationProposal_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationProposalItem" ADD CONSTRAINT "AutomationProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AutomationProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationActivity" ADD CONSTRAINT "AutomationActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationActivity" ADD CONSTRAINT "AutomationActivity_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationActivity" ADD CONSTRAINT "AutomationActivity_playlistRevisionId_fkey" FOREIGN KEY ("playlistRevisionId") REFERENCES "PlaylistRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationActivityItem" ADD CONSTRAINT "AutomationActivityItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "AutomationActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing automation is intentionally mapped to the safe review-first policy. Existing schedules remain untouched.
INSERT INTO "AutomationPolicy" (
  "id", "userId", "permissionLevel", "preset", "isCustom", "allowAdditions", "maximumAdditionsPerUpdate",
  "minimumAdditionConfidence", "maximumChangesPerDay", "maximumChangesPerWeek", "maximumAdditionsPerDay", "maximumAdditionsPerWeek", "updatedAt"
)
SELECT md5('mixarr-automation-policy:' || ras."userId"), ras."userId", 'SUGGEST_ONLY', 'CONSERVATIVE', true, false, 0,
       GREATEST(85, ROUND(ras."metadataConfidenceThreshold")::integer), 0, 0, 0, 0, CURRENT_TIMESTAMP
FROM "RecentlyAddedSettings" ras
ON CONFLICT ("userId") DO NOTHING;

-- Preserve legacy playlist overrides without granting broader access.
UPDATE "PlaylistAutomationSettings"
SET "useGlobalPolicy" = false,
    "permissionLevel" = CASE
      WHEN "mode" = 'off' THEN 'DISABLED'
      WHEN "mode" = 'automatic' THEN 'REQUIRE_APPROVAL'
      ELSE 'SUGGEST_ONLY'
    END,
    "preset" = 'CUSTOM';
