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
import { getMatch, getPlayer, getServers, headToHead, leaderboard, listMatches, networkSummary, population, recentKills, regionOf, shortNameOf } from './data';
import { TTL } from './warcon/api';
import type { ServerRow } from './views';

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
  test('a failing server has unknown status (null), not offline; the others still show', async () => {
    api.live.mockImplementation(async (id: string) => {
      if (id === 's2') throw new Error('down');
      return fresh({
        ok: true, gameServerId: 'J1', startedAt: '2026-10-04T10:00:00Z', observedAt: '2026-10-04T12:00:00Z',
        status: { serverName: 'x', map: 'M', experiences: [], lighting: 'Day', matchSeconds: 5, playerCount: 1, maxPlayers: 64, scoreCap: 500, scores: [] },
        players: [{ name: 'A', steamId: '76561198000000001', faction: null, kills: 1, deaths: 0, cash: 0 }],
      });
    });
    const r = await getServers();
    expect(r.data.map((s) => [s.id, s.online, s.playerCount])).toEqual([['s1', true, 1], ['s2', null, 0]]);
    expect(r.data[0].status?.scoreCap).toBe(500);
    expect(r.data[0].players[0]).not.toHaveProperty('ping');
    expect(r.missing).toEqual(['s2']);
  });

  test('a server Warcon reports as unobserved (live: null) is offline', async () => {
    api.live.mockResolvedValue(fresh(null));
    const r = await getServers();
    expect(r.data.map((s) => s.online)).toEqual([false, false]);
    expect(r.missing).toEqual([]);
  });
});

describe('networkSummary', () => {
  const row = (id: string, online: boolean | null, players: number): ServerRow => ({
    id, name: id, shortName: id, region: 'EU', online, updatedAt: null, players: [], playerCount: players, joinCode: null, startedAt: null,
    status: online ? { serverName: id, map: 'M', experiences: [], lighting: null, players: { current: players, max: 64 }, scoreCap: null, factionScores: [] } : null,
  });

  test('servers with unknown status are left out of online counts and listed as missing', async () => {
    api.analytics.mockResolvedValue(fresh({ summary: { uniquePlayers: 1, peakPlayers: 1, matches: 1 }, combat: null }));
    const r = await networkSummary([row('s1', true, 5), row('s2', null, 0), row('s3', false, 0)]);
    expect(r.data).toMatchObject({ playersOnline: 5, capacity: 64, serversOnline: 1, serversTotal: 3 });
    expect(r.missing).toEqual(['s2']);
  });

  test('peak is the highest single-server peak, not a sum', async () => {
    api.analytics.mockImplementation(async (id: string) => fresh({ summary: { uniquePlayers: 1, peakPlayers: id === 's1' ? 40 : 25, matches: 1 }, combat: null }));
    const r = await networkSummary([row('s1', true, 5), row('s3', false, 0)]);
    expect(r.data.peakToday).toBe(40);
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

describe('getPlayer and hidden servers', () => {
  test('per-server rows, recent kills and last matches on servers not shown are dropped', async () => {
    const kill = (serverId: string) => ({ eventId: serverId, ts: '2026-10-04T12:00:00Z', map: 'M', eventTime: 1, killer: null, victim: { steamId: '76561198000000001', name: 'V', faction: null }, cause: null, distanceM: null, headshot: false, suicide: false, teamKill: false, tags: [], serverId, serverName: serverId });
    api.dossier.mockResolvedValue(fresh({
      steamId: '76561198000000001', name: 'A', names: ['A'], online: { serverId: 'hidden', serverName: 'H' }, steam: null,
      summary: { sessions: 1, minutes: 1, kills: 1, deaths: 1, firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-04T00:00:00Z' },
      combat: { kills: 1, deaths: 1, headshots: 0, teamKills: 0, suicides: 0, avgDistanceM: null, longestM: null, causes: [], victims: [], nemeses: [], recent: [kill('s1'), kill('hidden')] },
      perServer: [
        { serverId: 's1', serverName: 'S1', minutes: 1, kills: 1, deaths: 1, lastSeen: '2026-10-04T00:00:00Z' },
        { serverId: 'hidden', serverName: 'H', minutes: 1, kills: 1, deaths: 1, lastSeen: '2026-10-04T00:00:00Z' },
      ],
    }));
    const m = (serverId: string) => ({ matchId: 1, serverId, serverName: serverId, map: 'M', startedAt: '2026-10-04T00:00:00Z', endedAt: null, faction: null, result: null, kills: 0, deaths: 0, seconds: 0 });
    api.career.mockResolvedValue(fresh({ rank: { server: null, org: 1 }, streak: null, matches: 2, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, minutes: 0, headshots: 0, longestM: null, killStreak: 0, maps: [], factions: [], last: [m('s1'), m('hidden')] }));
    const p = (await getPlayer('76561198000000001'))!.data;
    expect(p.servers.map((s) => s.serverId)).toEqual(['s1']);
    expect(p.recentKills.map((k) => k.serverId)).toEqual(['s1']);
    expect(p.matches.map((x) => x.serverId)).toEqual(['s1']);
    expect(p.onlineOn).toBeNull();
  });
});

describe('listMatches', () => {
  const list = { ok: true, matches: [], live: [], page: 1, pages: 7, total: 300 };

  test('all servers: only page 1 is requested, with no pages offered', async () => {
    api.matches.mockResolvedValue(fresh(list));
    const r = await listMatches({ page: 3 });
    expect(api.matches.mock.calls.map((c) => c[1])).toEqual([1, 1]);
    expect(r.data.pages).toBe(1);
  });

  test('one server: the asked-for page and its page count', async () => {
    api.matches.mockResolvedValue(fresh(list));
    const r = await listMatches({ serverId: 's1', page: 3 });
    expect(api.matches).toHaveBeenCalledWith('s1', 3);
    expect(r.data.pages).toBe(7);
  });
});

describe('getMatch', () => {
  const view = (endedAt: string | null) => ({
    match: { id: 9, startedAt: '2026-10-04T10:00:00Z', endedAt, map: 'M', experiences: null, lighting: null, peakPlayers: 2, players: 2, finalScores: null, winner: null },
    factions: [], lines: [], timeline: [], awards: [], kills: 3, hasFeed: true,
  });

  test('a kills failure still returns the match, without kills, marked stale', async () => {
    api.match.mockResolvedValue(fresh(view('2026-10-04T11:00:00Z')));
    api.kills.mockRejectedValue(new Error('down'));
    const r = await getMatch('s1', 9);
    expect(r?.data.match.id).toBe(9);
    expect(r?.data.kills).toEqual([]);
    expect(r?.data.weapons).toEqual([]);
    expect(r?.stale).toBe(true);
  });

  test("an ended match's kills use the ended-match TTL, a running one the stats TTL", async () => {
    api.kills.mockResolvedValue(fresh({ ok: true, kills: [], total: null }));
    api.match.mockResolvedValue(fresh(view('2026-10-04T11:00:00Z')));
    await getMatch('s1', 9);
    expect(api.kills).toHaveBeenLastCalledWith('s1', { match: 9, limit: 200 }, { ttl: TTL.endedMatch });
    api.match.mockResolvedValue(fresh(view(null)));
    await getMatch('s1', 9);
    expect(api.kills).toHaveBeenLastCalledWith('s1', { match: 9, limit: 200 }, { ttl: TTL.stats });
  });
});

describe('headToHead', () => {
  test('count queries ask for the stats TTL', async () => {
    api.kills.mockResolvedValue(fresh({ ok: true, kills: [], total: 2 }));
    const r = await headToHead('76561198000000001', '76561198000000002');
    expect(r.data).toEqual({ aKills: 4, bKills: 4 });
    for (const c of api.kills.mock.calls) expect(c[2]).toEqual({ ttl: TTL.stats });
  });
});
