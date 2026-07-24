-- Retry monetary limits are optional. Upgraded installations with no configured
-- value must retain NULL (unlimited retry-cost setting), never an accidental
-- zero-dollar allowance. Explicit zero values remain unchanged.
ALTER TABLE "AiGovernanceSetting"
  ALTER COLUMN "maximumRetryCost" DROP DEFAULT,
  ALTER COLUMN "maximumCumulativeRequestCost" DROP DEFAULT;

COMMENT ON COLUMN "AiGovernanceSetting"."maximumRetryCost"
  IS 'NULL means no separate monetary retry ceiling; zero permits only zero-cost retries.';
COMMENT ON COLUMN "AiGovernanceSetting"."maximumCumulativeRequestCost"
  IS 'NULL means no per-logical-request monetary ceiling; explicit zero is a zero allowance.';
