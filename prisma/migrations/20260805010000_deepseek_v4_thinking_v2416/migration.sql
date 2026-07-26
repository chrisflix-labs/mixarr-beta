-- Mixarr v2.4.16: sanitized DeepSeek thinking/truncation diagnostics.
-- No prompt, final response body, or reasoning_content text is persisted.
ALTER TABLE "AiRequestAudit"
  ADD COLUMN IF NOT EXISTS "requestedOutputTokenLimit" INTEGER,
  ADD COLUMN IF NOT EXISTS "effectiveOutputTokenLimit" INTEGER,
  ADD COLUMN IF NOT EXISTS "outputTokenLimitingSource" TEXT,
  ADD COLUMN IF NOT EXISTS "thinkingModeRequested" TEXT,
  ADD COLUMN IF NOT EXISTS "reasoningContentDetected" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "reasoningCharacterCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "finalContentCharacterCount" INTEGER;
