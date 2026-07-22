-- Mixarr v2.4.8: AI-Assisted Troubleshooting.
-- External AI remains disabled by default and diagnostic categories use safe defaults.
CREATE TABLE "TroubleshootingSession" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "householdId" TEXT, "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "problemCategory" TEXT NOT NULL, "problemDescription" TEXT, "relatedResourceType" TEXT, "relatedResourceId" TEXT,
  "privacySelectionsJson" JSONB NOT NULL DEFAULT '[]', "deterministicOnly" BOOLEAN NOT NULL DEFAULT true,
  "diagnosticTimeWindowMinutes" INTEGER NOT NULL DEFAULT 60, "bundleVersion" TEXT NOT NULL DEFAULT '1',
  "sanitizationVersion" TEXT NOT NULL DEFAULT '1.0', "diagnosticVersion" TEXT NOT NULL DEFAULT '1.0',
  "sanitizedBundleJson" JSONB, "redactionSummaryJson" JSONB, "aiProviderId" TEXT, "aiProviderName" TEXT,
  "aiModel" TEXT, "aiRequestStatus" TEXT, "aiUsageJson" JSONB, "aiCost" DOUBLE PRECISION, "aiExplanationJson" JSONB,
  "errorCode" TEXT, "errorMessage" TEXT, "summary" TEXT, "evidenceStrengthSummary" TEXT, "targetVersion" TEXT,
  "progressJson" JSONB, "exportStatus" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "completedAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3), "deletedAt" TIMESTAMP(3), CONSTRAINT "TroubleshootingSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TroubleshootingFinding" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "checkId" TEXT NOT NULL, "checkVersion" TEXT NOT NULL,
  "category" TEXT NOT NULL, "title" TEXT NOT NULL, "severity" TEXT NOT NULL, "evidenceStrength" TEXT NOT NULL,
  "summary" TEXT NOT NULL, "observedValuesJson" JSONB NOT NULL DEFAULT '{}', "expectedValuesJson" JSONB NOT NULL DEFAULT '{}',
  "evidenceJson" JSONB NOT NULL DEFAULT '[]', "affectedResourcesJson" JSONB NOT NULL DEFAULT '[]',
  "possibleActionsJson" JSONB NOT NULL DEFAULT '[]', "limitationsJson" JSONB NOT NULL DEFAULT '[]',
  "dataFreshness" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TroubleshootingFinding_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TroubleshootingSuggestion" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "source" TEXT NOT NULL, "supportingFindingIdsJson" JSONB NOT NULL DEFAULT '[]',
  "actionType" TEXT NOT NULL, "targetResourceType" TEXT, "targetResourceId" TEXT, "settingPath" TEXT, "title" TEXT NOT NULL,
  "currentValueJson" JSONB, "proposedValueJson" JSONB, "explanation" TEXT NOT NULL, "expectedEffect" TEXT NOT NULL,
  "possibleSideEffectsJson" JSONB NOT NULL DEFAULT '[]', "riskLevel" TEXT NOT NULL, "reversible" BOOLEAN NOT NULL,
  "backupRecommended" BOOLEAN NOT NULL DEFAULT false, "manualOnly" BOOLEAN NOT NULL DEFAULT true, "requiredPermission" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED', "targetVersion" TEXT, "simulationJson" JSONB, "simulationInputHash" TEXT,
  "validationResultJson" JSONB, "applyResultJson" JSONB, "rollbackReference" TEXT, "reviewerId" TEXT, "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "reviewedAt" TIMESTAMP(3), "appliedAt" TIMESTAMP(3), CONSTRAINT "TroubleshootingSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TroubleshootingAuditEvent" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "actorId" TEXT, "eventType" TEXT NOT NULL, "objectType" TEXT NOT NULL,
  "objectId" TEXT NOT NULL, "summary" TEXT, "safeMetadataJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TroubleshootingAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TroubleshootingSetting" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "aiAssistedEnabled" BOOLEAN NOT NULL DEFAULT false, "defaultDeterministicOnly" BOOLEAN NOT NULL DEFAULT true,
  "defaultPrivacyCategoriesJson" JSONB NOT NULL DEFAULT '["PROVIDER_STATUS","PLEX_STATUS","LIBRARY_STATISTICS","RECENT_JOB_HISTORY"]',
  "maximumLogWindowMinutes" INTEGER NOT NULL DEFAULT 1440, "maximumBundleBytes" INTEGER NOT NULL DEFAULT 524288,
  "retentionDays" INTEGER NOT NULL DEFAULT 30, "autoDeleteExpired" BOOLEAN NOT NULL DEFAULT true,
  "permitTrackMetadata" BOOLEAN NOT NULL DEFAULT false, "permitSanitizedLogs" BOOLEAN NOT NULL DEFAULT false,
  "requireAdminApprovalForChanges" BOOLEAN NOT NULL DEFAULT true, "whatIfSimulationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "allowExport" BOOLEAN NOT NULL DEFAULT true, "maximumAiRequestsPerDay" INTEGER NOT NULL DEFAULT 5,
  "advancedDetailsByDefault" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "TroubleshootingSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TroubleshootingFinding_sessionId_checkId_key" ON "TroubleshootingFinding"("sessionId", "checkId");
CREATE UNIQUE INDEX "TroubleshootingSetting_userId_key" ON "TroubleshootingSetting"("userId");
CREATE INDEX "TroubleshootingSession_userId_createdAt_idx" ON "TroubleshootingSession"("userId", "createdAt");
CREATE INDEX "TroubleshootingSession_userId_status_updatedAt_idx" ON "TroubleshootingSession"("userId", "status", "updatedAt");
CREATE INDEX "TroubleshootingSession_householdId_createdAt_idx" ON "TroubleshootingSession"("householdId", "createdAt");
CREATE INDEX "TroubleshootingSession_relatedResourceType_relatedResourceId_idx" ON "TroubleshootingSession"("relatedResourceType", "relatedResourceId");
CREATE INDEX "TroubleshootingSession_expiresAt_idx" ON "TroubleshootingSession"("expiresAt");
CREATE INDEX "TroubleshootingFinding_sessionId_severity_idx" ON "TroubleshootingFinding"("sessionId", "severity");
CREATE INDEX "TroubleshootingFinding_checkId_createdAt_idx" ON "TroubleshootingFinding"("checkId", "createdAt");
CREATE INDEX "TroubleshootingSuggestion_sessionId_status_createdAt_idx" ON "TroubleshootingSuggestion"("sessionId", "status", "createdAt");
CREATE INDEX "TroubleshootingSuggestion_targetResourceType_targetResourceId_idx" ON "TroubleshootingSuggestion"("targetResourceType", "targetResourceId");
CREATE INDEX "TroubleshootingSuggestion_reviewerId_reviewedAt_idx" ON "TroubleshootingSuggestion"("reviewerId", "reviewedAt");
CREATE INDEX "TroubleshootingAuditEvent_sessionId_createdAt_idx" ON "TroubleshootingAuditEvent"("sessionId", "createdAt");
CREATE INDEX "TroubleshootingAuditEvent_actorId_createdAt_idx" ON "TroubleshootingAuditEvent"("actorId", "createdAt");
CREATE INDEX "TroubleshootingAuditEvent_eventType_createdAt_idx" ON "TroubleshootingAuditEvent"("eventType", "createdAt");
ALTER TABLE "TroubleshootingSession" ADD CONSTRAINT "TroubleshootingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TroubleshootingFinding" ADD CONSTRAINT "TroubleshootingFinding_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TroubleshootingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TroubleshootingSuggestion" ADD CONSTRAINT "TroubleshootingSuggestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TroubleshootingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TroubleshootingAuditEvent" ADD CONSTRAINT "TroubleshootingAuditEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TroubleshootingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TroubleshootingSetting" ADD CONSTRAINT "TroubleshootingSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AiFeatureSetting" ("featureKey", "enabled", "implemented", "requiredCapabilities", "safeConfigurationJson", "createdAt", "updatedAt")
VALUES ('troubleshooting_explanations', false, true, '["chat_messages","structured_json"]'::jsonb, '{"advisoryOnly":true,"deterministicFirst":true,"automaticChanges":false,"maximumSuggestions":20}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("featureKey") DO UPDATE SET "implemented" = true, "safeConfigurationJson" = EXCLUDED."safeConfigurationJson", "updatedAt" = CURRENT_TIMESTAMP;
