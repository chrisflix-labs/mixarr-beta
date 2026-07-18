import type { PlaylistOverlapPolicy, PlaylistOverlapResult, PlaylistTrackFact } from "./types";

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

function artistKeys(track: PlaylistTrackFact) {
  const ids = track.creditedArtistIds || [];
  const names = track.creditedArtistNames || [];
  const keys = [artistKey(track)];
  for (const id of ids) if (id) keys.push(`artist:${id}`);
  for (const name of names) if (normalize(name)) keys.push(`artist-name:${normalize(name)}`);
  return Array.from(new Set(keys.filter(Boolean)));
}

const UNKNOWN_ALBUMS = new Set(["unknown", "unknown album", "untitled", "none", "n a"]);
const COMPILATION_ARTISTS = new Set(["various artists", "various", "compilation", "soundtrack"]);

export function albumKey(track: PlaylistTrackFact) {
  const albumName = track.albumName || (track as any).album?.title;
  const normalizedAlbum = normalize(albumName);
  if (!normalizedAlbum || UNKNOWN_ALBUMS.has(normalizedAlbum)) return "";
  const albumArtist = normalize(track.albumArtistName || (track as any).album?.artist?.title);
  if (track.isCompilation || COMPILATION_ARTISTS.has(albumArtist)) {
    const primaryArtist = artistKey(track);
    return primaryArtist ? `compilation:${normalizedAlbum}:${primaryArtist}` : "";
  }
  return track.albumId ? `album:${track.albumId}` : `album-name:${normalizedAlbum}`;
}

function activeFacts(tracks: PlaylistTrackFact[]) {
  const unique = new Map<string, PlaylistTrackFact>();
  for (const track of tracks) {
    const key = canonicalTrackKey(track);
    if (track.active === false || track.available === false || track.resolved === false || track.deleted || !key) continue;
    if (!unique.has(key)) unique.set(key, track);
  }
  return Array.from(unique.values());
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

function occurrenceCounts(tracks: PlaylistTrackFact[], key: (track: PlaylistTrackFact) => string[]) {
  const result = new Map<string, number>();
  for (const track of tracks) for (const value of key(track)) if (value) result.set(value, (result.get(value) || 0) + 1);
  return result;
}

function rankedCounts(counts: Map<string, number>, minimum = 1) {
  return Array.from(counts, ([key, count]) => ({ key, count }))
    .filter((item) => item.count >= minimum)
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function warningLevel(actual: number, maximum: number): "INFORMATIONAL" | "MODERATE" | "HIGH" | "SEVERE" {
  if (maximum <= 0) return actual > 20 ? "SEVERE" : "HIGH";
  const ratio = actual / maximum;
  return ratio >= 2 ? "SEVERE" : ratio >= 1.5 ? "HIGH" : ratio > 1 ? "MODERATE" : "INFORMATIONAL";
}

export function calculatePlaylistOverlap(
  sourceTracks: PlaylistTrackFact[],
  targetTracks: PlaylistTrackFact[],
  sharedCoreKeys: Iterable<string> = [],
  policyInput: PlaylistOverlapPolicy = {},
): PlaylistOverlapResult {
  const source = activeFacts(sourceTracks);
  const target = activeFacts(targetTracks);
  const sourceTrackKeys = keySet(source, canonicalTrackKey);
  const targetTrackKeys = keySet(target, canonicalTrackKey);
  const sourceArtistKeys = new Set(source.flatMap(artistKeys));
  const targetArtistKeys = new Set(target.flatMap(artistKeys));
  const sourcePrimaryArtistKeys = keySet(source, artistKey);
  const targetPrimaryArtistKeys = keySet(target, artistKey);
  const sourceAlbumKeys = keySet(source, albumKey);
  const targetAlbumKeys = keySet(target, albumKey);
  const sharedTrackKeys = intersection(sourceTrackKeys, targetTrackKeys);
  const sharedArtistKeys = intersection(sourceArtistKeys, targetArtistKeys);
  const sharedPrimaryArtistKeys = intersection(sourcePrimaryArtistKeys, targetPrimaryArtistKeys);
  const sharedAlbumKeys = intersection(sourceAlbumKeys, targetAlbumKeys);
  const allowedArtistSet = new Set(policyInput.allowedArtistKeys || []);
  const allowedAlbumSet = new Set(policyInput.allowedAlbumKeys || []);
  const policySharedArtistKeys = sharedArtistKeys.filter((key) => !allowedArtistSet.has(key));
  const policySharedAlbumKeys = sharedAlbumKeys.filter((key) => !allowedAlbumSet.has(key));
  const unionTrackCount = new Set(Array.from(sourceTrackKeys).concat(Array.from(targetTrackKeys))).size;
  const sharedCoreSet = new Set(sharedCoreKeys);
  const policyCoreSet = new Set(policyInput.coreTrackKeys || sharedCoreKeys);
  const allowedSharedSet = new Set(policyInput.allowedSharedTrackKeys || []);
  const exemptSharedKeys = sharedTrackKeys.filter((key) => policyCoreSet.has(key) || allowedSharedSet.has(key));
  const sharedTrackAllowance = Math.max(0, Math.floor(policyInput.sharedTrackAllowance || 0));
  const policySharedTrackCount = Math.max(0, sharedTrackKeys.length - exemptSharedKeys.length - sharedTrackAllowance);
  const maximumTrackOverlapPercent = policyInput.maximumTrackOverlapPercent ?? 20;
  const maximumArtistOverlapPercent = policyInput.maximumArtistOverlapPercent ?? 35;
  const maximumAlbumOverlapPercent = policyInput.maximumAlbumOverlapPercent ?? 25;
  const maximumSharedTrackCount = policyInput.maximumSharedTrackCount ?? null;
  const minimumUniqueTrackPercent = policyInput.minimumUniqueTrackPercent ?? 70;
  const minimumUniqueTrackCount = policyInput.minimumUniqueTrackCount ?? null;
  const smallerSize = Math.min(sourceTrackKeys.size, targetTrackKeys.size);
  const percentageAllowance = Math.floor((smallerSize * maximumTrackOverlapPercent) / 100);
  const permittedSharedCount = maximumSharedTrackCount == null ? percentageAllowance : Math.min(percentageAllowance, maximumSharedTrackCount);
  const excessSharedTrackCount = Math.max(0, policySharedTrackCount - permittedSharedCount);
  const sharedTrackPercentage = percent(sharedTrackKeys.length, Math.min(sourceTrackKeys.size, targetTrackKeys.size));
  const sharedArtistPercentage = percent(sharedArtistKeys.length, Math.min(sourceArtistKeys.size, targetArtistKeys.size));
  const sharedAlbumPercentage = percent(sharedAlbumKeys.length, Math.min(sourceAlbumKeys.size, targetAlbumKeys.size));
  const policySharedArtistPercentage = percent(policySharedArtistKeys.length, Math.min(sourceArtistKeys.size, targetArtistKeys.size));
  const policySharedAlbumPercentage = percent(policySharedAlbumKeys.length, Math.min(sourceAlbumKeys.size, targetAlbumKeys.size));
  const jaccardSimilarity = percent(sharedTrackKeys.length, unionTrackCount);
  const similarityScore = Math.round((sharedTrackPercentage * 0.65 + sharedArtistPercentage * 0.25 + sharedAlbumPercentage * 0.1) * 100) / 100;
  const combined = source.concat(target);
  const artistCounts = occurrenceCounts(combined, artistKeys);
  const albumCounts = occurrenceCounts(combined, (track) => [albumKey(track)].filter(Boolean));
  const sharedArtistSet = new Set(sharedArtistKeys);
  const sharedAlbumSet = new Set(sharedAlbumKeys);
  const tracksFromSharedArtists = combined.filter((track) => artistKeys(track).some((key) => sharedArtistSet.has(key))).length;
  const tracksFromSharedAlbums = combined.filter((track) => sharedAlbumSet.has(albumKey(track))).length;
  const excessiveArtistKeys = rankedCounts(artistCounts, 5).map((item) => item.key);
  const dominatingAlbumKeys = rankedCounts(albumCounts, 4).map((item) => item.key);
  const artistConcentrationScore = percent(Array.from(artistCounts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0), combined.length);
  const sourceUniqueTrackPercentage = percent(sourceTrackKeys.size - sharedTrackKeys.length, sourceTrackKeys.size);
  const targetUniqueTrackPercentage = percent(targetTrackKeys.size - sharedTrackKeys.length, targetTrackKeys.size);
  const uniquenessSatisfied = sourceUniqueTrackPercentage >= minimumUniqueTrackPercent
    && targetUniqueTrackPercentage >= minimumUniqueTrackPercent
    && (minimumUniqueTrackCount == null || (sourceTrackKeys.size - sharedTrackKeys.length >= minimumUniqueTrackCount && targetTrackKeys.size - sharedTrackKeys.length >= minimumUniqueTrackCount));
  const withinPolicy = excessSharedTrackCount === 0 && policySharedArtistPercentage <= maximumArtistOverlapPercent && policySharedAlbumPercentage <= maximumAlbumOverlapPercent && uniquenessSatisfied;
  const warnings: PlaylistOverlapResult["warnings"] = [];
  if (excessSharedTrackCount > 0) warnings.push({ level: warningLevel(sharedTrackPercentage, maximumTrackOverlapPercent), code: "TRACK_OVERLAP", message: `${sharedTrackPercentage}% track overlap exceeds the ${maximumTrackOverlapPercent}% limit by ${excessSharedTrackCount} track${excessSharedTrackCount === 1 ? "" : "s"}.` });
  if (policySharedArtistPercentage > maximumArtistOverlapPercent) warnings.push({ level: warningLevel(policySharedArtistPercentage, maximumArtistOverlapPercent), code: "ARTIST_CONCENTRATION", message: `${policySharedArtistPercentage}% policy-counted artist overlap exceeds the ${maximumArtistOverlapPercent}% limit.` });
  if (policySharedAlbumPercentage > maximumAlbumOverlapPercent) warnings.push({ level: warningLevel(policySharedAlbumPercentage, maximumAlbumOverlapPercent), code: "ALBUM_CONCENTRATION", message: `${policySharedAlbumPercentage}% policy-counted album overlap exceeds the ${maximumAlbumOverlapPercent}% limit.` });
  if (!uniquenessSatisfied) warnings.push({ level: "MODERATE", code: "UNIQUE_TARGET", message: `At least one playlist is below the ${minimumUniqueTrackPercent}% unique-track target.` });
  return {
    sourceTrackCount: sourceTrackKeys.size,
    targetTrackCount: targetTrackKeys.size,
    sharedTrackCount: sharedTrackKeys.length,
    sharedTrackPercentage,
    overlapPercentOfSource: percent(sharedTrackKeys.length, sourceTrackKeys.size),
    overlapPercentOfTarget: percent(sharedTrackKeys.length, targetTrackKeys.size),
    jaccardSimilarity,
    sourceUniqueTrackCount: sourceTrackKeys.size - sharedTrackKeys.length,
    targetUniqueTrackCount: targetTrackKeys.size - sharedTrackKeys.length,
    sourceUniqueTrackPercentage,
    targetUniqueTrackPercentage,
    policySharedTrackCount,
    allowedSharedTrackCount: exemptSharedKeys.length + Math.min(sharedTrackAllowance, Math.max(0, sharedTrackKeys.length - exemptSharedKeys.length)),
    excessSharedTrackCount,
    sharedArtistCount: sharedArtistKeys.length,
    sharedPrimaryArtistCount: sharedPrimaryArtistKeys.length,
    sharedArtistPercentage,
    policySharedArtistPercentage,
    tracksFromSharedArtists,
    artistConcentrationScore,
    excessiveArtistKeys,
    mostRepeatedArtists: rankedCounts(artistCounts).slice(0, 10),
    sharedAlbumCount: sharedAlbumKeys.length,
    sharedAlbumPercentage,
    policySharedAlbumPercentage,
    tracksFromSharedAlbums,
    dominatingAlbumKeys,
    mostRepeatedAlbums: rankedCounts(albumCounts).slice(0, 10),
    sharedCoreTrackCount: sharedTrackKeys.filter((key) => sharedCoreSet.has(key)).length,
    similarityScore,
    sharedTrackKeys,
    sharedArtistKeys,
    sharedAlbumKeys,
    withinPolicy,
    policy: { maximumTrackOverlapPercent, maximumArtistOverlapPercent, maximumAlbumOverlapPercent, maximumSharedTrackCount, minimumUniqueTrackPercent, minimumUniqueTrackCount },
    warnings,
    enforcementCalculation: "shared / smaller active playlist",
  };
}
