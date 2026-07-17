import type { PlaylistOverlapResult, PlaylistTrackFact } from "./types";

function normalize(value: unknown) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalTrackKey(track: PlaylistTrackFact) {
  if (track.canonicalRecordingId) return `canonical:${track.canonicalRecordingId}`;
  const artist = normalize(track.artistName || (track as any).artist?.title || track.artistId);
  const title = normalize(track.normalizedTitle || track.title);
  if (artist && title) return `metadata:${artist}:${title}`;
  if (track.trackId) return `track:${track.trackId}`;
  if (track.ratingKey) return `plex:${track.ratingKey}`;
  return "";
}

export function artistKey(track: PlaylistTrackFact) {
  const artistName = track.artistName || (track as any).artist?.title;
  return track.artistId ? `artist:${track.artistId}` : normalize(artistName) ? `artist-name:${normalize(artistName)}` : "";
}

export function albumKey(track: PlaylistTrackFact) {
  const albumName = track.albumName || (track as any).album?.title;
  return track.albumId ? `album:${track.albumId}` : normalize(albumName) ? `album-name:${normalize(albumName)}` : "";
}

function activeFacts(tracks: PlaylistTrackFact[]) {
  return tracks.filter((track) => track.active !== false && !track.deleted && canonicalTrackKey(track));
}

function keySet(tracks: PlaylistTrackFact[], key: (track: PlaylistTrackFact) => string) {
  return new Set(tracks.map(key).filter(Boolean));
}

function intersection(left: Set<string>, right: Set<string>) {
  return Array.from(left).filter((value) => right.has(value));
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

export function calculatePlaylistOverlap(
  sourceTracks: PlaylistTrackFact[],
  targetTracks: PlaylistTrackFact[],
  sharedCoreKeys: Iterable<string> = [],
): PlaylistOverlapResult {
  const source = activeFacts(sourceTracks);
  const target = activeFacts(targetTracks);
  const sourceTrackKeys = keySet(source, canonicalTrackKey);
  const targetTrackKeys = keySet(target, canonicalTrackKey);
  const sourceArtistKeys = keySet(source, artistKey);
  const targetArtistKeys = keySet(target, artistKey);
  const sourceAlbumKeys = keySet(source, albumKey);
  const targetAlbumKeys = keySet(target, albumKey);
  const sharedTrackKeys = intersection(sourceTrackKeys, targetTrackKeys);
  const sharedArtistKeys = intersection(sourceArtistKeys, targetArtistKeys);
  const sharedAlbumKeys = intersection(sourceAlbumKeys, targetAlbumKeys);
  const unionTrackCount = new Set(Array.from(sourceTrackKeys).concat(Array.from(targetTrackKeys))).size;
  const sharedCoreSet = new Set(sharedCoreKeys);
  const sharedTrackPercentage = percent(sharedTrackKeys.length, Math.min(sourceTrackKeys.size, targetTrackKeys.size));
  const sharedArtistPercentage = percent(sharedArtistKeys.length, Math.min(sourceArtistKeys.size, targetArtistKeys.size));
  const sharedAlbumPercentage = percent(sharedAlbumKeys.length, Math.min(sourceAlbumKeys.size, targetAlbumKeys.size));
  const jaccardSimilarity = percent(sharedTrackKeys.length, unionTrackCount);
  const similarityScore = Math.round((sharedTrackPercentage * 0.65 + sharedArtistPercentage * 0.25 + sharedAlbumPercentage * 0.1) * 100) / 100;
  return {
    sourceTrackCount: sourceTrackKeys.size,
    targetTrackCount: targetTrackKeys.size,
    sharedTrackCount: sharedTrackKeys.length,
    sharedTrackPercentage,
    jaccardSimilarity,
    sourceUniqueTrackCount: sourceTrackKeys.size - sharedTrackKeys.length,
    targetUniqueTrackCount: targetTrackKeys.size - sharedTrackKeys.length,
    sharedArtistCount: sharedArtistKeys.length,
    sharedArtistPercentage,
    sharedAlbumCount: sharedAlbumKeys.length,
    sharedAlbumPercentage,
    sharedCoreTrackCount: sharedTrackKeys.filter((key) => sharedCoreSet.has(key)).length,
    similarityScore,
    sharedTrackKeys,
    sharedArtistKeys,
    sharedAlbumKeys,
    enforcementCalculation: "shared / smaller active playlist",
  };
}
