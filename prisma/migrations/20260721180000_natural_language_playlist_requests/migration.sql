-- v2.4.2 keeps AI interpretations separate from canonical recipes and Plex state.
CREATE TABLE "NaturalLanguageRequest" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "originalRequest" TEXT,
  "originalRequestHash" TEXT NOT NULL,
  "originalRequestRetained" BOOLEAN NOT NULL DEFAULT true,
  "detectedLanguage" TEXT,
  "intent" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "providerConfigId" TEXT,
  "providerDisplayName" TEXT,
  "model" TEXT,
  "privacyMode" TEXT NOT NULL DEFAULT 'METADATA_LIMITED',
  "currentRevision" INTEGER NOT NULL DEFAULT 1,
  "interpretationJson" JSONB,
  "draftRecipeJson" JSONB,
  "validationJson" JSONB,
  "candidateEstimateJson" JSONB,
  "compatibilityJson" JSONB,
  "previewJson" JSONB,
  "analysisRevision" INTEGER,
  "previewRevision" INTEGER,
  "previewGeneratedAt" TIMESTAMP(3),
  "approvalRevision" INTEGER,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "finalRecipeId" TEXT,
  "executionId" TEXT,
  "executionIdempotencyKey" TEXT,
  "estimatedCost" DECIMAL(18,6),
  "actualCost" DECIMAL(18,6),
  "inputTokenCount" INTEGER,
  "outputTokenCount" INTEGER,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "expiresAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NaturalLanguageRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NaturalLanguageRequestRevision" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "revisionText" TEXT,
  "interpretationJson" JSONB NOT NULL,
  "draftRecipeJson" JSONB NOT NULL,
  "validationJson" JSONB NOT NULL,
  "candidateEstimateJson" JSONB,
  "compatibilityJson" JSONB,
  "previewJson" JSONB,
  "changeSummaryJson" JSONB,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NaturalLanguageRequestRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NaturalLanguageRequestAudit" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT,
  "revision" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "result" TEXT NOT NULL DEFAULT 'SUCCESS',
  "detailsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NaturalLanguageRequestAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NaturalLanguageRequest_executionIdempotencyKey_key" ON "NaturalLanguageRequest"("executionIdempotencyKey");
CREATE INDEX "NaturalLanguageRequest_ownerId_status_updatedAt_idx" ON "NaturalLanguageRequest"("ownerId", "status", "updatedAt");
CREATE INDEX "NaturalLanguageRequest_approvedById_approvedAt_idx" ON "NaturalLanguageRequest"("approvedById", "approvedAt");
CREATE INDEX "NaturalLanguageRequest_finalRecipeId_idx" ON "NaturalLanguageRequest"("finalRecipeId");
CREATE INDEX "NaturalLanguageRequest_expiresAt_idx" ON "NaturalLanguageRequest"("expiresAt");
CREATE UNIQUE INDEX "NaturalLanguageRequestRevision_requestId_revision_key" ON "NaturalLanguageRequestRevision"("requestId", "revision");
CREATE INDEX "NaturalLanguageRequestRevision_requestId_createdAt_idx" ON "NaturalLanguageRequestRevision"("requestId", "createdAt");
CREATE INDEX "NaturalLanguageRequestRevision_createdById_createdAt_idx" ON "NaturalLanguageRequestRevision"("createdById", "createdAt");
CREATE INDEX "NaturalLanguageRequestAudit_requestId_createdAt_idx" ON "NaturalLanguageRequestAudit"("requestId", "createdAt");
CREATE INDEX "NaturalLanguageRequestAudit_actorId_createdAt_idx" ON "NaturalLanguageRequestAudit"("actorId", "createdAt");
CREATE INDEX "NaturalLanguageRequestAudit_action_createdAt_idx" ON "NaturalLanguageRequestAudit"("action", "createdAt");

ALTER TABLE "NaturalLanguageRequest" ADD CONSTRAINT "NaturalLanguageRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NaturalLanguageRequest" ADD CONSTRAINT "NaturalLanguageRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NaturalLanguageRequest" ADD CONSTRAINT "NaturalLanguageRequest_finalRecipeId_fkey" FOREIGN KEY ("finalRecipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NaturalLanguageRequestRevision" ADD CONSTRAINT "NaturalLanguageRequestRevision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "NaturalLanguageRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NaturalLanguageRequestAudit" ADD CONSTRAINT "NaturalLanguageRequestAudit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "NaturalLanguageRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NaturalLanguageRequestAudit" ADD CONSTRAINT "NaturalLanguageRequestAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
