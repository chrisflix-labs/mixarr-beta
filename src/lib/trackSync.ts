import {
  sanitizeOptionalMetadataString,
  sanitizeRequiredMetadataString,
} from "./metadataSanitizer";

export type TrackSyncChangeType =
  | "unchanged"
  | "new_track"
  | "updated_metadata"
  | "moved_file"
  | "renamed_track"
  | "changed_album"
  | "changed_artist"
  | "missing_from_plex"
  | "restored_from_plex"
  | "duplicate_candidate"
  | "match_conflict"
  | "sync_error";

export type NormalizedPlexTrackForSync = {
  plexId: string;
  ratingKey: string;
  plexGuid: string | null;
  plexServerId?: string | null;
  plexLibraryId?: string | null;
  plexGuids: string[];
  librarySectionId: string;
  mediaPath: string | null;
  plexMediaPartId: string | null;
  fileSize: bigint | null;
  fileFormat: string | null;
  bitrate: number | null;
  plexMetadata: Record<string, unknown>;
  title: string;
  artistTitle: string;
  albumTitle: string;
  duration: number | null;
  trackIndex: number | null;
  rating: number | null;
  fingerprint: string;
};

export type ExistingTrackForSync = {
  id: string;
  plexId: string;
  ratingKey: string;
  plexGuid: string | null;
  plexServerId?: string | null;
  plexLibraryId?: string | null;
  mediaPath: string | null;
  title: string;
  duration: number | null;
  trackIndex?: number | null;
  rating?: number | null;
  syncStatus?: string | null;
  lastSyncChangeTypes?: string | null;
  artistId?: string | null;
  albumId?: string | null;
  canonicalRecordingId?: string | null;
  artist?: { title: string | null } | null;
  album?: { title: string | null } | null;
};

export type TrackSyncMatch =
  | { type: "new"; reason: "no_existing_match" }
  | { type: "matched"; reason: string; track: ExistingTrackForSync }
  | { type: "conflict"; reason: string; candidates: ExistingTrackForSync[] };

export type TrackSyncChangeSet = {
  changeTypes: TrackSyncChangeType[];
  changedFields: Record<string, { before: string | number | null; after: string | number | null }>;
};

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^)]*\)/gi, "")
    .replace(/\[[^\]]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^\]]*\]/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedDuration(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function firstMediaPath(track: any) {
  const value = track.Media?.flatMap((media: any) => media.Part || []).find((part: any) => part.file)?.file;
  return sanitizeOptionalMetadataString(value, { entity: "Track", entityId: track.ratingKey, field: "mediaPath" });
}

function firstMediaPart(track: any) {
  return track.Media?.flatMap((media: any) => media.Part || [])[0] || null;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function plexGuidList(track: any, primary: string | null) {
  return Array.from(new Set([
    primary,
    ...(Array.isArray(track.Guid) ? track.Guid.map((entry: any) => sanitizeOptionalMetadataString(entry?.id)) : []),
  ].filter((value): value is string => Boolean(value))));
}

function metadataKey(input: {
  title: string | null | undefined;
  artistTitle: string | null | undefined;
  albumTitle: string | null | undefined;
  duration: number | null | undefined;
}) {
  const durationBucket = input.duration == null ? "unknown" : String(Math.round(input.duration / 1000));
  return [
    normalizeText(input.artistTitle),
    normalizeText(input.albumTitle),
    normalizeText(input.title),
    durationBucket,
  ].join("|");
}

export function getTrackSyncFingerprint(track: {
  title: string | null | undefined;
  artistTitle: string | null | undefined;
  albumTitle: string | null | undefined;
  duration: number | null | undefined;
  mediaPath?: string | null | undefined;
  plexGuid?: string | null | undefined;
  ratingKey?: string | null | undefined;
}) {
  return [
    track.ratingKey || "",
    track.plexGuid || "",
    track.mediaPath || "",
    metadataKey(track),
  ].join("||");
}

export function normalizePlexTrackForSync(track: any, librarySectionId: string): NormalizedPlexTrackForSync {
  const ratingKey = sanitizeRequiredMetadataString(track.ratingKey, { entity: "Track", entityId: track.ratingKey, field: "ratingKey" });
  const title = sanitizeRequiredMetadataString(track.title, { entity: "Track", entityId: track.ratingKey, field: "title" });
  const artistTitle = sanitizeRequiredMetadataString(track.grandparentTitle, { entity: "Track", entityId: track.ratingKey, field: "artist" });
  const albumTitle = sanitizeRequiredMetadataString(track.parentTitle, { entity: "Track", entityId: track.ratingKey, field: "album" });
  const plexGuid = sanitizeOptionalMetadataString(track.guid, { entity: "Track", entityId: track.ratingKey, field: "plexGuid" });
  const mediaPath = firstMediaPath(track);
  const mediaPart = firstMediaPart(track);
  const media = track.Media?.[0] || null;
  const duration = normalizedDuration(track.duration);
  const plexGuids = plexGuidList(track, plexGuid);
  const normalized = {
    plexId: ratingKey,
    ratingKey,
    plexGuid,
    plexGuids,
    librarySectionId,
    mediaPath,
    plexMediaPartId: sanitizeOptionalMetadataString(mediaPart?.id ?? mediaPart?.key),
    fileSize: positiveInteger(mediaPart?.size) === null ? null : BigInt(positiveInteger(mediaPart?.size)!),
    fileFormat: sanitizeOptionalMetadataString(media?.container ?? mediaPart?.container),
    bitrate: positiveInteger(media?.bitrate),
    plexMetadata: {
      ratingKey,
      guid: plexGuid,
      guids: plexGuids,
      key: sanitizeOptionalMetadataString(track.key),
      title,
      artist: artistTitle,
      album: albumTitle,
      duration,
      index: positiveInteger(track.index),
      addedAt: positiveInteger(track.addedAt),
      updatedAt: positiveInteger(track.updatedAt),
      media: media ? {
        id: sanitizeOptionalMetadataString(media.id),
        container: sanitizeOptionalMetadataString(media.container),
        bitrate: positiveInteger(media.bitrate),
        audioCodec: sanitizeOptionalMetadataString(media.audioCodec),
        channels: positiveInteger(media.audioChannels),
      } : null,
      part: mediaPart ? {
        id: sanitizeOptionalMetadataString(mediaPart.id ?? mediaPart.key),
        file: mediaPath,
        size: positiveInteger(mediaPart.size),
        container: sanitizeOptionalMetadataString(mediaPart.container),
      } : null,
    },
    title,
    artistTitle,
    albumTitle,
    duration,
    trackIndex: normalizedDuration(track.index),
    rating: normalizedDuration(track.rating),
    fingerprint: "",
  };
  normalized.fingerprint = getTrackSyncFingerprint(normalized);
  return normalized;
}

export function resolvePlexTrackIdentity(track: NormalizedPlexTrackForSync) {
  return {
    ratingKey: track.ratingKey,
    plexGuid: track.plexGuid,
    libraryRatingKey: `${track.librarySectionId}:${track.ratingKey}`,
    mediaPath: track.mediaPath,
    metadataKey: metadataKey(track),
    fingerprint: track.fingerprint,
  };
}

function uniqueCandidates(candidates: ExistingTrackForSync[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function oneOrConflict(candidates: ExistingTrackForSync[], reason: string): TrackSyncMatch | null {
  const unique = uniqueCandidates(candidates);
  if (unique.length === 0) return null;
  if (unique.length === 1) return { type: "matched", reason, track: unique[0] };
  return { type: "conflict", reason, candidates: unique };
}

function safeMetadataCandidate(plexTrack: NormalizedPlexTrackForSync, candidate: ExistingTrackForSync) {
  const duration = normalizedDuration(candidate.duration);
  const durationClose = duration === null || plexTrack.duration === null || Math.abs(duration - plexTrack.duration) <= 2_000;
  return durationClose
    && normalizeText(candidate.title) === normalizeText(plexTrack.title)
    && normalizeText(candidate.artist?.title) === normalizeText(plexTrack.artistTitle)
    && normalizeText(candidate.album?.title) === normalizeText(plexTrack.albumTitle);
}

export function matchPlexTrackToExistingRecord(
  plexTrack: NormalizedPlexTrackForSync,
  existingTracks: ExistingTrackForSync[],
): TrackSyncMatch {
  const identity = resolvePlexTrackIdentity(plexTrack);

  const byRatingKey = oneOrConflict(
    existingTracks.filter((track) => track.plexId === identity.ratingKey || track.ratingKey === identity.ratingKey),
    "plex_rating_key",
  );
  if (byRatingKey) return byRatingKey;

  if (identity.mediaPath) {
    const byPath = oneOrConflict(
      existingTracks.filter((track) => track.mediaPath && track.mediaPath === identity.mediaPath),
      "file_path",
    );
    if (byPath) return byPath;
  }

  // Plex GUIDs identify media metadata, not a unique physical library item. Copies,
  // editions, and duplicate entries can legitimately share one. If the stable
  // rating key and physical path did not match, surface the GUID overlap for review
  // instead of allowing GUID (or a later metadata fallback) to claim the record.
  if (identity.plexGuid) {
    const guidCandidates = uniqueCandidates(existingTracks.filter((track) => track.plexGuid === identity.plexGuid));
    if (guidCandidates.length) {
      return { type: "conflict", reason: "plex_guid_requires_review", candidates: guidCandidates };
    }
  }

  const exactMetadata = oneOrConflict(
    existingTracks.filter((track) => metadataKey({
      title: track.title,
      artistTitle: track.artist?.title,
      albumTitle: track.album?.title,
      duration: normalizedDuration(track.duration),
    }) === identity.metadataKey),
    "metadata_fallback",
  );
  if (exactMetadata) return exactMetadata;

  const fuzzy = oneOrConflict(
    existingTracks.filter((track) => safeMetadataCandidate(plexTrack, track)),
    "safe_fuzzy_metadata",
  );
  if (fuzzy) return fuzzy;

  return { type: "new", reason: "no_existing_match" };
}

function fieldChanged(before: string | number | null | undefined, after: string | number | null | undefined) {
  return (before ?? null) !== (after ?? null);
}

function addField(
  changedFields: TrackSyncChangeSet["changedFields"],
  field: string,
  before: string | number | null | undefined,
  after: string | number | null | undefined,
) {
  if (fieldChanged(before, after)) {
    changedFields[field] = { before: before ?? null, after: after ?? null };
  }
}

export function buildTrackSyncChangeSet(
  existing: ExistingTrackForSync | null,
  plexTrack: NormalizedPlexTrackForSync,
  resolvedParentIds?: { artistId?: string | null; albumId?: string | null },
): TrackSyncChangeSet {
  if (!existing) {
    return { changeTypes: ["new_track"], changedFields: {} };
  }

  const changedFields: TrackSyncChangeSet["changedFields"] = {};
  addField(changedFields, "mediaPath", existing.mediaPath, plexTrack.mediaPath);
  addField(changedFields, "title", existing.title, plexTrack.title);
  addField(changedFields, "artist", existing.artist?.title, plexTrack.artistTitle);
  addField(changedFields, "album", existing.album?.title, plexTrack.albumTitle);
  addField(changedFields, "artistId", existing.artistId, resolvedParentIds?.artistId);
  addField(changedFields, "albumId", existing.albumId, resolvedParentIds?.albumId);
  addField(changedFields, "duration", normalizedDuration(existing.duration), plexTrack.duration);
  addField(changedFields, "trackIndex", normalizedDuration(existing.trackIndex), plexTrack.trackIndex);
  addField(changedFields, "rating", normalizedDuration(existing.rating), plexTrack.rating);

  const changeTypes: TrackSyncChangeType[] = [];
  if (changedFields.mediaPath) changeTypes.push("moved_file");
  if (changedFields.title) changeTypes.push("renamed_track");
  if (changedFields.album || changedFields.albumId) changeTypes.push("changed_album");
  if (changedFields.artist || changedFields.artistId) changeTypes.push("changed_artist");
  if (Object.keys(changedFields).some((field) => !["mediaPath", "title", "album", "artist", "albumId", "artistId"].includes(field))) {
    changeTypes.push("updated_metadata");
  }
  if (existing.syncStatus && existing.syncStatus !== "active") changeTypes.push("restored_from_plex");
  if (changeTypes.length === 0) changeTypes.push("unchanged");

  return { changeTypes: Array.from(new Set(changeTypes)), changedFields };
}

export function serializeSyncChangeTypes(changeTypes: TrackSyncChangeType[]) {
  const filtered = changeTypes.filter((type) => type !== "unchanged");
  return filtered.length ? `|${Array.from(new Set(filtered)).join("|")}|` : null;
}

export function mergeSerializedSyncChangeTypes(
  existing: string | null | undefined,
  additional: TrackSyncChangeType[],
) {
  const current = (existing || "")
    .split("|")
    .filter((value): value is TrackSyncChangeType => Boolean(value));
  return serializeSyncChangeTypes([...current, ...additional]);
}

export function syncChangeTypesContain(value: string | null | undefined, changeType: TrackSyncChangeType) {
  return typeof value === "string" && value.includes(`|${changeType}|`);
}
