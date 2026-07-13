import type { PlaylistVersionDiff, PlaylistVersionSnapshot, PlaylistVersionTrack, SettingsDiffEntry } from "./playlist-version-types";

function trackKey(track: PlaylistVersionTrack) {
  return track.trackId || (track.plexTrackRatingKey ? `plex:${track.plexTrackRatingKey}` : `snapshot:${track.position}:${track.artistSnapshot}:${track.titleSnapshot}`);
}

function flatten(value: unknown, prefix = "", output = new Map<string, unknown>()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) flatten(child, prefix ? `${prefix}.${key}` : key, output);
  } else {
    output.set(prefix, value);
  }
  return output;
}

function equalValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function settingGroup(path: string): SettingsDiffEntry["group"] {
  const normalized = path.toLowerCase();
  if (normalized.includes("mood") || normalized.includes("valence")) return "Mood";
  if (normalized.includes("bpm") || normalized.includes("tempo")) return "BPM";
  if (normalized.includes("energy")) return "Energy";
  if (normalized.includes("discover") || normalized.includes("deepcut") || normalized.includes("popular") || normalized.includes("familiar")) return "Discovery";
  if (normalized.includes("artist") || normalized.includes("album") || normalized.includes("variety") || normalized.includes("duplicate")) return "Variety";
  if (normalized.includes("regen") || normalized.includes("preserv") || normalized.includes("replacement")) return "Regeneration";
  if (normalized.includes("fallback") || normalized.includes("missing")) return "Fallback behavior";
  return "General";
}

function humanize(path: string) {
  const leaf = path.split(".").pop() || path;
  return leaf.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

export function compareGenerationSettings(from: Record<string, unknown> | null, to: Record<string, unknown> | null): SettingsDiffEntry[] {
  const left = flatten(from || {});
  const right = flatten(to || {});
  return Array.from(new Set([...Array.from(left.keys()), ...Array.from(right.keys())]))
    .filter((path) => !equalValue(left.get(path), right.get(path)))
    .sort()
    .map((path) => ({ path, label: humanize(path), group: settingGroup(path), from: left.get(path) ?? null, to: right.get(path) ?? null }));
}

function compareScores(from: Record<string, unknown> | null, to: Record<string, unknown> | null) {
  const left = flatten(from || {});
  const right = flatten(to || {});
  return Array.from(new Set([...Array.from(left.keys()), ...Array.from(right.keys())]))
    .filter((path) => typeof left.get(path) === "number" || typeof right.get(path) === "number")
    .filter((path) => left.get(path) !== right.get(path))
    .sort()
    .map((path) => ({ path, label: humanize(path), from: typeof left.get(path) === "number" ? left.get(path) as number : null, to: typeof right.get(path) === "number" ? right.get(path) as number : null }));
}

export function diffPlaylistVersions(input: {
  fromVersionId: string;
  toVersionId: string;
  from: PlaylistVersionSnapshot;
  to: PlaylistVersionSnapshot;
}): PlaylistVersionDiff {
  const fromByKey = new Map(input.from.tracks.map((track) => [trackKey(track), track]));
  const toByKey = new Map(input.to.tracks.map((track) => [trackKey(track), track]));
  const removedTracks = input.from.tracks.filter((track) => !toByKey.has(trackKey(track)));
  const addedTracks = input.to.tracks.filter((track) => !fromByKey.has(trackKey(track)));
  const movedTracks: PlaylistVersionDiff["movedTracks"] = [];
  const unchangedTracks: PlaylistVersionTrack[] = [];
  const stateChanges: PlaylistVersionDiff["stateChanges"] = [];

  for (const track of input.from.tracks) {
    const target = toByKey.get(trackKey(track));
    if (!target) continue;
    if (track.position !== target.position) movedTracks.push({ track: target, fromPosition: track.position, toPosition: target.position });
    else unchangedTracks.push(target);
    const fields = (["locked", "liked", "regenerationExcluded"] as const).filter((field) => track[field] !== target[field]);
    if (fields.length) stateChanges.push({ track: target, fields });
  }

  // Position-only inference is deliberately conservative. It is shown as
  // "Possible replacement" by the UI and never treated as authoritative data.
  const replacements: PlaylistVersionDiff["replacements"] = [];
  const usedAdded = new Set<string>();
  for (const removed of removedTracks) {
    const added = addedTracks.find((candidate) => candidate.position === removed.position && !usedAdded.has(trackKey(candidate)));
    if (!added) continue;
    usedAdded.add(trackKey(added));
    replacements.push({ position: removed.position, removed, added, inferred: true });
  }

  const fromSettings = input.from.playlist.generationSettings?.settings || null;
  const toSettings = input.to.playlist.generationSettings?.settings || null;
  return {
    fromVersionId: input.fromVersionId,
    toVersionId: input.toVersionId,
    summary: {
      addedCount: addedTracks.length, removedCount: removedTracks.length, movedCount: movedTracks.length,
      unchangedCount: unchangedTracks.length, replacedCount: replacements.length,
      trackCountFrom: input.from.summary.trackCount, trackCountTo: input.to.summary.trackCount,
      durationMsFrom: input.from.summary.durationMs, durationMsTo: input.to.summary.durationMs,
    },
    addedTracks, removedTracks, movedTracks, replacements, unchangedTracks, stateChanges,
    settingsChanges: compareGenerationSettings(fromSettings, toSettings),
    scoreChanges: compareScores(input.from.scores, input.to.scores),
  };
}
