-- Mixarr v2.4.9: AI governance, security, and reliability.
-- Existing providers and discovered models remain unapproved by design. An
-- administrator must explicitly review them after upgrade.

ALTER TABLE "AiGlobalSetting"
  ADD COLUMN "emergencyShutdown" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emergencyShutdownReason" TEXT,
  ADD COLUMN "emergencyShutdownBy" TEXT,
  ADD COLUMN "emergencyShutdownAt" TIMESTAMP(3);

ALTER TABLE "AiGovernanceSetting"
  ADD COLUMN "externalProvidersAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireExternalConfirmation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowedExternalFeaturesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "allowedExternalDataJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "requestMetadataRetentionDays" INTEGER NOT NULL DEFAULT 365,
  ADD COLUMN "requestBodyRetentionDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "responseMetadataRetentionDays" INTEGER NOT NULL DEFAULT 365,
  ADD COLUMN "responseBodyRetentionDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "quarantineRetentionDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "approvalRetentionDays" INTEGER NOT NULL DEFAULT 730,
  ADD COLUMN "costRetentionDays" INTEGER NOT NULL DEFAULT 730,
  ADD COLUMN "diagnosticRetentionDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "redactEmailAddresses" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "redactLocalPaths" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "redactInternalHostnames" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "redactIpAddresses" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "redactUsernames" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "globalConcurrencyLimit" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "perProviderConcurrencyLimit" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "perModelConcurrencyLimit" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "perUserConcurrencyLimit" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "perFeatureConcurrencyLimit" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "diagnosticConcurrencyLimit" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "healthCheckConcurrencyLimit" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "maximumQueueSize" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "jobLeaseSeconds" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "jsonLocalRepairAttempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "jsonProviderRepairAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AiProviderConfig"
  ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "allowedFeaturesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "privacyModesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "allowLibraryMetadata" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allowDiagnosticData" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allowUserNotes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allowExternalRequests" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestsPerMinute" INTEGER,
  ADD COLUMN "tokensPerMinute" INTEGER,
  ADD COLUMN "maximumConcurrency" INTEGER;

ALTER TABLE "AiProviderModel"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "allowedFeaturesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "capabilitiesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "structuredOutput" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "jsonMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "toolCalling" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deprecated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastSuccessfulUseAt" TIMESTAMP(3),
  ADD COLUMN "maximumConcurrency" INTEGER;

ALTER TABLE "AiRequestAudit"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "contentFingerprint" TEXT,
  ADD COLUMN "parentRequestId" TEXT,
  ADD COLUMN "promptTemplateVersion" TEXT,
  ADD COLUMN "requestBodyJson" JSONB,
  ADD COLUMN "requestBodyPurgedAt" TIMESTAMP(3),
  ADD COLUMN "externalDataCategoriesJson" JSONB,
  ADD COLUMN "redactionResultJson" JSONB,
  ADD COLUMN "injectionResultJson" JSONB,
  ADD COLUMN "structuredOutputResult" TEXT,
  ADD COLUMN "schemaValidationResult" TEXT,
  ADD COLUMN "policyValidationResult" TEXT,
  ADD COLUMN "deterministicResult" TEXT,
  ADD COLUMN "safetyAnalysisResult" TEXT,
  ADD COLUMN "quarantineStatus" TEXT,
  ADD COLUMN "approvalStatus" TEXT,
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "generatedRecipeId" TEXT,
  ADD COLUMN "playlistJobId" TEXT,
  ADD COLUMN "queueWaitMs" INTEGER,
  ADD COLUMN "providerDurationMs" INTEGER;

CREATE UNIQUE INDEX "AiRequestAudit_userId_idempotencyKey_key" ON "AiRequestAudit"("userId", "idempotencyKey");
CREATE INDEX "AiRequestAudit_contentFingerprint_createdAt_idx" ON "AiRequestAudit"("contentFingerprint", "createdAt");
CREATE INDEX "AiRequestAudit_quarantineStatus_createdAt_idx" ON "AiRequestAudit"("quarantineStatus", "createdAt");
CREATE INDEX "AiRequestAudit_approvalStatus_createdAt_idx" ON "AiRequestAudit"("approvalStatus", "createdAt");

CREATE TABLE "AiPermissionGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "grantedBy" TEXT NOT NULL,
  "reason" TEXT,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiPermissionGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiPermissionGrant_userId_permission_key" ON "AiPermissionGrant"("userId", "permission");
CREATE INDEX "AiPermissionGrant_permission_revokedAt_idx" ON "AiPermissionGrant"("permission", "revokedAt");
CREATE INDEX "AiPermissionGrant_userId_expiresAt_idx" ON "AiPermissionGrant"("userId", "expiresAt");

CREATE TABLE "AiJob" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestAuditId" TEXT,
  "userId" TEXT,
  "featureKey" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "providerConfigId" TEXT,
  "model" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "waitingReason" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maximumAttempts" INTEGER NOT NULL DEFAULT 1,
  "payloadJson" JSONB,
  "progressJson" JSONB,
  "resultReferenceJson" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "contentFingerprint" TEXT NOT NULL,
  "workerId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "cancellationRequestedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "redactedErrorMessage" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiJob_requestId_key" ON "AiJob"("requestId");
CREATE UNIQUE INDEX "AiJob_userId_idempotencyKey_key" ON "AiJob"("userId", "idempotencyKey");
CREATE INDEX "AiJob_status_priority_queuedAt_idx" ON "AiJob"("status", "priority", "queuedAt");
CREATE INDEX "AiJob_leaseExpiresAt_status_idx" ON "AiJob"("leaseExpiresAt", "status");
CREATE INDEX "AiJob_providerConfigId_status_idx" ON "AiJob"("providerConfigId", "status");
CREATE INDEX "AiJob_userId_status_idx" ON "AiJob"("userId", "status");
CREATE INDEX "AiJob_featureKey_status_idx" ON "AiJob"("featureKey", "status");

CREATE TABLE "AiResponseRecord" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "jobId" TEXT,
  "providerConfigId" TEXT,
  "model" TEXT,
  "schemaVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "bodyJson" JSONB,
  "bodyText" TEXT,
  "bodyPurgedAt" TIMESTAMP(3),
  "repairAttempts" INTEGER NOT NULL DEFAULT 0,
  "repairMethod" TEXT,
  "responseHash" TEXT NOT NULL,
  "validationSummaryJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiResponseRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiResponseRecord_requestId_key" ON "AiResponseRecord"("requestId");
CREATE INDEX "AiResponseRecord_status_createdAt_idx" ON "AiResponseRecord"("status", "createdAt");
CREATE INDEX "AiResponseRecord_providerConfigId_model_idx" ON "AiResponseRecord"("providerConfigId", "model");

CREATE TABLE "AiQuarantineRecord" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "responseRecordId" TEXT,
  "jobId" TEXT,
  "userId" TEXT,
  "featureKey" TEXT NOT NULL,
  "providerConfigId" TEXT,
  "model" TEXT,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "reasonCodesJson" JSONB NOT NULL,
  "nonOverridable" BOOLEAN NOT NULL DEFAULT false,
  "safeRequestPreview" TEXT,
  "safeResponsePreview" TEXT,
  "validationFailuresJson" JSONB,
  "redactionResultJson" JSONB,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "resolutionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiQuarantineRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiQuarantineRecord_status_severity_createdAt_idx" ON "AiQuarantineRecord"("status", "severity", "createdAt");
CREATE INDEX "AiQuarantineRecord_requestId_idx" ON "AiQuarantineRecord"("requestId");
CREATE INDEX "AiQuarantineRecord_userId_createdAt_idx" ON "AiQuarantineRecord"("userId", "createdAt");

CREATE TABLE "AiApprovalEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "artifactType" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reviewNotes" TEXT,
  "artifactHash" TEXT NOT NULL,
  "validationState" TEXT NOT NULL,
  "safetyState" TEXT NOT NULL,
  "diffJson" JSONB,
  "executionMode" TEXT,
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiApprovalEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiApprovalEvent_artifactType_artifactId_createdAt_idx" ON "AiApprovalEvent"("artifactType", "artifactId", "createdAt");
CREATE INDEX "AiApprovalEvent_requestId_createdAt_idx" ON "AiApprovalEvent"("requestId", "createdAt");
CREATE INDEX "AiApprovalEvent_reviewerId_createdAt_idx" ON "AiApprovalEvent"("reviewerId", "createdAt");

CREATE TABLE "AiSecurityEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "reasonCodesJson" JSONB NOT NULL,
  "safeDetailsJson" JSONB,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiSecurityEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiSecurityEvent_requestId_createdAt_idx" ON "AiSecurityEvent"("requestId", "createdAt");
CREATE INDEX "AiSecurityEvent_eventType_createdAt_idx" ON "AiSecurityEvent"("eventType", "createdAt");
CREATE INDEX "AiSecurityEvent_severity_createdAt_idx" ON "AiSecurityEvent"("severity", "createdAt");
