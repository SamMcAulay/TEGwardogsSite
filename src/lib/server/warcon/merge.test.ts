import { describe, expect, test } from 'vitest';
import { fanOut, mergeNewest } from './merge';

describe('fanOut', () => {
  test('collects successes and names the servers that failed', async () => {
    const r = await fanOut(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw new Error('down');
      return { value: id.toUpperCase(), stale: id === 'c' };
    });
    expect(r.ok).toEqual([{ id: 'a', value: 'A' }, { id: 'c', value: 'C' }]);
    expect(r.failed).toEqual(['b']);
    expect(r.stale).toBe(true);
  });

  test('every server failing still resolves', async () => {
    const r = await fanOut(['a'], async () => Promise.reject(new Error('x')));
    expect(r).toEqual({ ok: [], failed: ['a'], stale: false });
  });
});

describe('mergeNewest', () => {
  test('interleaves newest first and trims to the limit', () => {
    const rows = mergeNewest([[{ t: 9 }, { t: 5 }], [{ t: 7 }, { t: 1 }]], (r) => r.t, 3);
    expect(rows.map((r) => r.t)).toEqual([9, 7, 5]);
  });
});
