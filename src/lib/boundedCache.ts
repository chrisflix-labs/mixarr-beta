/**
 * Adds an entry to a small process-local cache while pruning expired entries
 * and enforcing a hard cardinality limit. Values may expose `expiresAt` in
 * milliseconds; maps without an expiry still receive FIFO eviction.
 */
export function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, maximumEntries = 1_000, now = Date.now()) {
  cache.forEach((candidate, candidateKey) => {
    const expiresAt = Number((candidate as { expiresAt?: unknown })?.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= now) cache.delete(candidateKey);
  });
  cache.delete(key);
  while (cache.size >= maximumEntries) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}
