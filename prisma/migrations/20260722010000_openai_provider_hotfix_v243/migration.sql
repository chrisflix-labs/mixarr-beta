-- Mixarr v2.4.3 native OpenAI Responses API compatibility and diagnostics.
-- This migration is additive and preserves existing health and audit history.
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "authenticationState" TEXT NOT NULL DEFAULT 'NOT_TESTED';
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "discoveryState" TEXT NOT NULL DEFAULT 'NOT_TESTED';
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "inferenceState" TEXT NOT NULL DEFAULT 'NOT_TESTED';
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "lastAuthenticationAt" TIMESTAMP(3);
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "lastDiscoveryAt" TIMESTAMP(3);
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "lastSuccessfulInferenceAt" TIMESTAMP(3);
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "lastFailedRequestAt" TIMESTAMP(3);
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "endpointMode" TEXT;
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "lastHttpStatus" INTEGER;
ALTER TABLE "AiProviderHealth" ADD COLUMN IF NOT EXISTS "providerRequestId" TEXT;

ALTER TABLE "AiRequestAudit" ADD COLUMN IF NOT EXISTS "modelReturned" TEXT;
ALTER TABLE "AiRequestAudit" ADD COLUMN IF NOT EXISTS "endpointMode" TEXT;
ALTER TABLE "AiRequestAudit" ADD COLUMN IF NOT EXISTS "testStage" TEXT;
ALTER TABLE "AiRequestAudit" ADD COLUMN IF NOT EXISTS "governanceResult" TEXT;
ALTER TABLE "AiRequestAudit" ADD COLUMN IF NOT EXISTS "modelCompatibilityResult" TEXT;
ALTER TABLE "AiRequestAudit" ADD COLUMN IF NOT EXISTS "httpStatus" INTEGER;
ALTER TABLE "AiRequestAudit" ADD COLUMN IF NOT EXISTS "providerErrorCode" TEXT;
ALTER TABLE "AiRequestAudit" ADD COLUMN IF NOT EXISTS "costState" TEXT;
