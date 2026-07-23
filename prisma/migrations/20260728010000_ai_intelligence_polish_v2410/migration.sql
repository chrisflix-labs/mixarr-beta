-- Mixarr v2.4.10: resumable AI onboarding, saved requests, and private quality feedback.
-- All records are inert by default. This migration does not enable AI, providers,
-- paid fallback, external metadata sharing, or metadata writes.

CREATE TABLE "AiOnboardingProgress" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "currentStep" INTEGER NOT NULL DEFAULT 1,
  "completedStepsJson" JSONB NOT NULL DEFAULT '[]',
  "configurationJson" JSONB NOT NULL DEFAULT '{}',
  "privacyAcceptedAt" TIMESTAMP(3),
  "privacyPolicyVersion" TEXT,
  "externalCostAcceptedAt" TIMESTAMP(3),
  "testRequestId" TEXT,
  "reviewedRecipeRequestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiOnboardingProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiOnboardingProgress_userId_key" ON "AiOnboardingProgress"("userId");
CREATE INDEX "AiOnboardingProgress_status_updatedAt_idx" ON "AiOnboardingProgress"("status", "updatedAt");
ALTER TABLE "AiOnboardingProgress" ADD CONSTRAINT "AiOnboardingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiRequestTemplate" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "householdId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "requestText" TEXT NOT NULL,
  "variablesJson" JSONB NOT NULL DEFAULT '[]',
  "defaultFeature" TEXT NOT NULL DEFAULT 'natural_language_playlist_requests',
  "defaultProviderId" TEXT,
  "defaultModel" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiRequestTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiRequestTemplate_ownerId_updatedAt_idx" ON "AiRequestTemplate"("ownerId", "updatedAt");
CREATE INDEX "AiRequestTemplate_householdId_visibility_updatedAt_idx" ON "AiRequestTemplate"("householdId", "visibility", "updatedAt");
CREATE INDEX "AiRequestTemplate_visibility_updatedAt_idx" ON "AiRequestTemplate"("visibility", "updatedAt");
ALTER TABLE "AiRequestTemplate" ADD CONSTRAINT "AiRequestTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiQualityFeedback" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "resultId" TEXT,
  "featureKey" TEXT NOT NULL,
  "providerConfigId" TEXT,
  "providerName" TEXT,
  "model" TEXT,
  "recipeVersion" INTEGER,
  "rating" TEXT NOT NULL,
  "reason" TEXT,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiQualityFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiQualityFeedback_authorId_requestId_resultId_key" ON "AiQualityFeedback"("authorId", "requestId", "resultId");
CREATE INDEX "AiQualityFeedback_requestId_createdAt_idx" ON "AiQualityFeedback"("requestId", "createdAt");
CREATE INDEX "AiQualityFeedback_providerConfigId_model_createdAt_idx" ON "AiQualityFeedback"("providerConfigId", "model", "createdAt");
CREATE INDEX "AiQualityFeedback_featureKey_rating_createdAt_idx" ON "AiQualityFeedback"("featureKey", "rating", "createdAt");
ALTER TABLE "AiQualityFeedback" ADD CONSTRAINT "AiQualityFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
