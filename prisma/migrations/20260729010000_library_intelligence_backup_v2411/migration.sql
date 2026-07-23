-- Mixarr v2.4.11: Library Intelligence Backup & Restore.
--
-- This migration adds job-state, summary, provenance, and staging tables plus a
-- small set of nullable "restored from backup" provenance columns on existing
-- intelligence tables. It never enables AI, providers, external metadata sharing,
-- or analysis work, and it does not modify or read any existing intelligence data.
-- Every statement is idempotent (IF NOT EXISTS) so an interrupted migration can be
-- safely re-applied.

-- Provenance columns (existing intelligence tables). Original source/timestamp
-- columns are preserved; these only record that a value was restored from an archive.
ALTER TABLE "AudioFeature" ADD COLUMN IF NOT EXISTS "restoredFromBackupId" TEXT;
ALTER TABLE "AudioFeature" ADD COLUMN IF NOT EXISTS "restoredAt" TIMESTAMP(3);

ALTER TABLE "Popularity" ADD COLUMN IF NOT EXISTS "restoredFromBackupId" TEXT;
ALTER TABLE "Popularity" ADD COLUMN IF NOT EXISTS "restoredAt" TIMESTAMP(3);

ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "bpmRestoredFromBackupId" TEXT;
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "bpmRestoredAt" TIMESTAMP(3);
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "genreRestoredFromBackupId" TEXT;
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "genreRestoredAt" TIMESTAMP(3);

-- Backup archive metadata (the archive file itself lives on disk / is downloaded).
CREATE TABLE IF NOT EXISTS "LibraryBackupArchive" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "storedPath" TEXT,
  "schemaVersion" INTEGER NOT NULL,
  "mixarrVersion" TEXT NOT NULL,
  "backupType" TEXT NOT NULL DEFAULT 'mixarr-library-intelligence',
  "fileSizeBytes" BIGINT NOT NULL DEFAULT 0,
  "archiveSha256" TEXT,
  "trackCount" INTEGER NOT NULL DEFAULT 0,
  "audioFeatureCount" INTEGER NOT NULL DEFAULT 0,
  "bpmCount" INTEGER NOT NULL DEFAULT 0,
  "popularityCount" INTEGER NOT NULL DEFAULT 0,
  "genreCount" INTEGER NOT NULL DEFAULT 0,
  "noDataCount" INTEGER NOT NULL DEFAULT 0,
  "countsJson" JSONB,
  "manifestJson" JSONB,
  "notes" TEXT,
  "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
  "verifiedAt" TIMESTAMP(3),
  "lastRestoredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryBackupArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LibraryBackupArchive_userId_createdAt_idx" ON "LibraryBackupArchive"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "LibraryBackupArchive_verificationStatus_idx" ON "LibraryBackupArchive"("verificationStatus");

-- Backup job state.
CREATE TABLE IF NOT EXISTS "LibraryBackupJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "archiveId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'preparing',
  "phase" TEXT NOT NULL DEFAULT 'preparing',
  "libraryId" TEXT,
  "notes" TEXT,
  "trackCount" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "totalEstimate" INTEGER NOT NULL DEFAULT 0,
  "countsJson" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryBackupJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LibraryBackupJob_userId_startedAt_idx" ON "LibraryBackupJob"("userId", "startedAt");
CREATE INDEX IF NOT EXISTS "LibraryBackupJob_status_idx" ON "LibraryBackupJob"("status");

-- Restore job state.
CREATE TABLE IF NOT EXISTS "LibraryRestoreJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "archiveFileName" TEXT NOT NULL,
  "uploadedPath" TEXT,
  "backupSchemaVersion" INTEGER,
  "backupMixarrVersion" TEXT,
  "status" TEXT NOT NULL DEFAULT 'uploaded',
  "phase" TEXT NOT NULL DEFAULT 'uploaded',
  "conflictPolicy" TEXT NOT NULL DEFAULT 'fill_missing',
  "categoryPolicyJson" JSONB,
  "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  "workerId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "compatibility" TEXT,
  "previewJson" JSONB,
  "reportJson" JSONB,
  "error" TEXT,
  "archiveTrackCount" INTEGER NOT NULL DEFAULT 0,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
  "ambiguousCount" INTEGER NOT NULL DEFAULT 0,
  "appliedCount" INTEGER NOT NULL DEFAULT 0,
  "lastBatchIndex" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryRestoreJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LibraryRestoreJob_userId_startedAt_idx" ON "LibraryRestoreJob"("userId", "startedAt");
CREATE INDEX IF NOT EXISTS "LibraryRestoreJob_status_idx" ON "LibraryRestoreJob"("status");

-- Staged restore records (used when a backup is uploaded before a Plex library sync,
-- and as the durable idempotent ledger during apply).
CREATE TABLE IF NOT EXISTS "LibraryRestoreStagedRecord" (
  "id" TEXT NOT NULL,
  "restoreJobId" TEXT NOT NULL,
  "recordIndex" INTEGER NOT NULL,
  "backupTrackId" TEXT,
  "fingerprint" TEXT,
  "pathHash" TEXT,
  "plexGuid" TEXT,
  "ratingKey" TEXT,
  "recordJson" JSONB NOT NULL,
  "matchStatus" TEXT NOT NULL DEFAULT 'pending',
  "matchType" TEXT,
  "matchedTrackId" TEXT,
  "appliedBatch" INTEGER,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryRestoreStagedRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LibraryRestoreStagedRecord_restoreJobId_matchStatus_idx" ON "LibraryRestoreStagedRecord"("restoreJobId", "matchStatus");
CREATE INDEX IF NOT EXISTS "LibraryRestoreStagedRecord_restoreJobId_fingerprint_idx" ON "LibraryRestoreStagedRecord"("restoreJobId", "fingerprint");

-- Persisted per-track match provenance so users can inspect how each track matched.
CREATE TABLE IF NOT EXISTS "LibraryRestoreMatch" (
  "id" TEXT NOT NULL,
  "restoreJobId" TEXT NOT NULL,
  "backupTrackId" TEXT,
  "matchedTrackId" TEXT,
  "matchType" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "candidatesJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryRestoreMatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LibraryRestoreMatch_restoreJobId_matchType_idx" ON "LibraryRestoreMatch"("restoreJobId", "matchType");

-- Foreign keys (guarded so re-application does not error).
DO $$ BEGIN
  ALTER TABLE "LibraryRestoreStagedRecord" ADD CONSTRAINT "LibraryRestoreStagedRecord_restoreJobId_fkey" FOREIGN KEY ("restoreJobId") REFERENCES "LibraryRestoreJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LibraryRestoreMatch" ADD CONSTRAINT "LibraryRestoreMatch_restoreJobId_fkey" FOREIGN KEY ("restoreJobId") REFERENCES "LibraryRestoreJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
