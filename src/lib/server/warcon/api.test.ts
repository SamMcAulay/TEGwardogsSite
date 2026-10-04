import { describe, expect, test, vi } from 'vitest';
import { createApi } from './api';
import { TtlCache } from './cache';
import type { Warcon } from './http';

const fake = (body: unknown) => {
  const json = vi.fn(async (_path: string, schema: { parse(v: unknown): unknown }) => schema.parse(body));
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
});
