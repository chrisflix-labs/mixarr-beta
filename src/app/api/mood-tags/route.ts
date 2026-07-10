import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getEnabledExternalApiProviders } from "@/lib/externalApiSettings";
import { aggregateSelectableMoodIndexFromTracks } from "@/lib/selectableMoods";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "@/lib/syncSettings";

const MOOD_TAG_TRACK_BATCH_SIZE = 2_000;

const moodIndexTrackSelect = {
  id: true,
  syncStatus: true,
  tags: { where: { type: "mood" }, select: { name: true, type: true } },
  artist: { select: { tags: { where: { type: "mood" }, select: { name: true, type: true } } } },
  album: { select: { tags: { where: { type: "mood" }, select: { name: true, type: true } } } },
  audioFeature: {
    select: {
      energy: true,
      valence: true,
      apiEnergy: true,
      apiMood: true,
      localEnergy: true,
      localMood: true,
      effectiveEnergy: true,
      effectiveMood: true,
      source: true,
      confidence: true,
      audioFeatureSource: true,
      audioFeatureStatus: true,
      audioFeatureConfidence: true,
      energySource: true,
      valenceSource: true,
    },
  },
} satisfies Prisma.TrackSelect;

type MoodIndexTrack = Prisma.TrackGetPayload<{ select: typeof moodIndexTrackSelect }>;

async function fetchTracksForMoodIndex(where: Prisma.TrackWhereInput) {
  const tracks: MoodIndexTrack[] = [];
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.track.findMany({
      where,
      take: MOOD_TAG_TRACK_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: moodIndexTrackSelect,
    });

    tracks.push(...batch);
    if (batch.length < MOOD_TAG_TRACK_BATCH_SIZE) break;
    cursor = batch[batch.length - 1]?.id;
    if (!cursor) break;
  }

  return tracks;
}

export async function GET(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const serverId = url.searchParams.get("serverId") || undefined;
  const libraryId = url.searchParams.get("libraryId") || undefined;
  const userTrackScope: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: {
      ...(libraryId ? { id: libraryId } : {}),
      server: {
        userId,
        ...(serverId ? { id: serverId } : {}),
      },
    },
  };

  try {
    const rawSettings = await getUserSyncSettings(userId);
    const settings = resolveMetadataProviderSettings(rawSettings);
    const [audioApiProviders, bpmApiProviders, tracks] = await Promise.all([
      getEnabledExternalApiProviders("audioFeatures"),
      getEnabledExternalApiProviders("bpm"),
      fetchTracksForMoodIndex(userTrackScope),
    ]);
    const effectiveAudioSettings = {
      ...settings.audioFeatures,
      api: settings.audioFeatures.api && (audioApiProviders.length > 0 || bpmApiProviders.length > 0),
    };
    const index = aggregateSelectableMoodIndexFromTracks({
      tracks,
      libraryId,
      serverId,
      settings: effectiveAudioSettings,
    });

    console.info("[MoodTags] selectable mood index", {
      libraryId: libraryId || "all",
      serverId: serverId || "all",
      status: index.status,
      totalTracks: index.totalTracks,
      tracksWithMood: index.tracksWithMood,
      tracksWithoutMood: index.tracksWithoutMood,
      uniqueMoodCount: index.uniqueMoodCount,
      pendingTracks: index.pendingTracks,
      parsingFailures: index.parsingFailures,
    });

    return NextResponse.json(index);
  } catch (error) {
    console.error("[MoodTags] failed to build selectable mood index", {
      libraryId: libraryId || "all",
      serverId: serverId || "all",
      error,
    });
    return NextResponse.json({
      status: "error",
      libraryId,
      serverId,
      totalTracks: 0,
      tracksWithMood: 0,
      tracksWithoutMood: 0,
      uniqueMoodCount: 0,
      pendingTracks: 0,
      inspectedTracks: 0,
      moods: [],
      parsingFailures: {},
      error: "Moods could not be loaded.",
    }, { status: 500 });
  }
}
