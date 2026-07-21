-- Mixarr v2.4.4: review-only Recipe Copilot artifacts and durable provenance.
ALTER TABLE "PlaylistRecipe"
  ADD COLUMN "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiRecipeStatus" TEXT,
  ADD COLUMN "aiProvenanceJson" JSONB,
  ADD COLUMN "lastAiProposalId" TEXT,
  ADD COLUMN "manuallyEditedAfterAi" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlaylistRecipeRevision"
  ADD COLUMN "aiRequestId" TEXT,
  ADD COLUMN "aiProposalId" TEXT,
  ADD COLUMN "structuredDiffJson" JSONB;

CREATE TABLE "AiRecipeRequest" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "recipeId" TEXT,
  "recipeVersion" INTEGER,
  "action" TEXT NOT NULL,
  "sourceRequest" TEXT NOT NULL,
  "providerConfigId" TEXT,
  "providerDisplayName" TEXT,
  "model" TEXT,
  "privacyMode" TEXT NOT NULL DEFAULT 'METADATA_LIMITED',
  "status" TEXT NOT NULL DEFAULT 'PREPARING',
  "contextFingerprint" TEXT NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3),
  "promptTemplateVersion" TEXT NOT NULL,
  "inputTokenCount" INTEGER,
  "outputTokenCount" INTEGER,
  "estimatedCost" DECIMAL(18,6),
  "actualCost" DECIMAL(18,6),
  "aiResponseIdentifier" TEXT,
  "errorCategory" TEXT,
  "errorMessage" TEXT,
  "remote" BOOLEAN NOT NULL DEFAULT false,
  "cancelledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiRecipeRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiRecipeProposal" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "recipeId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
  "originalProposalJson" JSONB NOT NULL,
  "proposedConfigurationJson" JSONB,
  "analysisJson" JSONB NOT NULL,
  "intentJson" JSONB NOT NULL,
  "recommendationsJson" JSONB NOT NULL,
  "changesJson" JSONB NOT NULL,
  "validationJson" JSONB NOT NULL,
  "candidateEstimateJson" JSONB,
  "compatibilityJson" JSONB,
  "safetyWarningsJson" JSONB NOT NULL,
  "unsupportedRequestsJson" JSONB NOT NULL,
  "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "previousConfigurationJson" JSONB,
  "previousRecipeVersion" INTEGER,
  "manuallyEdited" BOOLEAN NOT NULL DEFAULT false,
  "differsFromAiProposal" BOOLEAN NOT NULL DEFAULT false,
  "appliedById" TEXT,
  "appliedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "quarantinedAt" TIMESTAMP(3),
  "statusReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiRecipeProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiRecipeAuditEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "proposalId" TEXT,
  "recipeId" TEXT,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "privacyMode" TEXT,
  "remote" BOOLEAN NOT NULL DEFAULT false,
  "statusBefore" TEXT,
  "statusAfter" TEXT,
  "reason" TEXT,
  "estimatedCost" DECIMAL(18,6),
  "actualCost" DECIMAL(18,6),
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRecipeAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiRecipeProposal_requestId_key" ON "AiRecipeProposal"("requestId");
CREATE INDEX "AiRecipeRequest_ownerId_status_createdAt_idx" ON "AiRecipeRequest"("ownerId", "status", "createdAt");
CREATE INDEX "AiRecipeRequest_recipeId_createdAt_idx" ON "AiRecipeRequest"("recipeId", "createdAt");
CREATE INDEX "AiRecipeRequest_providerConfigId_createdAt_idx" ON "AiRecipeRequest"("providerConfigId", "createdAt");
CREATE INDEX "AiRecipeProposal_recipeId_status_createdAt_idx" ON "AiRecipeProposal"("recipeId", "status", "createdAt");
CREATE INDEX "AiRecipeProposal_status_createdAt_idx" ON "AiRecipeProposal"("status", "createdAt");
CREATE INDEX "PlaylistRecipe_userId_aiRecipeStatus_updatedAt_idx" ON "PlaylistRecipe"("userId", "aiRecipeStatus", "updatedAt");
CREATE INDEX "PlaylistRecipe_lastAiProposalId_idx" ON "PlaylistRecipe"("lastAiProposalId");
CREATE INDEX "PlaylistRecipeRevision_aiRequestId_idx" ON "PlaylistRecipeRevision"("aiRequestId");
CREATE INDEX "PlaylistRecipeRevision_aiProposalId_idx" ON "PlaylistRecipeRevision"("aiProposalId");
CREATE INDEX "AiRecipeAuditEvent_requestId_createdAt_idx" ON "AiRecipeAuditEvent"("requestId", "createdAt");
CREATE INDEX "AiRecipeAuditEvent_proposalId_createdAt_idx" ON "AiRecipeAuditEvent"("proposalId", "createdAt");
CREATE INDEX "AiRecipeAuditEvent_recipeId_createdAt_idx" ON "AiRecipeAuditEvent"("recipeId", "createdAt");
CREATE INDEX "AiRecipeAuditEvent_actorId_createdAt_idx" ON "AiRecipeAuditEvent"("actorId", "createdAt");
CREATE INDEX "AiRecipeAuditEvent_eventType_createdAt_idx" ON "AiRecipeAuditEvent"("eventType", "createdAt");

ALTER TABLE "AiRecipeRequest" ADD CONSTRAINT "AiRecipeRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiRecipeRequest" ADD CONSTRAINT "AiRecipeRequest_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRecipeProposal" ADD CONSTRAINT "AiRecipeProposal_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AiRecipeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiRecipeProposal" ADD CONSTRAINT "AiRecipeProposal_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRecipeProposal" ADD CONSTRAINT "AiRecipeProposal_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRecipeProposal" ADD CONSTRAINT "AiRecipeProposal_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRecipeAuditEvent" ADD CONSTRAINT "AiRecipeAuditEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AiRecipeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiRecipeAuditEvent" ADD CONSTRAINT "AiRecipeAuditEvent_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AiRecipeProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRecipeAuditEvent" ADD CONSTRAINT "AiRecipeAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "AiFeatureSetting" ("featureKey", "enabled", "implemented", "requiredCapabilities", "safeConfigurationJson", "createdAt", "updatedAt")
VALUES ('recipe_copilot', false, true, '["chat_messages","structured_json"]'::jsonb, '{"advisoryOnly":true,"allowRemoteFallback":false}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("featureKey") DO UPDATE SET "implemented" = true, "requiredCapabilities" = EXCLUDED."requiredCapabilities";
