import { describe, expect, test } from 'vitest';
import { safe, sectionState } from './section';

describe('sectionState', () => {
  test('ok, stale and down', () => {
    expect(sectionState({ data: 1, stale: false, missing: [] })).toBe('ok');
    expect(sectionState({ data: 1, stale: true, missing: [] })).toBe('stale');
    expect(sectionState({ data: 1, stale: false, missing: ['s2'] })).toBe('stale');
    expect(sectionState(new Error('down'))).toBe('down');
  });

  test('safe() turns a rejection into an Error value', async () => {
    expect(await safe(Promise.reject(new Error('x')))).toBeInstanceOf(Error);
    expect(await safe(Promise.resolve(3))).toBe(3);
  });
});
