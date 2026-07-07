import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  DEFAULT_LIBRARY_HEALTH_CATEGORY,
  MAX_LIBRARY_HEALTH_PAGE_SIZE,
  buildLibraryHealthTrackWhere,
  defaultOrderForLibraryHealth,
  getLibraryHealthAudioFeatureGapTrackIds,
  isLibraryHealthDetailCategory,
  libraryHealthDetailTrackSelect,
  orderByForLibraryHealth,
  resolveBpmMetadataFilteredTrackIds,
  resolveLibraryHealthTrackIds,
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

function categoryUsesResolvedTrackIds(category: string) {
  return category === "missing_audio_features"
    || category === "pending_audio_features"
    || category === "partial_audio_features"
    || category === "missing_bpm"
    || category === "api_bpm"
    || category === "local_bpm"
    || category === "imported_bpm"
    || category === "pending_bpm"
    || category === "low_confidence_bpm"
    || category === "bpm_source_conflict"
    || category === "failed_analysis"
    || category === "missing_local_file";
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
    || (params.get("localFileStatus") && params.get("localFileStatus") !== "all")
    || params.get("failedOnly") === "true"
    || params.get("missingDataOnly") === "true"
  );
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
  const audioFeatureGapTrackIds = await getLibraryHealthAudioFeatureGapTrackIds(userId, {
    category,
    libraryId,
    settings: audioFeatureSettings,
    audioFeatureStatus,
    missingDataOnly,
  });
  const resolved = categoryUsesResolvedTrackIds(category)
    ? await resolveLibraryHealthTrackIds(userId, {
      category,
      libraryId,
      settings: audioFeatureSettings,
    })
    : null;
  const needsBpmMetadataFilter = !!(
    (params.get("bpmSource") && params.get("bpmSource") !== "all")
    || (params.get("bpmConfidence") && params.get("bpmConfidence") !== "all")
    || (params.get("bpmConflict") && params.get("bpmConflict") !== "all")
    || params.get("apiImportedOnly") === "true"
    || params.get("noLocalBpm") === "true"
  );
  const bpmMetadataTrackIds = needsBpmMetadataFilter
    ? await resolveBpmMetadataFilteredTrackIds(userId, {
      category,
      libraryId,
      settings: audioFeatureSettings,
      bpmSource: params.get("bpmSource") || "all",
      bpmConfidence: params.get("bpmConfidence") || "all",
      bpmConflict: params.get("bpmConflict") || "all",
      apiImportedOnly: params.get("apiImportedOnly") === "true",
      noLocalBpm: params.get("noLocalBpm") === "true",
      resolvedTrackIds: resolved?.trackIds,
    })
    : null;

  const where = buildLibraryHealthTrackWhere(userId, {
    category,
    libraryId,
    search: params.get("search")?.trim() || undefined,
    artist: params.get("artist")?.trim() || undefined,
    album: params.get("album")?.trim() || undefined,
    bpmSource: needsBpmMetadataFilter ? undefined : params.get("bpmSource") || undefined,
    bpmConfidence: needsBpmMetadataFilter ? undefined : params.get("bpmConfidence") || undefined,
    bpmConflict: needsBpmMetadataFilter ? undefined : params.get("bpmConflict") || undefined,
    apiImportedOnly: needsBpmMetadataFilter ? undefined : params.get("apiImportedOnly") === "true",
    noLocalBpm: needsBpmMetadataFilter ? undefined : params.get("noLocalBpm") === "true",
    audioFeatureStatus,
    localFileStatus: params.get("localFileStatus") || undefined,
    failedOnly: params.get("failedOnly") === "true",
    missingDataOnly,
    settings: audioFeatureSettings,
    audioFeatureGapTrackIds,
    resolvedTrackIds: bpmMetadataTrackIds ?? resolved?.trackIds,
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
    const expectedTotal = resolved?.count ?? total;
    const countDetailMismatch = !!resolved && resolved.count !== total && !hasAdditionalDetailFilters(params);
    if (countDetailMismatch) {
      console.error(`[LibraryHealth][ERROR] Count/detail mismatch category=${category} cardCount=${resolved.count} detailCount=${total}`);
    }
    console.log(`[LibraryHealth] detail filter=${category} returned=${total} total=${expectedTotal} pageRows=${tracks.length} gapCount=${resolved?.debug?.gap ?? audioFeatureGapTrackIds.length} mode=${mode}`);

    return NextResponse.json({
      tracks: tracks.map((track) => serializeLibraryHealthDetailTrack(track, category, audioFeatureSettings)),
      total,
      resolvedTotal: expectedTotal,
      countDetailMismatch,
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
