-- Mixarr v2.2.0 Playlist Orchestration Foundation.
-- Additive and opt-in: no existing playlist is registered and global orchestration defaults disabled.
CREATE TYPE "PlaylistPriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');
CREATE TYPE "PlaylistAutomationState" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED', 'WAITING', 'RUNNING', 'BLOCKED', 'ERROR');
CREATE TYPE "PlaylistOrchestrationMode" AS ENUM ('COORDINATED', 'OBSERVE_ONLY', 'DRY_RUN_ONLY');
CREATE TYPE "ManagedPlaylistRelationshipType" AS ENUM ('DEPENDS_ON', 'RUNS_AFTER', 'RELATED');
CREATE TYPE "PlaylistOrchestrationJobType" AS ENUM ('GENERATE', 'REGENERATE', 'SYNC', 'ANALYZE', 'PREVIEW', 'DRY_RUN');
CREATE TYPE "PlaylistOrchestrationJobStatus" AS ENUM ('QUEUED', 'WAITING', 'BLOCKED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED', 'STALE');
CREATE TYPE "PlaylistOrchestrationTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'RECENTLY_ADDED', 'DEPENDENCY', 'SYSTEM', 'RETRY');

CREATE TABLE "ManagedPlaylist" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "libraryId" TEXT NOT NULL, "playlistId" TEXT NOT NULL,
  "generatedPlaylistId" TEXT, "playlistIdentityId" TEXT, "displayName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "priority" "PlaylistPriority" NOT NULL DEFAULT 'NORMAL', "automationState" "PlaylistAutomationState" NOT NULL DEFAULT 'DISABLED',
  "automationStateReason" TEXT, "orchestrationMode" "PlaylistOrchestrationMode" NOT NULL DEFAULT 'COORDINATED',
  "plexAvailable" BOOLEAN NOT NULL DEFAULT true, "lastAvailabilityCheck" TIMESTAMP(3), "lastQueuedAt" TIMESTAMP(3),
  "lastStartedAt" TIMESTAMP(3), "lastCompletedAt" TIMESTAMP(3), "lastFailedAt" TIMESTAMP(3),
  "lastSuccessfulJobId" TEXT, "currentJobId" TEXT, "unregisteredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagedPlaylist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedPlaylistRelationship" (
  "id" TEXT NOT NULL, "sourceManagedPlaylistId" TEXT NOT NULL, "targetManagedPlaylistId" TEXT NOT NULL,
  "relationshipType" "ManagedPlaylistRelationshipType" NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0, "metadataJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ManagedPlaylistRelationship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistOrchestrationJob" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "managedPlaylistId" TEXT, "libraryId" TEXT,
  "parentJobId" TEXT, "rootJobId" TEXT, "jobType" "PlaylistOrchestrationJobType" NOT NULL,
  "status" "PlaylistOrchestrationJobStatus" NOT NULL DEFAULT 'QUEUED', "playlistPriority" "PlaylistPriority" NOT NULL DEFAULT 'NORMAL',
  "priority" INTEGER NOT NULL DEFAULT 0, "trigger" "PlaylistOrchestrationTrigger" NOT NULL, "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "idempotencyKey" TEXT NOT NULL, "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 1, "lockedBy" TEXT, "lockedAt" TIMESTAMP(3), "heartbeatAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3), "dependencySnapshotJson" JSONB, "requestPayloadJson" JSONB, "resultSummaryJson" JSONB,
  "operationPhase" TEXT NOT NULL DEFAULT 'PLANNING', "waitingReason" TEXT, "errorCode" TEXT, "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistOrchestrationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistOrchestrationLock" (
  "id" TEXT NOT NULL, "conflictKey" TEXT NOT NULL, "jobId" TEXT NOT NULL, "managedPlaylistId" TEXT, "libraryId" TEXT,
  "ownerId" TEXT NOT NULL, "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL, "releasedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PlaylistOrchestrationLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistOrchestrationAuditEvent" (
  "id" TEXT NOT NULL, "userId" TEXT, "managedPlaylistId" TEXT, "jobId" TEXT, "eventType" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'INFO', "actorType" TEXT NOT NULL DEFAULT 'SYSTEM', "actorId" TEXT,
  "message" TEXT NOT NULL, "metadataJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistOrchestrationAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagedPlaylist_generatedPlaylistId_key" ON "ManagedPlaylist"("generatedPlaylistId");
CREATE UNIQUE INDEX "ManagedPlaylist_playlistIdentityId_key" ON "ManagedPlaylist"("playlistIdentityId");
CREATE UNIQUE INDEX "ManagedPlaylist_userId_playlistId_key" ON "ManagedPlaylist"("userId", "playlistId");
CREATE INDEX "ManagedPlaylist_userId_enabled_automationEnabled_idx" ON "ManagedPlaylist"("userId", "enabled", "automationEnabled");
CREATE INDEX "ManagedPlaylist_libraryId_automationState_idx" ON "ManagedPlaylist"("libraryId", "automationState");
CREATE INDEX "ManagedPlaylist_priority_lastQueuedAt_idx" ON "ManagedPlaylist"("priority", "lastQueuedAt");
CREATE INDEX "ManagedPlaylist_currentJobId_idx" ON "ManagedPlaylist"("currentJobId");
CREATE UNIQUE INDEX "ManagedPlaylistRelationship_source_target_type_key" ON "ManagedPlaylistRelationship"("sourceManagedPlaylistId", "targetManagedPlaylistId", "relationshipType");
CREATE INDEX "ManagedPlaylistRelationship_source_enabled_idx" ON "ManagedPlaylistRelationship"("sourceManagedPlaylistId", "enabled");
CREATE INDEX "ManagedPlaylistRelationship_target_enabled_idx" ON "ManagedPlaylistRelationship"("targetManagedPlaylistId", "enabled");
CREATE INDEX "ManagedPlaylistRelationship_createdAt_idx" ON "ManagedPlaylistRelationship"("createdAt");
CREATE UNIQUE INDEX "PlaylistOrchestrationJob_idempotencyKey_key" ON "PlaylistOrchestrationJob"("idempotencyKey");
CREATE INDEX "PlaylistOrchestrationJob_status_scheduledFor_idx" ON "PlaylistOrchestrationJob"("status", "scheduledFor");
CREATE INDEX "PlaylistOrchestrationJob_playlist_status_idx" ON "PlaylistOrchestrationJob"("managedPlaylistId", "status");
CREATE INDEX "PlaylistOrchestrationJob_priority_requested_idx" ON "PlaylistOrchestrationJob"("playlistPriority", "priority", "requestedAt");
CREATE INDEX "PlaylistOrchestrationJob_user_status_idx" ON "PlaylistOrchestrationJob"("userId", "status");
CREATE INDEX "PlaylistOrchestrationJob_library_status_idx" ON "PlaylistOrchestrationJob"("libraryId", "status");
CREATE INDEX "PlaylistOrchestrationJob_lockedAt_idx" ON "PlaylistOrchestrationJob"("lockedAt");
CREATE INDEX "PlaylistOrchestrationJob_heartbeatAt_idx" ON "PlaylistOrchestrationJob"("heartbeatAt");
CREATE INDEX "PlaylistOrchestrationJob_leaseExpiresAt_idx" ON "PlaylistOrchestrationJob"("leaseExpiresAt");
CREATE INDEX "PlaylistOrchestrationJob_createdAt_idx" ON "PlaylistOrchestrationJob"("createdAt");
CREATE INDEX "PlaylistOrchestrationJob_rootJobId_idx" ON "PlaylistOrchestrationJob"("rootJobId");
CREATE UNIQUE INDEX "PlaylistOrchestrationLock_conflictKey_key" ON "PlaylistOrchestrationLock"("conflictKey");
CREATE INDEX "PlaylistOrchestrationLock_jobId_idx" ON "PlaylistOrchestrationLock"("jobId");
CREATE INDEX "PlaylistOrchestrationLock_managedPlaylistId_idx" ON "PlaylistOrchestrationLock"("managedPlaylistId");
CREATE INDEX "PlaylistOrchestrationLock_libraryId_idx" ON "PlaylistOrchestrationLock"("libraryId");
CREATE INDEX "PlaylistOrchestrationLock_leaseExpiresAt_idx" ON "PlaylistOrchestrationLock"("leaseExpiresAt");
CREATE INDEX "PlaylistOrchestrationLock_heartbeatAt_idx" ON "PlaylistOrchestrationLock"("heartbeatAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_user_created_idx" ON "PlaylistOrchestrationAuditEvent"("userId", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_playlist_created_idx" ON "PlaylistOrchestrationAuditEvent"("managedPlaylistId", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_job_created_idx" ON "PlaylistOrchestrationAuditEvent"("jobId", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_type_created_idx" ON "PlaylistOrchestrationAuditEvent"("eventType", "createdAt");
CREATE INDEX "PlaylistOrchestrationAuditEvent_createdAt_idx" ON "PlaylistOrchestrationAuditEvent"("createdAt");

ALTER TABLE "ManagedPlaylist" ADD CONSTRAINT "ManagedPlaylist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagedPlaylist" ADD CONSTRAINT "ManagedPlaylist_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedPlaylist" ADD CONSTRAINT "ManagedPlaylist_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManagedPlaylist" ADD CONSTRAINT "ManagedPlaylist_playlistIdentityId_fkey" FOREIGN KEY ("playlistIdentityId") REFERENCES "PlaylistIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManagedPlaylistRelationship" ADD CONSTRAINT "ManagedPlaylistRelationship_source_fkey" FOREIGN KEY ("sourceManagedPlaylistId") REFERENCES "ManagedPlaylist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedPlaylistRelationship" ADD CONSTRAINT "ManagedPlaylistRelationship_target_fkey" FOREIGN KEY ("targetManagedPlaylistId") REFERENCES "ManagedPlaylist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistOrchestrationJob" ADD CONSTRAINT "PlaylistOrchestrationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistOrchestrationJob" ADD CONSTRAINT "PlaylistOrchestrationJob_managedPlaylistId_fkey" FOREIGN KEY ("managedPlaylistId") REFERENCES "ManagedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistOrchestrationJob" ADD CONSTRAINT "PlaylistOrchestrationJob_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistOrchestrationLock" ADD CONSTRAINT "PlaylistOrchestrationLock_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PlaylistOrchestrationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistOrchestrationLock" ADD CONSTRAINT "PlaylistOrchestrationLock_managedPlaylistId_fkey" FOREIGN KEY ("managedPlaylistId") REFERENCES "ManagedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistOrchestrationLock" ADD CONSTRAINT "PlaylistOrchestrationLock_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistOrchestrationAuditEvent" ADD CONSTRAINT "PlaylistOrchestrationAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistOrchestrationAuditEvent" ADD CONSTRAINT "PlaylistOrchestrationAuditEvent_managedPlaylistId_fkey" FOREIGN KEY ("managedPlaylistId") REFERENCES "ManagedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistOrchestrationAuditEvent" ADD CONSTRAINT "PlaylistOrchestrationAuditEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PlaylistOrchestrationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SystemState" ("key", "value", "updatedAt") VALUES (
  'playlistOrchestrationSettings',
  '{"enabled":false,"dryRunByDefault":false,"globalMaxConcurrentJobs":1,"perUserMaxConcurrentJobs":1,"perLibraryMaxConcurrentJobs":1,"defaultPriority":"NORMAL","autoRegisterGeneratedPlaylists":false,"autoEnableRegisteredPlaylists":false,"staleJobTimeoutMinutes":15,"jobHistoryRetentionDays":90,"auditRetentionDays":365,"allowScheduledOrchestration":false}',
  CURRENT_TIMESTAMP
) ON CONFLICT ("key") DO NOTHING;
