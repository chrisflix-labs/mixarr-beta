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

-- Mixarr Recipe Copilot per-request cost limits separate the enforcement flag
-- from the USD amount. Docker installations use db push, so perform the same
-- one-time legacy backfill as the versioned migration before schema
-- reconciliation. Existing positive limits remain enabled; zero/null become
-- disabled and cannot turn into an accidental zero-dollar block.
DO $$
DECLARE
  enabled_column_existed BOOLEAN;
BEGIN
  IF to_regclass('"AiGovernanceSetting"') IS NULL THEN
    -- Fresh database: db push creates the complete disabled-by-default model.
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AiGovernanceSetting'
      AND column_name = 'perRequestCostLimitEnabled'
  ) INTO enabled_column_existed;

  ALTER TABLE "AiGovernanceSetting"
    ADD COLUMN IF NOT EXISTS "perRequestCostLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "perRequestCostLimitUsd" DECIMAL(18,6);

  IF to_regclass('"AiProviderBudget"') IS NOT NULL THEN
    ALTER TABLE "AiProviderBudget"
      ADD COLUMN IF NOT EXISTS "perRequestCostLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "perRequestCostLimitUsd" DECIMAL(18,6);
  END IF;

  IF to_regclass('"AiUserLimit"') IS NOT NULL THEN
    ALTER TABLE "AiUserLimit"
      ADD COLUMN IF NOT EXISTS "perRequestCostLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "perRequestCostLimitUsd" DECIMAL(18,6);
  END IF;

  IF NOT enabled_column_existed THEN
    UPDATE "AiGovernanceSetting"
    SET
      "perRequestCostLimitEnabled" = COALESCE("maximumCumulativeRequestCost" > 0, false),
      "perRequestCostLimitUsd" = CASE
        WHEN "maximumCumulativeRequestCost" > 0 THEN "maximumCumulativeRequestCost"
        ELSE NULL
      END,
      "maximumCumulativeRequestCost" = CASE
        WHEN "maximumCumulativeRequestCost" > 0 THEN "maximumCumulativeRequestCost"
        ELSE NULL
      END;
  END IF;
END $$;

-- Mixarr v2.4.9 adds optional per-user idempotency keys to the existing AI
-- request audit table. Prisma warns about every new unique index during
-- `db push`, even though this newly added nullable column contains only NULLs.
-- Prepare and verify the exact index so deployment never needs the broad
-- data-loss acceptance flag.
DO $$
DECLARE
  duplicate_idempotency_count BIGINT;
BEGIN
  IF to_regclass('"AiRequestAudit"') IS NULL THEN
    -- Fresh database: db push will create the complete table and index.
    RETURN;
  END IF;

  ALTER TABLE "AiRequestAudit" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

  SELECT count(*) INTO duplicate_idempotency_count
  FROM (
    SELECT 1
    FROM "AiRequestAudit"
    WHERE "userId" IS NOT NULL
      AND "idempotencyKey" IS NOT NULL
    GROUP BY "userId", "idempotencyKey"
    HAVING count(*) > 1
  ) duplicate_keys;

  IF duplicate_idempotency_count > 0 THEN
    RAISE EXCEPTION
      'Mixarr v2.4.9 found % duplicated AI request idempotency keys; no records were changed or removed',
      duplicate_idempotency_count;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS "AiRequestAudit_userId_idempotencyKey_key"
    ON "AiRequestAudit"("userId", "idempotencyKey");
END $$;

-- Mixarr v2.3.0 adds a required, per-user unique recipe slug. Prepare it in
-- additive steps so existing Docker installations never need a broad
-- `--accept-data-loss` acknowledgement just to add the unique index.
DO $$
DECLARE
  duplicate_slug_count BIGINT;
BEGIN
  IF to_regclass('"PlaylistRecipe"') IS NULL THEN
    -- Fresh database: db push will create the complete table and index.
    RETURN;
  END IF;

  ALTER TABLE "PlaylistRecipe" ADD COLUMN IF NOT EXISTS "slug" TEXT;

  UPDATE "PlaylistRecipe"
  SET "slug" = CONCAT(
    LEFT(COALESCE(NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER("name"), '[^a-z0-9]+', '-', 'g')), ''), 'recipe'), 100),
    '-',
    LOWER("id")
  )
  WHERE "slug" IS NULL OR BTRIM("slug") = '';

  -- Preserve an already-valid slug. If a partially upgraded installation has
  -- duplicates, disambiguate only the later rows using their immutable IDs.
  WITH duplicate_slugs AS (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "userId", "slug"
      ORDER BY "id"
    ) AS occurrence
    FROM "PlaylistRecipe"
  )
  UPDATE "PlaylistRecipe" recipe
  SET "slug" = CONCAT(LEFT(recipe."slug", 100), '-', LOWER(recipe."id"))
  FROM duplicate_slugs duplicate
  WHERE recipe."id" = duplicate."id"
    AND duplicate.occurrence > 1;

  SELECT count(*) INTO duplicate_slug_count
  FROM (
    SELECT 1
    FROM "PlaylistRecipe"
    GROUP BY "userId", "slug"
    HAVING count(*) > 1
  ) duplicate_slugs;

  IF duplicate_slug_count > 0 THEN
    RAISE EXCEPTION
      'Mixarr v2.3.0 found % unresolved duplicate recipe slugs; no unique constraint was forced',
      duplicate_slug_count;
  END IF;

  ALTER TABLE "PlaylistRecipe" ALTER COLUMN "slug" SET NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS "PlaylistRecipe_userId_slug_key"
    ON "PlaylistRecipe"("userId", "slug");
END $$;
