import { PLAYLIST_GENERATION_LIMITS } from "./playlistGenerationLimits";

export function chunkValues<T>(values: readonly T[], batchSize = PLAYLIST_GENERATION_LIMITS.queryBatchSize): T[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) chunks.push(values.slice(offset, offset + size));
  return chunks;
}

export async function queryInBatches<TValue, TResult>(
  values: readonly TValue[],
  query: (batch: TValue[], batchIndex: number) => Promise<readonly TResult[]>,
  batchSize = PLAYLIST_GENERATION_LIMITS.queryBatchSize,
) {
  const results: TResult[] = [];
  const batches = chunkValues(Array.from(new Set(values)), batchSize);
  for (let index = 0; index < batches.length; index += 1) results.push(...await query(batches[index], index));
  return results;
}
