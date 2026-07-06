import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  DEFAULT_LIBRARY_HEALTH_CATEGORY,
  MAX_LIBRARY_HEALTH_PAGE_SIZE,
  buildLibraryHealthTrackWhere,
  defaultOrderForLibraryHealth,
  isLibraryHealthDetailCategory,
  libraryHealthDetailTrackSelect,
  orderByForLibraryHealth,
  serializeLibraryHealthDetailTrack,
  type LibraryHealthSort,
} from "@/lib/libraryHealthDetails";
import { getUserSyncSettings, metadataProviderModeKey, resolveMetadataProviderSettings } from "@/lib/syncSettings";

export const dynamic = "force-dynamic";

function directionFrom(value: string | null) {
  return value === "asc" ? "asc" : "desc";
}

function sortFrom(value: string | null): LibraryHealthSort | null {
  if (value === "artist" || value === "title" || value === "album" || value === "duration" || value === "bpm" || value === "lastAnalyzed" || value === "failureStatus") {
    return value;
  }
  return null;
}

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const requestedCategory = params.get("filter") || params.get("category");
  const category = isLibraryHealthDetailCategory(requestedCategory) ? requestedCategory : DEFAULT_LIBRARY_HEALTH_CATEGORY;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(MAX_LIBRARY_HEALTH_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || 50));
  const sort = sortFrom(params.get("sort"));
  const direction = directionFrom(params.get("direction"));
  const audioFeatureSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId)).audioFeatures;

  const where = buildLibraryHealthTrackWhere(userId, {
    category,
    libraryId: params.get("libraryId") || undefined,
    search: params.get("search")?.trim() || undefined,
    artist: params.get("artist")?.trim() || undefined,
    album: params.get("album")?.trim() || undefined,
    bpmSource: params.get("bpmSource") || undefined,
    audioFeatureStatus: params.get("audioFeatureStatus") || undefined,
    localFileStatus: params.get("localFileStatus") || undefined,
    failedOnly: params.get("failedOnly") === "true",
    missingDataOnly: params.get("missingDataOnly") === "true",
    settings: audioFeatureSettings,
  });

  try {
    const [tracks, total] = await Promise.all([
      prisma.track.findMany({
        where,
        select: libraryHealthDetailTrackSelect,
        orderBy: sort ? orderByForLibraryHealth(sort, direction, category) : defaultOrderForLibraryHealth(category),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.track.count({ where }),
    ]);

    const mode = metadataProviderModeKey(audioFeatureSettings);
    console.log(`[LibraryHealth] detail filter=${category} count=${total} mode=${mode}`);

    return NextResponse.json({
      tracks: tracks.map((track) => serializeLibraryHealthDetailTrack(track, category, audioFeatureSettings)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filter: category,
      sort: sort || null,
      direction,
    });
  } catch (error) {
    console.error("[LibraryHealthDetails] Failed to load tracks", error);
    return NextResponse.json({ error: "Unable to load Library Health details. Check logs or try again." }, { status: 500 });
  }
}
