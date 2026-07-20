-- Mixarr v2.3.7 is opt-in and preserves all existing Plex connections.
-- Existing plaintext server tokens remain readable during the transition; Mixarr
-- encrypts them into accessTokenEncrypted when MIXARR_SECRET_KEY is available.
ALTER TABLE "Server" ADD COLUMN "accessTokenEncrypted" TEXT,
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "role" TEXT NOT NULL DEFAULT 'PRIMARY',
ADD COLUMN "availabilityState" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastSuccessAt" TIMESTAMP(3), ADD COLUMN "lastFailureAt" TIMESTAMP(3),
ADD COLUMN "lastFailureReason" TEXT, ADD COLUMN "responseLatencyMs" INTEGER,
ADD COLUMN "automaticFailover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "minimumFailures" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "failoverCooldownMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "failoverWritePolicy" TEXT NOT NULL DEFAULT 'READ_ONLY';

ALTER TABLE "PlexUserMapping" ADD COLUMN "mappingState" TEXT NOT NULL DEFAULT 'MAPPED',
ADD COLUMN "isHomeUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isManagedUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "defaultPlaylistOwner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastVerifiedAt" TIMESTAMP(3), ADD COLUMN "conflictReason" TEXT;

ALTER TABLE "GeneratedPlaylist" ADD COLUMN "plexOwnerName" TEXT,
ADD COLUMN "plexOwnerAccountId" TEXT, ADD COLUMN "plexPlaylistUrl" TEXT,
ADD COLUMN "plexOwnedByAuthenticatedUser" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "plexCanModify" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "managedByMixarr" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "importedFromPlex" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reconciliationPolicy" TEXT NOT NULL DEFAULT 'REQUIRE_MANUAL_REVIEW',
ADD COLUMN "externalChangeState" TEXT NOT NULL DEFAULT 'NO_CHANGE',
ADD COLUMN "lastExternalFingerprint" TEXT, ADD COLUMN "lastSuccessfulSyncAt" TIMESTAMP(3),
ADD COLUMN "lastManualChangeAt" TIMESTAMP(3);

ALTER TABLE "Library" ADD COLUMN "scanState" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "lastScanDetectedAt" TIMESTAMP(3), ADD COLUMN "lastScanCompletedAt" TIMESTAMP(3),
ADD COLUMN "destructiveSyncBlockedUntil" TIMESTAMP(3);

CREATE TABLE "IntegrationConfiguration" ("id" TEXT NOT NULL, "key" TEXT NOT NULL, "displayName" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'DISABLED', "configurationJson" JSONB NOT NULL DEFAULT '{}', "encryptedSecretJson" TEXT, "lastSuccessAt" TIMESTAMP(3), "lastFailureAt" TIMESTAMP(3), "lastFailureReason" TEXT, "failureCount" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "IntegrationConfiguration_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "IntegrationConfiguration_key_key" ON "IntegrationConfiguration"("key");
CREATE INDEX "IntegrationConfiguration_enabled_status_idx" ON "IntegrationConfiguration"("enabled", "status");
CREATE INDEX "IntegrationConfiguration_lastFailureAt_idx" ON "IntegrationConfiguration"("lastFailureAt");

CREATE TABLE "ApiToken" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "prefix" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "scopesJson" JSONB NOT NULL DEFAULT '[]', "ipRestrictions" JSONB, "enabled" BOOLEAN NOT NULL DEFAULT true, "revokedAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3), "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash"); CREATE INDEX "ApiToken_userId_enabled_idx" ON "ApiToken"("userId", "enabled"); CREATE INDEX "ApiToken_prefix_idx" ON "ApiToken"("prefix"); CREATE INDEX "ApiToken_expiresAt_idx" ON "ApiToken"("expiresAt");
CREATE TABLE "ApiTokenAuditEvent" ("id" TEXT NOT NULL, "tokenId" TEXT NOT NULL, "eventType" TEXT NOT NULL, "actorId" TEXT, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ApiTokenAuditEvent_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ApiTokenAuditEvent_tokenId_createdAt_idx" ON "ApiTokenAuditEvent"("tokenId", "createdAt"); CREATE INDEX "ApiTokenAuditEvent_eventType_createdAt_idx" ON "ApiTokenAuditEvent"("eventType", "createdAt");

CREATE TABLE "IntegrationEvent" ("id" TEXT NOT NULL, "event" TEXT NOT NULL, "envelopeVersion" TEXT NOT NULL DEFAULT '1', "dataJson" JSONB NOT NULL, "contextJson" JSONB NOT NULL DEFAULT '{}', "idempotencyKey" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "IntegrationEvent_idempotencyKey_key" ON "IntegrationEvent"("idempotencyKey"); CREATE INDEX "IntegrationEvent_event_createdAt_idx" ON "IntegrationEvent"("event", "createdAt"); CREATE INDEX "IntegrationEvent_createdAt_idx" ON "IntegrationEvent"("createdAt");
CREATE TABLE "WebhookEndpoint" ("id" TEXT NOT NULL, "displayName" TEXT NOT NULL, "destinationUrlEncrypted" TEXT NOT NULL, "secretEncrypted" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false, "eventsJson" JSONB NOT NULL DEFAULT '[]', "customHeadersJson" JSONB NOT NULL DEFAULT '{}', "timeoutMs" INTEGER NOT NULL DEFAULT 5000, "retryCount" INTEGER NOT NULL DEFAULT 3, "backoffStrategy" TEXT NOT NULL DEFAULT 'EXPONENTIAL', "includeSensitiveFields" BOOLEAN NOT NULL DEFAULT false, "lastSuccessAt" TIMESTAMP(3), "lastFailureAt" TIMESTAMP(3), "failureCount" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id"));
CREATE INDEX "WebhookEndpoint_enabled_idx" ON "WebhookEndpoint"("enabled"); CREATE INDEX "WebhookEndpoint_lastFailureAt_idx" ON "WebhookEndpoint"("lastFailureAt");
CREATE TABLE "WebhookDelivery" ("id" TEXT NOT NULL, "deliveryId" TEXT NOT NULL, "eventId" TEXT NOT NULL, "endpointId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "httpStatus" INTEGER, "attemptNumber" INTEGER NOT NULL DEFAULT 1, "durationMs" INTEGER, "responseExcerpt" TEXT, "errorCategory" TEXT, "errorMessage" TEXT, "nextAttemptAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "WebhookDelivery_deliveryId_attemptNumber_key" ON "WebhookDelivery"("deliveryId", "attemptNumber"); CREATE INDEX "WebhookDelivery_endpointId_status_createdAt_idx" ON "WebhookDelivery"("endpointId", "status", "createdAt"); CREATE INDEX "WebhookDelivery_eventId_createdAt_idx" ON "WebhookDelivery"("eventId", "createdAt"); CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

CREATE TABLE "ExternalStateSnapshot" ("id" TEXT NOT NULL, "generatedPlaylistId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "stateJson" JSONB NOT NULL, "source" TEXT NOT NULL DEFAULT 'PLEX', "synchronized" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ExternalStateSnapshot_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ExternalStateSnapshot_generatedPlaylistId_createdAt_idx" ON "ExternalStateSnapshot"("generatedPlaylistId", "createdAt"); CREATE INDEX "ExternalStateSnapshot_fingerprint_idx" ON "ExternalStateSnapshot"("fingerprint");
CREATE TABLE "PlaylistReconciliation" ("id" TEXT NOT NULL, "generatedPlaylistId" TEXT NOT NULL, "changeType" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "policy" TEXT NOT NULL DEFAULT 'REQUIRE_MANUAL_REVIEW', "beforeJson" JSONB NOT NULL, "afterJson" JSONB NOT NULL, "diffJson" JSONB NOT NULL, "decision" TEXT, "decidedById" TEXT, "decidedAt" TIMESTAMP(3), "resultJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PlaylistReconciliation_pkey" PRIMARY KEY ("id"));
CREATE INDEX "PlaylistReconciliation_generatedPlaylistId_status_createdAt_idx" ON "PlaylistReconciliation"("generatedPlaylistId", "status", "createdAt"); CREATE INDEX "PlaylistReconciliation_status_createdAt_idx" ON "PlaylistReconciliation"("status", "createdAt");

CREATE TABLE "PlexCollectionState" ("id" TEXT NOT NULL, "serverId" TEXT NOT NULL, "libraryId" TEXT NOT NULL, "plexCollectionId" TEXT NOT NULL, "name" TEXT NOT NULL, "summary" TEXT, "collectionType" TEXT NOT NULL DEFAULT 'artist', "itemCount" INTEGER NOT NULL DEFAULT 0, "managedByMixarr" BOOLEAN NOT NULL DEFAULT false, "available" BOOLEAN NOT NULL DEFAULT true, "synchronizationDirection" TEXT NOT NULL DEFAULT 'ONE_TIME', "syncMode" TEXT NOT NULL DEFAULT 'CREATE_NEW', "manualChangeState" TEXT NOT NULL DEFAULT 'NO_CHANGE', "lastItemSetJson" JSONB, "lastMetadataJson" JSONB, "lastModifiedAt" TIMESTAMP(3), "lastSuccessfulUpdateAt" TIMESTAMP(3), "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PlexCollectionState_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "PlexCollectionState_serverId_plexCollectionId_key" ON "PlexCollectionState"("serverId", "plexCollectionId"); CREATE INDEX "PlexCollectionState_libraryId_available_idx" ON "PlexCollectionState"("libraryId", "available"); CREATE INDEX "PlexCollectionState_managedByMixarr_updatedAt_idx" ON "PlexCollectionState"("managedByMixarr", "updatedAt");

CREATE TABLE "MountDependency" ("id" TEXT NOT NULL, "serverId" TEXT, "displayName" TEXT NOT NULL, "path" TEXT NOT NULL, "markerFile" TEXT, "expectedFilesystemId" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "status" TEXT NOT NULL DEFAULT 'UNKNOWN', "failureCount" INTEGER NOT NULL DEFAULT 0, "consecutiveSuccessCount" INTEGER NOT NULL DEFAULT 0, "requiredSuccessCount" INTEGER NOT NULL DEFAULT 2, "lastCheckedAt" TIMESTAMP(3), "lastSuccessAt" TIMESTAMP(3), "lastFailureAt" TIMESTAMP(3), "lastFailureReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MountDependency_pkey" PRIMARY KEY ("id"));
CREATE INDEX "MountDependency_enabled_status_idx" ON "MountDependency"("enabled", "status"); CREATE INDEX "MountDependency_serverId_idx" ON "MountDependency"("serverId");

CREATE TABLE "TautulliPlaybackSignal" ("id" TEXT NOT NULL, "externalEventId" TEXT NOT NULL, "trackRatingKey" TEXT NOT NULL, "plexUserIdHash" TEXT, "playedAt" TIMESTAMP(3) NOT NULL, "durationMs" INTEGER, "completionPercentage" DOUBLE PRECISION, "behavior" TEXT NOT NULL, "recentPlayCount" INTEGER NOT NULL DEFAULT 1, "privacyCategory" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TautulliPlaybackSignal_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "TautulliPlaybackSignal_externalEventId_key" ON "TautulliPlaybackSignal"("externalEventId"); CREATE INDEX "TautulliPlaybackSignal_trackRatingKey_playedAt_idx" ON "TautulliPlaybackSignal"("trackRatingKey", "playedAt"); CREATE INDEX "TautulliPlaybackSignal_expiresAt_idx" ON "TautulliPlaybackSignal"("expiresAt");

CREATE TABLE "IntegrationHealthRecord" ("id" TEXT NOT NULL, "integrationKey" TEXT NOT NULL, "status" TEXT NOT NULL, "latencyMs" INTEGER, "errorCategory" TEXT, "message" TEXT, "detailsJson" JSONB, "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "IntegrationHealthRecord_pkey" PRIMARY KEY ("id"));
CREATE INDEX "IntegrationHealthRecord_integrationKey_checkedAt_idx" ON "IntegrationHealthRecord"("integrationKey", "checkedAt"); CREATE INDEX "IntegrationHealthRecord_status_checkedAt_idx" ON "IntegrationHealthRecord"("status", "checkedAt");
CREATE TABLE "IntegrationTestResult" ("id" TEXT NOT NULL, "testKey" TEXT NOT NULL, "status" TEXT NOT NULL, "safe" BOOLEAN NOT NULL DEFAULT true, "durationMs" INTEGER NOT NULL, "requestSummary" JSONB, "responseSummary" JSONB, "errorCategory" TEXT, "message" TEXT NOT NULL, "actorId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "IntegrationTestResult_pkey" PRIMARY KEY ("id"));
CREATE INDEX "IntegrationTestResult_testKey_createdAt_idx" ON "IntegrationTestResult"("testKey", "createdAt"); CREATE INDEX "IntegrationTestResult_status_createdAt_idx" ON "IntegrationTestResult"("status", "createdAt");
CREATE TABLE "FailoverEvent" ("id" TEXT NOT NULL, "primaryServerId" TEXT NOT NULL, "activeServerId" TEXT NOT NULL, "operationType" TEXT NOT NULL, "writeAllowed" BOOLEAN NOT NULL DEFAULT false, "reason" TEXT NOT NULL, "metadataJson" JSONB, "recoveredAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "FailoverEvent_pkey" PRIMARY KEY ("id"));
CREATE INDEX "FailoverEvent_primaryServerId_createdAt_idx" ON "FailoverEvent"("primaryServerId", "createdAt"); CREATE INDEX "FailoverEvent_activeServerId_recoveredAt_idx" ON "FailoverEvent"("activeServerId", "recoveredAt");

ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiTokenAuditEvent" ADD CONSTRAINT "ApiTokenAuditEvent_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "ApiToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IntegrationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalStateSnapshot" ADD CONSTRAINT "ExternalStateSnapshot_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistReconciliation" ADD CONSTRAINT "PlaylistReconciliation_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Server_enabled_priority_idx" ON "Server"("enabled", "priority");
CREATE INDEX "Server_availabilityState_lastFailureAt_idx" ON "Server"("availabilityState", "lastFailureAt");
CREATE INDEX "GeneratedPlaylist_externalChangeState_updatedAt_idx" ON "GeneratedPlaylist"("externalChangeState", "updatedAt");
CREATE INDEX "GeneratedPlaylist_plexOwnerAccountId_idx" ON "GeneratedPlaylist"("plexOwnerAccountId");
