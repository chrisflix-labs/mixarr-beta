-- Mixarr v2.4.22: nullable phase timeouts and provider-specific overrides.
-- Positive legacy values are preserved. A legacy zero was never a documented
-- unlimited representation, so ambiguous/invalid zero values are restored to
-- the previous defaults and surfaced as database migration warnings.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AiGovernanceSetting" WHERE "connectionTimeoutMs" <= 0) THEN
    RAISE WARNING 'Mixarr v2.4.22 migration: invalid connectionTimeoutMs migrated to the previous 10000 ms default.';
    UPDATE "AiGovernanceSetting" SET "connectionTimeoutMs" = 10000 WHERE "connectionTimeoutMs" <= 0;
  END IF;
  IF EXISTS (SELECT 1 FROM "AiGovernanceSetting" WHERE "firstTokenTimeoutMs" <= 0) THEN
    RAISE WARNING 'Mixarr v2.4.22 migration: invalid firstTokenTimeoutMs migrated to the previous 30000 ms default.';
    UPDATE "AiGovernanceSetting" SET "firstTokenTimeoutMs" = 30000 WHERE "firstTokenTimeoutMs" <= 0;
  END IF;
  IF EXISTS (SELECT 1 FROM "AiGovernanceSetting" WHERE "totalRequestTimeoutMs" <= 0) THEN
    RAISE WARNING 'Mixarr v2.4.22 migration: invalid totalRequestTimeoutMs migrated to the previous 120000 ms default.';
    UPDATE "AiGovernanceSetting" SET "totalRequestTimeoutMs" = 120000 WHERE "totalRequestTimeoutMs" <= 0;
  END IF;
  IF EXISTS (SELECT 1 FROM "AiGovernanceSetting" WHERE "streamingIdleTimeoutMs" <= 0) THEN
    RAISE WARNING 'Mixarr v2.4.22 migration: invalid streamingIdleTimeoutMs migrated to the previous 30000 ms default.';
    UPDATE "AiGovernanceSetting" SET "streamingIdleTimeoutMs" = 30000 WHERE "streamingIdleTimeoutMs" <= 0;
  END IF;
END $$;

ALTER TABLE "AiGovernanceSetting"
  ALTER COLUMN "connectionTimeoutMs" DROP NOT NULL,
  ALTER COLUMN "firstTokenTimeoutMs" DROP NOT NULL,
  ALTER COLUMN "totalRequestTimeoutMs" DROP NOT NULL,
  ALTER COLUMN "streamingIdleTimeoutMs" DROP NOT NULL;

ALTER TABLE "AiProviderConfig"
  ADD COLUMN "timeoutOverrideEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "connectionTimeoutMs" INTEGER DEFAULT 10000,
  ADD COLUMN "firstTokenTimeoutMs" INTEGER DEFAULT 30000,
  ADD COLUMN "totalRequestTimeoutMs" INTEGER DEFAULT 120000,
  ADD COLUMN "streamingIdleTimeoutMs" INTEGER DEFAULT 30000,
  ADD COLUMN "cancellationGraceMs" INTEGER NOT NULL DEFAULT 2000;

ALTER TABLE "AiRequestAudit"
  ADD COLUMN "effectiveTimeoutPolicyJson" JSONB;
