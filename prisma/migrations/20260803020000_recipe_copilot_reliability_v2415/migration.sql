-- v2.4.15 Recipe Copilot reliability: replace legacy 30-second defaults while
-- preserving administrator-selected values that differ from the old default.
ALTER TABLE "AiGlobalSetting" ALTER COLUMN "defaultTimeoutMs" SET DEFAULT 120000;
ALTER TABLE "AiProviderConfig" ALTER COLUMN "requestTimeoutMs" SET DEFAULT 120000;
ALTER TABLE "AiProviderConfig" ALTER COLUMN "retryCount" SET DEFAULT 1;
ALTER TABLE "AiGovernanceSetting" ALTER COLUMN "jsonProviderRepairAttempts" SET DEFAULT 1;

UPDATE "AiGlobalSetting" SET "defaultTimeoutMs" = 120000 WHERE "defaultTimeoutMs" = 30000;
UPDATE "AiProviderConfig" SET "requestTimeoutMs" = 120000 WHERE "requestTimeoutMs" = 30000;
UPDATE "AiGlobalSetting" SET "defaultTimeoutMs" = 30000 WHERE "defaultTimeoutMs" < 30000;
UPDATE "AiGlobalSetting" SET "defaultTimeoutMs" = 600000 WHERE "defaultTimeoutMs" > 600000;
UPDATE "AiProviderConfig" SET "requestTimeoutMs" = 30000 WHERE "requestTimeoutMs" < 30000;
UPDATE "AiProviderConfig" SET "requestTimeoutMs" = 600000 WHERE "requestTimeoutMs" > 600000;
UPDATE "AiGovernanceSetting" SET "totalRequestTimeoutMs" = 30000 WHERE "totalRequestTimeoutMs" < 30000;
UPDATE "AiGovernanceSetting" SET "totalRequestTimeoutMs" = 600000 WHERE "totalRequestTimeoutMs" > 600000;
UPDATE "AiProviderConfig" SET "retryCount" = 1 WHERE "retryCount" > 1;
UPDATE "AiGovernanceSetting" SET "maximumRetryAttempts" = 1 WHERE "maximumRetryAttempts" > 1;
UPDATE "AiGovernanceSetting" SET "jsonProviderRepairAttempts" = 1 WHERE "jsonProviderRepairAttempts" = 0;
