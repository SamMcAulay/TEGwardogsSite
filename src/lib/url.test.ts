import { describe, expect, test } from 'vitest';
import { pageParam } from './url';

describe('pageParam', () => {
  test('floors, clamps to at least 1 and at most 1000', () => {
    expect(pageParam('2.9')).toBe(2);
    expect(pageParam('0')).toBe(1);
    expect(pageParam('-4')).toBe(1);
    expect(pageParam('abc')).toBe(1);
    expect(pageParam(undefined)).toBe(1);
    expect(pageParam('1e9')).toBe(1000);
  });
});
