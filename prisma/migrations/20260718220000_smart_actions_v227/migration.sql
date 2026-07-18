-- Mixarr v2.2.7 Smart Action Center. Additive only; no existing data is rewritten.
CREATE TABLE "SmartAction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "libraryId" TEXT,
  "playlistId" TEXT,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "confidenceScore" INTEGER NOT NULL,
  "confidenceLevel" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "sourceService" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "actionPayload" JSONB NOT NULL,
  "previewPayload" JSONB NOT NULL,
  "expectedImpact" JSONB NOT NULL,
  "actualImpact" JSONB,
  "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
  "sourceFingerprint" TEXT,
  "rejectionReason" TEXT,
  "snoozeCondition" TEXT,
  "approvedBy" TEXT,
  "executionAttempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "snoozedUntil" TIMESTAMP(3),
  "scheduledFor" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "deduplicationKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "SmartAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartActionAuditEvent" (
  "id" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorType" TEXT NOT NULL DEFAULT 'USER',
  "eventType" TEXT NOT NULL,
  "previousStatus" TEXT,
  "newStatus" TEXT,
  "reason" TEXT,
  "resultJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartActionAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartActionSetting" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "generateDuringNightlySync" BOOLEAN NOT NULL DEFAULT true,
  "generateAfterPlaylistCreation" BOOLEAN NOT NULL DEFAULT true,
  "generateAfterMetadataAnalysis" BOOLEAN NOT NULL DEFAULT true,
  "minimumConfidenceToDisplay" INTEGER NOT NULL DEFAULT 0,
  "highConfidenceThreshold" INTEGER NOT NULL DEFAULT 85,
  "mediumConfidenceThreshold" INTEGER NOT NULL DEFAULT 65,
  "maximumPendingActions" INTEGER NOT NULL DEFAULT 500,
  "expireAfterDays" INTEGER NOT NULL DEFAULT 30,
  "recommendationTypesJson" JSONB NOT NULL,
  "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT false,
  "maintenanceStartTime" TEXT NOT NULL DEFAULT '03:00',
  "maintenanceDaysJson" JSONB NOT NULL,
  "maximumActionsPerWindow" INTEGER NOT NULL DEFAULT 20,
  "maximumPlaylistsPerWindow" INTEGER NOT NULL DEFAULT 10,
  "maximumConcurrentActions" INTEGER NOT NULL DEFAULT 1,
  "allowPlexRefreshes" BOOLEAN NOT NULL DEFAULT true,
  "allowMetadataChanges" BOOLEAN NOT NULL DEFAULT false,
  "allowPlaylistRegeneration" BOOLEAN NOT NULL DEFAULT false,
  "pauseDuringPlayback" BOOLEAN NOT NULL DEFAULT true,
  "automationEmergencyDisabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartActionSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartActionAutomationPolicy" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "minimumConfidence" INTEGER NOT NULL DEFAULT 95,
  "maximumRisk" TEXT NOT NULL DEFAULT 'LOW',
  "maximumPerWindow" INTEGER NOT NULL DEFAULT 3,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartActionAutomationPolicy_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PlaylistRevision" ADD COLUMN "smartActionId" TEXT;

CREATE INDEX "SmartAction_userId_deduplicationKey_idx" ON "SmartAction"("userId", "deduplicationKey");
CREATE INDEX "SmartAction_userId_status_createdAt_idx" ON "SmartAction"("userId", "status", "createdAt");
CREATE INDEX "SmartAction_libraryId_status_idx" ON "SmartAction"("libraryId", "status");
CREATE INDEX "SmartAction_playlistId_status_idx" ON "SmartAction"("playlistId", "status");
CREATE INDEX "SmartAction_actionType_idx" ON "SmartAction"("actionType");
CREATE INDEX "SmartAction_confidenceLevel_idx" ON "SmartAction"("confidenceLevel");
CREATE INDEX "SmartAction_scheduledFor_status_idx" ON "SmartAction"("scheduledFor", "status");
CREATE INDEX "SmartAction_createdAt_idx" ON "SmartAction"("createdAt");
CREATE INDEX "SmartActionAuditEvent_actionId_createdAt_idx" ON "SmartActionAuditEvent"("actionId", "createdAt");
CREATE INDEX "SmartActionAuditEvent_actorUserId_createdAt_idx" ON "SmartActionAuditEvent"("actorUserId", "createdAt");
CREATE INDEX "SmartActionAuditEvent_eventType_createdAt_idx" ON "SmartActionAuditEvent"("eventType", "createdAt");
CREATE UNIQUE INDEX "SmartActionSetting_userId_key" ON "SmartActionSetting"("userId");
CREATE UNIQUE INDEX "SmartActionAutomationPolicy_userId_actionType_key" ON "SmartActionAutomationPolicy"("userId", "actionType");
CREATE INDEX "SmartActionAutomationPolicy_userId_enabled_idx" ON "SmartActionAutomationPolicy"("userId", "enabled");
CREATE INDEX "PlaylistRevision_smartActionId_idx" ON "PlaylistRevision"("smartActionId");

ALTER TABLE "SmartAction" ADD CONSTRAINT "SmartAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartAction" ADD CONSTRAINT "SmartAction_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartAction" ADD CONSTRAINT "SmartAction_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartActionAuditEvent" ADD CONSTRAINT "SmartActionAuditEvent_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "SmartAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartActionAuditEvent" ADD CONSTRAINT "SmartActionAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartActionSetting" ADD CONSTRAINT "SmartActionSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartActionAutomationPolicy" ADD CONSTRAINT "SmartActionAutomationPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistRevision" ADD CONSTRAINT "PlaylistRevision_smartActionId_fkey" FOREIGN KEY ("smartActionId") REFERENCES "SmartAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
