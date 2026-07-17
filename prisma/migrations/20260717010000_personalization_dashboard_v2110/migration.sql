ALTER TABLE "UserRecommendationProfile"
  ADD COLUMN "onboardingState" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "onboardingStep" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "onboardingConfigJson" JSONB;

CREATE TABLE "PersonalizationImportBackup" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT NOT NULL,
  "summaryJson" JSONB NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalizationImportBackup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonalizationAuditEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "summaryJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalizationAuditEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmartMixDecisionTrace_userId_decision_createdAt_idx" ON "SmartMixDecisionTrace"("userId", "decision", "createdAt");
CREATE INDEX "SmartMixDecisionTrace_userId_confidenceLabel_createdAt_idx" ON "SmartMixDecisionTrace"("userId", "confidenceLabel", "createdAt");
CREATE INDEX "PersonalizationImportBackup_userId_createdAt_idx" ON "PersonalizationImportBackup"("userId", "createdAt");
CREATE INDEX "PersonalizationImportBackup_expiresAt_idx" ON "PersonalizationImportBackup"("expiresAt");
CREATE INDEX "PersonalizationAuditEntry_userId_createdAt_idx" ON "PersonalizationAuditEntry"("userId", "createdAt");
CREATE INDEX "PersonalizationAuditEntry_action_createdAt_idx" ON "PersonalizationAuditEntry"("action", "createdAt");

ALTER TABLE "PersonalizationImportBackup" ADD CONSTRAINT "PersonalizationImportBackup_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalizationAuditEntry" ADD CONSTRAINT "PersonalizationAuditEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
