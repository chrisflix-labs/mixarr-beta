-- Mixarr v2.4.8 hotfix: retire provider configurations without deleting history.
-- Existing providers, credentials, reservations, attempts, usage, and audit rows
-- are unchanged when this additive migration is applied.

ALTER TABLE "AiProviderConfig"
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "AiBudgetReservation"
  ADD COLUMN "resolutionReason" TEXT;

CREATE INDEX "AiProviderConfig_deletedAt_idx" ON "AiProviderConfig"("deletedAt");
