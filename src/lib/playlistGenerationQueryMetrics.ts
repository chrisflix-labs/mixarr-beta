import { AsyncLocalStorage } from "node:async_hooks";

type QueryCounter = { count: number };

const globalMetrics = globalThis as typeof globalThis & { mixarrPlaylistGenerationQueryStorage?: AsyncLocalStorage<QueryCounter> };
const storage = globalMetrics.mixarrPlaylistGenerationQueryStorage ?? new AsyncLocalStorage<QueryCounter>();
globalMetrics.mixarrPlaylistGenerationQueryStorage = storage;

export function countPlaylistGenerationDatabaseQuery() {
  const counter = storage.getStore();
  if (counter) counter.count += 1;
}

export function withPlaylistGenerationQueryCount<T>(operation: (counter: QueryCounter) => Promise<T>) {
  const counter = { count: 0 };
  return storage.run(counter, () => operation(counter));
}
