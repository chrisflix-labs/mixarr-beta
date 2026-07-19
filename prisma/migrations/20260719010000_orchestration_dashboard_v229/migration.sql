-- Mixarr v2.2.9 Orchestration Dashboard & Release Polish
-- Additive only. Existing playlist enrollment, schedules, actions, experiments,
-- automation flags, and history are not modified.

ALTER TABLE "PlaylistOrchestrationAuditEvent"
  ADD COLUMN "playlistGroupId" TEXT,
  ADD COLUMN "smartActionId" TEXT,
  ADD COLUMN "experimentId" TEXT,
  ADD COLUMN "operationType" TEXT,
  ADD COLUMN "outcome" TEXT;

CREATE TABLE "OrchestrationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dashboardTimeRange" TEXT NOT NULL DEFAULT '30d',
  "onboardingStep" INTEGER NOT NULL DEFAULT 1,
  "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
  "automationLevel" TEXT NOT NULL DEFAULT 'OBSERVE_ONLY',
  "goalsJson" JSONB NOT NULL DEFAULT '[]',
  "safetySettingsJson" JSONB NOT NULL DEFAULT '{}',
  "dashboardJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrchestrationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrchestrationTrendSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "managedPlaylistCount" INTEGER NOT NULL DEFAULT 0,
  "healthyPlaylistCount" INTEGER NOT NULL DEFAULT 0,
  "attentionPlaylistCount" INTEGER NOT NULL DEFAULT 0,
  "pausedPlaylistCount" INTEGER NOT NULL DEFAULT 0,
  "averageHealthScore" DOUBLE PRECISION,
  "libraryCoveragePercentage" DOUBLE PRECISION,
  "averageOverlapPercentage" DOUBLE PRECISION,
  "automationSuccessRate" DOUBLE PRECISION,
  "pendingSmartActionCount" INTEGER NOT NULL DEFAULT 0,
  "activeExperimentCount" INTEGER NOT NULL DEFAULT 0,
  "failedJobCount" INTEGER NOT NULL DEFAULT 0,
  "metadataConfidence" DOUBLE PRECISION,
  "identityMatch" DOUBLE PRECISION,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadataJson" JSONB,
  CONSTRAINT "OrchestrationTrendSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrchestrationBackupValidation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceName" TEXT,
  "status" TEXT NOT NULL,
  "backupSchemaVersion" TEXT,
  "restoreCompatible" BOOLEAN NOT NULL DEFAULT false,
  "estimatedRestoreScope" INTEGER NOT NULL DEFAULT 0,
  "missingSectionsJson" JSONB NOT NULL DEFAULT '[]',
  "corruptSectionsJson" JSONB NOT NULL DEFAULT '[]',
  "warningsJson" JSONB NOT NULL DEFAULT '[]',
  "errorsJson" JSONB NOT NULL DEFAULT '[]',
  "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrchestrationBackupValidation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrchestrationPreference_userId_key" ON "OrchestrationPreference"("userId");
CREATE INDEX "OrchestrationPreference_onboardingComplete_updatedAt_idx" ON "OrchestrationPreference"("onboardingComplete", "updatedAt");
CREATE INDEX "OrchestrationTrendSnapshot_userId_capturedAt_idx" ON "OrchestrationTrendSnapshot"("userId", "capturedAt");
CREATE INDEX "OrchestrationBackupValidation_userId_validatedAt_idx" ON "OrchestrationBackupValidation"("userId", "validatedAt");
CREATE INDEX "OrchestrationBackupValidation_status_validatedAt_idx" ON "OrchestrationBackupValidation"("status", "validatedAt");
CREATE INDEX "PlaylistOrchestrationJob_userId_status_scheduledFor_idx" ON "PlaylistOrchestrationJob"("userId", "status", "scheduledFor");
CREATE INDEX "SmartAction_userId_status_priority_createdAt_idx" ON "SmartAction"("userId", "status", "priority", "createdAt");
CREATE INDEX "SmartExperiment_userId_status_completedAt_idx" ON "SmartExperiment"("userId", "status", "completedAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_userId_severity_createdAt_idx" ON "PlaylistOrchestrationAuditEvent"("userId", "severity", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_userId_actorType_createdAt_idx" ON "PlaylistOrchestrationAuditEvent"("userId", "actorType", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_playlistGroupId_createdAt_idx" ON "PlaylistOrchestrationAuditEvent"("playlistGroupId", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_smartActionId_createdAt_idx" ON "PlaylistOrchestrationAuditEvent"("smartActionId", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_experimentId_createdAt_idx" ON "PlaylistOrchestrationAuditEvent"("experimentId", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_operationType_createdAt_idx" ON "PlaylistOrchestrationAuditEvent"("operationType", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_outcome_createdAt_idx" ON "PlaylistOrchestrationAuditEvent"("outcome", "createdAt");

ALTER TABLE "OrchestrationPreference" ADD CONSTRAINT "OrchestrationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrchestrationTrendSnapshot" ADD CONSTRAINT "OrchestrationTrendSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrchestrationBackupValidation" ADD CONSTRAINT "OrchestrationBackupValidation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
