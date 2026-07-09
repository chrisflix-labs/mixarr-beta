import prisma from "./prisma";
import { getEffectiveBpm } from "./bpm";
import { normalizeSmartMixEngineVersion } from "./smartMixEngine/v2";
import type { PlaylistScoreSummary } from "./playlistScoring";

export const PLAYLIST_HISTORY_RETENTION_LIMIT = 500;

export type PlaylistHistoryEventType =
  | "created"
  | "regenerated"
  | "created_copy"
  | "removed_tracking"
  | "deleted_plex_playlist";

export type PlaylistHistorySourceType =
  | "manual_builder"
  | "smart_builder"
  | "recipe"
  | "regeneration"
  | "unknown";

const supportedEventTypes = new Set(["created", "regenerated", "created_copy", "removed_tracking", "deleted_plex_playlist"]);
const supportedSourceTypes = new Set(["manual_builder", "smart_builder", "recipe", "regeneration", "unknown"]);

const playlistHistoryTrackInclude = {
  artist: true,
  album: true,
  popularity: true,
  audioFeature: true,
} as const;

let playlistHistorySchemaPromise: Promise<void> | null = null;

function createHistoryId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  return `hist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function ensurePlaylistHistoryTables() {
  if (!playlistHistorySchemaPromise) {
    playlistHistorySchemaPromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PlaylistHistoryEntry" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "generatedPlaylistId" TEXT,
          "serverId" TEXT,
          "plexPlaylistRatingKey" TEXT,
          "playlistName" TEXT NOT NULL,
          "eventType" TEXT NOT NULL,
          "sourceType" TEXT NOT NULL DEFAULT 'unknown',
          "engineVersion" TEXT NOT NULL DEFAULT 'v1',
          "recipeId" TEXT,
          "recipeName" TEXT,
          "smartPresetId" TEXT,
          "smartPresetName" TEXT,
          "moodPresetId" TEXT,
          "moodPresetName" TEXT,
          "bpmPresetId" TEXT,
          "bpmPresetName" TEXT,
          "regenerationMode" TEXT,
          "keepPercent" INTEGER,
          "preferDifferentTracks" BOOLEAN NOT NULL DEFAULT false,
          "trackCount" INTEGER NOT NULL DEFAULT 0,
          "previousTrackCount" INTEGER,
          "keptCount" INTEGER,
          "replacedCount" INTEGER,
          "newCount" INTEGER,
          "removedCount" INTEGER,
          "manualExclusionsRemoved" INTEGER NOT NULL DEFAULT 0,
          "safetyRulesApplied" BOOLEAN NOT NULL DEFAULT false,
          "safetyRulesRemoved" INTEGER NOT NULL DEFAULT 0,
          "warningsJson" JSONB,
          "filtersJson" JSONB,
          "safetyRulesJson" JSONB,
          "qualityScoreJson" JSONB,
          "summary" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "PlaylistHistoryEntry_pkey" PRIMARY KEY ("id")
        )
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PlaylistHistoryTrack" (
          "id" TEXT NOT NULL,
          "historyEntryId" TEXT NOT NULL,
          "trackId" TEXT,
          "plexTrackRatingKey" TEXT,
          "position" INTEGER NOT NULL,
          "title" TEXT NOT NULL,
          "artist" TEXT,
          "album" TEXT,
          "duration" INTEGER,
          "bpm" DOUBLE PRECISION,
          "energy" DOUBLE PRECISION,
          "mood" DOUBLE PRECISION,
          "popularity" DOUBLE PRECISION,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "PlaylistHistoryTrack_pkey" PRIMARY KEY ("id")
        )
      `);

      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlaylistHistoryEntry_userId_createdAt_idx" ON "PlaylistHistoryEntry"("userId", "createdAt")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlaylistHistoryEntry_userId_eventType_createdAt_idx" ON "PlaylistHistoryEntry"("userId", "eventType", "createdAt")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlaylistHistoryEntry_userId_sourceType_createdAt_idx" ON "PlaylistHistoryEntry"("userId", "sourceType", "createdAt")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlaylistHistoryEntry_generatedPlaylistId_createdAt_idx" ON "PlaylistHistoryEntry"("generatedPlaylistId", "createdAt")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlaylistHistoryEntry_plexPlaylistRatingKey_createdAt_idx" ON "PlaylistHistoryEntry"("plexPlaylistRatingKey", "createdAt")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlaylistHistoryTrack_historyEntryId_position_idx" ON "PlaylistHistoryTrack"("historyEntryId", "position")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlaylistHistoryTrack_trackId_idx" ON "PlaylistHistoryTrack"("trackId")`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "PlaylistHistoryEntry" ADD COLUMN IF NOT EXISTS "engineVersion" TEXT NOT NULL DEFAULT 'v1'`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "PlaylistHistoryEntry" ADD COLUMN IF NOT EXISTS "qualityScoreJson" JSONB`);

      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistHistoryEntry_userId_fkey') THEN
            ALTER TABLE "PlaylistHistoryEntry" ADD CONSTRAINT "PlaylistHistoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistHistoryEntry_generatedPlaylistId_fkey') THEN
            ALTER TABLE "PlaylistHistoryEntry" ADD CONSTRAINT "PlaylistHistoryEntry_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistHistoryEntry_serverId_fkey') THEN
            ALTER TABLE "PlaylistHistoryEntry" ADD CONSTRAINT "PlaylistHistoryEntry_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistHistoryTrack_historyEntryId_fkey') THEN
            ALTER TABLE "PlaylistHistoryTrack" ADD CONSTRAINT "PlaylistHistoryTrack_historyEntryId_fkey" FOREIGN KEY ("historyEntryId") REFERENCES "PlaylistHistoryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
          END IF;
        END $$;
      `);
    })().catch((error) => {
      playlistHistorySchemaPromise = null;
      throw error;
    });
  }

  return playlistHistorySchemaPromise;
}

function normalizeEventType(eventType?: string | null): PlaylistHistoryEventType {
  return supportedEventTypes.has(eventType || "") ? eventType as PlaylistHistoryEventType : "created";
}

export function normalizePlaylistHistorySourceType(sourceType?: string | null): PlaylistHistorySourceType {
  return supportedSourceTypes.has(sourceType || "") ? sourceType as PlaylistHistorySourceType : "unknown";
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonParam(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function mapHistoryListRow(row: any) {
  const { serverName, snapshotTrackCount, ...entry } = row;
  return {
    ...entry,
    engineVersion: normalizeSmartMixEngineVersion(entry.engineVersion),
    server: serverName ? { name: serverName } : null,
    _count: { tracks: Number(snapshotTrackCount) || 0 },
  };
}

function buildHistoryWhere({
  userId,
  eventType,
  sourceType,
  playlistName,
  recipeName,
  generatedPlaylistId,
}: {
  userId: string;
  eventType?: string | null;
  sourceType?: string | null;
  playlistName?: string | null;
  recipeName?: string | null;
  generatedPlaylistId?: string | null;
}) {
  const params: unknown[] = [userId];
  const clauses = [`h."userId" = $1`];

  const addParam = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (eventType && eventType !== "all") clauses.push(`h."eventType" = ${addParam(eventType)}`);
  if (sourceType && sourceType !== "all") clauses.push(`h."sourceType" = ${addParam(sourceType)}`);
  if (generatedPlaylistId) clauses.push(`h."generatedPlaylistId" = ${addParam(generatedPlaylistId)}`);
  if (playlistName) clauses.push(`h."playlistName" ILIKE ${addParam(`%${playlistName}%`)}`);
  if (recipeName) clauses.push(`h."recipeName" ILIKE ${addParam(`%${recipeName}%`)}`);

  return { whereSql: clauses.join(" AND "), params };
}

function trackHistorySnapshot(track: any, index: number) {
  const bpm = numberOrNull(track.effectiveBpm ?? track.bpm ?? getEffectiveBpm(track) ?? track.audioFeature?.tempo);
  const energy = numberOrNull(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy ?? track.energy);
  const mood = numberOrNull(track.audioFeature?.effectiveMood ?? track.audioFeature?.valence ?? track.mood);
  const popularity = numberOrNull(track.popularity?.score ?? track.popularity);
  const duration = numberOrNull(track.duration);

  return {
    trackId: track.id || track.trackId || null,
    plexTrackRatingKey: track.ratingKey || track.plexId || track.plexTrackRatingKey || null,
    position: index + 1,
    title: track.title || "Unknown track",
    artist: track.artist?.title || track.artist || null,
    album: track.album?.title || track.album || null,
    duration: duration == null ? null : Math.max(0, Math.round(duration)),
    bpm,
    energy,
    mood,
    popularity,
  };
}

async function fetchTracksForHistory(userId: string, trackIds: string[]) {
  const uniqueIds = trackIds.filter((id, index, ids) => id && ids.indexOf(id) === index);
  if (uniqueIds.length === 0) return [];

  const tracks = await prisma.track.findMany({
    where: {
      id: { in: uniqueIds },
      library: { server: { userId } },
    },
    include: playlistHistoryTrackInclude,
  });
  const byId = new Map(tracks.map((track) => [track.id, track]));
  return trackIds.map((id) => byId.get(id)).filter(Boolean);
}

export async function prunePlaylistHistoryEntries(userId: string, retentionLimit = PLAYLIST_HISTORY_RETENTION_LIMIT) {
  if (retentionLimit <= 0) return;
  await ensurePlaylistHistoryTables();

  const staleEntries = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "PlaylistHistoryEntry" WHERE "userId" = $1 ORDER BY "createdAt" DESC OFFSET $2`,
    userId,
    retentionLimit,
  );

  if (staleEntries.length === 0) return;

  for (const entry of staleEntries) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "PlaylistHistoryEntry" WHERE "id" = $1 AND "userId" = $2`,
      entry.id,
      userId,
    );
  }
}

export async function recordPlaylistHistoryEntry({
  userId,
  generatedPlaylistId,
  serverId,
  plexPlaylistRatingKey,
  playlistName,
  eventType,
  sourceType,
  engineVersion,
  recipeId,
  recipeName,
  smartPresetId,
  smartPresetName,
  moodPresetId,
  moodPresetName,
  bpmPresetId,
  bpmPresetName,
  regenerationMode,
  keepPercent,
  preferDifferentTracks,
  trackCount,
  previousTrackCount,
  keptCount,
  replacedCount,
  newCount,
  removedCount,
  manualExclusionsRemoved,
  safetyRulesApplied,
  safetyRulesRemoved,
  warnings,
  filters,
  safetyRules,
  qualityScore,
  summary,
  tracks,
  trackIds,
}: {
  userId: string;
  generatedPlaylistId?: string | null;
  serverId?: string | null;
  plexPlaylistRatingKey?: string | null;
  playlistName: string;
  eventType: PlaylistHistoryEventType | string;
  sourceType?: PlaylistHistorySourceType | string | null;
  engineVersion?: string | null;
  recipeId?: string | null;
  recipeName?: string | null;
  smartPresetId?: string | null;
  smartPresetName?: string | null;
  moodPresetId?: string | null;
  moodPresetName?: string | null;
  bpmPresetId?: string | null;
  bpmPresetName?: string | null;
  regenerationMode?: string | null;
  keepPercent?: number | null;
  preferDifferentTracks?: boolean | null;
  trackCount?: number | null;
  previousTrackCount?: number | null;
  keptCount?: number | null;
  replacedCount?: number | null;
  newCount?: number | null;
  removedCount?: number | null;
  manualExclusionsRemoved?: number | null;
  safetyRulesApplied?: boolean | null;
  safetyRulesRemoved?: number | null;
  warnings?: unknown;
  filters?: unknown;
  safetyRules?: unknown;
  qualityScore?: PlaylistScoreSummary | null;
  summary?: string | null;
  tracks?: any[];
  trackIds?: string[];
}) {
  const snapshotTracks = tracks || (trackIds?.length ? await fetchTracksForHistory(userId, trackIds) : []);
  const createdTrackCount = trackCount ?? snapshotTracks.length;
  const normalizedTrackCount = Math.max(0, Number(createdTrackCount) || 0);
  await ensurePlaylistHistoryTables();
  const entry = await prisma.$transaction(async (tx) => {
    const entryId = createHistoryId();
    const [created] = await tx.$queryRawUnsafe<any[]>(
      `INSERT INTO "PlaylistHistoryEntry" (
        "id", "userId", "generatedPlaylistId", "serverId", "plexPlaylistRatingKey", "playlistName",
        "eventType", "sourceType", "engineVersion", "recipeId", "recipeName", "smartPresetId", "smartPresetName",
        "moodPresetId", "moodPresetName", "bpmPresetId", "bpmPresetName", "regenerationMode",
        "keepPercent", "preferDifferentTracks", "trackCount", "previousTrackCount", "keptCount",
        "replacedCount", "newCount", "removedCount", "manualExclusionsRemoved", "safetyRulesApplied",
        "safetyRulesRemoved", "warningsJson", "filtersJson", "safetyRulesJson", "qualityScoreJson", "summary"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, $26, $27, $28,
        $29, $30::jsonb, $31::jsonb, $32::jsonb, $33::jsonb, $34
      ) RETURNING *`,
      entryId,
      userId,
      generatedPlaylistId || null,
      serverId || null,
      plexPlaylistRatingKey || null,
      playlistName,
      normalizeEventType(eventType),
      normalizePlaylistHistorySourceType(sourceType),
      normalizeSmartMixEngineVersion(engineVersion),
      recipeId || null,
      recipeName || null,
      smartPresetId || null,
      smartPresetName || null,
      moodPresetId || null,
      moodPresetName || null,
      bpmPresetId || null,
      bpmPresetName || null,
      regenerationMode || null,
      keepPercent == null ? null : Math.max(0, Math.round(Number(keepPercent) || 0)),
      Boolean(preferDifferentTracks),
      normalizedTrackCount,
      previousTrackCount == null ? null : Math.max(0, Number(previousTrackCount) || 0),
      keptCount == null ? null : Math.max(0, Number(keptCount) || 0),
      replacedCount == null ? null : Math.max(0, Number(replacedCount) || 0),
      newCount == null ? null : Math.max(0, Number(newCount) || 0),
      removedCount == null ? null : Math.max(0, Number(removedCount) || 0),
      Math.max(0, Number(manualExclusionsRemoved) || 0),
      Boolean(safetyRulesApplied),
      Math.max(0, Number(safetyRulesRemoved) || 0),
      jsonParam(warnings),
      jsonParam(filters),
      jsonParam(safetyRules),
      jsonParam(qualityScore),
      summary || null,
    );

    for (const snapshot of snapshotTracks.map(trackHistorySnapshot)) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "PlaylistHistoryTrack" (
          "id", "historyEntryId", "trackId", "plexTrackRatingKey", "position", "title", "artist",
          "album", "duration", "bpm", "energy", "mood", "popularity"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        createHistoryId(),
        created.id,
        snapshot.trackId,
        snapshot.plexTrackRatingKey,
        snapshot.position,
        snapshot.title,
        snapshot.artist,
        snapshot.album,
        snapshot.duration,
        snapshot.bpm,
        snapshot.energy,
        snapshot.mood,
        snapshot.popularity,
      );
    }

    return created;
  });
  await prunePlaylistHistoryEntries(userId);
  return entry;
}

export async function getPlaylistHistory({
  userId,
  eventType,
  sourceType,
  playlistName,
  recipeName,
  generatedPlaylistId,
  limit = 50,
  offset = 0,
}: {
  userId: string;
  eventType?: string | null;
  sourceType?: string | null;
  playlistName?: string | null;
  recipeName?: string | null;
  generatedPlaylistId?: string | null;
  limit?: number;
  offset?: number;
}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const skip = Math.max(Number(offset) || 0, 0);
  await ensurePlaylistHistoryTables();
  const { whereSql, params } = buildHistoryWhere({
    userId,
    eventType,
    sourceType,
    playlistName,
    recipeName,
    generatedPlaylistId,
  });
  const takeParam = params.length + 1;
  const skipParam = params.length + 2;

  const [history, total] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT h.*, s."name" AS "serverName",
        COALESCE((SELECT COUNT(*)::int FROM "PlaylistHistoryTrack" t WHERE t."historyEntryId" = h."id"), 0) AS "snapshotTrackCount"
       FROM "PlaylistHistoryEntry" h
       LEFT JOIN "Server" s ON s."id" = h."serverId"
       WHERE ${whereSql}
       ORDER BY h."createdAt" DESC
       LIMIT $${takeParam} OFFSET $${skipParam}`,
      ...params,
      take,
      skip,
    ),
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count" FROM "PlaylistHistoryEntry" h WHERE ${whereSql}`,
      ...params,
    ),
  ]);

  return { history: history.map(mapHistoryListRow), total: Number(total[0]?.count || 0), limit: take, offset: skip };
}

export async function getPlaylistHistoryEntry(userId: string, id: string) {
  await ensurePlaylistHistoryTables();
  const [entry] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT h.*, s."name" AS "serverName",
      gp."id" AS "generatedPlaylistDbId",
      gp."plexPlaylistTitle" AS "generatedPlaylistTitle",
      gp."plexPlaylistRatingKey" AS "generatedPlaylistRatingKey",
      gp."engineVersion" AS "generatedPlaylistEngineVersion"
     FROM "PlaylistHistoryEntry" h
     LEFT JOIN "Server" s ON s."id" = h."serverId"
     LEFT JOIN "GeneratedPlaylist" gp ON gp."id" = h."generatedPlaylistId"
     WHERE h."id" = $1 AND h."userId" = $2
     LIMIT 1`,
    id,
    userId,
  );
  if (!entry) return null;

  const tracks = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "PlaylistHistoryTrack" WHERE "historyEntryId" = $1 ORDER BY "position" ASC`,
    id,
  );

  const {
    serverName,
    generatedPlaylistDbId,
    generatedPlaylistTitle,
    generatedPlaylistRatingKey,
    generatedPlaylistEngineVersion,
    ...historyEntry
  } = entry;

  return {
    ...historyEntry,
    engineVersion: normalizeSmartMixEngineVersion(historyEntry.engineVersion),
    server: serverName ? { name: serverName } : null,
    generatedPlaylist: generatedPlaylistDbId ? {
      id: generatedPlaylistDbId,
      plexPlaylistTitle: generatedPlaylistTitle,
      plexPlaylistRatingKey: generatedPlaylistRatingKey,
      engineVersion: normalizeSmartMixEngineVersion(generatedPlaylistEngineVersion),
    } : null,
    tracks,
  };
}

export async function getGeneratedPlaylistHistory(userId: string, generatedPlaylistId: string, limit = 50) {
  await ensurePlaylistHistoryTables();
  const generatedPlaylist = await prisma.generatedPlaylist.findFirst({
    where: { id: generatedPlaylistId, userId },
    select: { id: true },
  });
  if (!generatedPlaylist) return null;

  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const history = await prisma.$queryRawUnsafe<any[]>(
    `SELECT h.*, s."name" AS "serverName",
      COALESCE((SELECT COUNT(*)::int FROM "PlaylistHistoryTrack" t WHERE t."historyEntryId" = h."id"), 0) AS "snapshotTrackCount"
     FROM "PlaylistHistoryEntry" h
     LEFT JOIN "Server" s ON s."id" = h."serverId"
     WHERE h."userId" = $1 AND h."generatedPlaylistId" = $2
     ORDER BY h."createdAt" DESC
     LIMIT $3`,
    userId,
    generatedPlaylistId,
    take,
  );

  return history.map(mapHistoryListRow);
}

export async function getPlaylistHistoryDashboardSummary(userId: string) {
  await ensurePlaylistHistoryTables();
  const [count, lastEvent] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count" FROM "PlaylistHistoryEntry" WHERE "userId" = $1`,
      userId,
    ),
    prisma.$queryRawUnsafe<Array<{ playlistName: string; eventType: string; createdAt: Date }>>(
      `SELECT "playlistName", "eventType", "createdAt" FROM "PlaylistHistoryEntry" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      userId,
    ),
  ]);

  return { count: Number(count[0]?.count || 0), lastEvent: lastEvent[0] || null };
}
