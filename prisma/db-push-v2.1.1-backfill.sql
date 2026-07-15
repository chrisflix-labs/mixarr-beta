-- Idempotent v2.1.1 data backfill for Docker installations managed with
-- `prisma db push`. The normal Prisma migration performs the same work.

-- Preserve the most recent pre-v2.1.1 conflict diagnostics so administrators
-- can inspect and repair omitted Plex items after upgrading.
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
  "id", "libraryId", "plexRatingKey", "conflictReason", "candidateTrackIds",
  "resolutionStatus", "firstDetectedAt", "lastDetectedAt", "lastSyncBatchId"
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
JOIN "Library" lib ON lib."id" = l.library_id
ON CONFLICT ("libraryId", "plexRatingKey") DO NOTHING;

-- Group only existing rows with strong GUID + normalized artist/title + close
-- duration evidence. Physical Track rows are never merged or deleted.
WITH strong_groups AS (
  SELECT
    t."libraryId",
    t."plexGuid",
    lower(trim(ar."title")) AS artist_key,
    lower(trim(t."title")) AS title_key,
    round(COALESCE(t."duration", 0) / 2000.0) AS duration_bucket,
    min(ar."title") AS canonical_artist,
    min(t."title") AS canonical_title
  FROM "Track" t
  JOIN "Artist" ar ON ar."id" = t."artistId"
  WHERE t."plexGuid" IS NOT NULL AND t."plexGuid" <> ''
  GROUP BY t."libraryId", t."plexGuid", lower(trim(ar."title")), lower(trim(t."title")), round(COALESCE(t."duration", 0) / 2000.0)
  HAVING count(*) > 1
)
INSERT INTO "CanonicalRecording" (
  "id", "libraryId", "canonicalArtist", "canonicalTitle", "confidence",
  "matchEvidence", "reviewStatus", "updatedAt"
)
SELECT
  'backfill_' || md5(g."libraryId" || '|' || g."plexGuid" || '|' || g.artist_key || '|' || g.title_key || '|' || g.duration_bucket::text),
  g."libraryId",
  g.canonical_artist,
  g.canonical_title,
  'high',
  jsonb_build_object('signals', jsonb_build_array('plex_guid', 'normalized_artist_title', 'duration_within_tolerance'), 'durationToleranceMs', 2000, 'source', 'v2.1.1_db_push_backfill'),
  'confirmed',
  CURRENT_TIMESTAMP
FROM strong_groups g
ON CONFLICT ("id") DO NOTHING;

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
  "duplicateMatchEvidence" = jsonb_build_object('signals', jsonb_build_array('plex_guid', 'normalized_artist_title', 'duration_within_tolerance'), 'durationToleranceMs', 2000, 'source', 'v2.1.1_db_push_backfill')
FROM members m
JOIN "CanonicalRecording" c ON c."id" = m.group_id
WHERE t."id" = m.track_id
  AND t."canonicalRecordingId" IS NULL;

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
    EXISTS (
      SELECT 1 FROM "TrackMetadataCorrection" mc
      WHERE mc."trackId" = t."id" AND mc."isActive" AND mc."isVerified"
    ) DESC,
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
WHERE c."id" = r.group_id
  AND c."sharedEnrichment" IS NULL;
