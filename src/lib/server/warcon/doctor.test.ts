import { describe, expect, test, vi } from 'vitest';
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
    boardExportCsv: async () => 'rank,steam_id,name\n',
    dossier: () => okCached({}),
    career: () => okCached({}),
    match: () => okCached({}),
    steamProfiles: async () => ({}),
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

  const CSV = 'rank,steam_id,name,playtime_min\n1,76561198000000001,A,5\n';
  const ENDED = { ok: true, live: [], page: 1, pages: 1, total: 2, matches: [{ id: 5, endedAt: null }, { id: 4, endedAt: '2026-10-04T00:00:00Z' }] };

  test('the complex schemas are probed with a real player and an ended match', async () => {
    const dossier = vi.fn(() => okCached({}));
    const career = vi.fn(() => okCached({}));
    const match = vi.fn(() => okCached({}));
    const steamProfiles = vi.fn(async () => ({}));
    const r = await runChecks(api({ boardExportCsv: async () => CSV, matches: () => okCached(ENDED), dossier, career, match, steamProfiles }), { ...env, serverIds: [] });
    expect(dossier).toHaveBeenCalledWith('s1', '76561198000000001');
    expect(career).toHaveBeenCalledWith('s1', '76561198000000001');
    expect(match).toHaveBeenCalledWith('s1', 4);
    expect(steamProfiles).toHaveBeenCalledWith(['76561198000000001']);
    for (const name of ['search index export', 'player dossier', 'player career', 'match view', 'steam profiles (warning)']) {
      expect(r.find((c) => c.name === name), name).toMatchObject({ ok: true });
    }
    expect(r.find((c) => c.name === 'steam profiles (warning)')?.detail).toMatch(/0 of 1/);
  });

  test('a dossier that fails its schema fails the check', async () => {
    const r = await runChecks(api({ boardExportCsv: async () => CSV, dossier: () => Promise.reject(new Error('schema mismatch')) }), { ...env, serverIds: [] });
    expect(r.find((c) => c.name === 'player dossier')).toMatchObject({ ok: false, detail: 'schema mismatch' });
  });

  test('no players or no ended matches: those checks are skipped, not failed', async () => {
    const dossier = vi.fn();
    const r = await runChecks(api({ dossier }), { ...env, serverIds: [] });
    for (const name of ['player dossier', 'player career', 'match view', 'steam profiles (warning)']) {
      expect(r.find((c) => c.name === name), name).toEqual({ name, ok: true, detail: 'skipped: no data' });
    }
    expect(dossier).not.toHaveBeenCalled();
  });

  test('a key that sees no servers fails the key check and skips the rest without a TypeError', async () => {
    const r = await runChecks(api({ servers: () => okCached([]) }), { ...env, serverIds: [] });
    expect(r).toEqual([{ name: 'key', ok: false, detail: 'accepted; sees 0 server(s)' }]);
  });
});
