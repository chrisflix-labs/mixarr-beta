ALTER TABLE "Track"
ADD COLUMN "lastSyncChangeTypes" TEXT,
ADD COLUMN "duplicateWarning" TEXT,
ADD COLUMN "syncConflictReason" TEXT,
ADD COLUMN "localFileStatus" TEXT NOT NULL DEFAULT 'not_checked',
ADD COLUMN "localFileCheckedAt" TIMESTAMP(3);

CREATE INDEX "Track_libraryId_localFileStatus_idx" ON "Track"("libraryId", "localFileStatus");
