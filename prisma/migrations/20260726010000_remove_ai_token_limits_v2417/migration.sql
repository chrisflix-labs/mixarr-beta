-- Mixarr v2.4.17 no longer reads or writes application-configured token caps.
-- The columns remain in place for a safe rollback window. Existing values are
-- deliberately left intact but are inert in v2.4.17 and newer.
COMMENT ON COLUMN "AiGovernanceSetting"."maximumInputTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime; retained for rollback compatibility';
COMMENT ON COLUMN "AiGovernanceSetting"."maximumOutputTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime; retained for rollback compatibility';
COMMENT ON COLUMN "AiGovernanceSetting"."maximumCombinedTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime; retained for rollback compatibility';
COMMENT ON COLUMN "AiProviderConfig"."maximumOutputTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime; provider-native limits remain external';
COMMENT ON COLUMN "AiProviderConfig"."tokensPerMinute" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiProviderModel"."maximumInputTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiProviderModel"."maximumOutputTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiProviderModel"."maximumCombinedTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiProviderBudget"."maximumInputTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiProviderBudget"."maximumOutputTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiProviderBudget"."maximumCombinedTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiUserLimit"."maximumInputTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiUserLimit"."maximumOutputTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiUserLimit"."maximumCombinedTokens" IS 'DEPRECATED v2.4.17: ignored by Mixarr runtime';
COMMENT ON COLUMN "AiRequestAudit"."configuredOutputTokenLimit" IS 'Historical-only token-cap diagnostic; no longer written after v2.4.17';
COMMENT ON COLUMN "AiRequestAudit"."requestedOutputTokenLimit" IS 'Historical-only token-cap diagnostic; no longer written after v2.4.17';
COMMENT ON COLUMN "AiRequestAudit"."effectiveOutputTokenLimit" IS 'Historical-only token-cap diagnostic; no longer written after v2.4.17';
COMMENT ON COLUMN "AiRequestAudit"."outputTokenLimitingSource" IS 'Historical-only token-cap diagnostic; no longer written after v2.4.17';
