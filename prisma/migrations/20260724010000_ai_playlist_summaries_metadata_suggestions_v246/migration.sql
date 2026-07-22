-- Mixarr v2.4.6: advisory-only playlist summaries and metadata suggestions.
-- This migration schedules no work and creates no metadata-application path.

ALTER TABLE "GeneratedPlaylist" ADD COLUMN "localPlaylistNotes" TEXT;

CREATE TABLE "PlaylistAnalysisSnapshot" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "playlistId" TEXT NOT NULL,
  "sourceRevisionId" TEXT, "previousSnapshotId" TEXT, "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
  "privacyMode" TEXT NOT NULL DEFAULT 'METADATA_LIMITED', "analysisJson" JSONB NOT NULL,
  "aggregatePayloadJson" JSONB NOT NULL, "fullPayloadJson" JSONB, "trackCount" INTEGER NOT NULL DEFAULT 0,
  "fingerprint" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistAnalysisSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistAiSummary" (
  "id" TEXT NOT NULL, "playlistId" TEXT NOT NULL, "snapshotId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "summaryType" TEXT NOT NULL, "generatedText" TEXT NOT NULL, "originalAiGeneratedText" TEXT,
  "providerConfigId" TEXT, "providerDisplayName" TEXT, "model" TEXT,
  "privacyMode" TEXT NOT NULL DEFAULT 'METADATA_LIMITED', "promptTemplateVersion" TEXT NOT NULL,
  "requestId" TEXT, "inputTokenCount" INTEGER, "outputTokenCount" INTEGER,
  "estimatedCost" DECIMAL(18,6), "actualCost" DECIMAL(18,6), "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "errorCode" TEXT, "errorDetails" TEXT, "preferred" BOOLEAN NOT NULL DEFAULT false,
  "manuallyEdited" BOOLEAN NOT NULL DEFAULT false, "archivedAt" TIMESTAMP(3),
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistAiSummary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetadataAnalysisJob" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "libraryId" TEXT, "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "privacyMode" TEXT NOT NULL DEFAULT 'METADATA_LIMITED', "providerConfigId" TEXT, "providerDisplayName" TEXT,
  "model" TEXT, "requestId" TEXT, "batchSize" INTEGER NOT NULL DEFAULT 50,
  "librariesScanned" INTEGER NOT NULL DEFAULT 0, "tracksScanned" INTEGER NOT NULL DEFAULT 0,
  "candidateIssuesFound" INTEGER NOT NULL DEFAULT 0, "aiBatchesCompleted" INTEGER NOT NULL DEFAULT 0,
  "suggestionsCreated" INTEGER NOT NULL DEFAULT 0, "suggestionsDeduplicated" INTEGER NOT NULL DEFAULT 0,
  "suggestionsSuppressed" INTEGER NOT NULL DEFAULT 0, "conflictsFound" INTEGER NOT NULL DEFAULT 0,
  "completedBatchCount" INTEGER NOT NULL DEFAULT 0, "failedBatchCount" INTEGER NOT NULL DEFAULT 0,
  "progressJson" JSONB, "warningsJson" JSONB, "errorDetails" TEXT, "cancellationRequestedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MetadataAnalysisJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetadataSuggestion" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "libraryId" TEXT, "playlistId" TEXT, "analysisJobId" TEXT,
  "suggestionType" TEXT NOT NULL, "field" TEXT NOT NULL, "existingValue" TEXT, "suggestedValue" TEXT,
  "reason" TEXT NOT NULL, "confidenceScore" DOUBLE PRECISION NOT NULL, "confidenceLevel" TEXT NOT NULL,
  "detectionMethod" TEXT NOT NULL, "sourceMetadataJson" JSONB NOT NULL, "conflictingSourceJson" JSONB,
  "affectedTrackCount" INTEGER NOT NULL DEFAULT 0, "affectedAlbumCount" INTEGER NOT NULL DEFAULT 0,
  "affectedArtistCount" INTEGER NOT NULL DEFAULT 0, "affectedAlbumsJson" JSONB NOT NULL,
  "affectedArtistsJson" JSONB NOT NULL, "plexImpact" BOOLEAN NOT NULL DEFAULT false,
  "sourceLibraryImpact" BOOLEAN NOT NULL DEFAULT false, "embeddedTagImpact" BOOLEAN NOT NULL DEFAULT false,
  "providerConfigId" TEXT, "providerDisplayName" TEXT, "model" TEXT, "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "ignoreRuleId" TEXT, "duplicateSuggestionIdsJson" JSONB,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "detectionCount" INTEGER NOT NULL DEFAULT 1,
  "reviewedAt" TIMESTAMP(3), "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MetadataSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetadataSuggestionTrack" (
  "id" TEXT NOT NULL, "suggestionId" TEXT NOT NULL, "trackId" TEXT, "trackIdentifier" TEXT NOT NULL,
  "titleSnapshot" TEXT NOT NULL, "artistSnapshot" TEXT, "albumSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetadataSuggestionTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetadataSuggestionSource" (
  "id" TEXT NOT NULL, "suggestionId" TEXT NOT NULL, "sourceType" TEXT NOT NULL, "field" TEXT NOT NULL,
  "valueJson" JSONB, "available" BOOLEAN NOT NULL DEFAULT false, "queried" BOOLEAN NOT NULL DEFAULT false,
  "supportsValue" BOOLEAN, "sourceRecordId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetadataSuggestionSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetadataSuggestionReview" (
  "id" TEXT NOT NULL, "suggestionId" TEXT NOT NULL, "reviewerId" TEXT NOT NULL,
  "previousStatus" TEXT NOT NULL, "newStatus" TEXT NOT NULL, "notes" TEXT, "bulkRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetadataSuggestionReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetadataIgnoreRule" (
  "id" TEXT NOT NULL, "creatorId" TEXT NOT NULL, "scope" TEXT NOT NULL, "description" TEXT NOT NULL,
  "matchJson" JSONB NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true, "suppressedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "disabledAt" TIMESTAMP(3), CONSTRAINT "MetadataIgnoreRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetadataSuggestionExport" (
  "id" TEXT NOT NULL, "exporterId" TEXT NOT NULL, "format" TEXT NOT NULL, "filename" TEXT NOT NULL,
  "filterJson" JSONB NOT NULL, "suggestionCount" INTEGER NOT NULL, "affectedTrackCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetadataSuggestionExport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetadataSuggestionAuditEvent" (
  "id" TEXT NOT NULL, "suggestionId" TEXT, "actorId" TEXT, "action" TEXT NOT NULL,
  "objectType" TEXT NOT NULL, "objectId" TEXT NOT NULL, "libraryId" TEXT, "playlistId" TEXT,
  "requestOrJobId" TEXT, "suggestionCount" INTEGER NOT NULL DEFAULT 0,
  "affectedTrackCount" INTEGER NOT NULL DEFAULT 0, "previousStatus" TEXT, "newStatus" TEXT,
  "providerDisplayName" TEXT, "model" TEXT, "safeMetadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetadataSuggestionAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiAdvisorySetting" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "playlistSummariesEnabled" BOOLEAN NOT NULL DEFAULT true,
  "metadataSuggestionsEnabled" BOOLEAN NOT NULL DEFAULT false, "defaultSummaryTypesJson" JSONB NOT NULL,
  "automaticRefreshSummaries" BOOLEAN NOT NULL DEFAULT false, "plexDescriptionMaxLength" INTEGER NOT NULL DEFAULT 500,
  "metadataAnalysisBatchSize" INTEGER NOT NULL DEFAULT 50, "minimumConfidenceToDisplay" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "retainSummaryHistory" BOOLEAN NOT NULL DEFAULT true, "retainRejectedSuggestions" BOOLEAN NOT NULL DEFAULT true,
  "deterministicChecksEnabled" BOOLEAN NOT NULL DEFAULT true, "aiAssistedChecksEnabled" BOOLEAN NOT NULL DEFAULT true,
  "allowFullTrackMetadata" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AiAdvisorySetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetadataSuggestion_ownerId_fingerprint_key" ON "MetadataSuggestion"("ownerId", "fingerprint");
CREATE UNIQUE INDEX "MetadataSuggestionTrack_suggestionId_trackIdentifier_key" ON "MetadataSuggestionTrack"("suggestionId", "trackIdentifier");
CREATE UNIQUE INDEX "AiAdvisorySetting_userId_key" ON "AiAdvisorySetting"("userId");
CREATE INDEX "PlaylistAnalysisSnapshot_playlistId_createdAt_idx" ON "PlaylistAnalysisSnapshot"("playlistId", "createdAt");
CREATE INDEX "PlaylistAnalysisSnapshot_userId_createdAt_idx" ON "PlaylistAnalysisSnapshot"("userId", "createdAt");
CREATE INDEX "PlaylistAnalysisSnapshot_fingerprint_idx" ON "PlaylistAnalysisSnapshot"("fingerprint");
CREATE INDEX "PlaylistAiSummary_playlistId_summaryType_generatedAt_idx" ON "PlaylistAiSummary"("playlistId", "summaryType", "generatedAt");
CREATE INDEX "PlaylistAiSummary_playlistId_preferred_idx" ON "PlaylistAiSummary"("playlistId", "preferred");
CREATE INDEX "PlaylistAiSummary_createdById_generatedAt_idx" ON "PlaylistAiSummary"("createdById", "generatedAt");
CREATE INDEX "PlaylistAiSummary_status_generatedAt_idx" ON "PlaylistAiSummary"("status", "generatedAt");
CREATE INDEX "MetadataAnalysisJob_userId_status_createdAt_idx" ON "MetadataAnalysisJob"("userId", "status", "createdAt");
CREATE INDEX "MetadataAnalysisJob_libraryId_status_createdAt_idx" ON "MetadataAnalysisJob"("libraryId", "status", "createdAt");
CREATE INDEX "MetadataAnalysisJob_status_createdAt_idx" ON "MetadataAnalysisJob"("status", "createdAt");
CREATE INDEX "MetadataSuggestion_ownerId_status_createdAt_idx" ON "MetadataSuggestion"("ownerId", "status", "createdAt");
CREATE INDEX "MetadataSuggestion_libraryId_status_createdAt_idx" ON "MetadataSuggestion"("libraryId", "status", "createdAt");
CREATE INDEX "MetadataSuggestion_playlistId_createdAt_idx" ON "MetadataSuggestion"("playlistId", "createdAt");
CREATE INDEX "MetadataSuggestion_confidenceLevel_confidenceScore_idx" ON "MetadataSuggestion"("confidenceLevel", "confidenceScore");
CREATE INDEX "MetadataSuggestion_suggestionType_status_idx" ON "MetadataSuggestion"("suggestionType", "status");
CREATE INDEX "MetadataSuggestion_field_status_idx" ON "MetadataSuggestion"("field", "status");
CREATE INDEX "MetadataSuggestion_createdAt_idx" ON "MetadataSuggestion"("createdAt");
CREATE INDEX "MetadataSuggestionTrack_suggestionId_id_idx" ON "MetadataSuggestionTrack"("suggestionId", "id");
CREATE INDEX "MetadataSuggestionTrack_trackId_idx" ON "MetadataSuggestionTrack"("trackId");
CREATE INDEX "MetadataSuggestionSource_suggestionId_sourceType_idx" ON "MetadataSuggestionSource"("suggestionId", "sourceType");
CREATE INDEX "MetadataSuggestionSource_sourceType_field_idx" ON "MetadataSuggestionSource"("sourceType", "field");
CREATE INDEX "MetadataSuggestionReview_suggestionId_createdAt_idx" ON "MetadataSuggestionReview"("suggestionId", "createdAt");
CREATE INDEX "MetadataSuggestionReview_reviewerId_createdAt_idx" ON "MetadataSuggestionReview"("reviewerId", "createdAt");
CREATE INDEX "MetadataSuggestionReview_bulkRequestId_idx" ON "MetadataSuggestionReview"("bulkRequestId");
CREATE INDEX "MetadataIgnoreRule_creatorId_enabled_createdAt_idx" ON "MetadataIgnoreRule"("creatorId", "enabled", "createdAt");
CREATE INDEX "MetadataIgnoreRule_scope_enabled_idx" ON "MetadataIgnoreRule"("scope", "enabled");
CREATE INDEX "MetadataSuggestionExport_exporterId_createdAt_idx" ON "MetadataSuggestionExport"("exporterId", "createdAt");
CREATE INDEX "MetadataSuggestionAuditEvent_suggestionId_createdAt_idx" ON "MetadataSuggestionAuditEvent"("suggestionId", "createdAt");
CREATE INDEX "MetadataSuggestionAuditEvent_actorId_createdAt_idx" ON "MetadataSuggestionAuditEvent"("actorId", "createdAt");
CREATE INDEX "MetadataSuggestionAuditEvent_action_createdAt_idx" ON "MetadataSuggestionAuditEvent"("action", "createdAt");
CREATE INDEX "MetadataSuggestionAuditEvent_requestOrJobId_idx" ON "MetadataSuggestionAuditEvent"("requestOrJobId");

ALTER TABLE "PlaylistAnalysisSnapshot" ADD CONSTRAINT "PlaylistAnalysisSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistAnalysisSnapshot" ADD CONSTRAINT "PlaylistAnalysisSnapshot_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistAnalysisSnapshot" ADD CONSTRAINT "PlaylistAnalysisSnapshot_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId") REFERENCES "PlaylistAnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistAiSummary" ADD CONSTRAINT "PlaylistAiSummary_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistAiSummary" ADD CONSTRAINT "PlaylistAiSummary_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PlaylistAnalysisSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistAiSummary" ADD CONSTRAINT "PlaylistAiSummary_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetadataAnalysisJob" ADD CONSTRAINT "MetadataAnalysisJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataAnalysisJob" ADD CONSTRAINT "MetadataAnalysisJob_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestion" ADD CONSTRAINT "MetadataSuggestion_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestion" ADD CONSTRAINT "MetadataSuggestion_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestion" ADD CONSTRAINT "MetadataSuggestion_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestion" ADD CONSTRAINT "MetadataSuggestion_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "MetadataAnalysisJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestionTrack" ADD CONSTRAINT "MetadataSuggestionTrack_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "MetadataSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestionTrack" ADD CONSTRAINT "MetadataSuggestionTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestionSource" ADD CONSTRAINT "MetadataSuggestionSource_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "MetadataSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestionReview" ADD CONSTRAINT "MetadataSuggestionReview_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "MetadataSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestionReview" ADD CONSTRAINT "MetadataSuggestionReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetadataIgnoreRule" ADD CONSTRAINT "MetadataIgnoreRule_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestionExport" ADD CONSTRAINT "MetadataSuggestionExport_exporterId_fkey" FOREIGN KEY ("exporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestionAuditEvent" ADD CONSTRAINT "MetadataSuggestionAuditEvent_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "MetadataSuggestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MetadataSuggestionAuditEvent" ADD CONSTRAINT "MetadataSuggestionAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiAdvisorySetting" ADD CONSTRAINT "AiAdvisorySetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AiFeatureSetting" ("featureKey", "enabled", "implemented", "requiredCapabilities", "safeConfigurationJson", "createdAt", "updatedAt")
VALUES
  ('playlist_ai_summaries', false, true, '["chat_messages","structured_json"]'::jsonb, '{"advisoryOnly":true,"metadataWrites":false}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('metadata_suggestions', false, true, '["chat_messages","structured_json"]'::jsonb, '{"advisoryOnly":true,"metadataWrites":false,"maximumBatchSize":100}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("featureKey") DO UPDATE SET "implemented" = true, "safeConfigurationJson" = EXCLUDED."safeConfigurationJson", "updatedAt" = CURRENT_TIMESTAMP;
