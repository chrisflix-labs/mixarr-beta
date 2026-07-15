-- Non-destructive compatibility step for installations that historically used
-- `prisma db push`. Prisma cannot express add-nullable -> backfill -> NOT NULL,
-- so prepare existing Track rows before the final schema is reconciled.
DO $$
DECLARE
  unresolved_count BIGINT;
  duplicate_identity_count BIGINT;
BEGIN
  IF to_regclass('"Track"') IS NULL THEN
    -- Fresh database: db push will create the complete schema next.
    RETURN;
  END IF;

  ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "plexServerId" TEXT;
  ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "plexLibraryId" TEXT;

  UPDATE "Track" t
  SET
    "plexServerId" = COALESCE(NULLIF(t."plexServerId", ''), s."machineIdentifier"),
    "plexLibraryId" = COALESCE(NULLIF(t."plexLibraryId", ''), l."plexId"),
    "ratingKey" = COALESCE(NULLIF(t."ratingKey", ''), t."plexId")
  FROM "Library" l
  JOIN "Server" s ON s."id" = l."serverId"
  WHERE l."id" = t."libraryId"
    AND (
      t."plexServerId" IS NULL OR t."plexServerId" = ''
      OR t."plexLibraryId" IS NULL OR t."plexLibraryId" = ''
      OR t."ratingKey" IS NULL OR t."ratingKey" = ''
    );

  SELECT count(*) INTO unresolved_count
  FROM "Track"
  WHERE "plexServerId" IS NULL OR "plexServerId" = ''
     OR "plexLibraryId" IS NULL OR "plexLibraryId" = ''
     OR "ratingKey" IS NULL OR "ratingKey" = '';

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Mixarr v2.1.1 could not derive physical Plex identity for % Track rows; no schema changes were forced',
      unresolved_count;
  END IF;

  ALTER TABLE "Track" ALTER COLUMN "plexServerId" SET NOT NULL;
  ALTER TABLE "Track" ALTER COLUMN "plexLibraryId" SET NOT NULL;

  SELECT count(*) INTO duplicate_identity_count
  FROM (
    SELECT 1
    FROM "Track"
    GROUP BY "plexServerId", "plexLibraryId", "ratingKey"
    HAVING count(*) > 1
  ) duplicate_identities;

  IF duplicate_identity_count > 0 THEN
    RAISE EXCEPTION
      'Mixarr v2.1.1 found % duplicated Plex server/library/rating-key identities; no records were changed or removed',
      duplicate_identity_count;
  END IF;

  -- Prisma db push treats every new unique constraint as potential data loss,
  -- even after the values have been verified. Creating the exact Prisma-named
  -- index here avoids requiring the broad --accept-data-loss flag.
  CREATE UNIQUE INDEX IF NOT EXISTS "Track_plexServerId_plexLibraryId_ratingKey_key"
    ON "Track"("plexServerId", "plexLibraryId", "ratingKey");
END $$;
