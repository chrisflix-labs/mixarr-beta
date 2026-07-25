-- Mixarr v2.4.14 — separate and disambiguate the per-request AI cost ceiling.
--
-- Before this release the onboarding wizard's "maximum estimated request cost"
-- was written into "maximumCumulativeRequestCost" (the retry ceiling), which
-- admission then read as the per-request ceiling. The wizard defaulted that
-- value to 0, and 0 was indistinguishable from "unset", so every priced external
-- request was rejected with AI_REQUEST_COST_LIMIT_EXCEEDED.
--
-- This migration gives the per-request ceiling its own column and both ceilings
-- an explicit mode. Idempotent and additive: no rows are deleted, no approval or
-- permission is granted, AI and external providers are not enabled, and no
-- privacy, budget, token, or request-count control is modified.

ALTER TABLE "AiGovernanceSetting" ADD COLUMN IF NOT EXISTS "perRequestCostLimitMode" TEXT NOT NULL DEFAULT 'UNLIMITED';
ALTER TABLE "AiGovernanceSetting" ADD COLUMN IF NOT EXISTS "maximumEstimatedRequestCost" DECIMAL(18,6);
ALTER TABLE "AiGovernanceSetting" ADD COLUMN IF NOT EXISTS "cumulativeRequestCostLimitMode" TEXT NOT NULL DEFAULT 'UNLIMITED';

-- Move the value admission was actually enforcing into the per-request column.
-- A positive amount is a deliberate ceiling and is preserved exactly.
UPDATE "AiGovernanceSetting"
   SET "maximumEstimatedRequestCost" = "maximumCumulativeRequestCost",
       "perRequestCostLimitMode" = 'LIMITED'
 WHERE "maximumEstimatedRequestCost" IS NULL
   AND "maximumCumulativeRequestCost" IS NOT NULL
   AND "maximumCumulativeRequestCost" > 0;

-- A zero ceiling on an installation that permits external or paid providers is
-- the wizard default, not a policy: it contradicts the administrator's own
-- provider configuration and blocks every priced request. Release it.
UPDATE "AiGovernanceSetting"
   SET "perRequestCostLimitMode" = 'UNLIMITED',
       "maximumEstimatedRequestCost" = NULL
 WHERE "maximumCumulativeRequestCost" IS NOT NULL
   AND "maximumCumulativeRequestCost" = 0
   AND "privacyMode" <> 'LOCAL_ONLY'
   AND "externalProvidersAllowed" = true;

-- On a genuinely local-only installation a zero ceiling is consistent with the
-- privacy and provider policy already in force, so keep it as an explicit
-- Limited 0.00 rather than silently removing a control.
UPDATE "AiGovernanceSetting"
   SET "perRequestCostLimitMode" = 'LIMITED',
       "maximumEstimatedRequestCost" = 0
 WHERE "maximumCumulativeRequestCost" IS NOT NULL
   AND "maximumCumulativeRequestCost" = 0
   AND ("privacyMode" = 'LOCAL_ONLY' OR "externalProvidersAllowed" = false);

-- The cumulative retry ceiling keeps its own value and gains its own mode under
-- the same rule, so a wizard-written zero cannot block every retry either.
UPDATE "AiGovernanceSetting"
   SET "cumulativeRequestCostLimitMode" = 'LIMITED'
 WHERE "maximumCumulativeRequestCost" IS NOT NULL
   AND ("maximumCumulativeRequestCost" > 0 OR "privacyMode" = 'LOCAL_ONLY' OR "externalProvidersAllowed" = false);

UPDATE "AiGovernanceSetting"
   SET "maximumCumulativeRequestCost" = NULL
 WHERE "cumulativeRequestCostLimitMode" = 'UNLIMITED';
