import axios from "axios";
import prisma from "./prisma";
import { resolveLimit, type SyncEngineOptions } from "./syncSettings";
import { syncRunsTotal, syncDurationSeconds } from "./metrics";
import {
  sanitizeOptionalMetadataString,
  sanitizeRequiredMetadataString,
} from "./metadataSanitizer";
import {
  buildTrackSyncChangeSet,
  mergeSerializedSyncChangeTypes,
  normalizePlexTrackForSync,
  serializeSyncChangeTypes,
  type ExistingTrackForSync,
  type TrackSyncChangeType,
} from "./trackSync";
import { addDuplicateCandidate, assignConfirmedDuplicateGroup, createDuplicateCandidateIndex, findBestDuplicateCandidateFromIndex, recordingFingerprint } from "./duplicateRecordings";
import { logDebug, logRateLimited } from "./logging";
import { assertStorageAvailable, resolveStoragePolicy } from "./storage";
import { sanitizeErrorText } from "./supportRedaction";

type PlexItem = Record<string, any> & {
  Genre?: Array<{ tag: string }>;
  ratingKey: string | number;
};

type PlexFetchResult = {
  items: PlexItem[];
  expectedTotal: number;
};

const stagedArtistKey = (plexId: string) => `entity:artist:${plexId}`;
const stagedAlbumKey = (plexId: string) => `entity:album:${plexId}`;

export type ReconciliationSummary = {
  syncRunId: string;
  activeTracksSeen: number;
  attempted: number;
  processed: number;
  skipped: number;
  failed: number;
  scanned: number;
  matched: number;
  newTracks: number;
  updatedMetadata: number;
  movedFiles: number;
  renamedTracks: number;
  markedMissing: number;
  restored: number;
  restoreVerificationFailures: number;
  duplicateCandidates: number;
  matchConflicts: number;
  duplicatesGrouped: number;
  duplicateDataInherited: number;
  persistenceFailures: number;
  durationMs: number;
  activeDashboardCount: number;
  hardDeleted: number;
  message: string;
  metadata: Record<string, any>;
};

export type RestoreCandidate = {
  trackId: string;
  plexRatingKey: string;
  previousSyncStatus: string;
};

type RestoreDiagnostic = RestoreCandidate & {
  libraryId: string;
  previousMissingState: boolean;
  newMissingState: boolean;
  databaseRowsChanged: number;
  syncBatchId: string;
};

function plexHeaders(accessToken: string) {
  return {
    Accept: "application/json",
    "X-Plex-Token": accessToken,
    "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr-default-client").trim(),
  };
}

function assertCompletePlexResult(items: PlexItem[], expectedTotal: number, label: string) {
  if (items.length !== expectedTotal) {
    throw new Error(`Incomplete Plex ${label} response: received ${items.length} of ${expectedTotal}`);
  }

  const identities = new Set(items.map((item) => String(item.ratingKey)));
  if (identities.size !== items.length) {
    logRateLimited("warn", `plex-duplicate-rating-key:${label}`, `Plex ${label} response returned duplicate rating keys; continuing with conservative duplicate detection`);
  }
}

// Fetches every declared page and throws on short, empty, duplicated, or changing snapshots.
// A thrown fetch never reaches reconciliation, which is the primary partial-sync safety gate.
export const fetchPlexItems = async (
  serverUri: string,
  accessToken: string,
  libraryKey: string,
  typeId: number,
  pageSize?: number,
  abortSignal?: AbortSignal | null,
): Promise<PlexFetchResult> => {
  const url = `${serverUri}/library/sections/${libraryKey}/all`;

  if (!pageSize) {
    const response = await axios.get(url, {
      params: { type: typeId },
      headers: plexHeaders(accessToken),
      signal: abortSignal || undefined,
    });
    const container = response.data?.MediaContainer;
    if (!container) throw new Error("Plex returned an invalid metadata response");
    const items = (container.Metadata || []) as PlexItem[];
    const expectedTotal = Number(container.totalSize ?? container.size ?? items.length);
    assertCompletePlexResult(items, expectedTotal, `type ${typeId}`);
    return { items, expectedTotal };
  }

  const items: PlexItem[] = [];
  let expectedTotal: number | null = null;
  let start = 0;

  while (expectedTotal === null || start < expectedTotal) {
    const response = await axios.get(url, {
      params: {
        type: typeId,
        "X-Plex-Container-Start": start,
        "X-Plex-Container-Size": pageSize,
      },
      headers: plexHeaders(accessToken),
      signal: abortSignal || undefined,
    });
    const container = response.data?.MediaContainer;
    if (!container) throw new Error("Plex returned an invalid paginated metadata response");

    const page = (container.Metadata || []) as PlexItem[];
    if (container.size !== undefined && Number(container.size) !== page.length) {
      throw new Error(`Incomplete Plex type ${typeId} response: page declared ${container.size} items but returned ${page.length}`);
    }
    if (container.totalSize === undefined && page.length >= pageSize) {
      throw new Error(`Plex omitted totalSize for a full type ${typeId} page; reconciliation skipped because more pages may exist`);
    }
    const declaredTotal = Number(container.totalSize ?? (start + page.length));
    if (expectedTotal === null) expectedTotal = declaredTotal;
    if (declaredTotal !== expectedTotal) {
      throw new Error(`Plex library changed during pagination (${expectedTotal} to ${declaredTotal}); reconciliation skipped`);
    }
    if (page.length === 0 && start < expectedTotal) {
      throw new Error(`Incomplete Plex type ${typeId} response: empty page at ${start} of ${expectedTotal}`);
    }

    items.push(...page);
    start += page.length;
  }

  const total = expectedTotal ?? 0;
  assertCompletePlexResult(items, total, `type ${typeId}`);
  return { items, expectedTotal: total };
};

/** Streams validated Plex pages to a bounded consumer without retaining them. */
export async function fetchPlexItemPages(
  serverUri: string,
  accessToken: string,
  libraryKey: string,
  typeId: number,
  pageSize: number,
  onPage: (items: PlexItem[], start: number, expectedTotal: number) => Promise<void>,
  abortSignal?: AbortSignal | null,
) {
  const url = `${serverUri}/library/sections/${libraryKey}/all`;
  let expectedTotal: number | null = null;
  let start = 0;
  while (expectedTotal === null || start < expectedTotal) {
    abortSignal?.throwIfAborted();
    const response = await axios.get(url, { params: { type: typeId, "X-Plex-Container-Start": start, "X-Plex-Container-Size": pageSize }, headers: plexHeaders(accessToken), signal: abortSignal || undefined });
    const container = response.data?.MediaContainer;
    if (!container) throw new Error("Plex returned an invalid paginated metadata response");
    const items = (container.Metadata || []) as PlexItem[];
    if (container.size !== undefined && Number(container.size) !== items.length) throw new Error(`Incomplete Plex type ${typeId} response: page declared ${container.size} items but returned ${items.length}`);
    const declaredTotal = Number(container.totalSize ?? (start + items.length));
    if (expectedTotal === null) expectedTotal = declaredTotal;
    if (declaredTotal !== expectedTotal) throw new Error(`Plex library changed during pagination (${expectedTotal} to ${declaredTotal}); reconciliation skipped`);
    if (!items.length && start < expectedTotal) throw new Error(`Incomplete Plex type ${typeId} response: empty page at ${start} of ${expectedTotal}`);
    await onPage(items, start, expectedTotal);
    abortSignal?.throwIfAborted();
    start += items.length;
  }
  if (start !== (expectedTotal || 0)) throw new Error(`Incomplete Plex type ${typeId} response: received ${start} of ${expectedTotal || 0}`);
  return { expectedTotal: expectedTotal || 0, processed: start };
}

async function processSequentially<T>(items: T[], processFn: (item: T) => Promise<void>) {
  for (const item of items) await processFn(item);
}

function normalizeTrackTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/\([^)]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^)]*\)/gi, "")
    .replace(/\[[^\]]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^\]]*\]/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameOptionalDate(value: Date | null | undefined, epochSeconds: unknown) {
  const expected = epochSeconds ? Number(epochSeconds) * 1000 : null;
  return expected === null ? value == null : value?.getTime() === expected;
}

function deriveTrackFlags(track: any) {
  const title = sanitizeRequiredMetadataString(track.title, { entity: "Track", entityId: track.ratingKey, field: "title" });
  const album = sanitizeRequiredMetadataString(track.parentTitle, { entity: "Track", entityId: track.ratingKey, field: "album" });
  const combined = `${title} ${album}`.toLowerCase();
  const sanitizedContentRating = sanitizeOptionalMetadataString(track.contentRating, { entity: "Track", entityId: track.ratingKey, field: "contentRating" });
  const contentRating = String(sanitizedContentRating || track.rating || "").toLowerCase();

  return {
    contentRating: sanitizedContentRating,
    normalizedTitle: normalizeTrackTitle(title),
    isExplicit: contentRating.includes("explicit"),
    isLive: /\b(live|concert|session|unplugged)\b/.test(combined),
    isRemaster: /\b(remaster|remastered|anniversary edition|deluxe edition)\b/.test(combined),
    isHoliday: /\b(christmas|holiday|xmas|santa|noel|hanukkah|halloween)\b/.test(combined),
    isIntroOutro: /\b(intro|outro|interlude|skit|prologue|epilogue)\b/.test(title.toLowerCase()),
  };
}

function plexMediaPath(track: any): string | null {
  const value = track.Media?.flatMap((media: any) => media.Part || []).find((part: any) => part.file)?.file;
  return sanitizeOptionalMetadataString(value, { entity: "Track", entityId: track.ratingKey, field: "mediaPath" });
}

function localFileStatusForPath(mediaPath: string | null): "available" | "missing" | "unreadable" | "unknown" {
  return mediaPath ? "unknown" : "unknown";
}

function incrementChangeCounts(counts: Record<TrackSyncChangeType, number>, changeTypes: TrackSyncChangeType[]) {
  for (const changeType of Array.from(new Set(changeTypes))) {
    counts[changeType] = (counts[changeType] || 0) + 1;
  }
}

function addEvent(events: any[], event: any, limit = 500) {
  if (events.length < limit) events.push(event);
}

function duplicateWarningLabel(kind: string) {
  if (kind === "rating_key") return "Duplicate Plex key";
  if (kind === "file_path") return "Duplicate file path";
  if (kind === "metadata") return "Duplicate metadata match";
  return "Possible duplicate track";
}

async function acquireDurableScanLock(libraryId: string, syncRunId: string) {
  const key = "plex-scan-lock:global";
  const staleBefore = new Date(Date.now() - 12 * 60 * 60_000);
  const rows = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO "SystemState" ("key", "value", "updatedAt")
    VALUES (${key}, ${syncRunId}, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP
      WHERE "SystemState"."updatedAt" < ${staleBefore}
    RETURNING "key"
  `;
  if (!rows.length) throw Object.assign(new Error("A full-library scan is already running. Mixarr permits one full scan at a time to bound memory and staging storage."), { code: "SCAN_ALREADY_RUNNING", libraryId });
  return async () => { await prisma.systemState.deleteMany({ where: { key, value: syncRunId } }).catch(() => undefined); };
}

function buildPlexSyncSummaryText(input: {
  libraryName: string;
  scanned: number;
  matched: number;
  newTracks: number;
  updatedMetadata: number;
  movedFiles: number;
  renamedTracks: number;
  markedMissing: number;
  restored: number;
  duplicateCandidates: number;
  matchConflicts: number;
  activeTrackInstances: number;
  duplicatesGrouped: number;
  duplicateDataInherited: number;
  persistenceFailures: number;
  failed: number;
  durationMs: number;
}) {
  const durationSeconds = Math.max(0, Math.round(input.durationMs / 1000));
  return `Plex sync completed for ${input.libraryName}. Plex scanned ${input.scanned.toLocaleString()}, active track instances ${input.activeTrackInstances.toLocaleString()}, existing matched ${input.matched.toLocaleString()}, new instances ${input.newTracks.toLocaleString()}, duplicates grouped ${input.duplicatesGrouped.toLocaleString()}, duplicate data inherited ${input.duplicateDataInherited.toLocaleString()}, needs review ${input.matchConflicts.toLocaleString()}, persistence failures ${input.persistenceFailures.toLocaleString()}, missing ${input.markedMissing.toLocaleString()}, duration ${durationSeconds}s.`;
}

function unseenThisRun(syncRunId: string) {
  return {
    OR: [
      { lastSeenSyncId: null },
      { lastSeenSyncId: { not: syncRunId } },
    ],
  };
}

export function seenSyncData(syncRunId: string, seenAt: Date, plexLibraryId: string) {
  return {
    plexLibraryId,
    syncStatus: "active",
    lastSeenAt: seenAt,
    lastSeenSyncId: syncRunId,
    missingSince: null,
    deletedAt: null,
  };
}

export async function reconcileCompletedLibrary(
  tx: any,
  {
    libraryId,
    syncRunId,
    seenAt,
    snapshotComplete,
    restoreCandidates = [],
    conflictProtectedTrackIds = [],
    useSeenTrackStaging = false,
  }: {
    libraryId: string;
    syncRunId: string;
    seenAt: Date;
    snapshotComplete: boolean;
    restoreCandidates?: RestoreCandidate[];
    conflictProtectedTrackIds?: string[];
    useSeenTrackStaging?: boolean;
  },
) {
  if (!snapshotComplete) {
    throw new Error("Plex snapshot did not complete; reconciliation skipped");
  }

  let restored = 0;
  let restoreVerificationFailures = 0;
  const restoreDiagnostics: RestoreDiagnostic[] = [];

  for (const candidate of restoreCandidates) {
    const update = await tx.track.updateMany({
      where: {
        id: candidate.trackId,
        libraryId,
        syncStatus: candidate.previousSyncStatus,
        ...(useSeenTrackStaging ? {} : { lastSeenSyncId: syncRunId }),
      },
      data: {
        syncStatus: "active",
        missingSince: null,
        deletedAt: null,
        syncConflictReason: null,
        duplicateWarning: null,
      },
    });
    const persisted = await tx.track.findFirst({
      where: { id: candidate.trackId, libraryId },
      select: { syncStatus: true, missingSince: true, deletedAt: true },
    });
    const verified = update.count === 1
      && persisted?.syncStatus === "active"
      && persisted.missingSince === null
      && persisted.deletedAt === null;
    const diagnostic = {
      ...candidate,
      libraryId,
      previousMissingState: candidate.previousSyncStatus !== "active",
      newMissingState: persisted?.syncStatus !== "active",
      databaseRowsChanged: update.count,
      syncBatchId: syncRunId,
    };
    if (restoreDiagnostics.length < 500 || !verified) restoreDiagnostics.push(diagnostic);

    if (verified) {
      restored += 1;
      logDebug("[SyncEngine] Restored track availability", diagnostic);
    } else {
      restoreVerificationFailures += 1;
      logRateLimited("warn", "sync-restore-verification-failed", "[SyncEngine] Restore verification failed", {
        ...diagnostic,
        expectedMissing: false,
        persistedMissing: persisted?.syncStatus !== "active",
      });
    }
  }

  const missingTracks = useSeenTrackStaging
    ? { count: await tx.$executeRaw`
        UPDATE "Track" AS track
           SET "syncStatus" = 'missing',
               "missingSince" = ${seenAt},
               "lastSyncChangeTypes" = ${serializeSyncChangeTypes(["missing_from_plex"])}
         WHERE track."libraryId" = ${libraryId}
           AND track."syncStatus" = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM "PlexScanSeenTrack" seen
              WHERE seen."scanId" = ${syncRunId}
                AND seen."libraryId" = ${libraryId}
                AND seen."plexRatingKey" = track."ratingKey"
           )
      ` }
    : await tx.track.updateMany({
        where: {
          libraryId,
          syncStatus: "active",
          ...(conflictProtectedTrackIds.length ? { id: { notIn: conflictProtectedTrackIds } } : {}),
          ...unseenThisRun(syncRunId),
        },
        data: {
          syncStatus: "missing",
          missingSince: seenAt,
          lastSyncChangeTypes: serializeSyncChangeTypes(["missing_from_plex"]),
        },
      });

  if (useSeenTrackStaging) {
    await tx.$executeRaw`
      UPDATE "Album" AS album SET "syncStatus" = 'missing', "missingSince" = ${seenAt}
       WHERE album."libraryId" = ${libraryId} AND album."syncStatus" = 'active'
         AND NOT EXISTS (SELECT 1 FROM "PlexScanSeenTrack" seen WHERE seen."scanId" = ${syncRunId} AND seen."plexRatingKey" = ('entity:album:' || album."plexId"))
    `;
    await tx.$executeRaw`
      UPDATE "Artist" AS artist SET "syncStatus" = 'missing', "missingSince" = ${seenAt}
       WHERE artist."libraryId" = ${libraryId} AND artist."syncStatus" = 'active'
         AND NOT EXISTS (SELECT 1 FROM "PlexScanSeenTrack" seen WHERE seen."scanId" = ${syncRunId} AND seen."plexRatingKey" = ('entity:artist:' || artist."plexId"))
    `;
  } else {
    await tx.album.updateMany({ where: { libraryId, syncStatus: "active", tracks: { none: { syncStatus: "active" } } }, data: { syncStatus: "missing", missingSince: seenAt } });
    await tx.artist.updateMany({ where: { libraryId, syncStatus: "active", albums: { none: { syncStatus: "active" } }, tracks: { none: { syncStatus: "active" } } }, data: { syncStatus: "missing", missingSince: seenAt } });
  }

  return {
    markedMissing: missingTracks.count,
    restored,
    restoreVerificationFailures,
    restoreDiagnostics,
    hardDeleted: 0,
  };
}

export const runSyncEngine = async (
  libraryId: string,
  options: SyncEngineOptions = {},
): Promise<ReconciliationSummary | undefined> => {
  const endTimer = syncDurationSeconds.startTimer();
  let result: "success" | "failed" = "success";
  let summary: ReconciliationSummary | undefined;
  const { getMetadataSanitizerStats, logMetadataSanitizerSummarySince } = await import("./metadataSanitizer");
  const sanitizerStatsBefore = getMetadataSanitizerStats();

  const syncLog = await prisma.syncLog.create({
    data: { libraryId, status: "in_progress" },
  });
  const syncRunId = syncLog.id;
  const seenAt = new Date();
  let releaseDurableLock: (() => Promise<void>) | null = null;

  try {
    await assertStorageAvailable("Full-library scan", true);
    releaseDurableLock = await acquireDurableScanLock(libraryId, syncRunId);
    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      include: { server: true },
    });
    if (!library) throw new Error("Library not found");

    const { server } = library;
    const plexPageSize = resolveLimit(options.plexPageSize, "PLEX_METADATA_PAGE_SIZE");
    const seenData = seenSyncData(syncRunId, seenAt, library.plexId);
    const scanPolicy = resolveStoragePolicy();

    console.log(`[SyncEngine] Starting sync ${syncRunId} for library: ${library.name}`);

    options.abortSignal?.throwIfAborted();
    const { items: plexArtists } = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 8, plexPageSize, options.abortSignal);
    console.log(`[SyncEngine] Found ${plexArtists.length} artists`);
    const plexArtistIds = new Set(plexArtists.map((artist) => sanitizeRequiredMetadataString(artist.ratingKey)));
    const stagedArtists = Array.from(plexArtistIds);
    for (let offset = 0; offset < stagedArtists.length; offset += scanPolicy.scanBatchSize) {
      await prisma.plexScanSeenTrack.createMany({ data: stagedArtists.slice(offset, offset + scanPolicy.scanBatchSize).map((plexRatingKey) => ({ scanId: syncRunId, libraryId, plexRatingKey: stagedArtistKey(plexRatingKey) })), skipDuplicates: true });
    }
    const existingArtists = await prisma.artist.findMany({ where: { libraryId }, select: { id: true, plexId: true, title: true, summary: true, thumb: true, updatedAt: true, syncStatus: true, tags: { select: { name: true } } } });
    const existingArtistMap = new Map(existingArtists.map((artist) => [artist.plexId, artist]));

    await processSequentially(plexArtists, async (artist) => {
      options.abortSignal?.throwIfAborted();
      const plexId = sanitizeRequiredMetadataString(artist.ratingKey, { entity: "Artist", entityId: artist.ratingKey, field: "plexId" });
      const title = sanitizeRequiredMetadataString(artist.title, { entity: "Artist", entityId: artist.ratingKey, field: "title" });
      const summary = sanitizeOptionalMetadataString(artist.summary, { entity: "Artist", entityId: artist.ratingKey, field: "summary" });
      const thumb = sanitizeOptionalMetadataString(artist.thumb, { entity: "Artist", entityId: artist.ratingKey, field: "thumb" });
      const tagsToConnect = (artist.Genre || []).map((genre) => sanitizeRequiredMetadataString(genre.tag, { entity: "Artist", entityId: artist.ratingKey, field: "genre" }))
        .filter(Boolean)
        .map((name) => ({
          where: { type_name: { type: "genre", name } },
          create: { type: "genre", name },
        }));
      const existing = existingArtistMap.get(plexId);
      const tagNames = tagsToConnect.map((tag) => tag.create.name).sort();
      const existingTagNames = existing?.tags.map((tag) => tag.name).sort() || [];
      const changed = !existing || existing.syncStatus !== "active" || existing.title !== title || existing.summary !== summary || existing.thumb !== thumb || !sameOptionalDate(existing.updatedAt, artist.updatedAt) || tagNames.join("\u0000") !== existingTagNames.join("\u0000");
      if (!existing) await prisma.artist.create({ data: {
          plexId,
          libraryId,
          title,
          summary,
          thumb,
          addedAt: artist.addedAt ? new Date(artist.addedAt * 1000) : undefined,
          updatedAt: artist.updatedAt ? new Date(artist.updatedAt * 1000) : undefined,
          ...seenData,
          tags: { connectOrCreate: tagsToConnect },
        } });
      else if (changed) await prisma.artist.update({ where: { id: existing.id }, data: { title, summary, thumb, updatedAt: artist.updatedAt ? new Date(artist.updatedAt * 1000) : undefined, ...seenData, tags: { connectOrCreate: tagsToConnect } } });
    });

    const dbArtists = await prisma.artist.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const artistMap = new Map(dbArtists.map((artist) => [artist.plexId, artist.id]));

    options.abortSignal?.throwIfAborted();
    const { items: plexAlbums } = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 9, plexPageSize, options.abortSignal);
    console.log(`[SyncEngine] Found ${plexAlbums.length} albums`);
    const plexAlbumIds = new Set(plexAlbums.map((album) => sanitizeRequiredMetadataString(album.ratingKey)));
    const stagedAlbums = Array.from(plexAlbumIds);
    for (let offset = 0; offset < stagedAlbums.length; offset += scanPolicy.scanBatchSize) {
      await prisma.plexScanSeenTrack.createMany({ data: stagedAlbums.slice(offset, offset + scanPolicy.scanBatchSize).map((plexRatingKey) => ({ scanId: syncRunId, libraryId, plexRatingKey: stagedAlbumKey(plexRatingKey) })), skipDuplicates: true });
    }
    const existingAlbums = await prisma.album.findMany({ where: { libraryId }, select: { id: true, plexId: true, artistId: true, title: true, summary: true, thumb: true, year: true, plexTrackCount: true, updatedAt: true, syncStatus: true } });
    const existingAlbumMap = new Map(existingAlbums.map((album) => [album.plexId, album]));

    await processSequentially(plexAlbums, async (album) => {
      options.abortSignal?.throwIfAborted();
      const parentPlexId = sanitizeOptionalMetadataString(album.parentRatingKey, { entity: "Album", entityId: album.ratingKey, field: "artistPlexId" }) || "";
      const artistId = artistMap.get(parentPlexId);
      if (!artistId || !plexArtistIds.has(parentPlexId)) {
        throw new Error(`Album ${album.ratingKey} references artist ${parentPlexId || "unknown"} absent from this Plex snapshot`);
      }
      const plexId = sanitizeRequiredMetadataString(album.ratingKey, { entity: "Album", entityId: album.ratingKey, field: "plexId" });
      const title = sanitizeRequiredMetadataString(album.title, { entity: "Album", entityId: album.ratingKey, field: "title" });
      const albumSummary = sanitizeOptionalMetadataString(album.summary, { entity: "Album", entityId: album.ratingKey, field: "summary" });
      const thumb = sanitizeOptionalMetadataString(album.thumb, { entity: "Album", entityId: album.ratingKey, field: "thumb" });
      const plexTrackCount = Number.isInteger(Number(album.leafCount)) ? Number(album.leafCount) : null;
      const existing = existingAlbumMap.get(plexId);
      const changed = !existing || existing.syncStatus !== "active" || existing.artistId !== artistId || existing.title !== title || existing.summary !== albumSummary || existing.thumb !== thumb || existing.year !== (album.year ?? null) || existing.plexTrackCount !== plexTrackCount || !sameOptionalDate(existing.updatedAt, album.updatedAt);
      if (!existing) await prisma.album.create({ data: {
          plexId,
          libraryId,
          artistId,
          title,
          summary: albumSummary,
          thumb,
          year: album.year,
          plexTrackCount,
          addedAt: album.addedAt ? new Date(album.addedAt * 1000) : undefined,
          updatedAt: album.updatedAt ? new Date(album.updatedAt * 1000) : undefined,
          ...seenData,
        } });
      else if (changed) await prisma.album.update({ where: { id: existing.id }, data: { artistId, title, summary: albumSummary, thumb, year: album.year, plexTrackCount, updatedAt: album.updatedAt ? new Date(album.updatedAt * 1000) : undefined, ...seenData } });
    });

    const dbAlbums = await prisma.album.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const albumMap = new Map(dbAlbums.map((album) => [album.plexId, album.id]));

    let plexTrackCount = 0;
    console.log(`[PlexSync] Started libraryId=${library.id} plexLibraryId=${library.plexId} name=${JSON.stringify(library.name)}`);

    const existingTrackSelect = {
        id: true,
        plexId: true,
        ratingKey: true,
        plexGuid: true,
        plexServerId: true,
        plexLibraryId: true,
        mediaPath: true,
        title: true,
        duration: true,
        trackIndex: true,
        rating: true,
        syncStatus: true,
        lastSyncChangeTypes: true,
        artistId: true,
        albumId: true,
        canonicalRecordingId: true,
        recordingFingerprint: true,
        artist: { select: { title: true } },
        album: { select: { title: true } },
      } as const;
    let existingByInstance = new Map<string, ExistingTrackForSync>();
    let duplicateCandidateIndex = createDuplicateCandidateIndex<ExistingTrackForSync>([]);
    let processedTrackCount = 0;
    const changeCounts = {
      unchanged: 0,
      new_track: 0,
      updated_metadata: 0,
      moved_file: 0,
      renamed_track: 0,
      changed_album: 0,
      changed_artist: 0,
      missing_from_plex: 0,
      restored_from_plex: 0,
      duplicate_candidate: 0,
      match_conflict: 0,
      sync_error: 0,
    } satisfies Record<TrackSyncChangeType, number>;
    const syncEvents: any[] = [];
    const conflictEvents: any[] = [];
    const duplicateEvents: any[] = [];
    const restoreCandidates: RestoreCandidate[] = [];
    let duplicatesGrouped = 0;
    let duplicatesPreserved = 0;
    let unresolvedItemsCreated = 0;
    let duplicateDataInherited = 0;
    let persistenceFailures = 0;
    const automaticallyShareDuplicateEnrichment = options.automaticallyShareDuplicateEnrichment !== false;

    const prepareTrack = (track: PlexItem) => {
      const artistPlexId = sanitizeOptionalMetadataString(track.grandparentRatingKey, { entity: "Track", entityId: track.ratingKey, field: "artistPlexId" }) || "";
      const albumPlexId = sanitizeOptionalMetadataString(track.parentRatingKey, { entity: "Track", entityId: track.ratingKey, field: "albumPlexId" }) || "";
      const artistId = artistMap.get(artistPlexId);
      const albumId = albumMap.get(albumPlexId);
      if (!artistId || !albumId || !plexArtistIds.has(artistPlexId) || !plexAlbumIds.has(albumPlexId)) throw new Error(`Track ${track.ratingKey} has a parent absent from this Plex snapshot`);
      const normalizedTrack = normalizePlexTrackForSync(track, library.plexId);
      const data = {
        plexId: normalizedTrack.plexId,
        ratingKey: normalizedTrack.ratingKey,
        plexGuid: normalizedTrack.plexGuid,
        plexGuids: normalizedTrack.plexGuids,
        mediaPath: normalizedTrack.mediaPath,
        plexServerId: server.machineIdentifier,
        plexMediaPartId: normalizedTrack.plexMediaPartId,
        fileSize: normalizedTrack.fileSize,
        fileFormat: normalizedTrack.fileFormat,
        bitrate: normalizedTrack.bitrate,
        plexMetadata: normalizedTrack.plexMetadata as any,
        recordingFingerprint: recordingFingerprint(normalizedTrack.artistTitle, normalizedTrack.title),
        localFileStatus: localFileStatusForPath(normalizedTrack.mediaPath),
        localFileCheckedAt: new Date(),
        artistId,
        albumId,
        title: normalizedTrack.title,
        duration: normalizedTrack.duration,
        trackIndex: track.index,
        rating: track.rating,
        ...deriveTrackFlags(track),
        viewCount: track.viewCount || track.playCount || 0,
        lastViewedAt: track.lastViewedAt ? new Date(track.lastViewedAt * 1000) : undefined,
        updatedAt: track.updatedAt ? new Date(track.updatedAt * 1000) : undefined,
        plexLibraryId: seenData.plexLibraryId,
        lastSeenAt: seenData.lastSeenAt,
        lastSeenSyncId: seenData.lastSeenSyncId,
      };
      return { track, artistId, albumId, normalizedTrack, data };
    };
    const processTrack = async (track: PlexItem, db: any = prisma) => {
      const { artistId, albumId, normalizedTrack, data: preparedData } = prepareTrack(track);
      // A physical Plex instance is identified only by server + library + rating key.
      // Paths, GUIDs, and metadata are duplicate evidence, never an excuse to claim or skip another row.
      const existing = existingByInstance.get(`${server.machineIdentifier}\u0000${library.plexId}\u0000${normalizedTrack.ratingKey}`) || null;
      const duplicateRelationship = findBestDuplicateCandidateFromIndex(normalizedTrack, duplicateCandidateIndex);

      const changeSet = buildTrackSyncChangeSet(existing, normalizedTrack, { artistId, albumId });
      incrementChangeCounts(changeCounts, changeSet.changeTypes);
      const data = {
        ...preparedData,
        duplicateWarning: duplicateRelationship ? (duplicateRelationship.assessment.shouldAutoGroup ? "Confirmed duplicate recording" : "Possible duplicate recording") : null,
        syncConflictReason: duplicateRelationship?.assessment.needsReview ? "ambiguous_duplicate_relationship" : null,
        lastSyncChangeTypes: serializeSyncChangeTypes(changeSet.changeTypes),
      };

      let persisted: ExistingTrackForSync;
      let unchanged = false;
      if (existing) {
        processedTrackCount += 1;
        if (existing.syncStatus === "missing" || existing.syncStatus === "match_conflict") {
          restoreCandidates.push({
            trackId: existing.id,
            plexRatingKey: normalizedTrack.ratingKey,
            previousSyncStatus: existing.syncStatus,
          });
        }
        unchanged = changeSet.changeTypes.length === 1 && changeSet.changeTypes[0] === "unchanged" && existing.syncStatus === "active" && existing.recordingFingerprint === preparedData.recordingFingerprint;
        if (!unchanged) await db.track.update({ where: { id: existing.id }, data });
        persisted = { ...existing, ...data, artist: { title: normalizedTrack.artistTitle }, album: { title: normalizedTrack.albumTitle } };
      } else {
        const created = await db.track.create({
          data: {
            ...data,
            ...seenData,
            libraryId,
            addedAt: track.addedAt ? new Date(track.addedAt * 1000) : undefined,
            plexAddedAt: track.addedAt ? new Date(track.addedAt * 1000) : undefined,
            firstSeenAt: seenAt,
          },
          select: {
            id: true,
            plexId: true,
            ratingKey: true,
            plexGuid: true,
            plexServerId: true,
            plexLibraryId: true,
            mediaPath: true,
            title: true,
            duration: true,
            trackIndex: true,
            rating: true,
            syncStatus: true,
            lastSyncChangeTypes: true,
            artistId: true,
            albumId: true,
            canonicalRecordingId: true,
            recordingFingerprint: true,
            artist: { select: { title: true } },
            album: { select: { title: true } },
          },
        });
        existingByInstance.set(`${server.machineIdentifier}\u0000${library.plexId}\u0000${normalizedTrack.ratingKey}`, created);
        addDuplicateCandidate(duplicateCandidateIndex, created);
        processedTrackCount += 1;
        persisted = created;
      }


      if (duplicateRelationship) {
        incrementChangeCounts(changeCounts, ["duplicate_candidate"]);
        const candidateId = duplicateRelationship.candidate.id!;
        const evidence = duplicateRelationship.assessment.evidence;
        addEvent(duplicateEvents, { trackId: persisted.id, plexRatingKey: normalizedTrack.ratingKey, candidateTrackId: candidateId, confidence: duplicateRelationship.assessment.confidence, evidence });
        if (duplicateRelationship.assessment.shouldAutoGroup) {
          duplicatesPreserved += 1;
          const stableGroup = persisted.canonicalRecordingId && persisted.canonicalRecordingId === duplicateRelationship.candidate.canonicalRecordingId;
          if (!stableGroup) {
            const grouped = await assignConfirmedDuplicateGroup({
              libraryId,
              trackId: persisted.id,
              candidateTrackId: candidateId,
              assessment: duplicateRelationship.assessment,
              automaticallyShare: automaticallyShareDuplicateEnrichment,
              db,
            });
            persisted.canonicalRecordingId = grouped.groupId;
            duplicateRelationship.candidate.canonicalRecordingId = grouped.groupId;
            duplicatesGrouped += 1;
            duplicateDataInherited += grouped.inherited;
          }
          await db.plexSyncConflict.updateMany({
            where: { libraryId, plexRatingKey: normalizedTrack.ratingKey, resolutionStatus: "unresolved" },
            data: { resolutionStatus: "resolved_grouped", resolvedAt: new Date(), trackId: persisted.id, lastSyncBatchId: syncRunId },
          });
          logDebug(`[PlexSync] Preserved duplicate Plex item plexRatingKey=${normalizedTrack.ratingKey} trackId=${persisted.id} duplicateGroupId=${persisted.canonicalRecordingId || "existing"} confidence=high action=created_separate_instance`);
        } else {
          unresolvedItemsCreated += 1;
          incrementChangeCounts(changeCounts, ["match_conflict"]);
          await db.track.update({
            where: { id: persisted.id },
            data: {
              duplicateConfidence: duplicateRelationship.assessment.confidence,
              duplicateMatchEvidence: evidence,
              duplicateReviewStatus: "needs_review",
              syncConflictReason: "ambiguous_duplicate_relationship",
            },
          });
          await db.plexSyncConflict.upsert({
            where: { libraryId_plexRatingKey: { libraryId, plexRatingKey: normalizedTrack.ratingKey } },
            create: {
              libraryId,
              trackId: persisted.id,
              plexRatingKey: normalizedTrack.ratingKey,
              plexGuid: normalizedTrack.plexGuid,
              conflictReason: "ambiguous_duplicate_relationship",
              candidateTrackIds: [candidateId],
              duplicateConfidence: duplicateRelationship.assessment.confidence,
              matchEvidence: evidence,
              plexMetadata: normalizedTrack.plexMetadata as any,
              resolutionStatus: "unresolved",
              lastSyncBatchId: syncRunId,
            },
            update: {
              trackId: persisted.id,
              plexGuid: normalizedTrack.plexGuid,
              conflictReason: "ambiguous_duplicate_relationship",
              candidateTrackIds: [candidateId],
              duplicateConfidence: duplicateRelationship.assessment.confidence,
              matchEvidence: evidence,
              plexMetadata: normalizedTrack.plexMetadata as any,
              resolutionStatus: "unresolved",
              lastDetectedAt: new Date(),
              lastSyncBatchId: syncRunId,
              resolvedAt: null,
            },
          });
          addEvent(conflictEvents, { trackId: persisted.id, plexRatingKey: normalizedTrack.ratingKey, reason: "ambiguous_duplicate_relationship", candidates: [candidateId], confidence: duplicateRelationship.assessment.confidence });
          logDebug(`[PlexSync] Saved unresolved Plex item for review plexRatingKey=${normalizedTrack.ratingKey} trackId=${persisted.id} reason=ambiguous_duplicate_relationship action=created_separate_instance`);
        }
      } else if (existing && !unchanged) {
        await db.plexSyncConflict.updateMany({
          where: { libraryId, plexRatingKey: normalizedTrack.ratingKey, resolutionStatus: "unresolved" },
          data: { trackId: persisted.id, resolutionStatus: "resolved_separate", resolvedAt: new Date(), lastSyncBatchId: syncRunId },
        });
      }

      if (changeSet.changeTypes.some((changeType) => changeType !== "unchanged")) {
        addEvent(syncEvents, {
          trackId: persisted.id,
          plexRatingKey: normalizedTrack.ratingKey,
          title: normalizedTrack.title,
          changeTypes: changeSet.changeTypes,
          changedFields: changeSet.changedFields,
        });
        if (changeSet.changeTypes.includes("moved_file")) {
          logDebug(`[PlexSync] Moved file path plexRatingKey=${normalizedTrack.ratingKey}`);
        }
        if (changeSet.changeTypes.includes("renamed_track") && changeSet.changedFields.title) {
          logDebug(`[PlexSync] Track renamed: ${JSON.stringify(changeSet.changedFields.title.before)} -> ${JSON.stringify(changeSet.changedFields.title.after)}`);
        }
      }
    };
    await fetchPlexItemPages(server.uri, server.accessToken, library.plexId, 10, plexPageSize || scanPolicy.scanBatchSize, async (page) => {
      options.abortSignal?.throwIfAborted();
      const prepared = page.map(prepareTrack);
      const ratingKeys = prepared.map((item) => item.normalizedTrack.ratingKey);
      const mediaPaths = prepared.map((item) => item.normalizedTrack.mediaPath).filter((value): value is string => Boolean(value));
      const plexGuids = prepared.map((item) => item.normalizedTrack.plexGuid).filter((value): value is string => Boolean(value));
      const fingerprints = prepared.map((item) => item.data.recordingFingerprint).filter((value): value is string => Boolean(value));
      const pageCandidates: ExistingTrackForSync[] = await prisma.track.findMany({
        where: { libraryId, OR: [
          { ratingKey: { in: ratingKeys } },
          ...(mediaPaths.length ? [{ mediaPath: { in: mediaPaths } }] : []),
          ...(plexGuids.length ? [{ plexGuid: { in: plexGuids } }] : []),
          ...(fingerprints.length ? [{ recordingFingerprint: { in: fingerprints } }] : []),
        ] },
        select: existingTrackSelect,
      });
      existingByInstance = new Map(pageCandidates.map((track) => [`${track.plexServerId}\u0000${track.plexLibraryId}\u0000${track.ratingKey}`, track]));
      duplicateCandidateIndex = createDuplicateCandidateIndex(pageCandidates);
      await prisma.$transaction(async (tx) => {
        const staged = await tx.plexScanSeenTrack.createMany({ data: page.map((track) => ({ scanId: syncRunId, libraryId, plexRatingKey: String(track.ratingKey) })), skipDuplicates: true });
        if (staged.count !== page.length) throw new Error("Plex returned duplicate track rating keys across metadata pages; scan reconciliation was cancelled safely.");
        const pageDuplicateIndex = createDuplicateCandidateIndex<any>([]);
        let canBulkInsert = true;
        for (const item of prepared) {
          const instanceKey = `${server.machineIdentifier}\u0000${library.plexId}\u0000${item.normalizedTrack.ratingKey}`;
          const pageComparable = { ...item.normalizedTrack, id: `incoming:${item.normalizedTrack.ratingKey}`, artist: { title: item.normalizedTrack.artistTitle }, album: { title: item.normalizedTrack.albumTitle } };
          if (existingByInstance.has(instanceKey) || findBestDuplicateCandidateFromIndex(item.normalizedTrack, duplicateCandidateIndex) || findBestDuplicateCandidateFromIndex(item.normalizedTrack, pageDuplicateIndex)) canBulkInsert = false;
          addDuplicateCandidate(pageDuplicateIndex, pageComparable);
        }
        if (canBulkInsert) {
          const created = await tx.track.createManyAndReturn({
            data: prepared.map((item) => ({ ...item.data, ...seenData, libraryId, duplicateWarning: null, syncConflictReason: null, lastSyncChangeTypes: serializeSyncChangeTypes(["new_track"]), addedAt: item.track.addedAt ? new Date(item.track.addedAt * 1000) : undefined, plexAddedAt: item.track.addedAt ? new Date(item.track.addedAt * 1000) : undefined, firstSeenAt: seenAt })),
            select: { id: true, plexId: true, ratingKey: true, plexGuid: true, plexServerId: true, plexLibraryId: true, mediaPath: true, title: true, duration: true, trackIndex: true, rating: true, syncStatus: true, lastSyncChangeTypes: true, artistId: true, albumId: true, canonicalRecordingId: true, recordingFingerprint: true },
          });
          const preparedByRatingKey = new Map(prepared.map((item) => [item.normalizedTrack.ratingKey, item]));
          for (const row of created) {
            const item = preparedByRatingKey.get(row.ratingKey)!;
            const comparable = { ...row, artist: { title: item.normalizedTrack.artistTitle }, album: { title: item.normalizedTrack.albumTitle } } as ExistingTrackForSync;
            existingByInstance.set(`${server.machineIdentifier}\u0000${library.plexId}\u0000${row.ratingKey}`, comparable); addDuplicateCandidate(duplicateCandidateIndex, comparable); processedTrackCount += 1; incrementChangeCounts(changeCounts, ["new_track"]);
            addEvent(syncEvents, { trackId: row.id, plexRatingKey: row.ratingKey, title: row.title, changeTypes: ["new_track"], changedFields: {} });
          }
        } else {
          await processSequentially(page, (track) => processTrack(track, tx));
        }
      }, { maxWait: 10_000, timeout: 120_000 });
      plexTrackCount += page.length;
      if (plexTrackCount % scanPolicy.scanProgressInterval < page.length) console.info(`[PlexSync] Progress processed=${plexTrackCount}`);
    }, options.abortSignal);
    if (plexTrackCount === 0) console.warn(`[PlexSync] Plex returned 0 tracks for libraryId=${library.id} name=${JSON.stringify(library.name)}. Check library selection and Plex connection.`);
    console.log(`[SyncEngine] Found ${plexTrackCount} tracks`);

    const duplicateRows = await prisma.$queryRaw<Array<{ id: string; kind: string; duplicateWarning: string | null; lastSyncChangeTypes: string | null }>>`
      WITH active_tracks AS (
        SELECT
          t."id",
          t."ratingKey",
          t."mediaPath",
          lower(coalesce(t."title", '')) AS title,
          lower(coalesce(ar."title", '')) AS artist,
          lower(coalesce(al."title", '')) AS album,
          coalesce(round(t."duration" / 1000.0), -1) AS duration_bucket,
          t."duplicateWarning",
          t."lastSyncChangeTypes"
        FROM "Track" t
        JOIN "Artist" ar ON ar."id" = t."artistId"
        JOIN "Album" al ON al."id" = t."albumId"
        WHERE t."libraryId" = ${libraryId}
          AND t."syncStatus" = 'active'
      ),
      duplicate_rating_keys AS (
        SELECT "ratingKey" FROM active_tracks WHERE "ratingKey" IS NOT NULL AND "ratingKey" <> '' GROUP BY "ratingKey" HAVING COUNT(*) > 1
      ),
      duplicate_paths AS (
        SELECT "mediaPath" FROM active_tracks WHERE "mediaPath" IS NOT NULL AND "mediaPath" <> '' GROUP BY "mediaPath" HAVING COUNT(*) > 1
      ),
      duplicate_metadata AS (
        SELECT artist, album, title, duration_bucket FROM active_tracks GROUP BY artist, album, title, duration_bucket HAVING COUNT(*) > 1
      )
      SELECT "id", 'rating_key' AS kind, "duplicateWarning", "lastSyncChangeTypes" FROM active_tracks WHERE "ratingKey" IN (SELECT "ratingKey" FROM duplicate_rating_keys)
      UNION
      SELECT "id", 'file_path' AS kind, "duplicateWarning", "lastSyncChangeTypes" FROM active_tracks WHERE "mediaPath" IN (SELECT "mediaPath" FROM duplicate_paths)
      UNION
      SELECT at."id", 'metadata' AS kind, at."duplicateWarning", at."lastSyncChangeTypes"
      FROM active_tracks at
      JOIN duplicate_metadata dm ON dm.artist = at.artist AND dm.album = at.album AND dm.title = at.title AND dm.duration_bucket = at.duration_bucket
    `;
    const duplicateByTrackId = new Map<string, { warning: string; duplicateWarning: string | null; lastSyncChangeTypes: string | null }>();
    for (const row of duplicateRows) {
      duplicateByTrackId.set(row.id, { warning: duplicateWarningLabel(row.kind), duplicateWarning: row.duplicateWarning, lastSyncChangeTypes: row.lastSyncChangeTypes });
    }
    if (duplicateByTrackId.size > 0) {
      await processSequentially(Array.from(duplicateByTrackId).filter(([, state]) => state.duplicateWarning !== state.warning || !String(state.lastSyncChangeTypes || "").split(",").includes("duplicate_candidate")), async ([trackId, state]) => {
        await prisma.track.update({
          where: { id: trackId },
          data: {
            duplicateWarning: state.warning,
            lastSyncChangeTypes: mergeSerializedSyncChangeTypes(
              state.lastSyncChangeTypes,
              ["duplicate_candidate"],
            ),
          },
        });
      });
      for (const [trackId, state] of Array.from(duplicateByTrackId.entries())) {
        addEvent(duplicateEvents, { trackId, reason: state.warning });
      }
      changeCounts.duplicate_candidate = Math.max(changeCounts.duplicate_candidate, duplicateByTrackId.size);
    }

    await prisma.$executeRaw`
      UPDATE "PlexSyncConflict" AS conflict
         SET "resolutionStatus" = 'resolved_not_in_plex', "resolvedAt" = CURRENT_TIMESTAMP
       WHERE conflict."libraryId" = ${libraryId}
         AND conflict."resolutionStatus" = 'unresolved'
         AND NOT EXISTS (SELECT 1 FROM "PlexScanSeenTrack" seen WHERE seen."scanId" = ${syncRunId} AND seen."plexRatingKey" = conflict."plexRatingKey")
    `;
    const reviewRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
        FROM "PlexSyncConflict" conflict
        JOIN "PlexScanSeenTrack" seen ON seen."scanId" = ${syncRunId} AND seen."plexRatingKey" = conflict."plexRatingKey"
       WHERE conflict."libraryId" = ${libraryId} AND conflict."resolutionStatus" = 'unresolved'
    `;
    const needsReviewCount = Number(reviewRows[0]?.count || 0);
    changeCounts.match_conflict = needsReviewCount;

    // Re-check scan and mount state immediately before the destructive phase.
    // Read/upsert work above is safe, but missing-item reconciliation is deferred
    // while Plex is scanning, during its grace period, or while storage is absent.
    const { plexLibraryDestructiveSafety } = await import("./integrations/service");
    const destructiveSafety = await plexLibraryDestructiveSafety(libraryId);
    const reconciliation = destructiveSafety.destructiveAllowed ? await prisma.$transaction(async (tx) => {
      const reconciled = await reconcileCompletedLibrary(tx, {
        libraryId,
        syncRunId,
        seenAt,
        snapshotComplete: true,
        restoreCandidates,
        useSeenTrackStaging: true,
      });
      await tx.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: reconciled.restoreVerificationFailures > 0 ? "warning" : "success",
          endedAt: new Date(),
          reconciliationAt: new Date(),
          snapshotComplete: true,
          plexReportedTrackCount: plexTrackCount,
          restoredTrackCount: reconciled.restored,
          unresolvedTrackCount: needsReviewCount,
          restoreVerificationFailureCount: reconciled.restoreVerificationFailures,
        },
      });
      return reconciled;
    }, { maxWait: 10_000, timeout: 120_000 }) : await prisma.$transaction(async (tx) => {
      await tx.syncLog.update({ where: { id: syncLog.id }, data: { status: "warning", endedAt: new Date(), snapshotComplete: true, plexReportedTrackCount: plexTrackCount, unresolvedTrackCount: needsReviewCount, error: destructiveSafety.reason } });
      await tx.jobHistory.create({ data: { userId: server.userId, type: "sync", name: `Deferred destructive Plex reconciliation: ${library.name}`, status: "waiting", finishedAt: new Date(), durationMs: 0, trigger: "safety_gate", summary: destructiveSafety.reason, metadata: { libraryId, syncRunId, state: destructiveSafety.state } } });
      return { markedMissing: 0, restored: 0, restoreVerificationFailures: 0, restoreDiagnostics: [], hardDeleted: 0 };
    }, { maxWait: 10_000, timeout: 120_000 });

    // The authoritative count is deliberately read after the reconciliation
    // transaction commits; it never comes from pre-restoration objects or cache.
    const activeDashboardCount = await prisma.track.count({ where: { libraryId, syncStatus: "active" } });
    const stagedEntityCount = plexArtistIds.size + plexAlbumIds.size;
    const persistedCurrentSnapshotCount = (await prisma.plexScanSeenTrack.count({ where: { libraryId, scanId: syncRunId } })) - stagedEntityCount;
    const expectedUniqueInstances = plexTrackCount;
    persistenceFailures += Math.max(0, expectedUniqueInstances - persistedCurrentSnapshotCount);
    await prisma.syncLog.update({
      where: { id: syncRunId },
      data: { activeTrackCountAfterCommit: activeDashboardCount, status: persistenceFailures > 0 ? "warning" : undefined },
    });
    const { invalidateLibraryHealthCache } = await import("./libraryHealth");
    const invalidatedHealthSnapshots = await invalidateLibraryHealthCache(server.userId, {
      libraryId,
      reason: "plex_sync_committed",
    });

    changeCounts.missing_from_plex = reconciliation.markedMissing;
    changeCounts.restored_from_plex = reconciliation.restored;
    const durationMs = Math.max(0, Date.now() - syncLog.startedAt.getTime());
    const matchedExisting = Math.max(0, processedTrackCount - changeCounts.new_track);
    const metadataUpdates = changeCounts.updated_metadata + changeCounts.changed_album + changeCounts.changed_artist;
    const summaryText = buildPlexSyncSummaryText({
      libraryName: library.name,
      scanned: plexTrackCount,
      matched: matchedExisting,
      newTracks: changeCounts.new_track,
      updatedMetadata: metadataUpdates,
      movedFiles: changeCounts.moved_file,
      renamedTracks: changeCounts.renamed_track,
      markedMissing: reconciliation.markedMissing,
      restored: changeCounts.restored_from_plex,
      duplicateCandidates: changeCounts.duplicate_candidate,
      matchConflicts: changeCounts.match_conflict,
      activeTrackInstances: activeDashboardCount,
      duplicatesGrouped,
      duplicateDataInherited,
      persistenceFailures,
      failed: persistenceFailures + reconciliation.restoreVerificationFailures,
      durationMs,
    });

    summary = {
      syncRunId,
      activeTracksSeen: plexTrackCount,
      attempted: plexTrackCount,
      processed: processedTrackCount,
      skipped: 0,
      failed: persistenceFailures + reconciliation.restoreVerificationFailures,
      scanned: plexTrackCount,
      matched: matchedExisting,
      newTracks: changeCounts.new_track,
      updatedMetadata: metadataUpdates,
      movedFiles: changeCounts.moved_file,
      renamedTracks: changeCounts.renamed_track,
      markedMissing: reconciliation.markedMissing,
      restored: changeCounts.restored_from_plex,
      restoreVerificationFailures: reconciliation.restoreVerificationFailures,
      duplicateCandidates: changeCounts.duplicate_candidate,
      matchConflicts: changeCounts.match_conflict,
      duplicatesGrouped,
      duplicateDataInherited,
      persistenceFailures,
      durationMs,
      activeDashboardCount,
      hardDeleted: reconciliation.hardDeleted,
      message: summaryText,
      metadata: {
        libraryId,
        libraryName: library.name,
        plexLibraryId: library.plexId,
        syncRunId,
        counts: {
          scanned: plexTrackCount,
          matched: matchedExisting,
          newTracks: changeCounts.new_track,
          updatedMetadata: metadataUpdates,
          movedFiles: changeCounts.moved_file,
          renamedTracks: changeCounts.renamed_track,
          changedAlbums: changeCounts.changed_album,
          changedArtists: changeCounts.changed_artist,
          markedMissing: reconciliation.markedMissing,
          restored: changeCounts.restored_from_plex,
          activeDatabaseRecords: activeDashboardCount,
          trackInstancesActive: activeDashboardCount,
          existingMatched: matchedExisting,
          newInstancesCreated: changeCounts.new_track,
          duplicatesGrouped,
          duplicateDataInherited,
          needsReview: needsReviewCount,
          persistenceFailures,
          unresolvedPlexTracks: needsReviewCount,
          restoreVerificationFailures: reconciliation.restoreVerificationFailures,
          duplicateCandidates: changeCounts.duplicate_candidate,
          matchConflicts: changeCounts.match_conflict,
          failed: persistenceFailures + reconciliation.restoreVerificationFailures,
        },
        events: syncEvents,
        duplicates: duplicateEvents,
        conflicts: conflictEvents,
        restorations: reconciliation.restoreDiagnostics,
        invalidatedHealthSnapshots,
      },
    };

    // Detection is passive and idempotent. Scoring, matching, notifications,
    // and playlist mutation only run when the user's master switch permits it.
    try {
      const { detectRecentlyAddedTracks } = await import("./recentlyAdded/detection");
      const detected = await detectRecentlyAddedTracks({ userId: server.userId, libraryId, syncLogId: syncRunId, source: "plex_sync" });
      const recentlyAddedSettings = await prisma.recentlyAddedSettings.findUnique({ where: { userId: server.userId } });
      if (recentlyAddedSettings?.enabled && detected.discovered > 0) {
        const { runRecentlyAddedAutomation } = await import("./recentlyAdded/automation");
        await runRecentlyAddedAutomation({ userId: server.userId, triggerType: "plex_sync", libraryId, scan: false });
      }
    } catch (recentlyAddedError) {
      // Plex reconciliation is already committed; an optional automation failure
      // must not rewrite a successful library sync as failed.
      console.error("[RecentlyAdded] post-sync processing failed", { libraryId, syncRunId, reason: recentlyAddedError instanceof Error ? recentlyAddedError.message : String(recentlyAddedError) });
    }

    console.log(`[SyncEngine] Reconciliation for ${library.name}:`);
    console.log(`[SyncEngine] Plex tracks scanned: ${summary.scanned}`);
    console.log(`[SyncEngine] Existing records matched: ${summary.matched}`);
    console.log(`[SyncEngine] New records created: ${summary.newTracks}`);
    console.log(`[SyncEngine] Records restored this run: ${summary.restored}`);
    console.log(`[SyncEngine] Records marked missing this run: ${summary.markedMissing}`);
    console.log(`[SyncEngine] Unresolved Plex tracks: ${summary.matchConflicts}`);
    console.log(`[SyncEngine] Active database records after commit: ${summary.activeDashboardCount}`);
    console.log(`[SyncEngine] Restore verification failures: ${summary.restoreVerificationFailures}`);
    console.log(`[PlexSync] Completed plexScanned=${summary.scanned} trackInstancesActive=${summary.activeDashboardCount} existingMatched=${summary.matched} newInstancesCreated=${summary.newTracks} duplicatesGrouped=${summary.duplicatesGrouped} duplicateDataInherited=${summary.duplicateDataInherited} needsReview=${summary.matchConflicts} persistenceFailures=${summary.persistenceFailures} missing=${summary.markedMissing} restoreVerificationFailures=${summary.restoreVerificationFailures} duration=${Math.round(summary.durationMs / 1000)}s`);
    console.info(`[PlexSync] Duplicate handling preserved=${duplicatesPreserved} grouped=${duplicatesGrouped} metadataInherited=${duplicateDataInherited}`);
    console.info(`[PlexSync] Unresolved items created=${unresolvedItemsCreated} reasons={ambiguous_duplicate_relationship:${unresolvedItemsCreated}}`);
    if (summary.hardDeleted > 0) console.log(`[SyncEngine] Hard-deleted after grace period: ${summary.hardDeleted}`);

  } catch (error: any) {
    const safeError = sanitizeErrorText(error);
    console.error("[SyncEngine] Failed; reconciliation skipped", safeError);
    result = "failed";
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", endedAt: new Date(), error: safeError },
    });
  } finally {
    if (releaseDurableLock) await prisma.$executeRawUnsafe('TRUNCATE TABLE "PlexScanSeenTrack"').catch(async () => {
      await prisma.plexScanSeenTrack.deleteMany({ where: { scanId: syncRunId } }).catch(() => undefined);
    });
    await releaseDurableLock?.();
    logMetadataSanitizerSummarySince(sanitizerStatsBefore);
    endTimer();
    syncRunsTotal.inc({ result });
  }

  return summary;
};
