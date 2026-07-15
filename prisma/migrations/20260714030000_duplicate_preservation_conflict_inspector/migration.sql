-- Mixarr v2.1.1: preserve one Track row for every Plex server/library/rating-key item.
ALTER TABLE "SyncSettings"
  ADD COLUMN "automaticallyShareDuplicateEnrichment" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Album" ADD COLUMN "plexTrackCount" INTEGER;

ALTER TABLE "Track"
  ADD COLUMN "plexGuids" JSONB,
  ADD COLUMN "plexServerId" TEXT,
  ADD COLUMN "plexMediaPartId" TEXT,
  ADD COLUMN "fileSize" BIGINT,
  ADD COLUMN "fileFormat" TEXT,
  ADD COLUMN "bitrate" INTEGER,
  ADD COLUMN "plexMetadata" JSONB,
  ADD COLUMN "canonicalRecordingId" TEXT,
  ADD COLUMN "duplicateConfidence" TEXT,
  ADD COLUMN "duplicateMatchEvidence" JSONB,
  ADD COLUMN "duplicateReviewStatus" TEXT NOT NULL DEFAULT 'not_duplicate',
  ADD COLUMN "enrichmentProvenance" JSONB,
  ADD COLUMN "inheritDuplicateEnrichment" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "preferredDuplicateCopy" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Track" t
SET
  "plexServerId" = s."machineIdentifier",
  "plexLibraryId" = COALESCE(t."plexLibraryId", l."plexId"),
  "ratingKey" = COALESCE(NULLIF(t."ratingKey", ''), t."plexId")
FROM "Library" l
JOIN "Server" s ON s."id" = l."serverId"
WHERE l."id" = t."libraryId";

ALTER TABLE "Track"
  ALTER COLUMN "plexServerId" SET NOT NULL,
  ALTER COLUMN "plexLibraryId" SET NOT NULL;

CREATE TABLE "CanonicalRecording" (
  "id" TEXT NOT NULL,
  "libraryId" TEXT NOT NULL,
  "canonicalArtist" TEXT NOT NULL,
  "canonicalTitle" TEXT NOT NULL,
  "confidence" TEXT NOT NULL DEFAULT 'medium',
  "matchEvidence" JSONB,
  "reviewStatus" TEXT NOT NULL DEFAULT 'confirmed',
  "sharedEnrichment" JSONB,
  "enrichmentProvenance" JSONB,
  "preferredEnrichmentTrackId" TEXT,
  "inheritanceEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanonicalRecording_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlexSyncConflict" (
  "id" TEXT NOT NULL,
  "libraryId" TEXT NOT NULL,
  "trackId" TEXT,
  "plexRatingKey" TEXT NOT NULL,
  "plexGuid" TEXT,
  "conflictReason" TEXT NOT NULL,
  "candidateTrackIds" JSONB,
  "duplicateConfidence" TEXT,
  "matchEvidence" JSONB,
  "plexMetadata" JSONB,
  "resolutionStatus" TEXT NOT NULL DEFAULT 'unresolved',
  "hasInheritedData" BOOLEAN NOT NULL DEFAULT false,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncBatchId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  CONSTRAINT "PlexSyncConflict_pkey" PRIMARY KEY ("id")
);

-- Preserve the latest pre-v2.1.1 conflict diagnostics so the inspector is useful
-- before the first repair. These rows are completed with Track IDs by the repair sync.
WITH legacy_conflicts AS (
  SELECT DISTINCT ON (j."metadata"->>'libraryId', event->>'plexRatingKey')
    j."metadata"->>'libraryId' AS library_id,
    event->>'plexRatingKey' AS plex_rating_key,
    COALESCE(event->>'reason', 'legacy_sync_match_conflict') AS reason,
    COALESCE(event->'candidates', '[]'::jsonb) AS candidates,
    j."id" AS sync_batch_id,
    j."startedAt" AS detected_at
  FROM "JobHistory" j
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(j."metadata"->'conflicts') = 'array' THEN j."metadata"->'conflicts'
      ELSE '[]'::jsonb
    END
  ) event
  WHERE j."type" = 'plex_sync'
    AND j."metadata" IS NOT NULL
    AND j."metadata"->>'libraryId' IS NOT NULL
    AND event->>'plexRatingKey' IS NOT NULL
  ORDER BY j."metadata"->>'libraryId', event->>'plexRatingKey', j."startedAt" DESC
)
INSERT INTO "PlexSyncConflict" (
  "id", "libraryId", "plexRatingKey", "conflictReason", "candidateTrackIds", "resolutionStatus", "firstDetectedAt", "lastDetectedAt", "lastSyncBatchId"
)
SELECT
  'legacy_' || md5(l.library_id || '|' || l.plex_rating_key),
  l.library_id,
  l.plex_rating_key,
  l.reason,
  l.candidates,
  'unresolved',
  l.detected_at,
  l.detected_at,
  l.sync_batch_id
FROM legacy_conflicts l
JOIN "Library" lib ON lib."id" = l.library_id;

-- Existing physical rows remain untouched. Only strong GUID + normalized artist/title
-- matches with close duration buckets are grouped automatically.
WITH strong_groups AS (
  SELECT
    t."libraryId",
    t."plexGuid",
    lower(trim(ar."title")) AS artist_key,
    lower(trim(t."title")) AS title_key,
    round(COALESCE(t."duration", 0) / 2000.0) AS duration_bucket,
    min(ar."title") AS canonical_artist,
    min(t."title") AS canonical_title,
    count(*) AS member_count
  FROM "Track" t
  JOIN "Artist" ar ON ar."id" = t."artistId"
  WHERE t."plexGuid" IS NOT NULL AND t."plexGuid" <> ''
  GROUP BY t."libraryId", t."plexGuid", lower(trim(ar."title")), lower(trim(t."title")), round(COALESCE(t."duration", 0) / 2000.0)
  HAVING count(*) > 1
)
INSERT INTO "CanonicalRecording" (
  "id", "libraryId", "canonicalArtist", "canonicalTitle", "confidence", "matchEvidence", "reviewStatus", "updatedAt"
)
SELECT
  'backfill_' || md5(g."libraryId" || '|' || g."plexGuid" || '|' || g.artist_key || '|' || g.title_key || '|' || g.duration_bucket::text),
  g."libraryId",
  g.canonical_artist,
  g.canonical_title,
  'high',
  jsonb_build_object('signals', jsonb_build_array('plex_guid', 'normalized_artist_title', 'duration_within_tolerance'), 'durationToleranceMs', 2000, 'source', 'v2.1.1_backfill'),
  'confirmed',
  CURRENT_TIMESTAMP
FROM strong_groups g;

WITH members AS (
  SELECT
    t."id" AS track_id,
    'backfill_' || md5(t."libraryId" || '|' || t."plexGuid" || '|' || lower(trim(ar."title")) || '|' || lower(trim(t."title")) || '|' || round(COALESCE(t."duration", 0) / 2000.0)::text) AS group_id
  FROM "Track" t
  JOIN "Artist" ar ON ar."id" = t."artistId"
  WHERE t."plexGuid" IS NOT NULL AND t."plexGuid" <> ''
)
UPDATE "Track" t
SET
  "canonicalRecordingId" = m.group_id,
  "duplicateConfidence" = 'high',
  "duplicateReviewStatus" = 'confirmed',
  "duplicateMatchEvidence" = jsonb_build_object('signals', jsonb_build_array('plex_guid', 'normalized_artist_title', 'duration_within_tolerance'), 'durationToleranceMs', 2000, 'source', 'v2.1.1_backfill')
FROM members m
JOIN "CanonicalRecording" c ON c."id" = m.group_id
WHERE t."id" = m.track_id;

WITH ranked AS (
  SELECT DISTINCT ON (t."canonicalRecordingId")
    t."canonicalRecordingId" AS group_id,
    t."id" AS track_id,
    COALESCE(t."effectiveBpm", t."localBpm", t."apiBpm", t."bpm", af."tempo") AS bpm,
    COALESCE(af."effectiveEnergy", af."localEnergy", af."apiEnergy", af."energy") AS energy,
    COALESCE(af."effectiveMood", af."localMood", af."apiMood", af."valence") AS mood,
    COALESCE(t."bpmSource", af."audioFeatureSource", af."source", 'existing') AS provider,
    GREATEST(COALESCE(t."bpmConfidence", 0), COALESCE(af."audioFeatureConfidence", 0), COALESCE(af."confidence", 0)) AS confidence
  FROM "Track" t
  LEFT JOIN "AudioFeature" af ON af."trackId" = t."id"
  WHERE t."canonicalRecordingId" IS NOT NULL
  ORDER BY t."canonicalRecordingId",
    EXISTS (SELECT 1 FROM "TrackMetadataCorrection" mc WHERE mc."trackId" = t."id" AND mc."isActive" AND mc."isVerified") DESC,
    (t."localBpm" IS NOT NULL OR af."localEnergy" IS NOT NULL OR af."localMood" IS NOT NULL) DESC,
    GREATEST(COALESCE(t."bpmConfidence", 0), COALESCE(af."audioFeatureConfidence", 0), COALESCE(af."confidence", 0)) DESC,
    t."id"
)
UPDATE "CanonicalRecording" c
SET
  "preferredEnrichmentTrackId" = r.track_id,
  "sharedEnrichment" = jsonb_strip_nulls(jsonb_build_object('bpm', r.bpm, 'energy', r.energy, 'mood', r.mood)),
  "enrichmentProvenance" = jsonb_build_object('valueSource', 'duplicate_group', 'inheritedFromTrackId', r.track_id, 'originalProvider', r.provider, 'confidence', r.confidence, 'backfilled', true),
  "updatedAt" = CURRENT_TIMESTAMP
FROM ranked r
WHERE c."id" = r.group_id;

CREATE UNIQUE INDEX "Track_plexServerId_plexLibraryId_ratingKey_key" ON "Track"("plexServerId", "plexLibraryId", "ratingKey");
CREATE INDEX "Track_canonicalRecordingId_syncStatus_idx" ON "Track"("canonicalRecordingId", "syncStatus");
CREATE INDEX "Track_libraryId_duplicateReviewStatus_idx" ON "Track"("libraryId", "duplicateReviewStatus");
CREATE INDEX "Track_libraryId_plexGuid_idx" ON "Track"("libraryId", "plexGuid");
CREATE INDEX "CanonicalRecording_libraryId_reviewStatus_idx" ON "CanonicalRecording"("libraryId", "reviewStatus");
CREATE INDEX "CanonicalRecording_libraryId_canonicalArtist_canonicalTitle_idx" ON "CanonicalRecording"("libraryId", "canonicalArtist", "canonicalTitle");
CREATE UNIQUE INDEX "PlexSyncConflict_libraryId_plexRatingKey_key" ON "PlexSyncConflict"("libraryId", "plexRatingKey");
CREATE INDEX "PlexSyncConflict_libraryId_resolutionStatus_lastDetectedAt_idx" ON "PlexSyncConflict"("libraryId", "resolutionStatus", "lastDetectedAt");
CREATE INDEX "PlexSyncConflict_trackId_idx" ON "PlexSyncConflict"("trackId");
CREATE INDEX "PlexSyncConflict_conflictReason_idx" ON "PlexSyncConflict"("conflictReason");

ALTER TABLE "CanonicalRecording" ADD CONSTRAINT "CanonicalRecording_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalRecording" ADD CONSTRAINT "CanonicalRecording_preferredEnrichmentTrackId_fkey" FOREIGN KEY ("preferredEnrichmentTrackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Track" ADD CONSTRAINT "Track_canonicalRecordingId_fkey" FOREIGN KEY ("canonicalRecordingId") REFERENCES "CanonicalRecording"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlexSyncConflict" ADD CONSTRAINT "PlexSyncConflict_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlexSyncConflict" ADD CONSTRAINT "PlexSyncConflict_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
