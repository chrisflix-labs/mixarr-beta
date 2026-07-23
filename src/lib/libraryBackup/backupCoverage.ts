/**
 * Coverage summary for the Library Intelligence Backup page. Reuses the existing
 * library-health summaries so the backup cards match the data-enrichment cards.
 */
import prisma from "../prisma";
import {
  getAudioFeatureHealthSummary,
  getBpmHealthSummary,
  getGenreHealthSummary,
  getPopularityHealthSummary,
} from "../libraryHealth";
import { BACKUP_STORAGE_WARNING, resolveBackupDir } from "./backupStorage";
import { EXPORT_EXCLUDED_CATEGORIES, EXPORT_INCLUDED_CATEGORIES } from "./scopeDescription";

export type LibraryBackupCoverage = {
  totalTracks: number;
  plexLibrary: { tracksAvailable: number };
  audioFeatures: { completed: number; incomplete: number; local: number; api: number; estimated: number };
  popularity: { values: number; attempted: number; noData: number };
  genres: { values: number; attempted: number; noData: number };
  bpm: { values: number; attempted: number; pending: number };
  storage: { backupDirLabel: string; warning: string; separateVolumeUnverified: boolean };
  included: string[];
  excluded: string[];
};

export async function getLibraryBackupCoverage(userId: string, libraryId?: string): Promise<LibraryBackupCoverage> {
  const [totalTracks, audio, bpm, genres, popularity] = await Promise.all([
    prisma.track.count({ where: { syncStatus: "active", library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } } } }),
    getAudioFeatureHealthSummary(userId, libraryId),
    getBpmHealthSummary(userId, libraryId),
    getGenreHealthSummary(userId, libraryId),
    getPopularityHealthSummary(userId, libraryId),
  ]);

  const audioComplete = audio.complete ?? 0;
  const audioLocal = audio.local ?? 0;
  const audioApi = audio.api ?? 0;
  const audioEstimated = audio.heuristic ?? 0; // Mixarr labels estimated features "heuristic"

  return {
    totalTracks,
    plexLibrary: { tracksAvailable: totalTracks },
    audioFeatures: {
      completed: audioComplete,
      incomplete: Math.max(0, totalTracks - audioComplete),
      local: audioLocal,
      api: audioApi,
      estimated: audioEstimated,
    },
    popularity: {
      values: popularity.tracksWithPopularity,
      attempted: popularity.tracksWithPopularity + popularity.popularityNoData + popularity.popularityFailed,
      noData: popularity.popularityNoData,
    },
    genres: {
      values: genres.tracksWithGenres,
      attempted: genres.tracksWithGenres + genres.genreNoData + genres.genreFailed,
      noData: genres.genreNoData,
    },
    bpm: {
      values: bpm.tracksWithBpm,
      attempted: bpm.tracksWithBpm + bpm.bpmNoData + bpm.bpmFailed,
      pending: bpm.pendingBackfill,
    },
    storage: {
      // Only the directory label (not the absolute server path) is exposed.
      backupDirLabel: resolveBackupDir().replace(/^.*[\\/]/, "") || "backups",
      warning: BACKUP_STORAGE_WARNING,
      // Mixarr cannot verify volume separation, so it never claims the backup is safe.
      separateVolumeUnverified: true,
    },
    included: [...EXPORT_INCLUDED_CATEGORIES],
    excluded: [...EXPORT_EXCLUDED_CATEGORIES],
  };
}
