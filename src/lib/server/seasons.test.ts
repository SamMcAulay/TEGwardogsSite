import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, test } from 'vitest';
import { openSeasonOne, parseSeason, SEASON_TWO_START, seasonOne, seasonView, type SeasonOne } from './seasons';
import type { PlayerProfile } from './views';

const S2 = SEASON_TWO_START;
const servers = {
  name: new Map([['eu2', 'EU#2 - TEG.gg']]),
  short: new Map([['eu2', 'EU#2']]),
};

const player = (): PlayerProfile => ({
  steamId: '76561198000000001', name: 'Owl', avatarUrl: null, firstSeen: 1, lastSeen: S2 + 100, aliases: [],
  totals: { kills: 150, deaths: 90, headshots: 30, suicides: 4, teamkills: 2, playtime: 36_000, longest: 400, matches: 20, wins: 12, losses: 8, draws: 0, vehicleKills: 5, killStreak: 9 },
  rank: 10, streak: { kind: 'win', n: 3 }, onlineOn: null,
  weapons: [{ cause: 'AK', kills: 100 }, { cause: 'Knife', kills: 20 }],
  victims: [{ steamId: 'v1', name: 'V1', avatarUrl: null, count: 10 }, { steamId: 'v2', name: 'V2', avatarUrl: null, count: 4 }],
  nemeses: [{ steamId: 'n1', name: 'N1', avatarUrl: null, count: 6 }],
  servers: [{ serverId: 'eu2', name: 'EU#2 - TEG.gg', playtime: 30_000, kills: 120 }, { serverId: 'na1', name: 'NA-West - TEG.gg', playtime: 6_000, kills: 30 }],
  matches: [
    { matchId: 9, serverId: 'eu2', serverName: 'EU#2', map: 'Ozeti', startedAt: S2 + 50, endedAt: S2 + 90, faction: 'Lonestar', result: 'win', kills: 5, deaths: 1, timePlayed: 40 },
    { matchId: 8, serverId: 'eu2', serverName: 'EU#2', map: 'Ozeti', startedAt: S2 - 50, endedAt: S2 + 10, faction: 'Valkyra', result: 'loss', kills: 2, deaths: 3, timePlayed: 60 },
  ],
  maps: [{ key: 'Ozeti', matches: 20, wins: 12, kills: 150, deaths: 90 }],
  factions: [{ key: 'Lonestar', matches: 5, wins: 4, kills: 50, deaths: 20 }, { key: 'Valkyra', matches: 15, wins: 8, kills: 100, deaths: 70 }],
  recentKills: [
    { eventId: 'a', serverId: 'eu2', serverName: 'EU#2', ts: S2 + 5, cursor: '', killerSteamId: null, killerName: null, victimSteamId: 'x', victimName: 'x', cause: 'AK', distance: 1, headshot: 0, suicide: 0, teamkill: 0, tags: '' },
    { eventId: 'b', serverId: 'eu2', serverName: 'EU#2', ts: S2 - 5, cursor: '', killerSteamId: null, killerName: null, victimSteamId: 'x', victimName: 'x', cause: 'AK', distance: 1, headshot: 0, suicide: 0, teamkill: 0, tags: '' },
  ],
});

const one: SeasonOne = {
  kills: 100, deaths: 70, headshots: 20, seconds: 30_000, matches: 15, wins: 8, losses: 7, draws: 0, vehicleKills: 5,
  longest: 400, killStreak: 7, teamKills: 2, suicides: 1,
  maps: [['Ozeti', 15, 8, 100, 70]],
  factions: [['Valkyra', 15, 8, 100, 70]],
  rounds: [
    [8, 'eu2', 'Ozeti', S2 - 50, S2 + 10, 'Valkyra', 'loss', 2, 3, 60],
    [3, 'old-eu1', 'Ozeti', S2 - 900, S2 - 800, 'Valkyra', 'win', 9, 1, 100],
  ],
  weapons: [['AK', 80], ['Knife', 20], ['Pistol', 1]],
  victims: [['v1', 'V1', 10], ['v2', 'V2', 1]],
  nemeses: [['n1', 'N1', 2]],
  servers: [['eu2', 25_000, 90], ['old-eu1', 5_000, 10]],
};

describe('season two: all time minus season one', () => {
  const v = seasonView(player(), one, 's2', servers);

  test('totals subtract exactly', () => {
    expect(v.profile.totals).toMatchObject({ kills: 50, deaths: 20, headshots: 10, suicides: 3, teamkills: 0, playtime: 6_000, matches: 5, wins: 4, losses: 1, vehicleKills: 0 });
  });

  test('a best counts only when it beat season one', () => {
    expect(v.profile.totals.killStreak).toBe(9);
    expect(v.unknownBest).toEqual({ longest: true, killStreak: false });
  });

  test('maps and factions subtract per key, dropping what is left empty', () => {
    expect(v.profile.maps).toEqual([{ key: 'Ozeti', matches: 5, wins: 4, kills: 50, deaths: 20 }]);
    expect(v.profile.factions).toEqual([{ key: 'Lonestar', matches: 5, wins: 4, kills: 50, deaths: 20 }]);
  });

  test('weapons and rivals come off the all-time top lists, re-sorted', () => {
    expect(v.profile.weapons).toEqual([{ cause: 'AK', kills: 20 }]);
    expect(v.profile.victims.map((r) => [r.steamId, r.count])).toEqual([['v2', 3]]);
    expect(v.profile.nemeses.map((r) => [r.steamId, r.count])).toEqual([['n1', 4]]);
    expect(v.topListsOnly).toBe(true);
  });

  test('servers, rounds and kills are season two only', () => {
    expect(v.profile.servers).toEqual([
      { serverId: 'eu2', name: 'EU#2 - TEG.gg', playtime: 5_000, kills: 30 },
      { serverId: 'na1', name: 'NA-West - TEG.gg', playtime: 6_000, kills: 30 },
    ]);
    expect(v.profile.matches.map((m) => m.matchId)).toEqual([9]);
    expect(v.profile.recentKills.map((k) => k.eventId)).toEqual(['a']);
  });

  test('someone new this season sees their whole record', () => {
    const fresh = seasonView(player(), null, 's2', servers);
    expect(fresh.profile.totals).toEqual(player().totals);
    expect(fresh.unknownBest).toEqual({ longest: false, killStreak: false });
  });
});

describe('season one: the snapshot', () => {
  const v = seasonView(player(), one, 's1', servers);

  test('totals, groups and weapons straight from the snapshot', () => {
    expect(v.profile.totals).toMatchObject({ kills: 100, playtime: 30_000, longest: 400, killStreak: 7, suicides: 1 });
    expect(v.profile.factions).toEqual([{ key: 'Valkyra', matches: 15, wins: 8, kills: 100, deaths: 70 }]);
    expect(v.profile.weapons).toHaveLength(3);
    expect(v.topListsOnly).toBe(false);
  });

  test('retired servers never show', () => {
    expect(v.profile.servers.map((s) => s.serverId)).toEqual(['eu2']);
    expect(v.profile.matches.map((m) => m.matchId)).toEqual([8]);
    expect(v.profile.matches[0].serverName).toBe('EU#2');
  });

  test('a player who missed season one has an empty one', () => {
    const none = seasonView(player(), null, 's1', servers);
    expect(none.profile.totals.kills).toBe(0);
    expect(none.profile.matches).toEqual([]);
  });
});

test('parseSeason falls back to all time', () => {
  expect(parseSeason('s1')).toBe('s1');
  expect(parseSeason('s3')).toBe('all');
  expect(parseSeason(undefined)).toBe('all');
});

describe('the snapshot file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'season-one-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('scripts/season-one-db.mjs writes what openSeasonOne reads', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => `765611980000${String(i).padStart(5, '0')}\t${JSON.stringify({ ...one, kills: i })}`);
    const file = join(dir, 'season-one.db');
    execFileSync('node', ['scripts/season-one-db.mjs', file], { input: rows.join('\n') + '\n', stdio: ['pipe', 'ignore', 'ignore'] });
    const read = openSeasonOne(file);
    expect(read('76561198000000007')).toMatchObject({ kills: 7, factions: one.factions });
    expect(read('76561190000000000')).toBeNull();
  });

  test('without the file, season stats are unavailable rather than empty', () => {
    const before = process.env.DATA_DIR;
    process.env.DATA_DIR = join(dir, 'nothing-here');
    try {
      expect(seasonOne('76561198000000001')).toBe('unavailable');
    } finally {
      process.env.DATA_DIR = before;
    }
  });
});
