import { describe, expect, test } from 'vitest';
import { loadSiteEnv } from './env';

const base = { WARCON_BASE_URL: 'http://warcon:3000/', WARCON_TOKEN: 'wk_x', SITE_URL: 'https://stats.example.com/' };

describe('loadSiteEnv', () => {
  test('trims trailing slashes and applies defaults', () => {
    expect(loadSiteEnv(base)).toEqual({
      warconBaseUrl: 'http://warcon:3000',
      warconToken: 'wk_x',
      siteUrl: 'https://stats.example.com',
      serverIds: [],
      allowIndexing: false,
    });
  });

  test('the token keeps a trailing slash; only the URLs lose theirs', () => {
    expect(loadSiteEnv({ ...base, WARCON_TOKEN: 'wk_abc/' }).warconToken).toBe('wk_abc/');
    expect(loadSiteEnv({ ...base, WARCON_BASE_URL: 'http://warcon:3000//' }).warconBaseUrl).toBe('http://warcon:3000');
  });

  test('SERVER_IDS keeps order and drops blanks', () => {
    expect(loadSiteEnv({ ...base, SERVER_IDS: ' b, a ,,' }).serverIds).toEqual(['b', 'a']);
  });

  test('ALLOW_INDEXING is true only for "true"', () => {
    expect(loadSiteEnv({ ...base, ALLOW_INDEXING: 'true' }).allowIndexing).toBe(true);
    expect(loadSiteEnv({ ...base, ALLOW_INDEXING: 'yes' }).allowIndexing).toBe(false);
  });

  test('names every missing required variable', () => {
    expect(() => loadSiteEnv({})).toThrow(/WARCON_BASE_URL[\s\S]*WARCON_TOKEN[\s\S]*SITE_URL/);
  });

  test('rejects a non-http SITE_URL or WARCON_BASE_URL', () => {
    expect(() => loadSiteEnv({ ...base, SITE_URL: 'stats.example.com' })).toThrow(/SITE_URL/);
    expect(() => loadSiteEnv({ ...base, WARCON_BASE_URL: 'warcon:3000' })).toThrow(/WARCON_BASE_URL/);
  });
});
