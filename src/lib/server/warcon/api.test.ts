import { describe, expect, test, vi } from 'vitest';
import { createApi, PLAYER_LOOKUPS, PLAYER_TIMEOUT_MS, TTL } from './api';
import { TtlCache } from './cache';
import type { Warcon } from './http';

const fake = (body: unknown) => {
  const json = vi.fn<(path: string, schema: { parse(v: unknown): unknown }, opts?: { timeoutMs?: number }) => Promise<unknown>>(async (_path, schema) => schema.parse(body));
  return { client: { json, text: vi.fn() } as unknown as Warcon, json };
};

describe('createApi', () => {
  test('board builds the documented query string', async () => {
    const { client, json } = fake({ ok: true, rows: [], total: 0, pageSize: 50 });
    await createApi(client, new TtlCache()).board('s1', { scope: 'org', range: '90d', sort: 'perHour', page: 2 });
    expect(json.mock.calls[0][0]).toBe('/api/servers/s1/leaderboard?scope=org&range=90d&sort=perHour&dir=desc&page=2&minMinutes=60');
  });

  test('kills passes only the filters that are set', async () => {
    const { client, json } = fake({ ok: true, kills: [], total: null });
    await createApi(client, new TtlCache()).kills('s1', { limit: 20, killer: '7656', kind: 'headshot', minM: null, count: true });
    expect(json.mock.calls[0][0]).toBe('/api/servers/s1/kills?limit=20&killer=7656&kind=headshot&count=1');
  });

  test('ids are URL-encoded', async () => {
    const { client, json } = fake({ ok: true, kills: [], total: null });
    await createApi(client, new TtlCache()).kills('a/b', {});
    expect(json.mock.calls[0][0]).toBe('/api/servers/a%2Fb/kills?limit=50');
  });

  test('a second call within the TTL is served from cache', async () => {
    const { client, json } = fake({ ok: true, servers: [] });
    const api = createApi(client, new TtlCache());
    await api.servers();
    await api.servers();
    expect(json).toHaveBeenCalledTimes(1);
  });

  test('steamProfiles batches by 100 and never throws', async () => {
    const json = vi.fn(async () => {
      throw new Error('steam_disabled');
    });
    const api = createApi({ json, text: vi.fn() } as unknown as Warcon, new TtlCache());
    const ids = Array.from({ length: 150 }, (_, i) => String(BigInt('76561198000000000') + BigInt(i)));
    await expect(api.steamProfiles(ids)).resolves.toEqual({});
    expect(json).toHaveBeenCalledTimes(2);
  });

  test('steamProfiles caches per id and fetches only the ids it has not seen', async () => {
    const json = vi.fn(async (path: string) =>
      Object.fromEntries(path.split('ids=')[1].split(',').map((id) => [id, { name: `n${id.slice(-1)}`, avatar: `a${id.slice(-1)}` }])),
    );
    const api = createApi({ json, text: vi.fn() } as unknown as Warcon, new TtlCache());
    const id = (n: number) => `7656119800000000${n}`;
    expect(await api.steamProfiles([id(1), id(2)])).toEqual({ [id(1)]: { name: 'n1', avatar: 'a1' }, [id(2)]: { name: 'n2', avatar: 'a2' } });
    const second = await api.steamProfiles([id(2), id(3)]);
    expect(json).toHaveBeenCalledTimes(2);
    expect(json.mock.calls[1][0]).toBe(`/api/steam/profiles?ids=${id(3)}`);
    expect(second).toEqual({ [id(2)]: { name: 'n2', avatar: 'a2' }, [id(3)]: { name: 'n3', avatar: 'a3' } });
    await api.steamProfiles([id(1), id(3)]);
    expect(json).toHaveBeenCalledTimes(2);
  });

  test('count queries are cached for the stats TTL; an explicit ttl overrides', async () => {
    let t = 0;
    const { client, json } = fake({ ok: true, kills: [], total: 3 });
    const api = createApi(client, new TtlCache({ now: () => t }));
    await api.kills('s1', { killer: '1', victim: '2', limit: 1, count: true });
    await api.kills('s1', { match: 9 }, { ttl: TTL.endedMatch });
    t = TTL.kills + 1;
    await api.kills('s1', { killer: '1', victim: '2', limit: 1, count: true });
    await api.kills('s1', { match: 9 }, { ttl: TTL.endedMatch });
    expect(json).toHaveBeenCalledTimes(2);
    t = TTL.stats + 1;
    await api.kills('s1', { killer: '1', victim: '2', limit: 1, count: true });
    expect(json).toHaveBeenCalledTimes(3);
  });
});

describe('player lookups', () => {
  test('only a few run in Warcon at once; the rest queue, and cache hits never wait', async () => {
    const json = vi.fn<(path: string) => Promise<unknown>>(() => new Promise(() => {}));
    const api = createApi({ json, text: vi.fn() } as unknown as Warcon, new TtlCache());
    const id = (n: number) => String(76561198000000000n + BigInt(n));
    for (let n = 0; n < PLAYER_LOOKUPS.max + 3; n++) {
      void api.dossier('s1', id(n));
      void api.career('s1', id(n));
    }
    await Promise.resolve();
    expect(json).toHaveBeenCalledTimes(PLAYER_LOOKUPS.max);
    expect(PLAYER_LOOKUPS).toMatchObject({ max: 3, maxWaitMs: 30_000 });
  });
});

describe('bannedPage', () => {
  test('asks for banned players 100 at a time from an offset, cached for 10 minutes', async () => {
    const { client, json } = fake({ ok: true, players: [], total: 0 });
    const cache = new TtlCache();
    const get = vi.spyOn(cache, 'get');
    await createApi(client, cache).bannedPage('s1', 200);
    expect(json.mock.calls[0][0]).toBe('/api/servers/s1/players/seen?flag=banned&sort=lastSeen&dir=desc&limit=100&offset=200');
    expect(get.mock.calls[0][1]).toBe(TTL.bans);
    expect(TTL.bans).toBe(600_000);
  });
});

describe('watchedPage', () => {
  test('asks for watched players 100 at a time from an offset, cached like the ban list', async () => {
    const { client, json } = fake({ ok: true, players: [], total: 0 });
    const cache = new TtlCache();
    const get = vi.spyOn(cache, 'get');
    await createApi(client, cache).watchedPage('s1', 100);
    expect(json.mock.calls[0][0]).toBe('/api/servers/s1/players/seen?flag=watched&sort=lastSeen&dir=desc&limit=100&offset=100');
    expect(get.mock.calls[0][1]).toBe(TTL.bans);
  });
});

describe('boardExport', () => {
  const CSV = [
    'rank,steam_id,name,playtime_min,seeded_min,kills,deaths,kd,kills_per_hour,headshots,team_kills,suicides,vehicle_kills,kill_streak,death_streak,matches,wins,losses,draws,win_pct,cash,last_seen',
    '1,76561198000000001,A,60,0,5,1,5,5,0,0,0,0,0,0,1,1,0,0,100,0,',
  ].join('\n');

  test('fetches the whole board once and keeps it in its own small cache', async () => {
    const text = vi.fn<(path: string) => Promise<string>>(async () => CSV);
    const client = { json: vi.fn(), text } as unknown as Warcon;
    const exportCache = new TtlCache({ maxEntries: 40 });
    const api = createApi(client, new TtlCache(), undefined, exportCache);
    const first = await api.boardExport('s1', { scope: 'org', range: '30d', sort: 'wins' });
    await api.boardExport('s1', { scope: 'org', range: '30d', sort: 'wins' });
    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0][0]).toBe('/api/servers/s1/leaderboard/export?scope=org&range=30d&sort=wins&dir=desc&minMinutes=60');
    expect(first.value.map((r) => r.steamId)).toEqual(['76561198000000001']);
    expect(exportCache.size).toBe(1);
  });
});

describe('slow player lookups', () => {
  test('the player record and career get 20 s; other endpoints keep the default', async () => {
    const { client, json } = fake({ ok: true, dossier: {}, career: {} });
    const api = createApi(client, new TtlCache());
    await api.dossier('s1', '76561198000000001').catch(() => {});
    await api.career('s1', '76561198000000001').catch(() => {});
    expect(json.mock.calls[0][2]).toEqual({ timeoutMs: PLAYER_TIMEOUT_MS });
    expect(json.mock.calls[1][2]).toEqual({ timeoutMs: PLAYER_TIMEOUT_MS });
    expect(PLAYER_TIMEOUT_MS).toBe(20_000);
    const other = fake({ ok: true, servers: [] });
    await createApi(other.client, new TtlCache()).servers();
    expect(other.json.mock.calls[0][2]).toBeUndefined();
  });
});
