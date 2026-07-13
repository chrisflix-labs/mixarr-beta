import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PLAYLIST_SNAPSHOT_SCHEMA_VERSION, type PlaylistEngineFamily, type PlaylistVersionSnapshot, type PlaylistVersionTrack, type StoredPlaylistSnapshot } from "./playlist-version-types";
import { resolveEffectiveTrackMetadata } from "../../metadataCorrections";

type DbClient = PrismaClient | Prisma.TransactionClient;

const SECRET_PATTERN = /(token|secret|password|credential|authorization|api[-_]?key|access[-_]?key|session|cookie)/i;

export function redactVersionSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactVersionSettings);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SECRET_PATTERN.test(key))
    .map(([key, child]) => [key, redactVersionSettings(child)]));
}

export function engineFamilyFor(engineVersion: string | null | undefined, sourceType?: string | null): PlaylistEngineFamily | null {
  if (sourceType === "import") return "import";
  if (!engineVersion) return null;
  if (/^v?2/i.test(engineVersion)) return "smart_mix_v2";
  if (/^v?1/i.test(engineVersion)) return "smart_mix_v1";
  return null;
}

export async function capturePlaylistSnapshot(db: DbClient, generatedPlaylistId: string): Promise<StoredPlaylistSnapshot> {
  const playlist = await db.generatedPlaylist.findUnique({
    where: { id: generatedPlaylistId },
    include: { tracks: { orderBy: { position: "asc" } } },
  });
  if (!playlist) throw new Error("Generated playlist not found");

  const trackIds = playlist.tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id));
  const libraryTracks = trackIds.length ? await db.track.findMany({
    where: { id: { in: trackIds } },
    select: {
      id: true, duration: true, effectiveBpm: true, bpm: true, apiBpm: true, localBpm: true, bpmSource: true,
      tags: { where: { type: "mood" }, select: { name: true } },
      audioFeature: true,
      metadataCorrections: { where: { isActive: true }, orderBy: { updatedAt: "desc" } },
      metadataVerifications: { where: { verified: true } },
      metadataSourceOverrides: { where: { ignored: true } },
    },
  }) : [];
  const metadata = new Map(libraryTracks.map((track) => [track.id, track]));
  const tracks: PlaylistVersionTrack[] = playlist.tracks.map((track) => {
    const details = track.trackId ? metadata.get(track.trackId) : null;
    const effective = details ? resolveEffectiveTrackMetadata(details) : null;
    return {
      trackId: track.trackId,
      plexTrackRatingKey: track.plexTrackRatingKey,
      position: track.position,
      locked: track.locked,
      liked: track.liked,
      regenerationExcluded: track.regenerationExcluded,
      titleSnapshot: track.title,
      artistSnapshot: track.artist,
      albumSnapshot: track.album,
      durationMsSnapshot: details?.duration ?? null,
      bpmSnapshot: effective?.bpm.value ?? null,
      moodSnapshot: effective?.mood.value ?? [],
      energySnapshot: effective?.energy.value ?? null,
    };
  });
  const durationMs = tracks.reduce((sum, track) => sum + (track.durationMsSnapshot || 0), 0);
  const settings = redactVersionSettings(playlist.filtersJson) as Record<string, unknown>;
  const snapshot: PlaylistVersionSnapshot = {
    playlist: {
      name: playlist.plexPlaylistTitle,
      description: null,
      engineFamily: engineFamilyFor(playlist.engineVersion, playlist.sourceType),
      engineVersion: playlist.engineVersion || null,
      generationSettings: { schemaVersion: 1, engineVersion: playlist.engineVersion || null, settings },
      betaMetadata: redactVersionSettings(playlist.betaMetadataJson) as Record<string, unknown> | null,
    },
    tracks,
    scores: redactVersionSettings(playlist.qualityScoreJson) as Record<string, unknown> | null,
    summary: { trackCount: tracks.length, durationMs },
  };
  return { schemaVersion: PLAYLIST_SNAPSHOT_SCHEMA_VERSION, data: snapshot };
}

const trackSchema = z.object({
  trackId: z.string().nullable(), plexTrackRatingKey: z.string().nullable(), position: z.number().int().positive(),
  locked: z.boolean(), liked: z.boolean(), regenerationExcluded: z.boolean(), titleSnapshot: z.string(),
  artistSnapshot: z.string().nullable(), albumSnapshot: z.string().nullable(), durationMsSnapshot: z.number().nullable(),
  bpmSnapshot: z.number().nullable(), moodSnapshot: z.array(z.string()), energySnapshot: z.number().nullable(),
});
const storedSchema = z.object({
  schemaVersion: z.literal(PLAYLIST_SNAPSHOT_SCHEMA_VERSION),
  data: z.object({
    playlist: z.object({
      name: z.string(), description: z.string().nullable(), engineFamily: z.enum(["smart_mix_v1", "smart_mix_v2", "manual", "import"]).nullable(),
      engineVersion: z.string().nullable(), generationSettings: z.object({ schemaVersion: z.number(), engineVersion: z.string().nullable(), settings: z.record(z.unknown()) }).nullable(),
      betaMetadata: z.record(z.unknown()).nullable().optional().default(null),
    }),
    tracks: z.array(trackSchema), scores: z.record(z.unknown()).nullable(),
    summary: z.object({ trackCount: z.number().int().nonnegative(), durationMs: z.number().nonnegative() }),
  }),
});

// v2.0.6 stored a bare array. It still represents a complete, usable playlist
// state, so migrate it in memory and leave the original JSON untouched.
function migrateLegacySnapshot(value: unknown, fallback: { name: string; engineVersion: string | null; settings: unknown; scores: unknown }): StoredPlaylistSnapshot | null {
  if (!Array.isArray(value)) return null;
  const tracks: PlaylistVersionTrack[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    tracks.push({
      trackId: typeof row.trackId === "string" ? row.trackId : null,
      plexTrackRatingKey: typeof row.plexTrackRatingKey === "string" ? row.plexTrackRatingKey : null,
      position: typeof row.position === "number" ? row.position : index + 1,
      locked: Boolean(row.locked), liked: Boolean(row.liked), regenerationExcluded: Boolean(row.regenerationExcluded),
      titleSnapshot: typeof row.title === "string" ? row.title : "Unknown track",
      artistSnapshot: typeof row.artist === "string" ? row.artist : null,
      albumSnapshot: typeof row.album === "string" ? row.album : null,
      durationMsSnapshot: typeof row.durationMs === "number" ? row.durationMs : null,
      bpmSnapshot: typeof row.bpm === "number" ? row.bpm : null,
      moodSnapshot: Array.isArray(row.mood) ? row.mood.filter((entry): entry is string => typeof entry === "string") : [],
      energySnapshot: typeof row.energy === "number" ? row.energy : null,
    });
  }
  const settings = redactVersionSettings(fallback.settings);
  return { schemaVersion: 1, data: {
    playlist: { name: fallback.name, description: null, engineFamily: engineFamilyFor(fallback.engineVersion), engineVersion: fallback.engineVersion, generationSettings: settings && typeof settings === "object" ? { schemaVersion: 1, engineVersion: fallback.engineVersion, settings: settings as Record<string, unknown> } : null, betaMetadata: null },
    tracks, scores: fallback.scores && typeof fallback.scores === "object" ? fallback.scores as Record<string, unknown> : null,
    summary: { trackCount: tracks.length, durationMs: tracks.reduce((sum, track) => sum + (track.durationMsSnapshot || 0), 0) },
  } };
}

export function readPlaylistSnapshot(value: unknown, fallback: { name: string; engineVersion: string | null; settings: unknown; scores: unknown }): { snapshot: StoredPlaylistSnapshot | null; error: string | null; legacy: boolean } {
  const legacy = migrateLegacySnapshot(value, fallback);
  if (legacy) return { snapshot: legacy, error: null, legacy: true };
  const parsed = storedSchema.safeParse(value);
  if (!parsed.success) return { snapshot: null, error: "This version cannot be restored because its snapshot data is incomplete.", legacy: false };
  if (parsed.data.data.summary.trackCount !== parsed.data.data.tracks.length) return { snapshot: null, error: "This version cannot be restored because its track summary is inconsistent.", legacy: false };
  return { snapshot: parsed.data, error: null, legacy: false };
}

export function snapshotJson(snapshot: StoredPlaylistSnapshot): Prisma.InputJsonValue {
  return snapshot as unknown as Prisma.InputJsonValue;
}
