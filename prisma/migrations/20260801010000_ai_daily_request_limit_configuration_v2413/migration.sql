-- Mixarr v2.4.13 — explicit daily AI request-limit modes.
--
-- Adds a tri-state mode beside every daily request-count limit so "unlimited" is
-- selectable and a missing, blank, or zero limit can never be interpreted as
-- "zero requests allowed". Idempotent and additive: no rows are deleted, no
-- provider/feature approval is granted, AI is not enabled, and cost, budget,
-- token, and privacy controls are untouched.

ALTER TABLE "AiGovernanceSetting" ADD COLUMN IF NOT EXISTS "dailyRequestLimitMode" TEXT NOT NULL DEFAULT 'UNLIMITED';
ALTER TABLE "AiProviderBudget" ADD COLUMN IF NOT EXISTS "dailyRequestLimitMode" TEXT NOT NULL DEFAULT 'INHERIT';
ALTER TABLE "AiUserLimit" ADD COLUMN IF NOT EXISTS "dailyRequestLimitMode" TEXT NOT NULL DEFAULT 'INHERIT';

-- Preserve every intentional existing limit by marking it explicitly limited.
UPDATE "AiGovernanceSetting" SET "dailyRequestLimitMode" = 'LIMITED'
  WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" > 0 AND "dailyRequestLimitMode" = 'UNLIMITED';
UPDATE "AiProviderBudget" SET "dailyRequestLimitMode" = 'LIMITED'
  WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" > 0 AND "dailyRequestLimitMode" = 'INHERIT';
UPDATE "AiUserLimit" SET "dailyRequestLimitMode" = 'LIMITED'
  WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" > 0 AND "dailyRequestLimitMode" = 'INHERIT';

-- Clear ambiguous zero limits. A stored zero previously blocked every AI request
-- with no interface control able to change it; it now becomes explicit Unlimited.
UPDATE "AiGovernanceSetting" SET "dailyRequestLimitMode" = 'UNLIMITED', "dailyRequestLimit" = NULL WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" <= 0;
UPDATE "AiProviderBudget" SET "dailyRequestLimitMode" = 'UNLIMITED', "dailyRequestLimit" = NULL WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" <= 0;
UPDATE "AiUserLimit" SET "dailyRequestLimitMode" = 'UNLIMITED', "dailyRequestLimit" = NULL WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" <= 0;

-- The monthly request counter has no mode; a zero there was equally unrecoverable.
UPDATE "AiGovernanceSetting" SET "monthlyRequestLimit" = NULL WHERE "monthlyRequestLimit" IS NOT NULL AND "monthlyRequestLimit" <= 0;
UPDATE "AiProviderBudget" SET "monthlyRequestLimit" = NULL WHERE "monthlyRequestLimit" IS NOT NULL AND "monthlyRequestLimit" <= 0;
UPDATE "AiUserLimit" SET "monthlyRequestLimit" = NULL WHERE "monthlyRequestLimit" IS NOT NULL AND "monthlyRequestLimit" <= 0;
