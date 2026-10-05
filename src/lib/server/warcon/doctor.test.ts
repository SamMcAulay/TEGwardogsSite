import { describe, expect, test } from 'vitest';
import { runChecks } from './doctor';
import { WarconError } from './http';

const env = { warconBaseUrl: 'http://w', warconToken: 't', siteUrl: 'https://s', serverIds: ['s1', 'nope'], allowIndexing: false };
const okCached = <T>(value: T) => Promise.resolve({ value, stale: false });

const api = (over: Record<string, unknown> = {}) =>
  ({
    servers: () => okCached([{ id: 's1', orgId: 'o', name: 'EU#1', sortOrder: 0 }]),
    live: () => okCached(null),
    board: () => okCached({ ok: true, rows: [], total: 0, pageSize: 50 }),
    matches: () => okCached({ ok: true, matches: [], live: [], page: 1, pages: 1, total: 0 }),
    kills: () => okCached({ ok: true, kills: [], total: 0 }),
    analytics: () => okCached({}),
    seen: () => okCached([]),
    boardExportCsv: async () => 'rank,steam_id\n',
    ...over,
  }) as never;

describe('runChecks', () => {
  test('a rejected key is one clear failure', async () => {
    const r = await runChecks(api({ servers: () => Promise.reject(new WarconError('x', 'rejected', 401, '/api/servers')) }), env);
    expect(r).toEqual([{ name: 'key', ok: false, detail: expect.stringMatching(/rejected/) }]);
  });

  test('a SERVER_IDS entry the key cannot see fails', async () => {
    const r = await runChecks(api(), env);
    expect(r.find((c) => c.name === 'SERVER_IDS')).toMatchObject({ ok: false, detail: expect.stringContaining('nope') });
  });

  test('each endpoint is checked per server', async () => {
    const r = await runChecks(api(), { ...env, serverIds: [] });
    expect(r.filter((c) => c.name.endsWith('(s1)')).map((c) => c.name)).toEqual(['summary (s1)', 'leaderboard (s1)', 'matches (s1)', 'kills (s1)', 'analytics (s1)', 'players/seen (s1)']);
    expect(r.every((c) => c.ok)).toBe(true);
  });
});
