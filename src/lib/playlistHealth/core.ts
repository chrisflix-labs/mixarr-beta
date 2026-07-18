import type { PlaylistHealthCheck, PlaylistHealthInput, PlaylistHealthResult, PlaylistHealthSeverity, PlaylistHealthStatus, PlaylistHealthTrack } from "./types";

const DAY_MS = 86_400_000;
const round = (value: number, digits = 0) => Number(value.toFixed(digits));
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const percent = (count: number, total: number) => total ? count / total * 100 : 0;
const normalizeConfidence = (value: number) => value <= 1 ? value * 100 : value;

function distribution(tracks: PlaylistHealthTrack[], id: (track: PlaylistHealthTrack) => string | null) {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const key = id(track);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
}

function rangeScore(values: number[], range?: [number, number] | null, target?: number | null, tolerance = 1) {
  if (!values.length || (!range && finite(target) == null)) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (range) {
    if (average >= range[0] && average <= range[1]) return 100;
    return Math.max(0, 100 - Math.min(Math.abs(average - range[0]), Math.abs(average - range[1])) / tolerance * 100);
  }
  return Math.max(0, 100 - Math.abs(average - Number(target)) / tolerance * 100);
}

function statusFor(score: number): PlaylistHealthStatus {
  return score >= 90 ? "EXCELLENT" : score >= 75 ? "GOOD" : score >= 50 ? "ATTENTION" : "CRITICAL";
}

function check(severity: PlaylistHealthSeverity, value: Omit<PlaylistHealthCheck, "severity" | "penalty"> & { penalty?: number }): PlaylistHealthCheck {
  const defaults: Record<PlaylistHealthSeverity, number> = { INFO: 2, WARNING: 7, ERROR: 14, CRITICAL: 22 };
  return { ...value, severity, penalty: value.penalty ?? defaults[severity] };
}

export function analyzePlaylistHealth(input: PlaylistHealthInput): PlaylistHealthResult {
  const { playlist, thresholds } = input;
  const now = input.now || new Date();
  const tracks = [...input.tracks].sort((left, right) => left.position - right.position);
  const checks: PlaylistHealthCheck[] = [];
  const missing = tracks.filter((track) => !track.trackId || track.present === false);
  const unavailable = tracks.filter((track) => track.trackId && track.present !== false && (
    (track.syncStatus && track.syncStatus !== "active") || ["missing", "unavailable", "inaccessible"].includes(track.localFileStatus || "")
  ));

  const brokenReasons = [
    ...(!playlist.serverId ? ["no Plex server"] : []),
    ...(!playlist.plexPlaylistRatingKey ? ["no Plex playlist identifier"] : []),
    ...(playlist.expectedTrackCount != null && playlist.expectedTrackCount !== tracks.length ? [`stored count is ${playlist.expectedTrackCount}, but ${tracks.length} rows were found`] : []),
  ];
  if (brokenReasons.length) checks.push(check(!playlist.plexPlaylistRatingKey || !playlist.serverId ? "CRITICAL" : "ERROR", {
    type: "BROKEN_PLEX_PLAYLIST", title: "Broken Plex playlist link", message: `Mixarr cannot fully verify this Plex playlist: ${brokenReasons.join("; ")}.`,
    details: { reasons: brokenReasons },
  }));
  if (missing.length) checks.push(check(missing.length >= 3 ? "ERROR" : "WARNING", {
    type: "MISSING_TRACKS", title: "Missing tracks", message: `${missing.length} playlist track${missing.length === 1 ? " is" : "s are"} no longer matched to the library.`, value: missing.length,
    details: { tracks: missing.slice(0, 25).map((track) => ({ position: track.position, title: track.title, artist: track.artist })) },
  }));
  if (unavailable.length) checks.push(check(unavailable.length >= 3 ? "ERROR" : "WARNING", {
    type: "UNAVAILABLE_MEDIA", title: "Unavailable media", message: `${unavailable.length} track${unavailable.length === 1 ? " is" : "s are"} unavailable for playback.`, value: unavailable.length,
    details: { tracks: unavailable.slice(0, 25).map((track) => ({ position: track.position, title: track.title, status: track.syncStatus || track.localFileStatus })) },
  }));

  const recordingCounts = distribution(tracks, (track) => track.trackId || track.ratingKey || null);
  const duplicateOccurrences = recordingCounts.reduce((sum, [, count]) => sum + Math.max(0, count - 1), 0);
  let longestArtistRun = 0;
  let currentRun = 0;
  let previousArtist = "";
  for (const track of tracks) {
    const artist = track.artistId || track.artist || "";
    currentRun = artist && artist === previousArtist ? currentRun + 1 : 1;
    previousArtist = artist;
    longestArtistRun = Math.max(longestArtistRun, currentRun);
  }
  if (duplicateOccurrences || longestArtistRun >= 4) checks.push(check(duplicateOccurrences >= 3 ? "ERROR" : "WARNING", {
    type: "TRACK_REPETITION", title: "Repetition increased", message: duplicateOccurrences
      ? `${duplicateOccurrences} repeated track occurrence${duplicateOccurrences === 1 ? " was" : "s were"} detected${longestArtistRun >= 4 ? `, with an artist run of ${longestArtistRun}` : ""}.`
      : `${longestArtistRun} consecutive tracks use the same artist.`,
    value: duplicateOccurrences, details: { duplicateOccurrences, longestArtistRun },
  }));

  const artists = distribution(tracks, (track) => track.artistId || track.artist || null);
  const albums = distribution(tracks, (track) => track.albumId || (track.album ? `${track.artist || ""}:${track.album}` : null));
  const largestArtistShare = percent(artists[0]?.[1] || 0, tracks.length);
  const largestAlbumShare = percent(albums[0]?.[1] || 0, tracks.length);
  if (tracks.length >= 5 && largestArtistShare > thresholds.artistConcentrationPercent) checks.push(check(largestArtistShare >= 50 ? "ERROR" : "WARNING", {
    type: "ARTIST_CONCENTRATION", title: "Artist concentration is high", message: `${round(largestArtistShare)}% of tracks come from one artist.`, value: round(largestArtistShare), threshold: thresholds.artistConcentrationPercent,
    details: { topArtist: artists[0]?.[0], count: artists[0]?.[1] },
  }));
  if (tracks.length >= 5 && largestAlbumShare > thresholds.albumConcentrationPercent) checks.push(check(largestAlbumShare >= 40 ? "ERROR" : "WARNING", {
    type: "ALBUM_CONCENTRATION", title: "Album concentration is high", message: `${round(largestAlbumShare)}% of tracks come from one album.`, value: round(largestAlbumShare), threshold: thresholds.albumConcentrationPercent,
    details: { topAlbum: albums[0]?.[0], count: albums[0]?.[1] },
  }));

  const confidences = tracks.map((track) => finite(track.metadataConfidence)).filter((value): value is number => value != null).map(normalizeConfidence);
  const metadataConfidence = confidences.length ? round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length, 1) : null;
  const previousConfidence = finite(input.previousMetadataConfidence);
  const confidenceDecline = metadataConfidence != null && previousConfidence != null ? previousConfidence - metadataConfidence : 0;
  if (confidenceDecline >= thresholds.metadataDeclinePercent) checks.push(check(confidenceDecline >= 25 ? "ERROR" : "WARNING", {
    type: "METADATA_CONFIDENCE_DECLINE", title: "Metadata confidence declined", message: `Average metadata confidence fell ${round(confidenceDecline, 1)} points to ${metadataConfidence}%.`, value: round(confidenceDecline, 1), threshold: thresholds.metadataDeclinePercent,
    details: { previous: previousConfidence, current: metadataConfidence, measuredTracks: confidences.length },
  }));

  const bpmJumps: Array<{ from: number; to: number; delta: number }> = [];
  const moodConflicts: Array<{ from: number; to: number; delta: number }> = [];
  for (let index = 1; index < tracks.length; index += 1) {
    const previousBpm = finite(tracks[index - 1].bpm); const bpm = finite(tracks[index].bpm);
    if (previousBpm != null && bpm != null && Math.abs(previousBpm - bpm) > thresholds.excessiveBpmJump) bpmJumps.push({ from: index - 1, to: index, delta: round(Math.abs(previousBpm - bpm), 1) });
    const previousMood = finite(tracks[index - 1].mood); const mood = finite(tracks[index].mood);
    if (previousMood != null && mood != null && Math.abs(previousMood - mood) > thresholds.moodConflictDelta) moodConflicts.push({ from: index - 1, to: index, delta: round(Math.abs(previousMood - mood), 2) });
  }
  if (bpmJumps.length) checks.push(check(bpmJumps.length >= Math.max(3, Math.ceil(tracks.length * .15)) ? "ERROR" : "WARNING", {
    type: "EXCESSIVE_BPM_JUMPS", title: "Excessive BPM jumps", message: `${bpmJumps.length} transition${bpmJumps.length === 1 ? " exceeds" : "s exceed"} the ${thresholds.excessiveBpmJump} BPM limit.`, value: bpmJumps.length, threshold: thresholds.excessiveBpmJump, details: { transitions: bpmJumps.slice(0, 25) },
  }));
  if (moodConflicts.length) checks.push(check(moodConflicts.length >= Math.max(3, Math.ceil(tracks.length * .15)) ? "ERROR" : "WARNING", {
    type: "MOOD_CONFLICTS", title: "Mood conflicts", message: `${moodConflicts.length} adjacent transition${moodConflicts.length === 1 ? " has" : "s have"} a strong mood conflict.`, value: moodConflicts.length, threshold: thresholds.moodConflictDelta, details: { transitions: moodConflicts.slice(0, 25) },
  }));

  const profile = input.identityProfile;
  const bpms = tracks.map((track) => finite(track.bpm)).filter((value): value is number => value != null);
  const energies = tracks.map((track) => finite(track.energy)).filter((value): value is number => value != null);
  const targetMoods = new Set(Object.entries(profile?.moodDistribution || {}).sort((left, right) => right[1] - left[1]).slice(0, 5).map(([name]) => name.toLowerCase()));
  const moodTaggedTracks = tracks.filter((track) => track.moodTags?.length);
  const moodIdentityScore = targetMoods.size && moodTaggedTracks.length
    ? moodTaggedTracks.filter((track) => track.moodTags?.some((mood) => targetMoods.has(mood.toLowerCase()))).length / moodTaggedTracks.length * 100
    : null;
  const identityParts = [rangeScore(bpms, profile?.bpmRange, profile?.averageBpm, 45), rangeScore(energies, profile?.energyRange, profile?.averageEnergy, .45), moodIdentityScore].filter((value): value is number => value != null);
  const identityScore = profile && identityParts.length ? round(identityParts.reduce((sum, value) => sum + value, 0) / identityParts.length, 1) : null;
  if (identityScore != null && (profile?.confidence || 0) >= .4 && (identityScore < 65 || (moodIdentityScore != null && moodIdentityScore < 35))) checks.push(check(identityScore < 40 ? "ERROR" : "WARNING", {
    type: "IDENTITY_DRIFT", title: "Playlist identity drift detected", message: `Current tracks match ${identityScore}% of the learned tempo, energy, and mood identity signals available.`, value: identityScore, threshold: 65,
    details: { identityConfidence: profile?.confidence, comparedSignals: identityParts.length, moodIdentityScore: moodIdentityScore == null ? null : round(moodIdentityScore, 1) },
  }));

  const staleDays = Math.max(0, Math.floor((now.getTime() - playlist.lastChangedAt.getTime()) / DAY_MS));
  if (staleDays >= thresholds.staleAfterDays) checks.push(check(staleDays >= thresholds.staleAfterDays * 2 ? "ERROR" : "WARNING", {
    type: "STALE_PLAYLIST", title: "Playlist is stale", message: `This playlist has not changed in ${staleDays} days.`, value: staleDays, threshold: thresholds.staleAfterDays,
  }));
  if ((input.failedAutomation?.count || 0) > 0) checks.push(check("ERROR", {
    type: "FAILED_AUTOMATION", title: "Playlist automation failed", message: input.failedAutomation?.latestMessage || `${input.failedAutomation?.count} recent automation run${input.failedAutomation?.count === 1 ? " has" : "s have"} failed.`, value: input.failedAutomation?.count,
  }));

  const overallScore = Math.max(0, 100 - checks.reduce((sum, item) => sum + item.penalty, 0));
  return {
    playlistId: playlist.id, playlistName: playlist.name, overallScore, status: statusFor(overallScore), metadataConfidence, identityScore, checks,
    metrics: { trackCount: tracks.length, missingTracks: missing.length, unavailableTracks: unavailable.length, duplicateOccurrences, largestArtistShare: round(largestArtistShare, 1), largestAlbumShare: round(largestAlbumShare, 1), excessiveBpmJumps: bpmJumps.length, moodConflicts: moodConflicts.length, staleDays },
  };
}
