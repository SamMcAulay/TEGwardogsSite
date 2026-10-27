import { beforeEach, describe, expect, test, vi } from 'vitest';

const api = {
  servers: vi.fn(),
  live: vi.fn(),
  board: vi.fn(),
  boardExport: vi.fn(),
  career: vi.fn(),
  dossier: vi.fn(),
  matches: vi.fn(),
  match: vi.fn(),
  kills: vi.fn(),
  analytics: vi.fn(),
  seen: vi.fn(),
  steamProfiles: vi.fn(async () => ({})),
};
const index = { search: vi.fn(async () => []), snapshot: vi.fn(async (): Promise<unknown> => []), hit: vi.fn<(id: string) => Promise<unknown>>(async () => null) };
vi.mock('./warcon', () => ({ warcon: () => api, searchIndex: () => index }));
const presence = { hidden: new Set<string>() };
vi.mock('./accounts', () => ({ presenceHidden: () => presence.hidden, accounts: () => null }));
const bans = { orgBannedIds: vi.fn() };
vi.mock('./bans', () => ({ orgBannedIds: () => bans.orgBannedIds() }));
const seasonBoards: { byServer: Record<string, Map<string, object>> | 'unavailable' } = { byServer: {} };
vi.mock('./seasons', async (original) => ({
  ...(await original<typeof import('./seasons')>()),
  seasonOneBoard: (id: string) => (seasonBoards.byServer === 'unavailable' ? 'unavailable' : (seasonBoards.byServer[id] ?? new Map())),
}));

// vi.mock is hoisted above imports, so this import already sees the mocked module.
import { WarconError } from './warcon/http';
import { adjustedRank, records, getMatch, replayOf, getPlayer, MAX_BOARD_PAGE, getServers, friendsStatus, headToHead, killFeeds, leaderboard, listMatches, networkSummary, population, recentKills, recentPlayers, regionOf, serverNameOf, shortNameOf, TEAMKILL_PAGES, teamKills } from './data';
import { TTL } from './warcon/api';
import type { ServerRow } from './views';

const fresh = <T>(value: T) => ({ value, stale: false });
const SERVERS = [
  { id: 's1', orgId: 'o', name: 'EU#1 - Sealclubbing = ban', sortOrder: 0 },
  { id: 's2', orgId: 'o', name: 'OC#1 - x', sortOrder: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  presence.hidden = new Set();
  api.servers.mockResolvedValue(fresh(SERVERS));
  bans.orgBannedIds.mockResolvedValue({ ids: new Set<string>(), stale: false });
  // The export path is covered in its own tests; elsewhere it fails, exercising the page fallback.
  api.boardExport.mockRejectedValue(new Error('export unavailable'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('labels', () => {
  test('short name and region come from Warcon names', () => {
    expect(shortNameOf('EU#1 - Sealclubbing = ban')).toBe('EU#1');
    expect(regionOf('EU#1')).toBe('EU');
    expect(regionOf('OC#1')).toBe('OCE');
    expect(shortNameOf('NA-WEST - TEG.gg')).toBe('NA-West');
    expect(shortNameOf('na-east - TEG.gg')).toBe('NA-East');
    expect(serverNameOf('NA-WEST - TEG.gg')).toBe('NA-West - TEG.gg');
    expect(serverNameOf('EU#1 - TEG.gg')).toBe('EU#1 - TEG.gg');
    expect(regionOf('NA-WEST')).toBe('NA');
    expect(regionOf('NA-East')).toBe('NA');
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

describe('friendsStatus', () => {
  test('online friends say where; the rest when last seen; junk and repeats are dropped', async () => {
    api.live.mockImplementation(async (id: string) =>
      fresh(
        id === 's1'
          ? {
              ok: true, gameServerId: 'J1', startedAt: '2026-10-04T10:00:00Z', observedAt: '2026-10-04T12:00:00Z',
              status: { serverName: 'x', map: 'M', experiences: [], lighting: 'Day', matchSeconds: 5, playerCount: 1, maxPlayers: 64, scoreCap: 500, scores: [] },
              players: [{ name: 'LiveName', steamId: '76561198000000001', faction: 'Valkyra', kills: 7, deaths: 2, cash: 0 }],
            }
          : null,
      ),
    );
    index.hit.mockImplementation(async (id: string) => (id === '76561198000000002' ? { steamId: id, name: 'Board', minutes: 5, kills: 1, lastSeen: '2026-10-04T09:00:00Z' } : null));
    api.steamProfiles.mockResolvedValue({ '76561198000000002': { avatar: 'https://avatars.steamstatic.com/x.jpg' } } as never);
    const r = await friendsStatus(['76561198000000001', '76561198000000002', '76561198000000002', '76561198000000003', 'nope']);
    expect(r.data.map((f) => f.steamId)).toEqual(['76561198000000001', '76561198000000002', '76561198000000003']);
    expect(r.data[0]).toMatchObject({ name: 'LiveName', online: { serverId: 's1', serverName: 'EU#1', faction: 'Valkyra', kills: 7, deaths: 2 } });
    expect(r.data[1]).toEqual({ steamId: '76561198000000002', name: 'Board', avatarUrl: 'https://avatars.steamstatic.com/x.jpg', online: null, lastSeen: Date.parse('2026-10-04T09:00:00Z') / 1000 });
    expect(r.data[2]).toMatchObject({ name: null, online: null, lastSeen: null });
    expect(api.dossier).not.toHaveBeenCalled();
    // Steam pictures only for players the site knows: online, or in the player list
    expect(api.steamProfiles).toHaveBeenCalledWith(['76561198000000001', '76561198000000002']);
  });

  test('ids nobody knows cost no Steam lookup at all', async () => {
    api.live.mockResolvedValue(fresh(null));
    index.hit.mockResolvedValue(null);
    const r = await friendsStatus(['76561198000000111', '76561198000000222']);
    expect(r.data.map((f) => f.name)).toEqual([null, null]);
    expect(api.steamProfiles).not.toHaveBeenCalled();
  });
});

describe('members hiding where they play', () => {
  const H = '76561198000000009';
  const live = {
    ok: true, gameServerId: 'J1', startedAt: '2026-10-04T10:00:00Z', observedAt: '2026-10-04T12:00:00Z',
    status: { serverName: 'x', map: 'M', experiences: [], lighting: 'Day', matchSeconds: 5, playerCount: 2, maxPlayers: 64, scoreCap: 500, scores: [] },
    players: [
      { name: 'Hid', steamId: H, faction: 'A', kills: 3, deaths: 0, cash: 0 },
      { name: 'Bob', steamId: '76561198000000001', faction: 'A', kills: 1, deaths: 0, cash: 0 },
    ],
  };

  test('live scoreboards say Hidden player; /friends reads them unmasked', async () => {
    presence.hidden = new Set([H]);
    api.live.mockResolvedValue(fresh(live));
    const masked = await getServers();
    expect(masked.data[0].players.map((p) => [p.name, p.steamId])).toEqual([['Hidden player', ''], ['Bob', '76561198000000001']]);
    expect(masked.data[0].playerCount).toBe(2);
    const raw = await getServers({ unmasked: true });
    expect(raw.data[0].players[0].name).toBe('Hid');
  });

  test("a recent kill feed hides them; an old one doesn't", async () => {
    presence.hidden = new Set([H]);
    const now = Date.now();
    const k = (id: string, ms: number) => ({ eventId: id, ts: new Date(now - ms).toISOString(), map: 'M', eventTime: 1, killer: { steamId: H, name: 'Hid', faction: 'A' }, victim: { steamId: '76561198000000001', name: 'V', faction: 'B' }, cause: null, distanceM: null, headshot: false, suicide: false, teamKill: false, tags: [] });
    api.kills.mockImplementation(async (id: string) => fresh({ ok: true, total: null, kills: id === 's1' ? [k('new', 60_000), k('old', 5 * 3600_000)] : [] }));
    const r = await recentKills({ limit: 10 });
    expect(r.data.map((x) => [x.eventId, x.killerName, x.killerSteamId])).toEqual([['new', 'Hidden player', null], ['old', 'Hid', H]]);
  });

  test("a feed of one hidden player's kills leaves out their recent ones altogether", async () => {
    presence.hidden = new Set([H]);
    const now = Date.now();
    const k = (id: string, ms: number) => ({ eventId: id, ts: new Date(now - ms).toISOString(), map: 'M', eventTime: 1, killer: { steamId: H, name: 'Hid', faction: 'A' }, victim: { steamId: '76561198000000001', name: 'V', faction: 'B' }, cause: null, distanceM: null, headshot: false, suicide: false, teamKill: false, tags: [] });
    api.kills.mockImplementation(async (id: string) => fresh({ ok: true, total: null, kills: id === 's1' ? [k('new', 60_000), k('old', 5 * 3600_000)] : [] }));
    const r = await recentKills({ limit: 10, steamId: H });
    expect(r.data.map((x) => x.eventId)).toEqual(['old']);
  });

  test('a running round hides them by name and in its awards', async () => {
    presence.hidden = new Set([H]);
    api.match.mockResolvedValue(fresh({
      match: { id: 9, startedAt: new Date(Date.now() - 600_000).toISOString(), endedAt: null, map: 'M', experiences: null, lighting: null, peakPlayers: 2, players: 2, finalScores: null, winner: null },
      factions: [], lines: [{ steamId: H, name: 'Hid', faction: 'A', kills: 3, deaths: 0, headshots: 0, longestM: null, cashDelta: 0, seconds: 60, killStreak: 3 }],
      timeline: [], awards: [{ key: 'kills', label: 'Most kills', steamId: H, name: 'Hid', value: '3' }], kills: 0, hasFeed: true,
    }));
    api.kills.mockResolvedValue(fresh({ ok: true, total: null, kills: [] }));
    const r = await getMatch('s1', 9);
    expect(r?.data.lines[0]).toMatchObject({ steamId: '', name: 'Hidden player' });
    expect(r?.data.awards[0]).toMatchObject({ steamId: '', name: 'Hidden player' });
  });
});

describe('networkSummary', () => {
  const row = (id: string, online: boolean | null, players: number): ServerRow => ({
    id, slug: id, name: id, shortName: id, region: 'EU', online, updatedAt: null, players: [], playerCount: players, joinCode: null, startedAt: null,
    status: online ? { serverName: id, map: 'M', experiences: [], lighting: null, players: { current: players, max: 64 }, scoreCap: null, scoreTick: null, factionScores: [], rotation: { now: null, next: null } } : null,
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

describe('leaderboard without org-banned players', () => {
  const row = (n: number) => ({ rank: n, steamId: `7656119800000000${n}`, name: `P${n}`, minutes: 60, kills: 10 - n, deaths: 1, headshots: 0, matches: 1, wins: 1, losses: 0, draws: 0, cash: 0, lastSeen: null });
  const boardPages = (pages: number[][], pageSize: number) =>
    api.board.mockImplementation(async (_id: string, q: { page: number }) =>
      fresh({ ok: true, total: pages.flat().length, pageSize, rows: (pages[q.page - 1] ?? []).map(row) }),
    );
  const banned = (...ns: number[]) => bans.orgBannedIds.mockResolvedValue({ ids: new Set(ns.map((n) => `7656119800000000${n}`)), stale: false });

  test('banned players are removed and the ranks renumbered with no gaps', async () => {
    boardPages([[1, 2, 3]], 50);
    banned(2);
    const r = await leaderboard({ metric: 'kills', period: '7d' });
    expect(r.data.rows.map((x) => [x.rank, x.name])).toEqual([[1, 'P1'], [2, 'P3']]);
    expect(r.data.total).toBe(2);
  });

  test('a page short of players is filled from the next Warcon page', async () => {
    boardPages([[1, 2], [3, 4]], 2);
    banned(2);
    const p1 = await leaderboard({ metric: 'kills', period: '7d' });
    expect(p1.data.rows.map((x) => [x.rank, x.name])).toEqual([[1, 'P1'], [2, 'P3']]);
    const p2 = await leaderboard({ metric: 'kills', period: '7d', page: 2 });
    expect(p2.data.rows.map((x) => [x.rank, x.name])).toEqual([[3, 'P4']]);
  });

  test('the pages a deep page needs are fetched at the same time, not one after another', async () => {
    let inFlight = 0;
    let peak = 0;
    const pages = [[1, 2], [3, 4], [5, 6], [7, 8]];
    api.board.mockImplementation(async (_id: string, q: { page: number }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return fresh({ ok: true, total: 8, pageSize: 2, rows: (pages[q.page - 1] ?? []).map(row) });
    });
    banned();
    const r = await leaderboard({ metric: 'kills', period: '7d', page: 4 });
    expect(r.data.rows.map((x) => [x.rank, x.name])).toEqual([[7, 'P7'], [8, 'P8']]);
    expect(peak).toBeGreaterThanOrEqual(3); // pages 2, 3 and 4 together after page 1
  });

  test('a very deep page is capped and never fans out unbounded requests to Warcon', async () => {
    let inFlight = 0;
    let peak = 0;
    api.board.mockImplementation(async (_id: string, q: { page: number }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return fresh({ ok: true, total: 10_000, pageSize: 50, rows: [row((q.page % 9) + 1)] });
    });
    banned();
    const r = await leaderboard({ metric: 'kills', period: '7d', page: 1000 });
    expect(api.board.mock.calls.length).toBeLessThanOrEqual(MAX_BOARD_PAGE + 10);
    expect(peak).toBeLessThanOrEqual(4);
    expect(r.data.total).toBeLessThanOrEqual(MAX_BOARD_PAGE * 50);
  });

  test('applies to a single server board as well', async () => {
    boardPages([[1, 2]], 50);
    banned(1);
    const r = await leaderboard({ metric: 'kills', period: '7d', serverId: 's1' });
    expect(r.data.rows.map((x) => x.name)).toEqual(['P2']);
  });

  test('if the ban list cannot be read at all, the board fails instead of showing banned players', async () => {
    boardPages([[1, 2]], 50);
    bans.orgBannedIds.mockRejectedValue(new Error('org ban list unavailable'));
    await expect(leaderboard({ metric: 'kills', period: '7d' })).rejects.toThrow();
  });

  test('a stale ban list marks the board stale', async () => {
    boardPages([[1]], 50);
    bans.orgBannedIds.mockResolvedValue({ ids: new Set<string>(), stale: true });
    expect((await leaderboard({ metric: 'kills', period: '7d' })).stale).toBe(true);
  });
});

describe('season two leaderboard', () => {
  const A = '76561198000000001';
  const B = '76561198000000002';
  const C = '76561198000000003';
  const line = (steamId: string, o: object) => ({ rank: 0, steamId, name: steamId.slice(-1), minutes: 0, kills: 0, deaths: 0, headshots: 0, vehicleKills: 0, killStreak: 0, matches: 0, wins: 0, losses: 0, draws: 0, cash: 0, lastSeen: null, ...o });
  const s1 = (o: object) => ({ seconds: 0, kills: 0, deaths: 0, headshots: 0, matches: 0, wins: 0, losses: 0, draws: 0, cash: 0, ...o });

  beforeEach(() => {
    // s1 is an old server with a season-one history; s2 only ever ran in season two.
    api.boardExport.mockImplementation(async (id: string) =>
      fresh(
        id === 's1'
          ? [line(A, { minutes: 600, kills: 500, deaths: 100, lastSeen: '2026-10-15T09:00:00Z', name: 'A-old' }), line(B, { minutes: 300, kills: 90, deaths: 30 })]
          : [line(A, { minutes: 50, kills: 40, deaths: 5, lastSeen: '2026-10-15T10:00:00Z', name: 'A-new' }), line(C, { minutes: 70, kills: 60, deaths: 10 })],
      ),
    );
    seasonBoards.byServer = { s1: new Map([[A, s1({ seconds: 550 * 60, kills: 480, deaths: 90 })], [B, s1({ seconds: 290 * 60, kills: 80 })]]) };
  });

  test('each server less its season one, added up, under the 60-minute floor dropped', async () => {
    const r = await leaderboard({ metric: 'kills', period: 's2' });
    expect(api.boardExport).toHaveBeenCalledWith('s1', { scope: 'server', range: 'all', sort: 'playtime', minMinutes: 0 });
    expect(api.boardExport).toHaveBeenCalledWith('s2', { scope: 'server', range: 'all', sort: 'playtime', minMinutes: 0 });
    // A: (500-480) + 40 = 60 kills over (600-550) + 50 = 100 minutes. C: new, 60 kills in 70 minutes. B: 10 minutes this season.
    expect(r.data.rows.map((x) => [x.steamId, x.kills, x.playtime])).toEqual([[A, 60, 6000], [C, 60, 4200]]);
    expect(r.data.rows[0]).toMatchObject({ rank: 1, name: 'A-new', deaths: 15 });
    expect(r.data.total).toBe(2);
  });

  test('a single server is its own board less its season one', async () => {
    const r = await leaderboard({ metric: 'kills', period: 's2', serverId: 's1' });
    expect(api.boardExport).toHaveBeenCalledTimes(1);
    expect(r.data.rows).toEqual([]);
  });

  test('banned players stay off it', async () => {
    bans.orgBannedIds.mockResolvedValue({ ids: new Set([C]), stale: false });
    expect((await leaderboard({ metric: 'kills', period: 's2' })).data.rows.map((x) => x.steamId)).toEqual([A]);
  });

  test('without the season-one snapshot the board is unavailable, not all time', async () => {
    seasonBoards.byServer = 'unavailable';
    await expect(leaderboard({ metric: 'kills', period: 's2' })).rejects.toThrow(/snapshot/);
  });
});

describe('leaderboard from the whole-board export', () => {
  const row = (n: number) => ({ rank: n, steamId: `7656119800000${String(n).padStart(4, '0')}`, name: `P${n}`, minutes: 60, kills: 1000 - n, deaths: 1, headshots: 0, matches: 1, wins: 1, losses: 0, draws: 0, cash: 0, lastSeen: null });
  const exportOf = (n: number) => api.boardExport.mockResolvedValue(fresh(Array.from({ length: n }, (_, i) => row(i + 1))));

  test('a deep page comes straight from the export, with no board page requests', async () => {
    exportOf(500);
    const r = await leaderboard({ metric: 'kills', period: '30d', page: 5 });
    expect(api.boardExport).toHaveBeenCalledWith('s1', { scope: 'org', range: '30d', sort: 'kills' });
    expect(api.board).not.toHaveBeenCalled();
    expect(r.data.rows[0]).toMatchObject({ rank: 201, name: 'P201' });
    expect(r.data.rows).toHaveLength(50);
    expect(r.data.total).toBe(500);
  });

  test('banned players are removed from the whole board, so ranks and totals are exact', async () => {
    exportOf(100);
    bans.orgBannedIds.mockResolvedValue({ ids: new Set([row(1).steamId, row(60).steamId]), stale: false });
    const p1 = await leaderboard({ metric: 'kills', period: '30d' });
    expect(p1.data.rows[0]).toMatchObject({ rank: 1, name: 'P2' });
    const p2 = await leaderboard({ metric: 'kills', period: '30d', page: 2 });
    expect(p2.data.rows.map((x) => x.name)).not.toContain('P60');
    expect(p2.data.rows[0]).toMatchObject({ rank: 51, name: 'P52' });
    expect(p2.data.total).toBe(98);
  });

  test("the viewer's own rank and page; past the boards' depth, a rank with no page; absent, nothing", async () => {
    exportOf(3000);
    expect((await leaderboard({ metric: 'kills', period: '30d', me: row(130).steamId })).data.mine).toEqual({ rank: 130, page: 3 });
    expect((await leaderboard({ metric: 'kills', period: '30d', me: row(2500).steamId })).data.mine).toEqual({ rank: 2500, page: null });
    expect((await leaderboard({ metric: 'kills', period: '30d', me: '76561198099999999' })).data.mine).toBeNull();
    expect((await leaderboard({ metric: 'kills', period: '30d' })).data.mine).toBeNull();
  });

  test('boards stop at page 20 (the top 1,000)', async () => {
    exportOf(3000);
    const r = await leaderboard({ metric: 'kills', period: 'all', page: 999 });
    expect(r.data.rows[0]).toMatchObject({ rank: 951 });
    expect(r.data.total).toBe(1000);
  });

  test('linked members only: the whole board filtered, ranked 1, 2, 3 among them', async () => {
    exportOf(100);
    bans.orgBannedIds.mockResolvedValue({ ids: new Set([row(30).steamId]), stale: false });
    const members = new Set([row(7).steamId, row(30).steamId, row(81).steamId, '76561198099999999']);
    const r = await leaderboard({ metric: 'kills', period: '30d', members });
    expect(r.data.rows.map((x) => [x.rank, x.name])).toEqual([[1, 'P7'], [2, 'P81']]);
    expect(r.data.total).toBe(2);
  });

  test('linked members only: no page-by-page fallback, so never a partial list', async () => {
    api.board.mockResolvedValue(fresh({ ok: true, total: 1, pageSize: 50, rows: [row(1)] }));
    await expect(leaderboard({ metric: 'kills', period: '30d', members: new Set([row(1).steamId]) })).rejects.toThrow();
    expect(api.board).not.toHaveBeenCalled();
  });

  test('when the export fails, the board falls back to Warcon pages', async () => {
    api.board.mockResolvedValue(fresh({ ok: true, total: 1, pageSize: 50, rows: [row(1)] }));
    const r = await leaderboard({ metric: 'kills', period: '30d' });
    expect(api.board).toHaveBeenCalled();
    expect(r.data.rows[0]).toMatchObject({ rank: 1, name: 'P1' });
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

describe('teamKills', () => {
  const NOW = Date.parse('2026-10-20T12:00:00Z') / 1000;
  const tk = (id: string, hoursAgo: number) => ({
    eventId: id, ts: new Date((NOW - hoursAgo * 3600) * 1000).toISOString(), map: 'M', eventTime: hoursAgo,
    killer: { steamId: '76561198000000002', name: 'K', faction: null }, victim: { steamId: '76561198000000001', name: 'V', faction: null },
    cause: null, distanceM: null, headshot: false, suicide: false, teamKill: true, tags: [],
  });

  test('asks for team kills only and keeps those inside the window, newest first', async () => {
    api.kills.mockImplementation(async (id: string) => fresh({ ok: true, total: null, kills: id === 's1' ? [tk('a', 1), tk('b', 30)] : [tk('c', 2)] }));
    const r = await teamKills(1, NOW);
    expect(api.kills).toHaveBeenCalledWith('s1', expect.objectContaining({ kind: 'teamKill', limit: 200, before: null }), expect.anything());
    expect(r.data.rows.map((k) => k.eventId)).toEqual(['a', 'c']);
    expect(r.data.capped).toEqual([]);
  });

  test('pages back until it passes the window start, and says when it ran out of pages', async () => {
    const full = (hoursAgo: number) => Array.from({ length: 200 }, (_, i) => tk(`${hoursAgo}-${i}`, hoursAgo));
    api.kills.mockImplementation(async (id: string, q: { before: { ts: string } | null }) => {
      if (id === 's2') throw new Error('down');
      // s1 is busy: every page is full and still inside the 7 days
      return fresh({ ok: true, total: null, kills: full(q.before ? 5 : 1) });
    });
    const r = await teamKills(7, NOW);
    const s1 = api.kills.mock.calls.filter(([id]) => id === 's1');
    expect(s1).toHaveLength(TEAMKILL_PAGES);
    expect(s1[1][1].before).toEqual({ ts: tk('x', 1).ts, eventTime: 1 });
    expect(r.data.rows).toHaveLength(TEAMKILL_PAGES * 200);
    expect(r.data.capped).toEqual(['EU#1']);
    expect(r.missing).toEqual(['s2']);
  });

  test('stops at the first page that reaches back past the window', async () => {
    api.kills.mockImplementation(async () => fresh({ ok: true, total: null, kills: [...Array.from({ length: 199 }, (_, i) => tk(`n${i}`, 1)), tk('old', 48)] }));
    const r = await teamKills(1, NOW);
    expect(api.kills).toHaveBeenCalledTimes(2);
    expect(r.data.rows).toHaveLength(2 * 199);
    expect(r.data.capped).toEqual([]);
  });
});

describe('killFeeds', () => {
  test("each server's last feed batch and newest kill; a failed server is named", async () => {
    api.kills.mockImplementation(async (id: string) => {
      if (id === 's2') throw new Error('down');
      return fresh({ ok: true, total: null, feedAt: '2026-10-20T11:59:00Z', kills: [{ eventId: 'a', ts: '2026-10-20T11:58:00Z', map: 'M', eventTime: 1, killer: null, victim: { steamId: '76561198000000001', name: 'V', faction: null }, cause: null, distanceM: null, headshot: false, suicide: false, teamKill: false, tags: [] }] });
    });
    const r = await killFeeds();
    expect(r.data).toEqual([{ serverId: 's1', shortName: 'EU#1', feedAt: Date.parse('2026-10-20T11:59:00Z') / 1000, newestKill: Date.parse('2026-10-20T11:58:00Z') / 1000 }]);
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
    expect(api.kills).toHaveBeenLastCalledWith('s1', { match: 9, limit: 200, before: null }, { ttl: TTL.endedMatch });
    api.match.mockResolvedValue(fresh(view(null)));
    await getMatch('s1', 9);
    expect(api.kills).toHaveBeenLastCalledWith('s1', { match: 9, limit: 200, before: null }, { ttl: TTL.stats });
  });

  test("a busy round's kills are read page by page, and its momentum counts each side", async () => {
    const two = { ...view('2026-10-04T10:10:00Z'), factions: [{ name: 'A', colorHex: null }, { name: 'B', colorHex: null }], kills: 250 };
    api.match.mockResolvedValue(fresh(two));
    const kill = (i: number, faction: string) => ({
      eventId: `e${i}`, ts: '2026-10-04T10:05:00Z', map: 'M', eventTime: i, killer: { steamId: '76561198000000002', name: 'K', faction },
      victim: { steamId: '76561198000000001', name: 'V', faction: null }, cause: null, distanceM: null, headshot: false, suicide: false, teamKill: false, tags: [],
    });
    api.kills.mockImplementation(async (_id: string, q: { before: unknown }) =>
      fresh({ ok: true, total: null, kills: q.before ? Array.from({ length: 50 }, (_, i) => kill(i, 'B')) : Array.from({ length: 200 }, (_, i) => kill(300 + i, 'A')) }),
    );
    const r = await getMatch('s1', 9);
    expect(api.kills).toHaveBeenCalledTimes(2);
    expect(api.kills.mock.calls[1][1].before).toEqual({ ts: '2026-10-04T10:05:00Z', eventTime: 499 });
    expect(r?.data.kills).toHaveLength(250);
    const m = r!.data.momentum!;
    expect(m.bucketS).toBe(60);
    expect(m.buckets.reduce((n, [a]) => n + a, 0)).toBe(200);
    expect(m.buckets.reduce((n, [, b]) => n + b, 0)).toBe(50);
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

describe('profile rank without org-banned players', () => {
  const sid = (n: number) => `7656119800000000${n}`;
  const hit = (n: number, kills: number, minutes = 120) => ({ steamId: sid(n), name: `P${n}`, minutes, kills, lastSeen: null });
  const banned = (...ns: number[]) => bans.orgBannedIds.mockResolvedValue({ ids: new Set(ns.map(sid)), stale: false });

  test('subtracts banned players with more kills (and at least an hour on)', async () => {
    index.snapshot.mockResolvedValue([hit(1, 90), hit(2, 80), hit(3, 70, 30), hit(4, 60), hit(5, 50), hit(6, 10)]);
    banned(2, 3, 6); // 2 counts; 3 is under the hour floor; 6 has fewer kills
    expect(await adjustedRank(5, sid(5))).toBe(4);
  });

  test('a banned player has no rank', async () => {
    index.snapshot.mockResolvedValue([hit(1, 90)]);
    banned(1);
    expect(await adjustedRank(1, sid(1))).toBeNull();
  });

  test('a player Warcon does not rank stays unranked', async () => {
    banned();
    expect(await adjustedRank(null, sid(1))).toBeNull();
  });

  test('unavailable when the ban list, the export, or the player in it is missing', async () => {
    index.snapshot.mockResolvedValue([hit(1, 90)]);
    bans.orgBannedIds.mockRejectedValue(new Error('down'));
    expect(await adjustedRank(3, sid(1))).toBe('unavailable');
    banned();
    index.snapshot.mockResolvedValue('warming');
    expect(await adjustedRank(3, sid(1))).toBe('unavailable');
    index.snapshot.mockResolvedValue([hit(2, 90)]);
    expect(await adjustedRank(3, sid(1))).toBe('unavailable');
  });
});


describe('Steam avatars on player lists', () => {
  // Warcon's player list always says steam: null; the pictures come from its Steam profile lookup.
  const A = '76561198000000001';
  const B = '76561198000000002';
  const pics = { [A]: { name: 'a', avatar: 'https://a/1.jpg' }, [B]: null };

  test('recently active players get their pictures from the Steam lookup', async () => {
    api.steamProfiles.mockResolvedValue(pics);
    const seen = (steamId: string, lastSeen: string) => ({ steamId, name: steamId, aliases: [], firstSeen: lastSeen, lastSeen, minutes: 1, kills: 0, deaths: 0, online: false, lastServerId: 's1', steam: null });
    api.seen.mockResolvedValue(fresh([seen(A, '2026-10-06T10:00:00Z'), seen(B, '2026-10-05T10:00:00Z')]));
    const r = await recentPlayers(2);
    expect(r.data.map((p) => p.avatarUrl)).toEqual(['https://a/1.jpg', null]);
  });

  test('favourite targets and nemeses on a profile get pictures', async () => {
    api.steamProfiles.mockResolvedValue(pics);
    api.live.mockResolvedValue(fresh(null));
    index.snapshot.mockResolvedValue([]);
    api.dossier.mockResolvedValue(fresh({
      steamId: '76561198000000009', name: 'Me', names: [], online: null, steam: null,
      summary: { sessions: 3, minutes: 90, kills: 5, deaths: 2, firstSeen: '2026-10-01T10:00:00Z', lastSeen: '2026-10-06T10:00:00Z' },
      combat: { suicides: 0, teamKills: 0, causes: [], victims: [{ steamId: A, name: 'A', kills: 3 }], nemeses: [{ steamId: B, name: 'B', deaths: 2 }] },
      perServer: [],
    }));
    api.career.mockResolvedValue(fresh({ rank: { server: null, org: null }, streak: null, matches: 1, wins: 1, losses: 0, draws: 0, kills: 5, deaths: 2, minutes: 90, headshots: 0, longestM: null, killStreak: 0, maps: [], factions: [], last: [] }));
    const p = await getPlayer('76561198000000009');
    expect(p?.data.victims[0].avatarUrl).toBe('https://a/1.jpg');
    expect(p?.data.nemeses[0].avatarUrl).toBeNull();
  });
});

describe('records', () => {
  const id = (n: number) => String(76561198000000000n + BigInt(n));
  const shot = (killer: number, m: number, extra: object = {}) => ({
    eventId: `e${killer}-${m}`, ts: '2026-10-10T12:00:00Z', map: 'Europe', eventTime: 1,
    killer: { steamId: id(killer), name: `K${killer}`, faction: null }, victim: { steamId: id(99), name: 'V', faction: null },
    cause: 'Id.Item.Mosin', distanceM: m, headshot: false, suicide: false, teamKill: false, tags: [], ...extra,
  });
  const boardRow = (n: number, o: object) => ({ rank: n, steamId: id(n), name: `P${n}`, minutes: 60, kills: 1, deaths: 1, headshots: 0, vehicleKills: 0, killStreak: 0, matches: 1, wins: 0, losses: 0, draws: 0, cash: 0, lastSeen: null, ...o });

  beforeEach(() => {
    api.kills.mockImplementation(async (sid: string, q: { cause: string; minM: number }) => {
      expect(q.minM).toBe(500);
      if (q.cause !== 'Id.Item.Mosin') return fresh({ kills: [], total: null });
      return fresh({ kills: sid === 's1' ? [shot(1, 610), shot(2, 990), shot(3, 700, { teamKill: true })] : [shot(4, 820), shot(5, 1000)], total: null });
    });
    api.boardExport.mockResolvedValue(fresh([boardRow(1, { killStreak: 12, headshots: 50 }), boardRow(2, { killStreak: 30, vehicleKills: 7 }), boardRow(5, { killStreak: 99 })]));
    api.analytics.mockImplementation(async (sid: string) =>
      fresh({ combat: { kills: 0, headshots: 0, players: sid === 's1' ? [{ steamId: id(1), name: 'K1', kills: 10, deaths: 1, headshots: 0 }, { steamId: id(2), name: 'K2', kills: 30, deaths: 1, headshots: 0 }] : [{ steamId: id(1), name: 'K1', kills: 25, deaths: 1, headshots: 0 }] } }),
    );
    bans.orgBannedIds.mockResolvedValue({ ids: new Set([id(5)]), stale: false });
  });

  test('longest shots across servers and guns, longest first; team kills and banned players left out', async () => {
    const r = await records();
    expect(r.data.longestShots.map((x) => [x.name, x.distance, x.serverName])).toEqual([['K2', 990, 'EU#1'], ['K4', 820, 'OC#1'], ['K1', 610, 'EU#1']]);
  });

  test('all-time leaders from the export, without banned players or zeros', async () => {
    const r = await records();
    expect(r.data.streaks.map((x) => [x.name, x.value])).toEqual([['P2', 30], ['P1', 12]]);
    expect(r.data.vehicleKills.map((x) => [x.name, x.value])).toEqual([['P2', 7]]);
    expect(r.data.headshots.map((x) => [x.name, x.value])).toEqual([['P1', 50]]);
  });

  test("today's killers add up across servers", async () => {
    const r = await records();
    expect(r.data.today.map((x) => [x.name, x.value])).toEqual([['K1', 35], ['K2', 30]]);
  });

  test('shorter shots and the same kill found twice are not counted', async () => {
    api.kills.mockImplementation(async (_sid: string, q: { cause: string }) =>
      fresh({ kills: q.cause === 'Id.Item.Mosin' || q.cause === 'Id.Item.SV98' ? [shot(1, 900), shot(2, 300)] : [], total: null }),
    );
    const r = await records();
    expect(r.data.longestShots.map((x) => [x.name, x.distance])).toEqual([['K1', 900], ['K1', 900]]); // once per server
  });

  test('impossible distances and vehicle-explosion kills are not records', async () => {
    api.kills.mockImplementation(async (_sid: string, q: { cause: string }) =>
      fresh({
        kills: q.cause === 'Id.Item.Mosin'
          ? [shot(1, 3940), shot(2, 1199), shot(3, 900, { tags: ['meta.progression.context.player.killcontext.VehicleExplosion'] }), shot(4, 880, { tags: ['meta.progression.context.player.killcontext.Penetration'] })]
          : [],
        total: null,
      }),
    );
    const r = await records();
    expect(r.data.longestShots.filter((x) => x.serverName === 'EU#1').map((x) => [x.name, x.distance])).toEqual([['K2', 1199], ['K4', 880]]);
  });

  test('a failed search marks its server missing instead of failing the page', async () => {
    api.kills.mockRejectedValue(new Error('down'));
    const r = await records();
    expect(r.data.longestShots).toEqual([]);
    expect(r.missing).toEqual(expect.arrayContaining(['s1', 's2']));
    expect(r.data.streaks).toHaveLength(2);
  });
});

describe('replayOf', () => {
  const kill = (eventTime: number, killer: string, victim: string, faction = 'Valkyra') => ({
    eventId: `${eventTime}`, ts: '2026-10-27T00:00:00Z', map: 'Europe', eventTime,
    killer: { steamId: killer, name: `n${killer}`, faction }, victim: { steamId: victim, name: `n${victim}`, faction: 'Lonestar' },
    cause: 'AK', distanceM: 12.4, headshot: true, suicide: false, teamKill: false, tags: [],
  });
  const row = (killer: string | null, victim: string | null) => ({
    killerSteamId: killer, killerName: killer ? `n${killer}` : 'Hidden player', victimSteamId: victim, victimName: victim ? `n${victim}` : 'Hidden player',
  }) as unknown as Parameters<typeof replayOf>[1][number];

  test('packs kills oldest first and keeps masked players anonymous', () => {
    // Warcon sends newest first; the second killer is hidden in the masked feed.
    const raw = [kill(20, 'h', 'b'), kill(10, 'a', 'b')];
    const r = replayOf(raw, [row(null, 'b'), row('a', 'b')]);
    expect(r.kills.map((k) => k[0])).toEqual([10, 20]);
    expect(r.people.map((p) => p.steamId)).toEqual(['a', 'b', null]);
    expect(r.people[2]).toEqual({ steamId: null, name: 'Hidden player', faction: 'Valkyra' });
    expect(JSON.stringify(r)).not.toContain('nh');
    expect(r.kills[0]).toEqual([10, 0, 1, 0, 1, 12]);
  });
});
