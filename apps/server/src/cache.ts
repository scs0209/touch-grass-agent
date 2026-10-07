interface Entry<T> {
  value: Promise<T>;
  expiresAt: number;
}

interface CacheOptions<T> {
  ttlMs: number;
  /** Least recently used entries go first past this, so a long-running server doesn't grow without bound. */
  maxEntries?: number;
  /** How long past its expiry a value may still stand in when fetching a fresh one fails. */
  staleMs?: number;
  /** A shorter life for some values once they arrive; 0 drops the value right away. */
  ttlFor?: (value: T) => number;
}

/**
 * Promises by key, so callers asking for the same thing at the same time share one request. A failed
 * request is forgotten at once, so the next call tries again instead of getting the error back.
 */
export function createCache<T>({ ttlMs, maxEntries = 500, staleMs = 0, ttlFor }: CacheOptions<T>) {
  const entries = new Map<string, Entry<T>>();

  function prune(now: number) {
    for (const [key, entry] of entries) if (entry.expiresAt + staleMs <= now) entries.delete(key);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
  }

  function store(key: string, value: Promise<T>): Entry<T> {
    const now = Date.now();
    const entry = { value, expiresAt: now + ttlMs };
    entries.delete(key);
    entries.set(key, entry);
    prune(now);
    value.then(
      (result) => {
        if (ttlFor && entries.get(key) === entry) entry.expiresAt = now + Math.min(ttlMs, ttlFor(result));
      },
      () => {
        if (entries.get(key) === entry) entries.delete(key);
      },
    );
    return entry;
  }

  function fresh(key: string) {
    const entry = entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return undefined;
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  return {
    /** The cached value while fresh; otherwise loads it, falling back to a value no more than staleMs old. */
    getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
      const cached = fresh(key);
      if (cached) return cached;
      const old = entries.get(key);
      const stale = old && old.expiresAt + staleMs > Date.now() ? old : undefined;
      let entry: Entry<T> | undefined;
      const value = stale
        ? load().catch(() => {
            // The old value keeps its old expiry, so the next call still tries for a fresh one.
            if (entries.get(key) === entry) entries.set(key, stale);
            return stale.value;
          })
        : load();
      entry = store(key, value);
      return value;
    },
    /** The cached value while fresh, without loading anything. */
    peek: fresh,
    set(key: string, value: Promise<T>) {
      return store(key, value).value;
    },
  };
}
