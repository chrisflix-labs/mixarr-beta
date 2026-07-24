-- Recipe Copilot per-request cost-limit semantics.
--
-- Legacy maximumCumulativeRequestCost was used for both first-attempt admission
-- and retries without an explicit enabled state. Positive values are preserved
-- as enabled limits. NULL and zero values become disabled/unlimited. The block
-- is guarded so re-running this SQL does not overwrite settings saved after the
-- migration.
DO $$
DECLARE
  global_enabled_column_existed BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AiGovernanceSetting'
      AND column_name = 'perRequestCostLimitEnabled'
  ) INTO global_enabled_column_existed;

  ALTER TABLE "AiGovernanceSetting"
    ADD COLUMN IF NOT EXISTS "perRequestCostLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "perRequestCostLimitUsd" DECIMAL(18,6);

  ALTER TABLE "AiProviderBudget"
    ADD COLUMN IF NOT EXISTS "perRequestCostLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "perRequestCostLimitUsd" DECIMAL(18,6);

  ALTER TABLE "AiUserLimit"
    ADD COLUMN IF NOT EXISTS "perRequestCostLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "perRequestCostLimitUsd" DECIMAL(18,6);

  IF NOT global_enabled_column_existed THEN
    UPDATE "AiGovernanceSetting"
    SET
      "perRequestCostLimitEnabled" = COALESCE("maximumCumulativeRequestCost" > 0, false),
      "perRequestCostLimitUsd" = CASE
        WHEN "maximumCumulativeRequestCost" > 0 THEN "maximumCumulativeRequestCost"
        ELSE NULL
      END,
      "maximumCumulativeRequestCost" = CASE
        WHEN "maximumCumulativeRequestCost" > 0 THEN "maximumCumulativeRequestCost"
        ELSE NULL
      END;
  END IF;
END $$;

COMMENT ON COLUMN "AiGovernanceSetting"."perRequestCostLimitEnabled"
  IS 'Only true enables global per-request cost enforcement.';
COMMENT ON COLUMN "AiGovernanceSetting"."perRequestCostLimitUsd"
  IS 'Positive USD amount used only when perRequestCostLimitEnabled is true.';
COMMENT ON COLUMN "AiProviderBudget"."perRequestCostLimitEnabled"
  IS 'Only true enables this provider-specific per-request cost limit.';
COMMENT ON COLUMN "AiUserLimit"."perRequestCostLimitEnabled"
  IS 'Only true enables this user-specific per-request cost limit.';
