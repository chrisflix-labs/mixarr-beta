import type { SummaryType } from "./contracts";
import { envFlag } from "../envBoolean";

export type PlaylistAnalysisTrack = {
  id: string; identifier?: string; title: string; artist?: string | null; album?: string | null; albumId?: string | null;
  duration?: number | null; bpm?: number | null; energy?: number | null; year?: number | null;
  genres?: string[]; moods?: string[]; explicit?: boolean; familiar?: boolean | null; recentlyAdded?: boolean | null;
};

export type PlaylistAnalysisInput = {
  playlist: { id: string; name: string; type?: string; purpose?: string | null; recipeName?: string | null; sourceType?: string; refreshedAt?: Date | string | null; notes?: string | null };
  tracks: PlaylistAnalysisTrack[];
  previous?: { trackIds: string[]; durationMs?: number; uniqueArtists?: number; genreDistribution?: Record<string, number>; discoveryPercent?: number | null; averageEnergy?: number | null; averageBpm?: number | null } | null;
};

export type MetadataCandidate = {
  id: string; suggestionType: string; field: string; existingValue: string | null; suggestedValue: string | null;
  reason: string; confidenceScore: number; confidenceLevel: "HIGH" | "MEDIUM" | "LOW" | "CONFLICTING_SOURCES";
  detectionMethod: string; trackIds: string[]; trackSnapshots: Array<{ id: string; identifier: string; title: string; artist?: string | null; album?: string | null }>;
  albums: string[]; artists: string[]; sourceMetadata: Record<string, unknown>; conflictingSourceMetadata?: Record<string, unknown>;
  plexImpact: boolean; sourceLibraryImpact: boolean; embeddedTagImpact: boolean;
};

const clean = (value: string | null | undefined) => String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const normalized = (value: string | null | undefined) => clean(value).toLocaleLowerCase().replace(/\b(featuring|feat\.?|ft\.?)\b/g, "feat").replace(/[’']/g, "'").replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").trim();
const canonicalGenre = (value: string) => normalized(value).replace(/\b(hip hop)\b/, "hip-hop").replace(/\belectronica\b/, "electronic").replace(/s$/, "");
const round = (value: number, places = 1) => Number(value.toFixed(places));
const percent = (value: number, total: number) => total ? round(value / total * 100) : 0;
const average = (values: number[]) => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 2) : null;
const range = (values: number[]) => values.length ? { minimum: Math.min(...values), maximum: Math.max(...values) } : null;
const distribution = (values: string[]) => Object.fromEntries(Array.from(values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map<string, number>())).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
// A deterministic 128-bit non-secret content fingerprint. This is used only for
// deduplication, never for authentication or credential handling, and remains
// browser-safe for modules shared by Next.js route and UI dependency graphs.
const fingerprint = (value: unknown) => {
  const input = JSON.stringify(value); let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = 0xdeadbeef;
  for (let index = 0; index < input.length; index++) { const code = input.charCodeAt(index); a = Math.imul(a ^ code, 2654435761); b = Math.imul(b ^ code, 1597334677); c = Math.imul(c ^ code, 2246822507); d = Math.imul(d ^ code, 3266489909); }
  const mix = (value: number) => { value ^= value >>> 16; value = Math.imul(value, 2246822507); value ^= value >>> 13; value = Math.imul(value, 3266489909); return (value ^ value >>> 16) >>> 0; };
  return [mix(a ^ b), mix(b ^ c), mix(c ^ d), mix(d ^ a)].map((part) => part.toString(16).padStart(8, "0")).join("");
};

function segmentAverages(tracks: PlaylistAnalysisTrack[], field: "bpm" | "energy") {
  if (!tracks.some((track) => typeof track[field] === "number")) return null;
  const size = Math.max(1, Math.ceil(tracks.length / 3));
  return [0, 1, 2].map((segment) => average(tracks.slice(segment * size, (segment + 1) * size).map((track) => track[field]).filter((value): value is number => typeof value === "number")));
}

export function analyzePlaylist(input: PlaylistAnalysisInput) {
  const tracks = input.tracks;
  const artists = tracks.map((track) => clean(track.artist)).filter(Boolean);
  const albums = tracks.map((track) => clean(track.album)).filter(Boolean);
  const genres = tracks.flatMap((track) => track.genres || []).map(clean).filter(Boolean);
  const moods = tracks.flatMap((track) => track.moods || []).map(clean).filter(Boolean);
  const years = tracks.map((track) => track.year).filter((value): value is number => Number.isInteger(value));
  const bpms = tracks.map((track) => track.bpm).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const energies = tracks.map((track) => track.energy).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const durationMs = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  const familiarKnown = tracks.filter((track) => track.familiar != null);
  const recentKnown = tracks.filter((track) => track.recentlyAdded != null);
  const trackIds = tracks.map((track) => track.id);
  const previousIds = new Set(input.previous?.trackIds || []);
  const currentIds = new Set(trackIds);
  const added = input.previous ? trackIds.filter((id) => !previousIds.has(id)) : [];
  const removed = input.previous ? input.previous.trackIds.filter((id) => !currentIds.has(id)) : [];
  const retained = input.previous ? trackIds.filter((id) => previousIds.has(id)) : [];
  const genreDistribution = distribution(genres);
  const facts: Record<string, unknown> = {
    playlistName: clean(input.playlist.name), playlistType: clean(input.playlist.type), playlistPurpose: clean(input.playlist.purpose),
    recipeName: clean(input.playlist.recipeName), sourceType: clean(input.playlist.sourceType), refreshedAt: input.playlist.refreshedAt || null,
    trackCount: tracks.length, durationMs, uniqueArtistCount: new Set(artists.map(normalized)).size,
    uniqueAlbumCount: new Set(albums.map(normalized)).size, artistRepetitionCount: Math.max(0, artists.length - new Set(artists.map(normalized)).size),
    albumRepetitionCount: Math.max(0, albums.length - new Set(albums.map(normalized)).size), genreDistribution,
    moodDistribution: distribution(moods), releaseYearDistribution: distribution(years.map(String)), eraDistribution: distribution(years.map((year) => `${Math.floor(year / 10) * 10}s`)),
    bpmRange: range(bpms), averageBpm: average(bpms), energyRange: range(energies), averageEnergy: average(energies),
    bpmProgression: segmentAverages(tracks, "bpm"), energyProgression: segmentAverages(tracks, "energy"),
    explicitContentCount: tracks.filter((track) => track.explicit).length,
    familiarTrackPercent: familiarKnown.length ? percent(familiarKnown.filter((track) => track.familiar).length, familiarKnown.length) : null,
    discoveryTrackPercent: familiarKnown.length ? percent(familiarKnown.filter((track) => track.familiar === false).length, familiarKnown.length) : null,
    recentlyAddedPercent: recentKnown.length ? percent(recentKnown.filter((track) => track.recentlyAdded).length, recentKnown.length) : null,
    change: input.previous ? { addedCount: added.length, removedCount: removed.length, retainedCount: retained.length, durationDeltaMs: durationMs - (input.previous.durationMs || 0), uniqueArtistDelta: new Set(artists.map(normalized)).size - (input.previous.uniqueArtists || 0), averageBpmDelta: typeof input.previous.averageBpm === "number" && bpms.length ? round((average(bpms) || 0) - input.previous.averageBpm, 2) : null, averageEnergyDelta: typeof input.previous.averageEnergy === "number" && energies.length ? round((average(energies) || 0) - input.previous.averageEnergy, 2) : null } : null,
  };
  const availableFacts = Object.entries(facts).filter(([, value]) => value !== null && value !== "" && (!Array.isArray(value) || value.some((item) => item !== null))).map(([key]) => key);
  return { schemaVersion: "1.0", facts, availableFacts, trackIds, addedTrackIds: added, removedTrackIds: removed, retainedTrackIds: retained, fingerprint: fingerprint({ playlistId: input.playlist.id, facts, trackIds }) };
}

export function privacyAwarePlaylistPayload(analysis: ReturnType<typeof analyzePlaylist>, tracks: PlaylistAnalysisTrack[], privacyMode: string, allowFullTrackMetadata: boolean) {
  const aggregate = { schemaVersion: analysis.schemaVersion, facts: analysis.facts, availableFacts: analysis.availableFacts };
  if (privacyMode === "METADATA_LIMITED") return { payload: aggregate, blockedFields: ["track_titles", "artist_names", "album_names", "listening_history"], aggregateOnly: true };
  if (privacyMode === "ANONYMOUS_METADATA") return { payload: { ...aggregate, tracks: tracks.map((track, index) => ({ sequence: index + 1, duration: track.duration, bpm: track.bpm, energy: track.energy, year: track.year, genres: track.genres, moods: track.moods, explicit: track.explicit })) }, blockedFields: ["track_titles", "artist_names", "album_names", "stable_track_ids", "listening_history"], aggregateOnly: false };
  if (privacyMode === "FULL_METADATA" && !allowFullTrackMetadata) return { payload: aggregate, blockedFields: ["full_track_metadata_disabled_by_setting", "listening_history"], aggregateOnly: true };
  return { payload: { ...aggregate, tracks: tracks.map((track, index) => ({ sequence: index + 1, title: clean(track.title), artist: clean(track.artist), album: clean(track.album), duration: track.duration, bpm: track.bpm, energy: track.energy, year: track.year, genres: track.genres, moods: track.moods, explicit: track.explicit })) }, blockedFields: ["media_paths", "credentials", "listening_history"], aggregateOnly: false };
}

export function validateSummaryEvidence(summaryType: SummaryType, text: string, facts: Record<string, unknown>, maximumLength?: number) {
  const value = clean(text);
  if (!value) throw Object.assign(new Error("The AI returned an empty summary."), { code: "INVALID_AI_RESPONSE", status: 422 });
  if (summaryType === "PLEX_FRIENDLY" && /[*_#`\[\]]/.test(value)) throw Object.assign(new Error("The Plex-friendly description contains unsupported formatting."), { code: "INVALID_AI_RESPONSE", status: 422 });
  if (summaryType === "PLEX_FRIENDLY" && maximumLength && value.length > maximumLength) throw Object.assign(new Error(`The Plex-friendly description exceeds ${maximumLength} characters.`), { code: "PLEX_DESCRIPTION_TOO_LONG", status: 422 });
  const checks: Array<[RegExp, string[]]> = [
    [/\b(bpm|tempo)\b/i, ["averageBpm", "bpmRange", "bpmProgression"]], [/\benergy|energetic|calm(er)?\b/i, ["averageEnergy", "energyRange", "energyProgression"]],
    [/\bmood\b/i, ["moodDistribution"]], [/\bgenre|rock|pop|jazz|electronic|hip[- ]hop|country|metal\b/i, ["genreDistribution"]],
    [/\b(19|20)\d{2}|\b(19|20)\d0s\b|\bera\b/i, ["releaseYearDistribution", "eraDistribution"]],
    [/\bdiscovery|discover\b/i, ["discoveryTrackPercent"]], [/\bfamiliar\b/i, ["familiarTrackPercent"]],
  ];
  for (const [pattern, keys] of checks) if (pattern.test(value) && !keys.some((key) => facts[key] != null && JSON.stringify(facts[key]) !== "{}")) throw Object.assign(new Error(`The summary made an unsupported ${keys[0]} claim.`), { code: "UNSUPPORTED_AI_CLAIM", status: 422 });
  return value;
}

function candidate(input: Omit<MetadataCandidate, "id">): MetadataCandidate { return { id: crypto.randomUUID(), ...input }; }
function snapshot(track: PlaylistAnalysisTrack) { return { id: track.id, identifier: track.identifier || track.id, title: clean(track.title), artist: clean(track.artist), album: clean(track.album) }; }

export function detectMetadataCandidates(tracks: PlaylistAnalysisTrack[]) {
  const output: MetadataCandidate[] = [];
  const artistGroups = new Map<string, PlaylistAnalysisTrack[]>();
  for (const track of tracks) { const key = normalized(track.artist); if (key) artistGroups.set(key, [...(artistGroups.get(key) || []), track]); }
  for (const group of Array.from(artistGroups.values())) {
    const variants = distribution(group.map((track) => clean(track.artist)));
    if (Object.keys(variants).length < 2) continue;
    const preferred = Object.entries(variants).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    for (const existing of Object.keys(variants).filter((value) => value !== preferred)) {
      const affected = group.filter((track) => clean(track.artist) === existing);
      output.push(candidate({ suggestionType: "INCONSISTENT_ARTIST_NAME", field: "artist", existingValue: existing, suggestedValue: preferred, reason: `The normalized artist name matches “${preferred}”, which is the most common local variant.`, confidenceScore: 0.96, confidenceLevel: "HIGH", detectionMethod: "NORMALIZED_ARTIST_VARIANTS", trackIds: affected.map((track) => track.id), trackSnapshots: affected.map(snapshot), albums: Array.from(new Set(affected.map((track) => clean(track.album)).filter(Boolean))), artists: [existing, preferred], sourceMetadata: { mixarr: existing, localVariants: variants }, plexImpact: true, sourceLibraryImpact: true, embeddedTagImpact: true }));
    }
  }
  const albums = new Map<string, PlaylistAnalysisTrack[]>();
  for (const track of tracks) { const key = track.albumId || `${normalized(track.artist)}:${normalized(track.album)}`; if (key) albums.set(key, [...(albums.get(key) || []), track]); }
  for (const group of Array.from(albums.values())) {
    const years = Array.from(new Set(group.map((track) => track.year).filter((year): year is number => Number.isInteger(year))));
    if (years.length > 1) output.push(candidate({ suggestionType: "CONFLICTING_RELEASE_YEAR", field: "releaseYear", existingValue: years.join(", "), suggestedValue: null, reason: "Tracks assigned to the same album contain conflicting release years. Review authoritative sources before choosing a value.", confidenceScore: 0.7, confidenceLevel: "CONFLICTING_SOURCES", detectionMethod: "ALBUM_YEAR_CONFLICT", trackIds: group.map((track) => track.id), trackSnapshots: group.map(snapshot), albums: Array.from(new Set(group.map((track) => clean(track.album)).filter(Boolean))), artists: Array.from(new Set(group.map((track) => clean(track.artist)).filter(Boolean))), sourceMetadata: { mixarrYears: years }, conflictingSourceMetadata: { values: years }, plexImpact: true, sourceLibraryImpact: true, embeddedTagImpact: true }));
    const withMood = group.filter((track) => (track.moods || []).length); const withoutMood = group.filter((track) => !(track.moods || []).length);
    const moodCounts = distribution(withMood.flatMap((track) => track.moods || []).map(clean).filter(Boolean));
    if (withoutMood.length && withMood.length >= 2 && Object.keys(moodCounts).length === 1) { const mood = Object.keys(moodCounts)[0]; output.push(candidate({ suggestionType: "MISSING_MOOD", field: "mood", existingValue: null, suggestedValue: mood, reason: `Other tracks on this album consistently use the mood “${mood}”.`, confidenceScore: 0.72, confidenceLevel: "MEDIUM", detectionMethod: "ALBUM_NEIGHBOR_MOOD", trackIds: withoutMood.map((track) => track.id), trackSnapshots: withoutMood.map(snapshot), albums: Array.from(new Set(group.map((track) => clean(track.album)).filter(Boolean))), artists: Array.from(new Set(group.map((track) => clean(track.artist)).filter(Boolean))), sourceMetadata: { albumNeighborMoods: moodCounts }, plexImpact: true, sourceLibraryImpact: true, embeddedTagImpact: true })); }
  }
  const genres = new Map<string, Array<{ track: PlaylistAnalysisTrack; value: string }>>();
  for (const track of tracks) for (const genre of track.genres || []) { const key = canonicalGenre(genre); if (key) genres.set(key, [...(genres.get(key) || []), { track, value: clean(genre) }]); }
  for (const group of Array.from(genres.values())) { const variants = distribution(group.map((item) => item.value)); if (Object.keys(variants).length < 2) continue; const preferred = Object.entries(variants).sort((a, b) => b[1] - a[1])[0][0]; for (const existing of Object.keys(variants).filter((value) => value !== preferred)) { const affected = group.filter((item) => item.value === existing).map((item) => item.track); output.push(candidate({ suggestionType: "GENRE_VARIATION", field: "genre", existingValue: existing, suggestedValue: preferred, reason: `This genre normalizes to the more common local spelling “${preferred}”.`, confidenceScore: 0.88, confidenceLevel: "HIGH", detectionMethod: "NORMALIZED_GENRE_VARIANTS", trackIds: affected.map((track) => track.id), trackSnapshots: affected.map(snapshot), albums: Array.from(new Set(affected.map((track) => clean(track.album)).filter(Boolean))), artists: Array.from(new Set(affected.map((track) => clean(track.artist)).filter(Boolean))), sourceMetadata: { localVariants: variants }, plexImpact: true, sourceLibraryImpact: true, embeddedTagImpact: true })); } }
  const suffix = /\s*[\[(](live|remix|remaster(?:ed)?|acoustic|radio edit|edit|version)[^\])]*[\])]\s*$/i;
  for (const track of tracks) { const match = clean(track.title).match(suffix); if (!match) continue; output.push(candidate({ suggestionType: "VERSION_LABEL", field: "title", existingValue: clean(track.title), suggestedValue: clean(track.title), reason: `The title contains a “${match[1]}” version label. Confirm that the label is consistently represented across sources.`, confidenceScore: 0.62, confidenceLevel: "LOW", detectionMethod: "TITLE_VERSION_SUFFIX", trackIds: [track.id], trackSnapshots: [snapshot(track)], albums: clean(track.album) ? [clean(track.album)] : [], artists: clean(track.artist) ? [clean(track.artist)] : [], sourceMetadata: { mixarrTitle: clean(track.title), detectedLabel: match[1] }, plexImpact: true, sourceLibraryImpact: true, embeddedTagImpact: true })); }
  return output;
}

export function suggestionFingerprint(candidate: Pick<MetadataCandidate, "suggestionType" | "field" | "existingValue" | "suggestedValue" | "trackIds" | "sourceMetadata">) {
  return fingerprint({ type: candidate.suggestionType, field: candidate.field, existing: normalized(candidate.existingValue), suggested: normalized(candidate.suggestedValue), affected: [...candidate.trackIds].sort(), sources: Object.keys(candidate.sourceMetadata).sort() });
}

export function responseReferencesOnlySubmittedCandidates(candidateIds: string[], responseIds: string[]) { const allowed = new Set(candidateIds); return responseIds.every((id) => allowed.has(id)) && new Set(responseIds).size === responseIds.length; }

export function ignoreRuleMatches(candidate: MetadataCandidate, scope: string, match: Record<string, unknown>) {
  const comparisons: Record<string, boolean> = {
    EXACT_SUGGESTION: match.fingerprint === suggestionFingerprint(candidate), SUGGESTION_TYPE: match.suggestionType === candidate.suggestionType,
    METADATA_FIELD: match.field === candidate.field, ARTIST: candidate.artists.some((value) => normalized(value) === normalized(String(match.artist || ""))),
    ALBUM: candidate.albums.some((value) => normalized(value) === normalized(String(match.album || ""))), EXISTING_VALUE: normalized(String(match.existingValue || "")) === normalized(candidate.existingValue),
    SUGGESTED_VALUE: normalized(String(match.suggestedValue || "")) === normalized(candidate.suggestedValue), VALUE_PAIR: normalized(String(match.existingValue || "")) === normalized(candidate.existingValue) && normalized(String(match.suggestedValue || "")) === normalized(candidate.suggestedValue),
    SOURCE_CONFLICT_PATTERN: Boolean(candidate.conflictingSourceMetadata) && match.field === candidate.field,
  };
  return comparisons[scope] === true;
}

export const AI_METADATA_WRITES_ENABLED = false as const;
// Enabled unless the operator turns them off. Parsed through the shared reader so
// `0`, `no`, and `off` disable them as well as `false`.
export const AI_PLAYLIST_SUMMARIES_ENABLED = envFlag("AI_PLAYLIST_SUMMARIES_ENABLED", true);
export const AI_METADATA_SUGGESTIONS_ENABLED = envFlag("AI_METADATA_SUGGESTIONS_ENABLED", true);
export function assertMetadataWritesDisabled() { if (AI_METADATA_WRITES_ENABLED !== false) throw new Error("AI metadata writes must remain disabled in v2.4.6."); return true; }
