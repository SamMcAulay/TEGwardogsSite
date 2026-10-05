// In-memory cache for Warcon answers: one load per key at a time, the last good value served
// (flagged stale) for a while when Warcon fails, a short backoff after a failure so a down Warcon
// isn't asked again on every request, and a size cap evicting the least recently used.

export interface Cached<T> {
  value: T;
  stale: boolean;
}

interface Entry {
  value: unknown;
  freshUntil: number;
}

interface Failure {
  error: unknown;
  until: number;
}

export class TtlCache {
  private entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<unknown>>();
  private failures = new Map<string, Failure>();
  private readonly maxEntries: number;
  private readonly staleMs: number;
  private readonly backoffMs: number;
  private readonly now: () => number;

  constructor(opts: { maxEntries?: number; staleMs?: number; backoffMs?: number; now?: () => number } = {}) {
    this.maxEntries = opts.maxEntries ?? 500;
    this.staleMs = opts.staleMs ?? 300_000;
    this.backoffMs = opts.backoffMs ?? 15_000;
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

    // A recent failure: answer from what we have rather than asking Warcon again yet.
    const failed = this.failures.get(key);
    if (failed) {
      if (this.now() < failed.until) return this.fallback<T>(key, failed.error);
      this.failures.delete(key);
    }

    let pending = this.loading.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load().finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }

    try {
      const value = await pending;
      this.failures.delete(key);
      this.store(key, { value, freshUntil: this.now() + (typeof ttlMs === 'function' ? ttlMs(value) : ttlMs) });
      return { value, stale: false };
    } catch (e) {
      this.noteFailure(key, e);
      return this.fallback<T>(key, e);
    }
  }

  /** The last value as stale while inside the stale window, else the error. */
  private fallback<T>(key: string, error: unknown): Cached<T> {
    const last = this.entries.get(key);
    if (last && this.now() < last.freshUntil + this.staleMs) return { value: last.value as T, stale: true };
    throw error;
  }

  private noteFailure(key: string, error: unknown) {
    // Callers sharing one failed load all land here; the first one sets the window.
    if ((this.failures.get(key)?.until ?? 0) > this.now()) return;
    this.failures.delete(key);
    this.failures.set(key, { error, until: this.now() + this.backoffMs });
    while (this.failures.size > this.maxEntries) {
      this.failures.delete(this.failures.keys().next().value!);
    }
  }

  /** A fresh value for key, without loading. */
  peek<T>(key: string): { value: T } | undefined {
    const hit = this.entries.get(key);
    if (!hit || this.now() >= hit.freshUntil) return undefined;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return { value: hit.value as T };
  }

  /** Store a value loaded outside get() (one batched call filling many keys). */
  put(key: string, value: unknown, ttlMs: number) {
    this.store(key, { value, freshUntil: this.now() + ttlMs });
  }

  private store(key: string, entry: Entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
}
