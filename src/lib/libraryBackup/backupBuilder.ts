/**
 * Library Intelligence Backup — database-backed archive builder.
 *
 * Streams track rows from Prisma in batches (bounded memory) and hands them to
 * the pure archive writer. No external services are contacted.
 */
import prisma from "../prisma";
import { mapTrackRowToRecord, trackExportSelect, writeArchiveFromRecords, type TrackExportRow } from "./archiveWriter";
import type { BackupTrackRecord } from "./archiveFormat";

export { mapTrackRowToRecord, trackExportSelect, writeArchiveFromRecords };
export type { BuiltArchive } from "./archiveWriter";

const EXPORT_BATCH_SIZE = 500;

/** Async generator yielding export records for a user's active library, batched. */
export async function* streamTrackRecords(userId: string, libraryId?: string): AsyncGenerator<BackupTrackRecord> {
  let cursor: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = (await prisma.track.findMany({
      where: {
        syncStatus: "active",
        library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
      },
      select: trackExportSelect,
      orderBy: { id: "asc" },
      take: EXPORT_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })) as unknown as TrackExportRow[];
    if (!rows.length) break;
    for (const row of rows) yield mapTrackRowToRecord(row);
    cursor = rows[rows.length - 1].id;
    if (rows.length < EXPORT_BATCH_SIZE) break;
  }
}

export async function countBackupTracks(userId: string, libraryId?: string): Promise<number> {
  return prisma.track.count({
    where: { syncStatus: "active", library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } } },
  });
}
