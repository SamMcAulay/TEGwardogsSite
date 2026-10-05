import { beforeEach, describe, expect, test, vi } from 'vitest';

const api = {
  servers: vi.fn(),
  live: vi.fn(),
  board: vi.fn(),
  career: vi.fn(),
  dossier: vi.fn(),
  matches: vi.fn(),
  match: vi.fn(),
  kills: vi.fn(),
  analytics: vi.fn(),
  seen: vi.fn(),
  steamProfiles: vi.fn(async () => ({})),
};
vi.mock('./warcon', () => ({ warcon: () => api, searchIndex: () => ({ search: async () => [] }) }));

// vi.mock is hoisted above imports, so this import already sees the mocked module.
import { WarconError } from './warcon/http';
import { getPlayer, population, getServers, leaderboard, recentKills, regionOf, shortNameOf } from './data';

const fresh = <T>(value: T) => ({ value, stale: false });
const SERVERS = [
  { id: 's1', orgId: 'o', name: 'EU#1 - Sealclubbing = ban', sortOrder: 0 },
  { id: 's2', orgId: 'o', name: 'OC#1 - x', sortOrder: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.servers.mockResolvedValue(fresh(SERVERS));
});

describe('labels', () => {
  test('short name and region come from Warcon names', () => {
    expect(shortNameOf('EU#1 - Sealclubbing = ban')).toBe('EU#1');
    expect(regionOf('EU#1')).toBe('EU');
    expect(regionOf('OC#1')).toBe('OCE');
    expect(shortNameOf('Plain')).toBe('Plain');
  });
});

describe('getServers', () => {
  test('an unobserved or failing server is offline; the others still show', async () => {
    api.live.mockImplementation(async (id: string) => {
      if (id === 's2') throw new Error('down');
      return fresh({
        ok: true, gameServerId: 'J1', startedAt: '2026-10-04T10:00:00Z', observedAt: '2026-10-04T12:00:00Z',
        status: { serverName: 'x', map: 'M', experiences: [], lighting: 'Day', matchSeconds: 5, playerCount: 1, maxPlayers: 64, scoreCap: 500, scores: [] },
        players: [{ name: 'A', steamId: '76561198000000001', faction: null, kills: 1, deaths: 0, cash: 0 }],
      });
    });
    const r = await getServers();
    expect(r.data.map((s) => [s.id, s.online, s.playerCount])).toEqual([['s1', true, 1], ['s2', false, 0]]);
    expect(r.data[0].status?.scoreCap).toBe(500);
    expect(r.data[0].players[0]).not.toHaveProperty('ping');
    expect(r.missing).toEqual(['s2']);
  });
});

describe('getPlayer', () => {
  test('a player Warcon has never seen is null (the page 404s)', async () => {
    api.live.mockResolvedValue(fresh(null));
    api.dossier.mockResolvedValue(fresh({ steamId: '76561198000000009', name: '76561198000000009', names: [], online: null, steam: null, summary: { sessions: 0, minutes: 0, kills: 0, deaths: 0, firstSeen: null, lastSeen: null }, combat: null, perServer: [] }));
    api.career.mockResolvedValue(fresh({ rank: { server: null, org: null }, streak: null, matches: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, minutes: 0, headshots: 0, longestM: null, killStreak: 0, maps: [], factions: [], last: [] }));
    expect(await getPlayer('76561198000000009')).toBeNull();
  });
});

describe('leaderboard', () => {
  test('maps the metric and period onto an org board and computes value', async () => {
    api.board.mockResolvedValue(fresh({ ok: true, total: 1, pageSize: 50, rows: [{ rank: 1, steamId: '76561198000000001', name: 'A', minutes: 120, kills: 40, deaths: 10, headshots: 5, matches: 3, wins: 2, losses: 1, draws: 0, cash: 9, lastSeen: null }] }));
    const r = await leaderboard({ metric: 'perHour', period: '90d' });
    expect(api.board).toHaveBeenCalledWith('s1', { scope: 'org', range: '90d', sort: 'perHour', page: 1 });
    expect(r.data.rows[0]).toMatchObject({ playtime: 7200, value: 20 });
  });
});

describe('recentKills', () => {
  test('merges servers newest first and names a failed one', async () => {
    const k = (id: string, ts: string) => ({ eventId: id, ts, map: 'M', eventTime: 1, killer: null, victim: { steamId: '76561198000000001', name: 'V', faction: null }, cause: null, distanceM: null, headshot: false, suicide: false, teamKill: false, tags: [] });
    api.kills.mockImplementation(async (id: string) => {
      if (id === 's2') throw new Error('down');
      return fresh({ ok: true, total: null, kills: [k('a', '2026-10-04T12:00:02Z'), k('b', '2026-10-04T12:00:01Z')] });
    });
    const r = await recentKills({ limit: 1 });
    expect(r.data.map((x) => x.eventId)).toEqual(['a']);
    expect(r.missing).toEqual(['s2']);
  });
});

describe('not found and hidden servers', () => {
  test('a 404 from Warcon for a player is null', async () => {
    api.dossier.mockRejectedValue(new WarconError('x', 'not_found', 404, '/api/x'));
    api.career.mockResolvedValue(fresh({}));
    expect(await getPlayer('76561198000000009')).toBeNull();
  });

  test('a server outside the visible list never reaches Warcon', async () => {
    const r = await leaderboard({ metric: 'kills', period: '7d', serverId: 'hidden' });
    expect(r.data.rows).toEqual([]);
    expect(api.board).not.toHaveBeenCalled();
    const p = await population('hidden', '24h');
    expect(p.data).toEqual([]);
    expect(api.analytics).not.toHaveBeenCalled();
  });
});
