-- Mixarr v2.0.10 beta feature access, overrides, diagnostics and playlist metadata.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Preserve access for existing single-user/self-hosted installations by making
-- the earliest account the initial administrator. Additional administrators can
-- be configured explicitly after migration.
UPDATE "User" SET "isAdmin" = true
WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "isAdmin" = true);

ALTER TABLE "GeneratedPlaylist" ADD COLUMN IF NOT EXISTS "scoringModel" TEXT NOT NULL DEFAULT 'stable-v2';
ALTER TABLE "GeneratedPlaylist" ADD COLUMN IF NOT EXISTS "scoringModelVersion" TEXT NOT NULL DEFAULT '2';
ALTER TABLE "GeneratedPlaylist" ADD COLUMN IF NOT EXISTS "betaMetadataJson" JSONB;
ALTER TABLE "PlaylistRevision" ADD COLUMN IF NOT EXISTS "betaMetadata" JSONB;
ALTER TABLE "RecentlyAddedAutomationRun" ADD COLUMN IF NOT EXISTS "requiredFeatureFlags" JSONB;
ALTER TABLE "RecentlyAddedAutomationRun" ADD COLUMN IF NOT EXISTS "requestedScoringModel" TEXT;
ALTER TABLE "RecentlyAddedAutomationRun" ADD COLUMN IF NOT EXISTS "requestedAccessLevel" TEXT;
ALTER TABLE "RecentlyAddedAutomationRun" ALTER COLUMN "engineVersion" SET DEFAULT 'v2.0.10';

CREATE TABLE IF NOT EXISTS "FeatureFlagOverride" (
  "featureKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "forceDisabled" BOOLEAN NOT NULL DEFAULT false,
  "userSelectable" BOOLEAN NOT NULL DEFAULT true,
  "minimumAccessLevel" TEXT,
  "adminOnly" BOOLEAN,
  "riskLevel" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlagOverride_pkey" PRIMARY KEY ("featureKey")
);

CREATE TABLE IF NOT EXISTS "UserBetaPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enableBetaFeatures" BOOLEAN NOT NULL DEFAULT false,
  "flagsJson" JSONB NOT NULL DEFAULT '{}',
  "warningAcceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBetaPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserBetaAccess" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessLevel" TEXT NOT NULL DEFAULT 'STABLE',
  "grantedAt" TIMESTAMP(3),
  "grantedBy" TEXT,
  "expiresAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBetaAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BetaFeatureUsage" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "featureKey" TEXT NOT NULL,
  "playlistId" TEXT,
  "action" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "engineVersion" TEXT,
  "scoringModel" TEXT,
  "errorCode" TEXT,
  "durationMs" INTEGER,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BetaFeatureUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BetaFeedbackReport" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "featureKey" TEXT,
  "playlistId" TEXT,
  "scoringModel" TEXT,
  "action" TEXT,
  "sanitizedReport" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BetaFeedbackReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserBetaPreference_userId_key" ON "UserBetaPreference"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserBetaAccess_userId_key" ON "UserBetaAccess"("userId");
CREATE INDEX IF NOT EXISTS "UserBetaAccess_accessLevel_expiresAt_idx" ON "UserBetaAccess"("accessLevel", "expiresAt");
CREATE INDEX IF NOT EXISTS "BetaFeatureUsage_featureKey_createdAt_idx" ON "BetaFeatureUsage"("featureKey", "createdAt");
CREATE INDEX IF NOT EXISTS "BetaFeatureUsage_userId_createdAt_idx" ON "BetaFeatureUsage"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "BetaFeatureUsage_playlistId_createdAt_idx" ON "BetaFeatureUsage"("playlistId", "createdAt");
CREATE INDEX IF NOT EXISTS "BetaFeedbackReport_userId_createdAt_idx" ON "BetaFeedbackReport"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "BetaFeedbackReport_featureKey_createdAt_idx" ON "BetaFeedbackReport"("featureKey", "createdAt");

DO $$ BEGIN ALTER TABLE "UserBetaPreference" ADD CONSTRAINT "UserBetaPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "UserBetaAccess" ADD CONSTRAINT "UserBetaAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "BetaFeatureUsage" ADD CONSTRAINT "BetaFeatureUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "BetaFeedbackReport" ADD CONSTRAINT "BetaFeedbackReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
