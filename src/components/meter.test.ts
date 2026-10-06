import { describe, expect, test } from 'vitest';
import { meterWidth } from './ui';

describe('meterWidth', () => {
  test('a share of the max, never wider than the track', () => {
    expect(meterWidth(50, 100)).toBe(50);
    // A value above max (an unsorted list scaled by its first row) once drew a 565% bar that
    // stretched the whole page on phones.
    expect(meterWidth(695, 123)).toBe(100);
  });

  test('a sliver for tiny values, nothing for an empty max', () => {
    expect(meterWidth(1, 1000)).toBe(1.5);
    expect(meterWidth(5, 0)).toBe(0);
  });
});
