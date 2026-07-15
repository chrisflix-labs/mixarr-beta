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
import { addDuplicateCandidate, assignConfirmedDuplicateGroup, createDuplicateCandidateIndex, findBestDuplicateCandidateFromIndex } from "./duplicateRecordings";

type PlexItem = Record<string, any> & {
  Genre?: Array<{ tag: string }>;
  ratingKey: string | number;
};

type PlexFetchResult = {
  items: PlexItem[];
  expectedTotal: number;
};

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
    console.warn(`Plex ${label} response returned duplicate rating keys; continuing with conservative duplicate detection`);
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
): Promise<PlexFetchResult> => {
  const url = `${serverUri}/library/sections/${libraryKey}/all`;

  if (!pageSize) {
    const response = await axios.get(url, {
      params: { type: typeId },
      headers: plexHeaders(accessToken),
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
  }: {
    libraryId: string;
    syncRunId: string;
    seenAt: Date;
    snapshotComplete: boolean;
    restoreCandidates?: RestoreCandidate[];
    conflictProtectedTrackIds?: string[];
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
        lastSeenSyncId: syncRunId,
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
      console.info("[SyncEngine] Restored track availability", diagnostic);
    } else {
      restoreVerificationFailures += 1;
      console.warn("[SyncEngine] Restore verification failed", {
        ...diagnostic,
        expectedMissing: false,
        persistedMissing: persisted?.syncStatus !== "active",
      });
    }
  }

  const missingTracks = await tx.track.updateMany({
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

  await tx.album.updateMany({
    where: { libraryId, syncStatus: "active", tracks: { none: { syncStatus: "active" } } },
    data: { syncStatus: "missing", missingSince: seenAt },
  });
  await tx.artist.updateMany({
    where: {
      libraryId,
      syncStatus: "active",
      albums: { none: { syncStatus: "active" } },
      tracks: { none: { syncStatus: "active" } },
    },
    data: { syncStatus: "missing", missingSince: seenAt },
  });

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

  const syncLog = await prisma.syncLog.create({
    data: { libraryId, status: "in_progress" },
  });
  const syncRunId = syncLog.id;
  const seenAt = new Date();

  try {
    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      include: { server: true },
    });
    if (!library) throw new Error("Library not found");

    const { server } = library;
    const plexPageSize = resolveLimit(options.plexPageSize, "PLEX_METADATA_PAGE_SIZE");
    const seenData = seenSyncData(syncRunId, seenAt, library.plexId);

    console.log(`[SyncEngine] Starting sync ${syncRunId} for library: ${library.name}`);

    const { items: plexArtists } = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 8, plexPageSize);
    console.log(`[SyncEngine] Found ${plexArtists.length} artists`);
    const plexArtistIds = new Set(plexArtists.map((artist) => sanitizeRequiredMetadataString(artist.ratingKey)));

    await processSequentially(plexArtists, async (artist) => {
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
      await prisma.artist.upsert({
        where: { libraryId_plexId: { libraryId, plexId } },
        update: {
          title,
          summary,
          thumb,
          updatedAt: artist.updatedAt ? new Date(artist.updatedAt * 1000) : undefined,
          ...seenData,
          tags: { connectOrCreate: tagsToConnect },
        },
        create: {
          plexId,
          libraryId,
          title,
          summary,
          thumb,
          addedAt: artist.addedAt ? new Date(artist.addedAt * 1000) : undefined,
          updatedAt: artist.updatedAt ? new Date(artist.updatedAt * 1000) : undefined,
          ...seenData,
          tags: { connectOrCreate: tagsToConnect },
        },
      });
    });

    const dbArtists = await prisma.artist.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const artistMap = new Map(dbArtists.map((artist) => [artist.plexId, artist.id]));

    const { items: plexAlbums } = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 9, plexPageSize);
    console.log(`[SyncEngine] Found ${plexAlbums.length} albums`);
    const plexAlbumIds = new Set(plexAlbums.map((album) => sanitizeRequiredMetadataString(album.ratingKey)));

    await processSequentially(plexAlbums, async (album) => {
      const parentPlexId = sanitizeOptionalMetadataString(album.parentRatingKey, { entity: "Album", entityId: album.ratingKey, field: "artistPlexId" }) || "";
      const artistId = artistMap.get(parentPlexId);
      if (!artistId || !plexArtistIds.has(parentPlexId)) {
        throw new Error(`Album ${album.ratingKey} references artist ${parentPlexId || "unknown"} absent from this Plex snapshot`);
      }
      const plexId = sanitizeRequiredMetadataString(album.ratingKey, { entity: "Album", entityId: album.ratingKey, field: "plexId" });
      const title = sanitizeRequiredMetadataString(album.title, { entity: "Album", entityId: album.ratingKey, field: "title" });
      const albumSummary = sanitizeOptionalMetadataString(album.summary, { entity: "Album", entityId: album.ratingKey, field: "summary" });
      const thumb = sanitizeOptionalMetadataString(album.thumb, { entity: "Album", entityId: album.ratingKey, field: "thumb" });
      await prisma.album.upsert({
        where: { libraryId_plexId: { libraryId, plexId } },
        update: {
          artistId,
          title,
          summary: albumSummary,
          thumb,
          year: album.year,
          plexTrackCount: Number.isInteger(Number(album.leafCount)) ? Number(album.leafCount) : undefined,
          updatedAt: album.updatedAt ? new Date(album.updatedAt * 1000) : undefined,
          ...seenData,
        },
        create: {
          plexId,
          libraryId,
          artistId,
          title,
          summary: albumSummary,
          thumb,
          year: album.year,
          plexTrackCount: Number.isInteger(Number(album.leafCount)) ? Number(album.leafCount) : undefined,
          addedAt: album.addedAt ? new Date(album.addedAt * 1000) : undefined,
          updatedAt: album.updatedAt ? new Date(album.updatedAt * 1000) : undefined,
          ...seenData,
        },
      });
    });

    const dbAlbums = await prisma.album.findMany({ where: { libraryId }, select: { id: true, plexId: true } });
    const albumMap = new Map(dbAlbums.map((album) => [album.plexId, album.id]));

    const { items: plexTracks } = await fetchPlexItems(server.uri, server.accessToken, library.plexId, 10, plexPageSize);
    if (plexTracks.length === 0) {
      console.warn(`[PlexSync] Plex returned 0 tracks for libraryId=${library.id} name=${JSON.stringify(library.name)}. Check library selection and Plex connection.`);
    }
    console.log(`[PlexSync] Started libraryId=${library.id} plexLibraryId=${library.plexId} name=${JSON.stringify(library.name)}`);
    console.log(`[SyncEngine] Found ${plexTracks.length} tracks`);

    const existingTracks: ExistingTrackForSync[] = await prisma.track.findMany({
      where: { libraryId },
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
        artist: { select: { title: true } },
        album: { select: { title: true } },
      },
    });
    const existingById = new Map(existingTracks.map((track) => [track.id, track]));
    const duplicateCandidateIndex = createDuplicateCandidateIndex(existingTracks);
    const matchedRecordIds = new Set<string>();
    const seenRatingKeys = new Set<string>();
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
    let duplicateDataInherited = 0;
    let persistenceFailures = 0;
    const automaticallyShareDuplicateEnrichment = options.automaticallyShareDuplicateEnrichment !== false;

    await processSequentially(plexTracks, async (track) => {
      const artistPlexId = sanitizeOptionalMetadataString(track.grandparentRatingKey, { entity: "Track", entityId: track.ratingKey, field: "artistPlexId" }) || "";
      const albumPlexId = sanitizeOptionalMetadataString(track.parentRatingKey, { entity: "Track", entityId: track.ratingKey, field: "albumPlexId" }) || "";
      const artistId = artistMap.get(artistPlexId);
      const albumId = albumMap.get(albumPlexId);
      if (!artistId || !albumId || !plexArtistIds.has(artistPlexId) || !plexAlbumIds.has(albumPlexId)) {
        throw new Error(`Track ${track.ratingKey} has a parent absent from this Plex snapshot`);
      }
      const trackFlags = deriveTrackFlags(track);
      const normalizedTrack = normalizePlexTrackForSync(track, library.plexId);
      const duplicatePlexKey = seenRatingKeys.has(normalizedTrack.ratingKey);
      seenRatingKeys.add(normalizedTrack.ratingKey);
      if (duplicatePlexKey) {
        incrementChangeCounts(changeCounts, ["sync_error"]);
        persistenceFailures += 1;
        addEvent(conflictEvents, { plexRatingKey: normalizedTrack.ratingKey, reason: "invalid_duplicate_plex_rating_key", candidates: [] });
        console.warn(`[PlexSync] Invalid duplicate rating key in Plex response plexRatingKey=${normalizedTrack.ratingKey} action=kept_first_instance`);
        return;
      }

      // A physical Plex instance is identified only by server + library + rating key.
      // Paths, GUIDs, and metadata are duplicate evidence, never an excuse to claim or skip another row.
      const identityMatches = existingTracks.filter((candidate) => candidate.plexServerId === server.machineIdentifier && candidate.plexLibraryId === library.plexId && candidate.ratingKey === normalizedTrack.ratingKey);
      const existing = identityMatches[0] || null;
      const duplicateRelationship = findBestDuplicateCandidateFromIndex(normalizedTrack, duplicateCandidateIndex);

      const changeSet = buildTrackSyncChangeSet(existing, normalizedTrack, { artistId, albumId });
      incrementChangeCounts(changeCounts, changeSet.changeTypes);
      const localFileStatus = localFileStatusForPath(normalizedTrack.mediaPath);
      const seenWithoutAvailability = {
        plexLibraryId: seenData.plexLibraryId,
        lastSeenAt: seenData.lastSeenAt,
        lastSeenSyncId: seenData.lastSeenSyncId,
      };
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
        localFileStatus,
        localFileCheckedAt: new Date(),
        artistId,
        albumId,
        title: normalizedTrack.title,
        duration: normalizedTrack.duration,
        trackIndex: track.index,
        rating: track.rating,
        duplicateWarning: duplicateRelationship ? (duplicateRelationship.assessment.shouldAutoGroup ? "Confirmed duplicate recording" : "Possible duplicate recording") : null,
        syncConflictReason: duplicateRelationship?.assessment.needsReview ? "ambiguous_duplicate_relationship" : null,
        lastSyncChangeTypes: serializeSyncChangeTypes(changeSet.changeTypes),
        ...trackFlags,
        viewCount: track.viewCount || track.playCount || 0,
        lastViewedAt: track.lastViewedAt ? new Date(track.lastViewedAt * 1000) : undefined,
        updatedAt: track.updatedAt ? new Date(track.updatedAt * 1000) : undefined,
        ...seenWithoutAvailability,
      };

      let persisted: ExistingTrackForSync;
      if (existing) {
        matchedRecordIds.add(existing.id);
        if (existing.syncStatus === "missing" || existing.syncStatus === "match_conflict") {
          restoreCandidates.push({
            trackId: existing.id,
            plexRatingKey: normalizedTrack.ratingKey,
            previousSyncStatus: existing.syncStatus,
          });
        }
        await prisma.track.update({ where: { id: existing.id }, data });
        persisted = { ...existing, ...data, artist: { title: normalizedTrack.artistTitle }, album: { title: normalizedTrack.albumTitle } };
        existingById.set(existing.id, persisted);
      } else {
        const created = await prisma.track.create({
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
            artist: { select: { title: true } },
            album: { select: { title: true } },
          },
        });
        existingTracks.push(created);
        addDuplicateCandidate(duplicateCandidateIndex, created);
        existingById.set(created.id, created);
        matchedRecordIds.add(created.id);
        persisted = created;
      }


      if (duplicateRelationship) {
        incrementChangeCounts(changeCounts, ["duplicate_candidate"]);
        const candidateId = duplicateRelationship.candidate.id!;
        const evidence = duplicateRelationship.assessment.evidence;
        addEvent(duplicateEvents, { trackId: persisted.id, plexRatingKey: normalizedTrack.ratingKey, candidateTrackId: candidateId, confidence: duplicateRelationship.assessment.confidence, evidence });
        if (duplicateRelationship.assessment.shouldAutoGroup) {
          const stableGroup = persisted.canonicalRecordingId && persisted.canonicalRecordingId === duplicateRelationship.candidate.canonicalRecordingId;
          if (!stableGroup) {
            const grouped = await assignConfirmedDuplicateGroup({
              libraryId,
              trackId: persisted.id,
              candidateTrackId: candidateId,
              assessment: duplicateRelationship.assessment,
              automaticallyShare: automaticallyShareDuplicateEnrichment,
            });
            persisted.canonicalRecordingId = grouped.groupId;
            duplicateRelationship.candidate.canonicalRecordingId = grouped.groupId;
            duplicatesGrouped += 1;
            duplicateDataInherited += grouped.inherited;
          }
          await prisma.plexSyncConflict.updateMany({
            where: { libraryId, plexRatingKey: normalizedTrack.ratingKey, resolutionStatus: "unresolved" },
            data: { resolutionStatus: "resolved_grouped", resolvedAt: new Date(), trackId: persisted.id, lastSyncBatchId: syncRunId },
          });
          console.info(`[PlexSync] Preserved duplicate Plex item plexRatingKey=${normalizedTrack.ratingKey} trackId=${persisted.id} duplicateGroupId=${persisted.canonicalRecordingId || "existing"} confidence=high action=created_separate_instance`);
        } else {
          incrementChangeCounts(changeCounts, ["match_conflict"]);
          await prisma.track.update({
            where: { id: persisted.id },
            data: {
              duplicateConfidence: duplicateRelationship.assessment.confidence,
              duplicateMatchEvidence: evidence,
              duplicateReviewStatus: "needs_review",
              syncConflictReason: "ambiguous_duplicate_relationship",
            },
          });
          await prisma.plexSyncConflict.upsert({
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
          console.info(`[PlexSync] Saved unresolved Plex item for review plexRatingKey=${normalizedTrack.ratingKey} trackId=${persisted.id} reason=ambiguous_duplicate_relationship action=created_separate_instance`);
        }
      } else {
        await prisma.plexSyncConflict.updateMany({
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
          console.log(`[PlexSync] Moved file path plexRatingKey=${normalizedTrack.ratingKey}`);
        }
        if (changeSet.changeTypes.includes("renamed_track") && changeSet.changedFields.title) {
          console.log(`[PlexSync] Track renamed: ${JSON.stringify(changeSet.changedFields.title.before)} -> ${JSON.stringify(changeSet.changedFields.title.after)}`);
        }
      }
    });

    const duplicateRows = await prisma.$queryRaw<Array<{ id: string; kind: string }>>`
      WITH active_tracks AS (
        SELECT
          t."id",
          t."ratingKey",
          t."mediaPath",
          lower(coalesce(t."title", '')) AS title,
          lower(coalesce(ar."title", '')) AS artist,
          lower(coalesce(al."title", '')) AS album,
          coalesce(round(t."duration" / 1000.0), -1) AS duration_bucket
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
      SELECT "id", 'rating_key' AS kind FROM active_tracks WHERE "ratingKey" IN (SELECT "ratingKey" FROM duplicate_rating_keys)
      UNION
      SELECT "id", 'file_path' AS kind FROM active_tracks WHERE "mediaPath" IN (SELECT "mediaPath" FROM duplicate_paths)
      UNION
      SELECT at."id", 'metadata' AS kind
      FROM active_tracks at
      JOIN duplicate_metadata dm ON dm.artist = at.artist AND dm.album = at.album AND dm.title = at.title AND dm.duration_bucket = at.duration_bucket
    `;
    const duplicateByTrackId = new Map<string, string>();
    for (const row of duplicateRows) {
      duplicateByTrackId.set(row.id, duplicateWarningLabel(row.kind));
    }
    if (duplicateByTrackId.size > 0) {
      await processSequentially(Array.from(duplicateByTrackId), async ([trackId, warning]) => {
        await prisma.track.update({
          where: { id: trackId },
          data: {
            duplicateWarning: warning,
            lastSyncChangeTypes: mergeSerializedSyncChangeTypes(
              (existingById.get(trackId) as any)?.lastSyncChangeTypes,
              ["duplicate_candidate"],
            ),
          },
        });
      });
      for (const [trackId, warning] of Array.from(duplicateByTrackId.entries())) {
        addEvent(duplicateEvents, { trackId, reason: warning });
      }
      changeCounts.duplicate_candidate = Math.max(changeCounts.duplicate_candidate, duplicateByTrackId.size);
    }

    await prisma.plexSyncConflict.updateMany({
      where: {
        libraryId,
        resolutionStatus: "unresolved",
        track: { is: { lastSeenSyncId: { not: syncRunId } } },
      },
      data: { resolutionStatus: "resolved_not_in_plex", resolvedAt: new Date() },
    });
    const needsReviewCount = await prisma.plexSyncConflict.count({
      where: { libraryId, resolutionStatus: "unresolved", track: { is: { syncStatus: "active", lastSeenSyncId: syncRunId } } },
    });
    changeCounts.match_conflict = needsReviewCount;

    // This transaction is reached only after all three complete Plex snapshots were
    // fetched and every item was successfully upserted.
    const reconciliation = await prisma.$transaction(async (tx) => {
      const reconciled = await reconcileCompletedLibrary(tx, {
        libraryId,
        syncRunId,
        seenAt,
        snapshotComplete: true,
        restoreCandidates,
      });
      await tx.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: reconciled.restoreVerificationFailures > 0 ? "warning" : "success",
          endedAt: new Date(),
          reconciliationAt: new Date(),
          snapshotComplete: true,
          plexReportedTrackCount: plexTracks.length,
          restoredTrackCount: reconciled.restored,
          unresolvedTrackCount: needsReviewCount,
          restoreVerificationFailureCount: reconciled.restoreVerificationFailures,
        },
      });
      return reconciled;
    });

    // The authoritative count is deliberately read after the reconciliation
    // transaction commits; it never comes from pre-restoration objects or cache.
    const activeDashboardCount = await prisma.track.count({ where: { libraryId, syncStatus: "active" } });
    const persistedCurrentSnapshotCount = await prisma.track.count({ where: { libraryId, syncStatus: "active", lastSeenSyncId: syncRunId } });
    const expectedUniqueInstances = new Set(plexTracks.map((item) => String(item.ratingKey))).size;
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
    const matchedExisting = Math.max(0, matchedRecordIds.size - changeCounts.new_track);
    const metadataUpdates = changeCounts.updated_metadata + changeCounts.changed_album + changeCounts.changed_artist;
    const summaryText = buildPlexSyncSummaryText({
      libraryName: library.name,
      scanned: plexTracks.length,
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
      activeTracksSeen: plexTracks.length,
      attempted: plexTracks.length,
      processed: matchedRecordIds.size,
      skipped: 0,
      failed: persistenceFailures + reconciliation.restoreVerificationFailures,
      scanned: plexTracks.length,
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
          scanned: plexTracks.length,
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
    if (summary.hardDeleted > 0) console.log(`[SyncEngine] Hard-deleted after grace period: ${summary.hardDeleted}`);

  } catch (error: any) {
    console.error(`[SyncEngine] Failed; reconciliation skipped`, error);
    result = "failed";
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", endedAt: new Date(), error: error.message },
    });
  } finally {
    endTimer();
    syncRunsTotal.inc({ result });
  }

  return summary;
};
