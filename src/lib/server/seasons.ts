// Season tabs on a player's profile. Warcon only answers all time, so season one is a frozen
// snapshot of its database (DATA_DIR/season-one.db, built by scripts/season-one.sql) and season
// two is all time minus season one. Totals, maps, factions and servers subtract exactly; weapons
// and rivals can only be taken off Warcon's all-time top lists; a season-two best (longest kill,
// kill streak) is only known when it beat season one's.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inflateRawSync } from 'node:zlib';
import type { PlayerMatchRow, PlayerProfile, Rival } from './views';

/** Season two began when the server lineup changed: 2026-10-14 00:00 UTC. */
export const SEASON_TWO_START = Date.UTC(2026, 9, 14) / 1000;

export const SEASONS = ['all', 's2', 's1'] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABELS: Record<Season, string> = { all: 'All time', s2: 'Season 2', s1: 'Season 1' };
export const parseSeason = (v: unknown): Season => (SEASONS.includes(v as Season) ? (v as Season) : 'all');

type Group = [key: string, matches: number, wins: number, kills: number, deaths: number];
type Round = [matchId: number, serverId: string, map: string | null, startedAt: number, endedAt: number | null, faction: string | null, result: PlayerMatchRow['result'], kills: number, deaths: number, seconds: number];

/** One player's season one, as scripts/season-one.sql writes it. */
export interface SeasonOne {
  kills: number; deaths: number; headshots: number; seconds: number; matches: number; wins: number; losses: number; draws: number;
  vehicleKills: number; longest: number | null; killStreak: number; teamKills: number; suicides: number;
  maps: Group[]; factions: Group[]; rounds: Round[];
  weapons: [cause: string, kills: number][];
  victims: [steamId: string, name: string, kills: number][];
  nemeses: [steamId: string, name: string, deaths: number][];
  /** then deaths, headshots, matches, wins, losses, draws, cash: the board's numbers (see SeasonOneBoardRow) */
  servers: [serverId: string, seconds: number, kills: number, ...rest: number[]][];
}

/** One player's season one on one server, counted as Warcon's leaderboard counts it. */
export interface SeasonOneBoardRow {
  seconds: number; kills: number; deaths: number; headshots: number; matches: number; wins: number; losses: number; draws: number; cash: number;
}

interface SeasonOneFile {
  player: (steamId: string) => SeasonOne | null;
  board: (serverId: string) => Map<string, SeasonOneBoardRow>;
}

/**
 * Reads a snapshot file: one player's season one (null when they didn't play it), or every
 * player's season one on a server, kept once read since it never changes.
 */
export function openSeasonOne(file: string): SeasonOneFile {
  const db = new DatabaseSync(file, { readOnly: true });
  const get = db.prepare('SELECT data FROM players WHERE steam_id = ?');
  const boards = new Map<string, Map<string, SeasonOneBoardRow>>();
  return {
    player: (steamId) => {
      const row = get.get(steamId) as { data: Uint8Array } | undefined;
      return row ? (JSON.parse(inflateRawSync(row.data).toString('utf8')) as SeasonOne) : null;
    },
    board: (serverId) => {
      let board = boards.get(serverId);
      if (!board) {
        // Prepared here, not on open: a snapshot from before boards were added still serves profiles.
        const rows = db
          .prepare('SELECT steam_id, seconds, kills, deaths, headshots, matches, wins, losses, draws, cash FROM boards WHERE server_id = ?')
          .all(serverId) as unknown as (SeasonOneBoardRow & { steam_id: string })[];
        board = new Map(rows.map(({ steam_id, ...r }) => [steam_id, r]));
        boards.set(serverId, board);
      }
      return board;
    },
  };
}

const g = globalThis as unknown as { __seasonOne?: SeasonOneFile };

function installed(): SeasonOneFile | null {
  if (!g.__seasonOne) {
    const file = join(process.env.DATA_DIR || './data', 'season-one.db');
    if (!existsSync(file)) return null;
    g.__seasonOne = openSeasonOne(file);
  }
  return g.__seasonOne;
}

/**
 * A player's season one from DATA_DIR/season-one.db: null when they didn't play it, 'unavailable'
 * when the snapshot isn't installed (local dev, or before it's copied to the server; looked for
 * again on every call until it is).
 */
export function seasonOne(steamId: string): SeasonOne | null | 'unavailable' {
  return installed()?.player(steamId) ?? (installed() ? null : 'unavailable');
}

/** Every player's season one on a server, by Steam ID; 'unavailable' without the snapshot. */
export function seasonOneBoard(serverId: string): Map<string, SeasonOneBoardRow> | 'unavailable' {
  return installed()?.board(serverId) ?? 'unavailable';
}

export interface SeasonView {
  profile: PlayerProfile;
  /** a season-two best that didn't beat season one's, so isn't known */
  unknownBest: { longest: boolean; killStreak: boolean };
  /** weapons and rivals were worked out from Warcon's all-time top lists */
  topListsOnly: boolean;
}

const EMPTY: SeasonOne = {
  kills: 0, deaths: 0, headshots: 0, seconds: 0, matches: 0, wins: 0, losses: 0, draws: 0, vehicleKills: 0, longest: null,
  killStreak: 0, teamKills: 0, suicides: 0, maps: [], factions: [], rounds: [], weapons: [], victims: [], nemeses: [], servers: [],
};

const group = ([key, matches, wins, kills, deaths]: Group) => ({ key, matches, wins, kills, deaths });
const minus = (a: number, b: number) => Math.max(0, a - b);

/** servers: the visible ones, full and short names; others (retired servers) are left out. */
export function seasonView(
  player: PlayerProfile,
  s1: SeasonOne | null,
  season: Exclude<Season, 'all'>,
  servers: { name: Map<string, string>; short: Map<string, string> },
): SeasonView {
  const one = s1 ?? EMPTY;
  return season === 's1' ? seasonOneView(player, one, servers) : seasonTwoView(player, one);
}

function seasonOneView(player: PlayerProfile, s: SeasonOne, servers: { name: Map<string, string>; short: Map<string, string> }): SeasonView {
  const rival = ([steamId, name, count]: [string, string, number]): Rival => ({ steamId, name, avatarUrl: null, count });
  return {
    profile: {
      ...player,
      totals: {
        kills: s.kills, deaths: s.deaths, headshots: s.headshots, suicides: s.suicides, teamkills: s.teamKills, playtime: s.seconds,
        longest: s.longest ?? 0, matches: s.matches, wins: s.wins, losses: s.losses, draws: s.draws, vehicleKills: s.vehicleKills,
        killStreak: s.killStreak,
      },
      weapons: s.weapons.map(([cause, kills]) => ({ cause, kills })),
      victims: s.victims.slice(0, 5).map(rival),
      nemeses: s.nemeses.slice(0, 5).map(rival),
      servers: s.servers
        .filter(([id]) => servers.name.has(id))
        .map(([serverId, seconds, kills]) => ({ serverId, name: servers.name.get(serverId)!, playtime: seconds, kills })),
      matches: s.rounds
        .filter(([, serverId]) => servers.short.has(serverId))
        .map(([matchId, serverId, map, startedAt, endedAt, faction, result, kills, deaths, timePlayed]) => ({
          matchId, serverId, serverName: servers.short.get(serverId)!, map: map ?? '', startedAt, endedAt, faction, result, kills, deaths, timePlayed,
        })),
      maps: s.maps.map(group),
      factions: s.factions.map(group),
      recentKills: [],
    },
    unknownBest: { longest: false, killStreak: false },
    topListsOnly: false,
  };
}

function seasonTwoView(player: PlayerProfile, s: SeasonOne): SeasonView {
  const t = player.totals;
  const less = <T extends { key: string; matches: number; wins: number; kills: number; deaths: number }>(rows: T[], s1: Group[]) => {
    const before = new Map(s1.map((r) => [r[0], r]));
    return rows
      .map((r) => {
        const b = before.get(r.key);
        return b ? { ...r, matches: minus(r.matches, b[1]), wins: minus(r.wins, b[2]), kills: minus(r.kills, b[3]), deaths: minus(r.deaths, b[4]) } : r;
      })
      .filter((r) => r.matches > 0);
  };
  const lessCounts = <T>(rows: T[], key: (r: T) => string, count: (r: T) => number, s1: Map<string, number>, set: (r: T, n: number) => T) =>
    rows
      .map((r) => set(r, minus(count(r), s1.get(key(r)) ?? 0)))
      .filter((r) => count(r) > 0)
      .sort((a, b) => count(b) - count(a));
  const s1Rivals = (rows: [string, string, number][]) => new Map(rows.map(([id, , n]) => [id, n]));
  const rivals = (rows: Rival[], s1: [string, string, number][]) =>
    lessCounts(rows, (r) => r.steamId, (r) => r.count, s1Rivals(s1), (r, count) => ({ ...r, count }));
  const s1Servers = new Map(s.servers.map(([id, seconds, kills]) => [id, { seconds, kills }]));
  // A best is a maximum, so it can't be subtracted: all time's is season two's only if it's higher.
  const best = (all: number, s1: number | null) => (s1 && all <= s1 ? null : all);
  const longest = best(t.longest, s.longest);
  const killStreak = best(t.killStreak, s.killStreak);
  return {
    profile: {
      ...player,
      totals: {
        kills: minus(t.kills, s.kills), deaths: minus(t.deaths, s.deaths), headshots: minus(t.headshots, s.headshots),
        suicides: minus(t.suicides, s.suicides), teamkills: minus(t.teamkills, s.teamKills), playtime: minus(t.playtime, s.seconds),
        longest: longest ?? 0, matches: minus(t.matches, s.matches), wins: minus(t.wins, s.wins), losses: minus(t.losses, s.losses),
        draws: minus(t.draws, s.draws), vehicleKills: minus(t.vehicleKills, s.vehicleKills), killStreak: killStreak ?? 0,
      },
      weapons: lessCounts(player.weapons, (w) => w.cause, (w) => w.kills, new Map(s.weapons), (w, kills) => ({ ...w, kills })),
      victims: rivals(player.victims, s.victims),
      nemeses: rivals(player.nemeses, s.nemeses),
      servers: player.servers
        .map((p) => {
          const b = s1Servers.get(p.serverId);
          return b ? { ...p, playtime: minus(p.playtime, b.seconds), kills: minus(p.kills, b.kills) } : p;
        })
        .filter((p) => p.playtime > 0),
      matches: player.matches.filter((m) => m.startedAt >= SEASON_TWO_START),
      maps: less(player.maps, s.maps),
      factions: less(player.factions, s.factions),
      recentKills: player.recentKills.filter((k) => k.ts >= SEASON_TWO_START),
    },
    unknownBest: { longest: longest === null, killStreak: killStreak === null },
    topListsOnly: true,
  };
}
