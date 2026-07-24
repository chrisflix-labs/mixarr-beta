-- Preserve Plex mapping identity snapshots and distinguish currently discovered
-- accounts from mappings whose Plex account is temporarily unavailable.
ALTER TABLE "PlexAccount"
ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlexUserMapping"
ADD COLUMN "plexEmail" TEXT;

UPDATE "PlexUserMapping" AS mapping
SET "plexEmail" = account."email"
FROM "PlexAccount" AS account
WHERE mapping."plexAccountId" = account."id"
  AND mapping."plexEmail" IS NULL;

-- Retain every legacy mapping record, but make an accidental duplicate explicit
-- before enforcing one active Mixarr assignment per Plex account.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "serverId", "plexUserId"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS duplicate_rank
  FROM "PlexUserMapping"
  WHERE "enabled" = true
)
UPDATE "PlexUserMapping" AS mapping
SET "enabled" = false,
    "mappingState" = 'CONFLICT',
    "conflictReason" = 'This Plex account was assigned to more than one Mixarr user before duplicate protection was enabled.'
FROM ranked
WHERE mapping."id" = ranked."id"
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX "PlexUserMapping_one_active_assignment_per_account"
ON "PlexUserMapping"("serverId", "plexUserId")
WHERE "enabled" = true;
