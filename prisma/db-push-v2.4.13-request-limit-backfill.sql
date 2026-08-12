-- Idempotent v2.4.13 data backfill for Docker installations managed with
-- `prisma db push`. The Prisma migration
-- `20260801010000_ai_daily_request_limit_configuration_v2413` performs the same
-- work, but that migration is never executed on the `db push` upgrade path, so
-- only its column additions reached container installations.
--
-- `db push` adds "dailyRequestLimitMode" to "AiGovernanceSetting" with its
-- column default 'UNLIMITED' and leaves every existing row there. A global daily
-- AI request limit configured before v2.4.13 therefore resolved to
-- effectiveMode = UNLIMITED and stopped being enforced: the administrator's
-- throttle silently disappeared while still being displayed as a stored number.
-- ("AiProviderBudget" and "AiUserLimit" default to 'INHERIT', which
-- `resolveRequestLimitScope` still enforces, so those scopes were unaffected;
-- they are included below only so all three scopes stay consistent.)
--
-- Safety: a row can only reach mode = 'UNLIMITED' with a positive stored limit by
-- missing this backfill. `validateRequestLimitConfiguration` clears the stored
-- number whenever an administrator explicitly chooses Unlimited ("Unlimited
-- clears any stored number so a later mode change cannot resurrect it"), so this
-- statement cannot override a deliberate Unlimited choice. Re-running it is a
-- no-op. No rows are deleted and no limit is invented where none was stored.

UPDATE "AiGovernanceSetting" SET "dailyRequestLimitMode" = 'LIMITED'
  WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" > 0 AND "dailyRequestLimitMode" = 'UNLIMITED';
UPDATE "AiProviderBudget" SET "dailyRequestLimitMode" = 'LIMITED'
  WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" > 0 AND "dailyRequestLimitMode" IN ('INHERIT', 'UNLIMITED');
UPDATE "AiUserLimit" SET "dailyRequestLimitMode" = 'LIMITED'
  WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" > 0 AND "dailyRequestLimitMode" IN ('INHERIT', 'UNLIMITED');

-- A stored zero previously blocked every AI request with no interface control
-- able to clear it. `normalizeRequestLimitValue` already discards it at read
-- time; these statements make the stored data agree with that reading.
UPDATE "AiGovernanceSetting" SET "dailyRequestLimitMode" = 'UNLIMITED', "dailyRequestLimit" = NULL WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" <= 0;
UPDATE "AiProviderBudget" SET "dailyRequestLimitMode" = 'UNLIMITED', "dailyRequestLimit" = NULL WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" <= 0;
UPDATE "AiUserLimit" SET "dailyRequestLimitMode" = 'UNLIMITED', "dailyRequestLimit" = NULL WHERE "dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" <= 0;

UPDATE "AiGovernanceSetting" SET "monthlyRequestLimit" = NULL WHERE "monthlyRequestLimit" IS NOT NULL AND "monthlyRequestLimit" <= 0;
UPDATE "AiProviderBudget" SET "monthlyRequestLimit" = NULL WHERE "monthlyRequestLimit" IS NOT NULL AND "monthlyRequestLimit" <= 0;
UPDATE "AiUserLimit" SET "monthlyRequestLimit" = NULL WHERE "monthlyRequestLimit" IS NOT NULL AND "monthlyRequestLimit" <= 0;
