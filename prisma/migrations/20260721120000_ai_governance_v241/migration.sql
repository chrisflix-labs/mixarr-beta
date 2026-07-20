-- Mixarr v2.4.1: additive AI privacy, cost, token, usage and governance controls.
-- Existing provider credentials/configuration and v2.4.0 audit rows are preserved.

ALTER TABLE "AiProviderConfig"
  ADD COLUMN "administratorConfirmedLocal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trustedNetwork" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "externalAccessWarning" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastLocalStatusValidationAt" TIMESTAMP(3);

ALTER TABLE "AiProviderModel"
  ADD COLUMN "maximumInputTokens" INTEGER,
  ADD COLUMN "maximumOutputTokens" INTEGER,
  ADD COLUMN "maximumCombinedTokens" INTEGER;

ALTER TABLE "AiRequestAudit"
  ADD COLUMN "logicalRequestId" TEXT,
  ADD COLUMN "requestSource" TEXT NOT NULL DEFAULT 'FOREGROUND',
  ADD COLUMN "background" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "locationClassification" TEXT,
  ADD COLUMN "privacyMode" TEXT,
  ADD COLUMN "includedMetadataFields" JSONB,
  ADD COLUMN "transformedMetadataFields" JSONB,
  ADD COLUMN "blockedMetadataFields" JSONB,
  ADD COLUMN "cachedTokenCount" INTEGER,
  ADD COLUMN "reasoningTokenCount" INTEGER,
  ADD COLUMN "actualCost" DECIMAL(18,6),
  ADD COLUMN "pricingProfileId" TEXT,
  ADD COLUMN "usageSource" TEXT NOT NULL DEFAULT 'ESTIMATED',
  ADD COLUMN "timeToFirstTokenMs" INTEGER,
  ADD COLUMN "fallbackReason" TEXT,
  ADD COLUMN "originalProviderConfigId" TEXT,
  ADD COLUMN "originalModel" TEXT,
  ADD COLUMN "estimatedFallbackSavings" DECIMAL(18,6),
  ADD COLUMN "crossedProviderBoundary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "crossedLocationBoundary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "budgetControlResult" TEXT,
  ADD COLUMN "limitControlResult" TEXT,
  ADD COLUMN "blockReason" TEXT,
  ADD COLUMN "providerRequestId" TEXT;

CREATE TABLE "AiGovernanceSetting" (
  "id" TEXT NOT NULL DEFAULT 'global', "privacyMode" TEXT NOT NULL DEFAULT 'METADATA_LIMITED',
  "reviewed" BOOLEAN NOT NULL DEFAULT false, "currency" TEXT NOT NULL DEFAULT 'USD',
  "monthlyBudget" DECIMAL(18,6), "budgetResetDay" INTEGER NOT NULL DEFAULT 1,
  "budgetWarningThresholds" JSONB NOT NULL DEFAULT '[0.5,0.75,0.9,1]', "hardShutdownEnabled" BOOLEAN NOT NULL DEFAULT true,
  "countLocalCost" BOOLEAN NOT NULL DEFAULT false, "allowUnpricedExternalModels" BOOLEAN NOT NULL DEFAULT false,
  "adminExemptionEnabled" BOOLEAN NOT NULL DEFAULT false, "allowPaidProviderFallback" BOOLEAN NOT NULL DEFAULT false,
  "automaticCheaperModelFallback" BOOLEAN NOT NULL DEFAULT false,
  "backgroundAiEnabled" BOOLEAN NOT NULL DEFAULT false, "externalBackgroundAiEnabled" BOOLEAN NOT NULL DEFAULT false,
  "maximumBackgroundRequestsPerDay" INTEGER, "maximumBackgroundCostPerDay" DECIMAL(18,6),
  "maximumBackgroundConcurrency" INTEGER NOT NULL DEFAULT 1, "backgroundAllowedHoursJson" JSONB,
  "requireExternalBackgroundApproval" BOOLEAN NOT NULL DEFAULT true,
  "maximumInputTokens" INTEGER NOT NULL DEFAULT 16000, "maximumOutputTokens" INTEGER NOT NULL DEFAULT 2000,
  "maximumCombinedTokens" INTEGER NOT NULL DEFAULT 18000, "maximumPromptCharacters" INTEGER NOT NULL DEFAULT 80000,
  "maximumPromptBytes" INTEGER NOT NULL DEFAULT 200000, "maximumMetadataRecords" INTEGER NOT NULL DEFAULT 500,
  "maximumContextMessages" INTEGER NOT NULL DEFAULT 100, "maximumResponseBytes" INTEGER NOT NULL DEFAULT 1048576,
  "maximumStructuredItems" INTEGER NOT NULL DEFAULT 1000, "dailyRequestLimit" INTEGER, "monthlyRequestLimit" INTEGER,
  "metadataAllowlistJson" JSONB NOT NULL DEFAULT '["artist","album","title","album_artist","genres","release_year","track_number","disc_number","duration","bpm","musical_key","energy","mood","danceability","loudness","instrumentalness","acousticness","popularity","explicit","existing_tags"]',
  "anonymousGranularity" TEXT NOT NULL DEFAULT 'STRICT', "anonymousYearBandSize" INTEGER NOT NULL DEFAULT 10,
  "anonymousBpmBandSize" INTEGER NOT NULL DEFAULT 10, "allowUnknownLocalMetadata" BOOLEAN NOT NULL DEFAULT false,
  "secureDebugEnabled" BOOLEAN NOT NULL DEFAULT false, "secureDebugRetentionHours" INTEGER NOT NULL DEFAULT 24,
  "defaultContextTrimmingStrategy" TEXT NOT NULL DEFAULT 'REJECT', "connectionTimeoutMs" INTEGER NOT NULL DEFAULT 10000,
  "firstTokenTimeoutMs" INTEGER NOT NULL DEFAULT 30000, "totalRequestTimeoutMs" INTEGER NOT NULL DEFAULT 120000,
  "streamingIdleTimeoutMs" INTEGER NOT NULL DEFAULT 30000, "cancellationGraceMs" INTEGER NOT NULL DEFAULT 2000,
  "maximumRetryAttempts" INTEGER NOT NULL DEFAULT 1, "maximumRetryCost" DECIMAL(18,6),
  "maximumCumulativeRequestCost" DECIMAL(18,6), "retryAfterPossibleBilling" BOOLEAN NOT NULL DEFAULT false,
  "auditRetentionDays" INTEGER NOT NULL DEFAULT 90, "usageSummaryRetentionDays" INTEGER NOT NULL DEFAULT 730,
  "errorRetentionDays" INTEGER NOT NULL DEFAULT 90, "settingVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AiGovernanceSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiProviderBudget" (
  "id" TEXT NOT NULL, "providerConfigId" TEXT NOT NULL, "currency" TEXT NOT NULL DEFAULT 'USD',
  "dailyLimit" DECIMAL(18,6), "monthlyLimit" DECIMAL(18,6), "warningThresholdsJson" JSONB NOT NULL DEFAULT '[0.5,0.75,0.9,1]',
  "hardLimitEnabled" BOOLEAN NOT NULL DEFAULT true, "selectableAfterWarning" BOOLEAN NOT NULL DEFAULT true,
  "allowFallbackWhenExhausted" BOOLEAN NOT NULL DEFAULT false, "dailyRequestLimit" INTEGER, "monthlyRequestLimit" INTEGER,
  "maximumInputTokens" INTEGER, "maximumOutputTokens" INTEGER, "maximumCombinedTokens" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiProviderBudget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiProviderBudget_providerConfigId_key" ON "AiProviderBudget"("providerConfigId");

CREATE TABLE "AiUserLimit" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "currency" TEXT NOT NULL DEFAULT 'USD', "dailyCostLimit" DECIMAL(18,6),
  "monthlyCostLimit" DECIMAL(18,6), "dailyRequestLimit" INTEGER, "monthlyRequestLimit" INTEGER,
  "maximumInputTokens" INTEGER, "maximumOutputTokens" INTEGER, "maximumCombinedTokens" INTEGER,
  "allowedPrivacyModesJson" JSONB, "allowedProviderIdsJson" JSONB, "allowedModelTiersJson" JSONB,
  "paidProvidersAllowed" BOOLEAN NOT NULL DEFAULT false, "backgroundRequestsAllowed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUserLimit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiUserLimit_userId_key" ON "AiUserLimit"("userId");
CREATE INDEX "AiUserLimit_userId_idx" ON "AiUserLimit"("userId");

CREATE TABLE "AiModelPricing" (
  "id" TEXT NOT NULL, "providerConfigId" TEXT NOT NULL, "modelIdentifier" TEXT NOT NULL, "displayName" TEXT NOT NULL,
  "inputPricePerMillion" DECIMAL(18,6), "outputPricePerMillion" DECIMAL(18,6), "cachedInputPricePerMillion" DECIMAL(18,6),
  "reasoningPricePerMillion" DECIMAL(18,6), "fixedRequestCost" DECIMAL(18,6), "currency" TEXT NOT NULL DEFAULT 'USD',
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "pricingSource" TEXT, "lastVerifiedAt" TIMESTAMP(3),
  "enabled" BOOLEAN NOT NULL DEFAULT true, "estimated" BOOLEAN NOT NULL DEFAULT true,
  "billingClassification" TEXT NOT NULL DEFAULT 'EXTERNAL', "status" TEXT NOT NULL DEFAULT 'PRICED', "supersedesId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiModelPricing_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiModelPricing_providerConfigId_modelIdentifier_effectiveAt_idx" ON "AiModelPricing"("providerConfigId", "modelIdentifier", "effectiveAt");
CREATE INDEX "AiModelPricing_enabled_lastVerifiedAt_idx" ON "AiModelPricing"("enabled", "lastVerifiedAt");

CREATE TABLE "AiBudgetReservation" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "auditId" TEXT, "userId" TEXT, "providerConfigId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL, "requestSource" TEXT NOT NULL DEFAULT 'FOREGROUND', "currency" TEXT NOT NULL DEFAULT 'USD',
  "reservedCost" DECIMAL(18,6) NOT NULL, "actualCost" DECIMAL(18,6), "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL, "releasedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AiBudgetReservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiBudgetReservation_status_expiresAt_idx" ON "AiBudgetReservation"("status", "expiresAt");
CREATE INDEX "AiBudgetReservation_providerConfigId_status_createdAt_idx" ON "AiBudgetReservation"("providerConfigId", "status", "createdAt");
CREATE INDEX "AiBudgetReservation_userId_status_createdAt_idx" ON "AiBudgetReservation"("userId", "status", "createdAt");
CREATE INDEX "AiBudgetReservation_requestId_idx" ON "AiBudgetReservation"("requestId");

CREATE TABLE "AiProviderAttempt" (
  "id" TEXT NOT NULL, "requestAuditId" TEXT NOT NULL, "attemptNumber" INTEGER NOT NULL, "providerConfigId" TEXT NOT NULL,
  "model" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'STARTED', "estimatedCost" DECIMAL(18,6), "actualCost" DECIMAL(18,6),
  "inputTokens" INTEGER, "outputTokens" INTEGER, "cachedTokens" INTEGER, "reasoningTokens" INTEGER,
  "providerAcknowledged" BOOLEAN NOT NULL DEFAULT false, "errorCategory" TEXT, "retryReason" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), "safeUsageJson" JSONB,
  CONSTRAINT "AiProviderAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiProviderAttempt_requestAuditId_attemptNumber_key" ON "AiProviderAttempt"("requestAuditId", "attemptNumber");
CREATE INDEX "AiProviderAttempt_providerConfigId_startedAt_idx" ON "AiProviderAttempt"("providerConfigId", "startedAt");
CREATE INDEX "AiProviderAttempt_status_startedAt_idx" ON "AiProviderAttempt"("status", "startedAt");

CREATE TABLE "AiPrivacyAcknowledgment" (
  "id" TEXT NOT NULL, "policyVersion" TEXT NOT NULL, "actorId" TEXT NOT NULL, "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3), "warningHash" TEXT NOT NULL, CONSTRAINT "AiPrivacyAcknowledgment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiPrivacyAcknowledgment_policyVersion_revokedAt_idx" ON "AiPrivacyAcknowledgment"("policyVersion", "revokedAt");
CREATE INDEX "AiPrivacyAcknowledgment_actorId_acceptedAt_idx" ON "AiPrivacyAcknowledgment"("actorId", "acceptedAt");

CREATE TABLE "AiAlertThreshold" (
  "id" TEXT NOT NULL, "scopeType" TEXT NOT NULL, "scopeId" TEXT, "condition" TEXT NOT NULL, "thresholdsJson" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "cooldownMinutes" INTEGER NOT NULL DEFAULT 1440,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiAlertThreshold_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiAlertThreshold_scopeType_scopeId_enabled_idx" ON "AiAlertThreshold"("scopeType", "scopeId", "enabled");

CREATE TABLE "AiAlertEvent" (
  "id" TEXT NOT NULL, "thresholdId" TEXT, "deduplicationKey" TEXT NOT NULL, "severity" TEXT NOT NULL, "condition" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL, "scopeId" TEXT, "safeDetailsJson" JSONB, "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AiAlertEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiAlertEvent_deduplicationKey_createdAt_idx" ON "AiAlertEvent"("deduplicationKey", "createdAt");
CREATE INDEX "AiAlertEvent_acknowledgedAt_createdAt_idx" ON "AiAlertEvent"("acknowledgedAt", "createdAt");

CREATE TABLE "AiContextTrimmingRecord" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "strategy" TEXT NOT NULL, "originalTokenEstimate" INTEGER NOT NULL,
  "finalTokenEstimate" INTEGER NOT NULL, "savedTokenEstimate" INTEGER NOT NULL, "removedSectionsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AiContextTrimmingRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiContextTrimmingRecord_requestId_idx" ON "AiContextTrimmingRecord"("requestId");
CREATE INDEX "AiContextTrimmingRecord_createdAt_idx" ON "AiContextTrimmingRecord"("createdAt");

CREATE TABLE "AiGovernanceAudit" (
  "id" TEXT NOT NULL, "actorId" TEXT NOT NULL, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL,
  "previousValueJson" JSONB, "newValueJson" JSONB, "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiGovernanceAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiGovernanceAudit_actorId_createdAt_idx" ON "AiGovernanceAudit"("actorId", "createdAt");
CREATE INDEX "AiGovernanceAudit_entityType_entityId_createdAt_idx" ON "AiGovernanceAudit"("entityType", "entityId", "createdAt");

CREATE TABLE "AiSecureDebugPayload" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "privacyMode" TEXT NOT NULL, "sanitizedPayload" JSONB NOT NULL,
  "privacyReportJson" JSONB NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AiSecureDebugPayload_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiSecureDebugPayload_requestId_idx" ON "AiSecureDebugPayload"("requestId");
CREATE INDEX "AiSecureDebugPayload_expiresAt_idx" ON "AiSecureDebugPayload"("expiresAt");

CREATE INDEX "AiRequestAudit_userId_createdAt_idx" ON "AiRequestAudit"("userId", "createdAt");
CREATE INDEX "AiRequestAudit_privacyMode_createdAt_idx" ON "AiRequestAudit"("privacyMode", "createdAt");
CREATE INDEX "AiRequestAudit_requestSource_createdAt_idx" ON "AiRequestAudit"("requestSource", "createdAt");
CREATE INDEX "AiRequestAudit_blockReason_createdAt_idx" ON "AiRequestAudit"("blockReason", "createdAt");

ALTER TABLE "AiProviderBudget" ADD CONSTRAINT "AiProviderBudget_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiModelPricing" ADD CONSTRAINT "AiModelPricing_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiBudgetReservation" ADD CONSTRAINT "AiBudgetReservation_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiBudgetReservation" ADD CONSTRAINT "AiBudgetReservation_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "AiRequestAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiProviderAttempt" ADD CONSTRAINT "AiProviderAttempt_requestAuditId_fkey" FOREIGN KEY ("requestAuditId") REFERENCES "AiRequestAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiProviderAttempt" ADD CONSTRAINT "AiProviderAttempt_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "AiGovernanceSetting" ("id", "budgetWarningThresholds", "metadataAllowlistJson", "updatedAt")
VALUES ('global', '[0.5,0.75,0.9,1]', '["artist","album","title","album_artist","genres","release_year","track_number","disc_number","duration","bpm","musical_key","energy","mood","danceability","loudness","instrumentalness","acousticness","popularity","explicit","existing_tags"]', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
