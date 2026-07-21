-- Mixarr v2.4.2 Ollama requests and user-policy hotfix.
-- Existing explicit false/true user values and all audit history are preserved.

ALTER TABLE "AiGovernanceSetting"
  ADD COLUMN IF NOT EXISTS "paidProvidersAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allowUserPaidProviderOverrides" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "AiUserLimit"
  ALTER COLUMN "paidProvidersAllowed" DROP NOT NULL,
  ALTER COLUMN "paidProvidersAllowed" DROP DEFAULT,
  ALTER COLUMN "backgroundRequestsAllowed" DROP NOT NULL,
  ALTER COLUMN "backgroundRequestsAllowed" DROP DEFAULT;

ALTER TABLE "AiRequestAudit"
  ADD COLUMN IF NOT EXISTS "providerModelClassification" TEXT;

CREATE INDEX IF NOT EXISTS "AiRequestAudit_providerModelClassification_createdAt_idx"
  ON "AiRequestAudit"("providerModelClassification", "createdAt");
