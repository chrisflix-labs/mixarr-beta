import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  audioFeatureHealthTrackSelect,
  buildAudioFeatureHealthQuery,
  getAudioFeatureHealthSummary,
  isAudioFeatureHealthFilter,
  MAX_AUDIO_FEATURE_PAGE_SIZE,
  serializeAudioFeatureHealthTrack,
} from "@/lib/libraryHealth";
import { getUserSyncSettings, metadataProviderModeKey, resolveMetadataProviderSettings } from "@/lib/syncSettings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const filter = params.get("filter");
  if (!isAudioFeatureHealthFilter(filter)) {
    return NextResponse.json({ error: "A valid audio-feature health filter is required" }, { status: 400 });
  }

  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(MAX_AUDIO_FEATURE_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || 50));
  const libraryId = params.get("libraryId") || undefined;
  const audioFeatureSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId)).audioFeatures;

  try {
    const query = await buildAudioFeatureHealthQuery(userId, {
      filter,
      libraryId,
      search: params.get("search")?.trim() || undefined,
      settings: audioFeatureSettings,
    });
    const [tracks, total, baseCount, gapCount, summary] = await Promise.all([
      prisma.track.findMany({
        where: query.where,
        select: audioFeatureHealthTrackSelect,
        orderBy: [{ artist: { title: "asc" } }, { album: { title: "asc" } }, { title: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.track.count({ where: query.where }),
      prisma.track.count({ where: query.baseWhere }),
      prisma.track.count({ where: query.gapWhere }),
      getAudioFeatureHealthSummary(userId, libraryId, audioFeatureSettings),
    ]);
    const mode = metadataProviderModeKey(audioFeatureSettings);
    console.log(`[LibraryHealth] detail filter=${filter} baseCount=${baseCount} gapCount=${gapCount} total=${total} mode=${mode}`);

    return NextResponse.json({
      tracks: tracks.map((track) => serializeAudioFeatureHealthTrack(track, audioFeatureSettings)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filter,
      summary,
    });
  } catch (error) {
    console.error("[LibraryHealth] Failed to load audio-feature tracks", error);
    return NextResponse.json({ error: "Failed to load audio-feature tracks" }, { status: 500 });
  }
}
