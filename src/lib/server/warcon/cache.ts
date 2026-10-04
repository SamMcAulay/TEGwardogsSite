// In-memory cache for Warcon answers: one load per key at a time, the last good value served
// (flagged stale) for a while when Warcon fails, and a size cap evicting the least recently used.

export interface Cached<T> {
  value: T;
  stale: boolean;
}

interface Entry {
  value: unknown;
  freshUntil: number;
}

export class TtlCache {
  private entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly staleMs: number;
  private readonly now: () => number;

  constructor(opts: { maxEntries?: number; staleMs?: number; now?: () => number } = {}) {
    this.maxEntries = opts.maxEntries ?? 500;
    this.staleMs = opts.staleMs ?? 300_000;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  async get<T>(key: string, ttlMs: number | ((value: T) => number), load: () => Promise<T>): Promise<Cached<T>> {
    const hit = this.entries.get(key);
    if (hit) {
      // Map keeps insertion order: re-inserting marks the key most recently used.
      this.entries.delete(key);
      this.entries.set(key, hit);
      if (this.now() < hit.freshUntil) return { value: hit.value as T, stale: false };
    }

    let pending = this.loading.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load().finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }

    try {
      const value = await pending;
      this.store(key, { value, freshUntil: this.now() + (typeof ttlMs === 'function' ? ttlMs(value) : ttlMs) });
      return { value, stale: false };
    } catch (e) {
      const last = this.entries.get(key);
      if (last && this.now() < last.freshUntil + this.staleMs) return { value: last.value as T, stale: true };
      throw e;
    }
  }

  private store(key: string, entry: Entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
}
