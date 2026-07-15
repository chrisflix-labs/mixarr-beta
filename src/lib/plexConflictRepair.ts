import prisma from "./prisma";
import { fetchPlexItems } from "./syncEngine";
import { getUserSyncSettings, resolveLimit } from "./syncSettings";
import { createDuplicateCandidateIndex, findBestDuplicateCandidateFromIndex } from "./duplicateRecordings";
import { normalizePlexTrackForSync } from "./trackSync";

function hasEnrichment(track: any) {
  return track.effectiveBpm != null
    || track.localBpm != null
    || track.apiBpm != null
    || track.bpm != null
    || track.audioFeature?.effectiveEnergy != null
    || track.audioFeature?.effectiveMood != null
    || track.audioFeature?.localEnergy != null
    || track.audioFeature?.localMood != null;
}

export async function previewPlexConflictRepair(userId: string, libraryId: string) {
  const library = await prisma.library.findFirst({
    where: { id: libraryId, server: { userId } },
    include: { server: true },
  });
  if (!library) throw new Error("Library not found");
  const settings = await getUserSyncSettings(userId);
  const pageSize = resolveLimit(settings.plexPageSize, "PLEX_METADATA_PAGE_SIZE");
  const { items } = await fetchPlexItems(library.server.uri, library.server.accessToken, library.plexId, 10, pageSize);
  const existing = await prisma.track.findMany({
    where: { libraryId },
    select: {
      id: true,
      ratingKey: true,
      plexGuid: true,
      mediaPath: true,
      title: true,
      duration: true,
      canonicalRecordingId: true,
      artist: { select: { title: true } },
      album: { select: { title: true } },
      bpm: true,
      apiBpm: true,
      localBpm: true,
      effectiveBpm: true,
      audioFeature: { select: { effectiveEnergy: true, effectiveMood: true, localEnergy: true, localMood: true } },
    },
  });
  const existingKeys = new Set(existing.map((track) => track.ratingKey));
  const index = createDuplicateCandidateIndex(existing);
  let possibleDuplicateGroups = 0;
  let existingEnrichmentAvailable = 0;
  let manualReviewRecommended = 0;
  const missingRatingKeys: string[] = [];

  for (const item of items) {
    const normalized = normalizePlexTrackForSync(item, library.plexId);
    if (existingKeys.has(normalized.ratingKey)) continue;
    missingRatingKeys.push(normalized.ratingKey);
    const candidate = findBestDuplicateCandidateFromIndex(normalized, index);
    if (candidate?.assessment.shouldAutoGroup) possibleDuplicateGroups += 1;
    else if (candidate) manualReviewRecommended += 1;
    if (candidate && hasEnrichment(candidate.candidate)) existingEnrichmentAvailable += 1;
  }

  const durableUnresolved = await prisma.plexSyncConflict.count({ where: { libraryId, resolutionStatus: "unresolved" } });
  return {
    library: { id: library.id, name: library.name },
    plexReported: items.length,
    mixarrActive: await prisma.track.count({ where: { libraryId, syncStatus: "active" } }),
    unresolvedPlexTracks: Math.max(durableUnresolved, missingRatingKeys.length),
    newTrackInstancesExpected: missingRatingKeys.length,
    possibleDuplicateGroups,
    existingEnrichmentAvailable,
    manualReviewRecommended,
    sampleMissingRatingKeys: missingRatingKeys.slice(0, 25),
    calculatedAt: new Date().toISOString(),
  };
}
