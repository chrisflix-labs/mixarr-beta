-- Record output-budget and truncation recovery metadata without retaining model content.
ALTER TABLE "AiRequestAudit"
  ADD COLUMN IF NOT EXISTS "finishReason" TEXT,
  ADD COLUMN IF NOT EXISTS "configuredOutputTokenLimit" INTEGER,
  ADD COLUMN IF NOT EXISTS "finalContentStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "truncationRecoveryAttempted" BOOLEAN NOT NULL DEFAULT false;

-- New installations get enough global headroom for the 5,500-token Recipe
-- Copilot reasoning policy. Existing administrator values remain unchanged.
ALTER TABLE "AiGovernanceSetting" ALTER COLUMN "maximumOutputTokens" SET DEFAULT 7000;
