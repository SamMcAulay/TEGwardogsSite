import { beforeEach, describe, expect, test, vi } from 'vitest';

const api = { servers: vi.fn(), bannedPage: vi.fn() };
vi.mock('./warcon', () => ({ warcon: () => api }));

// vi.mock is hoisted above imports, so this import already sees the mocked module.
import { orgBannedIds, resetBans } from './bans';

const fresh = <T>(value: T) => ({ value, stale: false });
const id = (n: number) => String(76561198000000000n + BigInt(n));
const page = (players: { steamId: string; banned: 'org' | 'server' | null }[], total = players.length) =>
  fresh({ players, total });

beforeEach(() => {
  vi.clearAllMocks();
  resetBans();
  api.servers.mockResolvedValue(fresh([{ id: 's1' }, { id: 's2' }]));
});

describe('orgBannedIds', () => {
  test('collects org bans from every server and ignores server-only bans', async () => {
    api.bannedPage.mockImplementation(async (sid: string) =>
      sid === 's1'
        ? page([{ steamId: id(1), banned: 'org' }, { steamId: id(2), banned: 'server' }])
        : page([{ steamId: id(3), banned: 'org' }, { steamId: id(1), banned: 'org' }]),
    );
    const r = await orgBannedIds();
    expect([...r.ids].sort()).toEqual([id(1), id(3)]);
    expect(r.stale).toBe(false);
  });

  test('pages through a server with more than 100 banned players', async () => {
    api.servers.mockResolvedValue(fresh([{ id: 's1' }]));
    api.bannedPage.mockImplementation(async (_sid: string, offset: number) =>
      page(
        Array.from({ length: offset === 200 ? 50 : 100 }, (_, i) => ({ steamId: id(offset + i), banned: 'org' as const })),
        250,
      ),
    );
    const r = await orgBannedIds();
    expect(r.ids.size).toBe(250);
    expect(api.bannedPage.mock.calls.map((c) => c[1])).toEqual([0, 100, 200]);
  });

  test('when a server fails, the last good list is kept and the result is marked stale', async () => {
    api.bannedPage.mockResolvedValue(page([{ steamId: id(1), banned: 'org' }]));
    await orgBannedIds();
    api.bannedPage.mockImplementation(async (sid: string) => {
      if (sid === 's2') throw new Error('down');
      return page([{ steamId: id(5), banned: 'org' }]);
    });
    const r = await orgBannedIds();
    expect([...r.ids].sort()).toEqual([id(1), id(5)]);
    expect(r.stale).toBe(true);
  });

  test('with no list yet and Warcon failing, it throws (boards show unavailable, never unfiltered)', async () => {
    api.bannedPage.mockRejectedValue(new Error('down'));
    await expect(orgBannedIds()).rejects.toThrow();
  });

  test('a ban that is lifted drops off once every server answers again', async () => {
    api.bannedPage.mockResolvedValue(page([{ steamId: id(1), banned: 'org' }]));
    await orgBannedIds();
    api.bannedPage.mockResolvedValue(page([]));
    expect((await orgBannedIds()).ids.size).toBe(0);
  });
});
