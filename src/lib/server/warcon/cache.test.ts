import { describe, expect, test, vi } from 'vitest';
import { TtlCache } from './cache';

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('TtlCache', () => {
  test('serves a fresh value without loading again', async () => {
    const c = clock();
    const cache = new TtlCache({ now: c.now });
    const load = vi.fn(async () => 1);
    await cache.get('k', 1000, load);
    c.advance(999);
    expect(await cache.get('k', 1000, load)).toEqual({ value: 1, stale: false });
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('reloads once the value is past its freshness', async () => {
    const c = clock();
    const cache = new TtlCache({ now: c.now });
    let n = 0;
    const load = async () => ++n;
    await cache.get('k', 1000, load);
    c.advance(1001);
    expect((await cache.get('k', 1000, load)).value).toBe(2);
  });

  test('concurrent callers share one load', async () => {
    const cache = new TtlCache();
    let release!: (v: number) => void;
    const load = vi.fn(() => new Promise<number>((r) => (release = r)));
    const all = Promise.all(Array.from({ length: 50 }, () => cache.get('k', 1000, load)));
    release(7);
    expect((await all).every((r) => r.value === 7)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('a failed refresh serves the last value as stale for up to 5 minutes, then throws', async () => {
    const c = clock();
    const cache = new TtlCache({ now: c.now, staleMs: 300_000 });
    await cache.get('k', 1000, async () => 1);
    const boom = async () => {
      throw new Error('down');
    };
    c.advance(1000 + 299_000);
    expect(await cache.get('k', 1000, boom)).toEqual({ value: 1, stale: true });
    c.advance(2000);
    await expect(cache.get('k', 1000, boom)).rejects.toThrow('down');
  });

  test('a failure with nothing cached throws, and is not cached', async () => {
    const c = clock();
    const cache = new TtlCache({ now: c.now });
    await expect(cache.get('k', 1000, async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    c.advance(15_001);
    expect((await cache.get('k', 1000, async () => 2)).value).toBe(2);
  });

  test('the TTL may depend on the loaded value', async () => {
    const c = clock();
    const cache = new TtlCache({ now: c.now });
    const load = vi.fn(async () => ({ ended: true }));
    const ttl = (v: { ended: boolean }) => (v.ended ? 3_600_000 : 1000);
    await cache.get('k', ttl, load);
    c.advance(60_000);
    await cache.get('k', ttl, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('evicts the least recently used past maxEntries', async () => {
    const cache = new TtlCache({ maxEntries: 2 });
    const load = vi.fn(async () => 1);
    await cache.get('a', 1000, load);
    await cache.get('b', 1000, load);
    await cache.get('a', 1000, load); // a is now most recent
    await cache.get('c', 1000, load); // evicts b
    expect(cache.size).toBe(2);
    load.mockClear();
    await cache.get('a', 1000, load);
    await cache.get('b', 1000, load);
    expect(load).toHaveBeenCalledTimes(1); // only b reloaded
  });
  describe('failure backoff', () => {
    test('after one failure, calls within 15 s serve the stale value without loading', async () => {
      const c = clock();
      const cache = new TtlCache({ now: c.now });
      await cache.get('k', 1000, async () => 1);
      c.advance(2000);
      const boom = vi.fn(async () => {
        throw new Error('down');
      });
      expect(await cache.get('k', 1000, boom)).toEqual({ value: 1, stale: true });
      for (let i = 0; i < 5; i++) {
        c.advance(2000);
        expect(await cache.get('k', 1000, boom)).toEqual({ value: 1, stale: true });
      }
      expect(boom).toHaveBeenCalledTimes(1);
    });

    test('with no stale value, calls within 15 s rethrow the last error without loading', async () => {
      const c = clock();
      const cache = new TtlCache({ now: c.now });
      const boom = vi.fn(async () => {
        throw new Error('down');
      });
      await expect(cache.get('k', 1000, boom)).rejects.toThrow('down');
      const ok = vi.fn(async () => 2);
      for (let i = 0; i < 5; i++) {
        c.advance(1000);
        await expect(cache.get('k', 1000, ok)).rejects.toThrow('down');
      }
      expect(boom).toHaveBeenCalledTimes(1);
      expect(ok).not.toHaveBeenCalled();
    });

    test('after 15 s, one new load is attempted (shared by concurrent callers)', async () => {
      const c = clock();
      const cache = new TtlCache({ now: c.now });
      await expect(cache.get('k', 1000, async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
      c.advance(15_001);
      const ok = vi.fn(async () => 3);
      const all = await Promise.all([cache.get('k', 1000, ok), cache.get('k', 1000, ok), cache.get('k', 1000, ok)]);
      expect(all.every((r) => r.value === 3 && !r.stale)).toBe(true);
      expect(ok).toHaveBeenCalledTimes(1);
    });
  });
});
