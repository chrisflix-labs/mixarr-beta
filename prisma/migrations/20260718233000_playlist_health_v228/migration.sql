-- Playlist Health Monitoring & Alerts (v2.2.8)
-- Additive only: existing playlists and settings are not modified.

CREATE TABLE "PlaylistHealthSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "analyzeDuringNightlySync" BOOLEAN NOT NULL DEFAULT true,
    "staleAfterDays" INTEGER NOT NULL DEFAULT 30,
    "artistConcentrationPercent" INTEGER NOT NULL DEFAULT 30,
    "albumConcentrationPercent" INTEGER NOT NULL DEFAULT 20,
    "excessiveBpmJump" INTEGER NOT NULL DEFAULT 35,
    "moodConflictDelta" DOUBLE PRECISION NOT NULL DEFAULT 0.55,
    "metadataDeclinePercent" INTEGER NOT NULL DEFAULT 15,
    "minimumAlertSeverity" TEXT NOT NULL DEFAULT 'WARNING',
    "inAppNotifications" BOOLEAN NOT NULL DEFAULT true,
    "discordNotifications" BOOLEAN NOT NULL DEFAULT false,
    "webhookNotifications" BOOLEAN NOT NULL DEFAULT false,
    "discordWebhookEncrypted" TEXT,
    "webhookUrlEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlaylistHealthSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistHealthSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "metadataConfidence" DOUBLE PRECISION,
    "identityScore" DOUBLE PRECISION,
    "checksJson" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistHealthAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "alertType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detailsJson" JSONB,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlaylistHealthAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistHealthAlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "note" TEXT,
    "detailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistHealthAlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistHealthNotificationDelivery" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseCode" INTEGER,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistHealthNotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaylistHealthSetting_userId_key" ON "PlaylistHealthSetting"("userId");
CREATE INDEX "PlaylistHealthSnapshot_userId_analyzedAt_idx" ON "PlaylistHealthSnapshot"("userId", "analyzedAt");
CREATE INDEX "PlaylistHealthSnapshot_playlistId_analyzedAt_idx" ON "PlaylistHealthSnapshot"("playlistId", "analyzedAt");
CREATE INDEX "PlaylistHealthSnapshot_userId_status_analyzedAt_idx" ON "PlaylistHealthSnapshot"("userId", "status", "analyzedAt");
CREATE UNIQUE INDEX "PlaylistHealthAlert_userId_playlistId_alertType_key" ON "PlaylistHealthAlert"("userId", "playlistId", "alertType");
CREATE INDEX "PlaylistHealthAlert_userId_status_severity_lastDetectedAt_idx" ON "PlaylistHealthAlert"("userId", "status", "severity", "lastDetectedAt");
CREATE INDEX "PlaylistHealthAlert_playlistId_status_idx" ON "PlaylistHealthAlert"("playlistId", "status");
CREATE INDEX "PlaylistHealthAlert_snapshotId_idx" ON "PlaylistHealthAlert"("snapshotId");
CREATE INDEX "PlaylistHealthAlertEvent_alertId_createdAt_idx" ON "PlaylistHealthAlertEvent"("alertId", "createdAt");
CREATE INDEX "PlaylistHealthAlertEvent_actorUserId_createdAt_idx" ON "PlaylistHealthAlertEvent"("actorUserId", "createdAt");
CREATE INDEX "PlaylistHealthNotificationDelivery_alertId_attemptedAt_idx" ON "PlaylistHealthNotificationDelivery"("alertId", "attemptedAt");
CREATE INDEX "PlaylistHealthNotificationDelivery_status_attemptedAt_idx" ON "PlaylistHealthNotificationDelivery"("status", "attemptedAt");

ALTER TABLE "PlaylistHealthSetting" ADD CONSTRAINT "PlaylistHealthSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistHealthSnapshot" ADD CONSTRAINT "PlaylistHealthSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistHealthSnapshot" ADD CONSTRAINT "PlaylistHealthSnapshot_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistHealthAlert" ADD CONSTRAINT "PlaylistHealthAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistHealthAlert" ADD CONSTRAINT "PlaylistHealthAlert_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistHealthAlert" ADD CONSTRAINT "PlaylistHealthAlert_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PlaylistHealthSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistHealthAlertEvent" ADD CONSTRAINT "PlaylistHealthAlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "PlaylistHealthAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistHealthAlertEvent" ADD CONSTRAINT "PlaylistHealthAlertEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistHealthNotificationDelivery" ADD CONSTRAINT "PlaylistHealthNotificationDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "PlaylistHealthAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
