import { describe, expect, it, test } from 'vitest';
import { pageParam, serverPath, serverSlug } from './url';

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

describe('serverSlug', () => {
  it('makes a short address from the short name', () => {
    expect(serverSlug('EU#1 - Sealclubbing = ban')).toBe('eu1');
    expect(serverSlug('EU#2')).toBe('eu2');
    expect(serverSlug('NA-WEST - TEG.gg')).toBe('nawest');
    expect(serverSlug('NA-East')).toBe('naeast');
    expect(serverPath('NA-East - TEG.gg')).toBe('/servers/naeast');
  });
});
