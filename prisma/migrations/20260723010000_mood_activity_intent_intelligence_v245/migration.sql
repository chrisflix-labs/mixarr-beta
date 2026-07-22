-- Mixarr v2.4.5: additive, backward-compatible intent intelligence storage.
CREATE TABLE "IntentInterpretation" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "naturalLanguageId" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "sourceText" TEXT,
  "sourceTextHash" TEXT NOT NULL,
  "sourceRetained" BOOLEAN NOT NULL DEFAULT true,
  "summary" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  "interpretationSource" TEXT NOT NULL DEFAULT 'LOCAL_RULES',
  "structuredIntentJson" JSONB NOT NULL,
  "approvedIntentJson" JSONB,
  "adapterOutputJson" JSONB,
  "coverageEstimateJson" JSONB,
  "conflictResolutionJson" JSONB,
  "providerConfigId" TEXT,
  "overallConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "requiresReview" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "IntentInterpretation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntentDictionaryEntry" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "householdId" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "phrase" TEXT NOT NULL,
  "normalizedPhrase" TEXT NOT NULL,
  "aliasesJson" JSONB NOT NULL DEFAULT '[]',
  "description" TEXT,
  "definitionJson" JSONB NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntentDictionaryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntentPreset" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "householdId" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "intentJson" JSONB NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntentPreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntentInterpretationSetting" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "localEnabled" BOOLEAN NOT NULL DEFAULT true,
  "providerAssistanceEnabled" BOOLEAN NOT NULL DEFAULT false,
  "defaultProviderId" TEXT,
  "automaticSoftPreferenceMinimum" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  "inferredHardRequirementMinimum" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
  "maximumPhases" INTEGER NOT NULL DEFAULT 6,
  "defaultEnergyTolerance" DOUBLE PRECISION NOT NULL DEFAULT 0.12,
  "defaultBpmTolerance" DOUBLE PRECISION NOT NULL DEFAULT 10,
  "coverageEstimationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
  "personalDictionariesEnabled" BOOLEAN NOT NULL DEFAULT true,
  "householdDictionariesEnabled" BOOLEAN NOT NULL DEFAULT true,
  "presetsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "retainSourceText" BOOLEAN NOT NULL DEFAULT true,
  "retentionDays" INTEGER NOT NULL DEFAULT 90,
  "auditDetailLevel" TEXT NOT NULL DEFAULT 'SUMMARY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntentInterpretationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntentAuditEvent" (
  "id" TEXT NOT NULL,
  "interpretationId" TEXT,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "result" TEXT NOT NULL DEFAULT 'SUCCESS',
  "summaryJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntentAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntentInterpretation_naturalLanguageId_key" ON "IntentInterpretation"("naturalLanguageId");
CREATE INDEX "IntentInterpretation_ownerId_status_updatedAt_idx" ON "IntentInterpretation"("ownerId", "status", "updatedAt");
CREATE INDEX "IntentInterpretation_ownerId_deletedAt_updatedAt_idx" ON "IntentInterpretation"("ownerId", "deletedAt", "updatedAt");
CREATE INDEX "IntentInterpretation_approvedById_approvedAt_idx" ON "IntentInterpretation"("approvedById", "approvedAt");
CREATE INDEX "IntentInterpretation_interpretationSource_updatedAt_idx" ON "IntentInterpretation"("interpretationSource", "updatedAt");
CREATE UNIQUE INDEX "IntentDictionaryEntry_ownerId_normalizedPhrase_key" ON "IntentDictionaryEntry"("ownerId", "normalizedPhrase");
CREATE INDEX "IntentDictionaryEntry_ownerId_enabled_updatedAt_idx" ON "IntentDictionaryEntry"("ownerId", "enabled", "updatedAt");
CREATE INDEX "IntentDictionaryEntry_householdId_visibility_enabled_idx" ON "IntentDictionaryEntry"("householdId", "visibility", "enabled");
CREATE INDEX "IntentDictionaryEntry_normalizedPhrase_enabled_idx" ON "IntentDictionaryEntry"("normalizedPhrase", "enabled");
CREATE UNIQUE INDEX "IntentPreset_ownerId_name_key" ON "IntentPreset"("ownerId", "name");
CREATE INDEX "IntentPreset_ownerId_enabled_updatedAt_idx" ON "IntentPreset"("ownerId", "enabled", "updatedAt");
CREATE INDEX "IntentPreset_householdId_visibility_enabled_idx" ON "IntentPreset"("householdId", "visibility", "enabled");
CREATE UNIQUE INDEX "IntentInterpretationSetting_userId_key" ON "IntentInterpretationSetting"("userId");
CREATE INDEX "IntentAuditEvent_interpretationId_createdAt_idx" ON "IntentAuditEvent"("interpretationId", "createdAt");
CREATE INDEX "IntentAuditEvent_actorId_createdAt_idx" ON "IntentAuditEvent"("actorId", "createdAt");
CREATE INDEX "IntentAuditEvent_action_createdAt_idx" ON "IntentAuditEvent"("action", "createdAt");

ALTER TABLE "IntentInterpretation" ADD CONSTRAINT "IntentInterpretation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntentInterpretation" ADD CONSTRAINT "IntentInterpretation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IntentInterpretation" ADD CONSTRAINT "IntentInterpretation_naturalLanguageId_fkey" FOREIGN KEY ("naturalLanguageId") REFERENCES "NaturalLanguageRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IntentDictionaryEntry" ADD CONSTRAINT "IntentDictionaryEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntentDictionaryEntry" ADD CONSTRAINT "IntentDictionaryEntry_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntentPreset" ADD CONSTRAINT "IntentPreset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntentPreset" ADD CONSTRAINT "IntentPreset_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntentInterpretationSetting" ADD CONSTRAINT "IntentInterpretationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntentAuditEvent" ADD CONSTRAINT "IntentAuditEvent_interpretationId_fkey" FOREIGN KEY ("interpretationId") REFERENCES "IntentInterpretation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntentAuditEvent" ADD CONSTRAINT "IntentAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
