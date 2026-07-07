import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  audioFeatureHealthTrackSelect,
  buildAudioFeatureHealthQuery,
  getAudioFeatureHealthSummary,
  isAudioFeatureHealthFilter,
  MAX_AUDIO_FEATURE_PAGE_SIZE,
  serializeAudioFeatureHealthTrack,
} from "@/lib/libraryHealth";
import { resolveLibraryHealthTrackIds } from "@/lib/libraryHealthDetails";
import { getUserSyncSettings, metadataProviderModeKey, resolveMetadataProviderSettings } from "@/lib/syncSettings";

export const dynamic = "force-dynamic";

function queryNever() {
  return { id: "__library_health_no_gap_debug_bucket__" };
}

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
    const resolved = filter === "missing_audio_features" || filter === "partial_audio_features" || filter === "pending_audio_features"
      ? await resolveLibraryHealthTrackIds(userId, { category: filter, libraryId, settings: audioFeatureSettings })
      : null;
    const search = params.get("search")?.trim() || undefined;
    const activeScope: Prisma.TrackWhereInput = {
      syncStatus: "active",
      library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
    };
    const resolvedIdWhere: Prisma.TrackWhereInput = resolved?.trackIds.length
      ? { id: { in: resolved.trackIds } }
      : { id: "__library_health_empty_resolved_track_set__" };
    const searchWhere: Prisma.TrackWhereInput | null = search
      ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { artist: { title: { contains: search, mode: "insensitive" } } },
          { album: { title: { contains: search, mode: "insensitive" } } },
          { mediaPath: { contains: search, mode: "insensitive" } },
        ],
      }
      : null;
    const query = resolved
      ? {
        where: {
          AND: [
            activeScope,
            resolvedIdWhere,
            ...(searchWhere ? [searchWhere] : []),
          ],
        },
        baseWhere: {
          AND: [
            activeScope,
            resolvedIdWhere,
          ],
        },
        gapWhere: {
          AND: [
            activeScope,
            queryNever(),
          ],
        },
        gapTrackIds: Object.keys(resolved.reasonByTrackId || {}),
      }
      : await buildAudioFeatureHealthQuery(userId, {
        filter,
        libraryId,
        search,
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
    const summaryCount = filter === "missing_audio_features"
      ? summary.missing
      : filter === "partial_audio_features"
        ? summary.partial
        : filter === "pending_audio_features"
          ? summary.pending
          : total;
    if (!search && summaryCount !== total) {
      console.error(`[LibraryHealth][ERROR] Count/detail mismatch category=${filter} cardCount=${summaryCount} detailCount=${total}`);
    }
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
