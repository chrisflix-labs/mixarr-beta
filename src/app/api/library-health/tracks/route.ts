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

function hasAdditionalDetailFilters(params: URLSearchParams) {
  return !!(
    params.get("search")?.trim()
    || params.get("artist")?.trim()
    || params.get("album")?.trim()
    || (params.get("bpmSource") && params.get("bpmSource") !== "all")
    || (params.get("bpmConfidence") && params.get("bpmConfidence") !== "all")
    || (params.get("bpmConflict") && params.get("bpmConflict") !== "all")
    || params.get("apiImportedOnly") === "true"
    || params.get("noLocalBpm") === "true"
    || (params.get("audioFeatureStatus") && params.get("audioFeatureStatus") !== "all")
    || params.get("failedOnly") === "true"
    || params.get("missingDataOnly") === "true"
  );
}

function withStableTieBreaker(orderBy: ReturnType<typeof defaultOrderForLibraryHealth>) {
  return [...orderBy, { id: "asc" as const }];
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

  const libraryId = params.get("libraryId") || undefined;
  const audioFeatureStatus = params.get("audioFeatureStatus") || undefined;
  const missingDataOnly = params.get("missingDataOnly") === "true";

  const where = buildLibraryHealthTrackWhere(userId, {
    category,
    libraryId,
    search: params.get("search")?.trim() || undefined,
    artist: params.get("artist")?.trim() || undefined,
    album: params.get("album")?.trim() || undefined,
    bpmSource: params.get("bpmSource") || undefined,
    bpmConfidence: params.get("bpmConfidence") || undefined,
    bpmConflict: params.get("bpmConflict") || undefined,
    apiImportedOnly: params.get("apiImportedOnly") === "true",
    noLocalBpm: params.get("noLocalBpm") === "true",
    audioFeatureStatus,
    failedOnly: params.get("failedOnly") === "true",
    missingDataOnly,
    settings: audioFeatureSettings,
  });

  try {
    const queryStarted = Date.now();
    const orderBy = withStableTieBreaker(sort ? orderByForLibraryHealth(sort, direction, category) : defaultOrderForLibraryHealth(category));
    const [total, tracks] = await prisma.$transaction([
      prisma.track.count({ where }),
      prisma.track.findMany({
        where,
        select: libraryHealthDetailTrackSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const mode = metadataProviderModeKey(audioFeatureSettings);
    const items = tracks.map((track) => serializeLibraryHealthDetailTrack(track, category, audioFeatureSettings));
    console.log(`[LibraryHealth] detail filter=${category} total=${total} page=${page} pageSize=${pageSize} pageRows=${tracks.length} libraryId=${libraryId || "all"} filtered=${hasAdditionalDetailFilters(params)} durationMs=${Date.now() - queryStarted} mode=${mode}`);

    return NextResponse.json({
      items,
      tracks: items,
      total,
      resolvedTotal: total,
      countDetailMismatch: false,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      category,
      filter: category,
      sort: sort || null,
      direction,
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    console.error("[LibraryHealthDetails] Failed to load tracks", {
      category,
      page,
      pageSize,
      libraryId: libraryId || "all",
      filters: {
        search: params.get("search")?.trim() || null,
        artist: params.get("artist")?.trim() || null,
        album: params.get("album")?.trim() || null,
        bpmSource: params.get("bpmSource") || null,
        bpmConfidence: params.get("bpmConfidence") || null,
        bpmConflict: params.get("bpmConflict") || null,
        apiImportedOnly: params.get("apiImportedOnly") === "true",
        noLocalBpm: params.get("noLocalBpm") === "true",
        audioFeatureStatus,
        failedOnly: params.get("failedOnly") === "true",
        missingDataOnly,
      },
      prismaCode: prismaError.code || null,
      error,
    });
    return NextResponse.json({ error: "Unable to load Library Health details. Retry or check the server logs." }, { status: 500 });
  }
}
