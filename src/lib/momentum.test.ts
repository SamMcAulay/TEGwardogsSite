import { describe, expect, test } from 'vitest';
import { momentum } from './momentum';

const k = (t: number, faction: string | null, own = false) => ({ t, faction, own });

describe('momentum', () => {
  test('per-minute kills for each side; own goals and the environment count for nobody', () => {
    const m = momentum([k(10, 'A'), k(50, 'A'), k(70, 'B'), k(80, 'A', true), k(90, null), k(150, 'B')], ['A', 'B'], 180);
    expect(m.bucketS).toBe(60);
    expect(m.buckets).toEqual([[2, 0], [0, 1], [0, 1]]);
    expect(m.swing).toEqual({ index: 0, leader: 0 });
  });

  test('long rounds get wider buckets, at most 40', () => {
    expect(momentum([], ['A', 'B'], 39 * 60).bucketS).toBe(60);
    expect(momentum([], ['A', 'B'], 41 * 60).bucketS).toBe(120);
    const long = momentum([k(3 * 3600, 'A')], ['A', 'B'], 60);
    expect(long.bucketS).toBe(300);
    expect(long.buckets).toHaveLength(36);
    expect(long.buckets.at(-1)).toEqual([1, 0]);
  });

  test('no swing without kills or without exactly two sides', () => {
    expect(momentum([], ['A', 'B'], 600).swing).toBeNull();
    expect(momentum([k(1, 'A')], ['A', 'B', 'C'], 600).swing).toBeNull();
  });
});
