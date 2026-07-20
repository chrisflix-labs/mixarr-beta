-- Mixarr v2.4.0: provider-neutral AI foundation.
-- This migration is additive. AI remains disabled and no provider is created.
CREATE TABLE "AiGlobalSetting" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "defaultProviderId" TEXT,
  "defaultFallbackPolicy" TEXT NOT NULL DEFAULT 'NONE',
  "auditRetentionDays" INTEGER NOT NULL DEFAULT 90,
  "usageReportingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "maximumServerResponseBytes" INTEGER NOT NULL DEFAULT 1048576,
  "defaultTimeoutMs" INTEGER NOT NULL DEFAULT 30000,
  "privacyWarningAcknowledgedAt" TIMESTAMP(3),
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiGlobalSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiProviderConfig" (
  "id" TEXT NOT NULL,
  "providerType" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "locationClassification" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "baseUrl" TEXT,
  "authenticationType" TEXT NOT NULL DEFAULT 'NONE',
  "encryptedSecretPayload" TEXT,
  "encryptedSecretHeaders" TEXT,
  "nonSecretHeadersJson" JSONB,
  "defaultModel" TEXT,
  "fastModel" TEXT,
  "reasoningModel" TEXT,
  "maximumContextTokens" INTEGER,
  "maximumOutputTokens" INTEGER,
  "requestTimeoutMs" INTEGER NOT NULL DEFAULT 30000,
  "retryCount" INTEGER NOT NULL DEFAULT 2,
  "initialRetryDelayMs" INTEGER NOT NULL DEFAULT 500,
  "maximumRetryDelayMs" INTEGER NOT NULL DEFAULT 10000,
  "retryBackoffMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2,
  "sslVerification" BOOLEAN NOT NULL DEFAULT true,
  "capabilityOverridesJson" JSONB,
  "modelDiscoveryEnabled" BOOLEAN NOT NULL DEFAULT true,
  "healthCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
  "healthCheckIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
  "monthlyBudget" DOUBLE PRECISION,
  "budgetWarningThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "priority" INTEGER,
  "fallbackProviderId" TEXT,
  "notes" TEXT,
  "customConfigurationJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastConnectionTestAt" TIMESTAMP(3),
  "lastSuccessfulConnectionAt" TIMESTAMP(3),
  CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiProviderModel" (
  "id" TEXT NOT NULL,
  "providerConfigId" TEXT NOT NULL,
  "modelIdentifier" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "contextSize" INTEGER,
  "modelCategory" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "capabilityMetadata" JSONB,
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "availabilityStatus" TEXT NOT NULL DEFAULT 'AVAILABLE',
  CONSTRAINT "AiProviderModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiProviderHealth" (
  "id" TEXT NOT NULL,
  "providerConfigId" TEXT NOT NULL,
  "healthState" TEXT NOT NULL DEFAULT 'NOT_TESTED',
  "lastCheckAt" TIMESTAMP(3),
  "lastSuccessfulCheckAt" TIMESTAMP(3),
  "latencyMs" INTEGER,
  "errorCategory" TEXT,
  "sanitizedMessage" TEXT,
  "discoveredModelCount" INTEGER NOT NULL DEFAULT 0,
  "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
  "nextEligibleCheckAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiProviderHealth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiFeatureSetting" (
  "featureKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "implemented" BOOLEAN NOT NULL DEFAULT false,
  "preferredProviderId" TEXT,
  "preferredModel" TEXT,
  "fallbackBehavior" TEXT NOT NULL DEFAULT 'NONE',
  "fallbackProviderId" TEXT,
  "requiredCapabilities" JSONB,
  "safeConfigurationJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiFeatureSetting_pkey" PRIMARY KEY ("featureKey")
);

CREATE TABLE "AiRequestAudit" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "correlationId" TEXT,
  "featureKey" TEXT NOT NULL,
  "providerConfigId" TEXT,
  "providerType" TEXT,
  "providerDisplayName" TEXT,
  "model" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "latencyMs" INTEGER,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "streamingUsed" BOOLEAN NOT NULL DEFAULT false,
  "cancellationStatus" TEXT,
  "inputTokenCount" INTEGER,
  "outputTokenCount" INTEGER,
  "totalTokenCount" INTEGER,
  "estimatedCost" DOUBLE PRECISION,
  "responseByteCount" INTEGER,
  "errorCategory" TEXT,
  "sanitizedErrorCode" TEXT,
  "userId" TEXT,
  "safeMetadataJson" JSONB,
  "promptHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRequestAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiProviderModel_providerConfigId_modelIdentifier_key" ON "AiProviderModel"("providerConfigId", "modelIdentifier");
CREATE UNIQUE INDEX "AiProviderHealth_providerConfigId_key" ON "AiProviderHealth"("providerConfigId");
CREATE UNIQUE INDEX "AiRequestAudit_requestId_key" ON "AiRequestAudit"("requestId");
CREATE INDEX "AiProviderConfig_providerType_enabled_idx" ON "AiProviderConfig"("providerType", "enabled");
CREATE INDEX "AiProviderConfig_enabled_priority_idx" ON "AiProviderConfig"("enabled", "priority");
CREATE INDEX "AiProviderConfig_fallbackProviderId_idx" ON "AiProviderConfig"("fallbackProviderId");
CREATE INDEX "AiProviderModel_providerConfigId_availabilityStatus_idx" ON "AiProviderModel"("providerConfigId", "availabilityStatus");
CREATE INDEX "AiProviderModel_lastSeenAt_idx" ON "AiProviderModel"("lastSeenAt");
CREATE INDEX "AiProviderHealth_healthState_nextEligibleCheckAt_idx" ON "AiProviderHealth"("healthState", "nextEligibleCheckAt");
CREATE INDEX "AiFeatureSetting_enabled_implemented_idx" ON "AiFeatureSetting"("enabled", "implemented");
CREATE INDEX "AiFeatureSetting_preferredProviderId_idx" ON "AiFeatureSetting"("preferredProviderId");
CREATE INDEX "AiFeatureSetting_fallbackProviderId_idx" ON "AiFeatureSetting"("fallbackProviderId");
CREATE INDEX "AiRequestAudit_createdAt_idx" ON "AiRequestAudit"("createdAt");
CREATE INDEX "AiRequestAudit_featureKey_createdAt_idx" ON "AiRequestAudit"("featureKey", "createdAt");
CREATE INDEX "AiRequestAudit_providerConfigId_createdAt_idx" ON "AiRequestAudit"("providerConfigId", "createdAt");
CREATE INDEX "AiRequestAudit_status_startedAt_idx" ON "AiRequestAudit"("status", "startedAt");
CREATE INDEX "AiRequestAudit_correlationId_idx" ON "AiRequestAudit"("correlationId");

ALTER TABLE "AiProviderConfig" ADD CONSTRAINT "AiProviderConfig_fallbackProviderId_fkey" FOREIGN KEY ("fallbackProviderId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiProviderModel" ADD CONSTRAINT "AiProviderModel_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiProviderHealth" ADD CONSTRAINT "AiProviderHealth_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiFeatureSetting" ADD CONSTRAINT "AiFeatureSetting_preferredProviderId_fkey" FOREIGN KEY ("preferredProviderId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiFeatureSetting" ADD CONSTRAINT "AiFeatureSetting_fallbackProviderId_fkey" FOREIGN KEY ("fallbackProviderId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRequestAudit" ADD CONSTRAINT "AiRequestAudit_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
