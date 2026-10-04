// Read-side queries for the pages. Everything here is synchronous SQLite; pages call it directly.

import { db, dayOf, nowSec, stmt } from './db';
import type { LivePlayer, ServerStatus } from './rcon';

// ---------------------------------------------------------------------------------------------
// Periods

export const PERIODS = ['today', '7d', '30d', 'all'] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  all: 'All time',
};

export function parsePeriod(v: unknown, fallback: Period = '7d'): Period {
  return PERIODS.includes(v as Period) ? (v as Period) : fallback;
}

/** First UTC day included in a period. */
export function periodStartDay(period: Period, now = nowSec()): string {
  switch (period) {
    case 'today':
      return dayOf(now);
    case '7d':
      return dayOf(now - 6 * 86400);
    case '30d':
      return dayOf(now - 29 * 86400);
    case 'all':
      return '0000-00-00';
  }
}

export function periodStartTs(period: Period, now = nowSec()): number {
  return period === 'all' ? 0 : Date.parse(`${periodStartDay(period, now)}T00:00:00Z`) / 1000;
}

// ---------------------------------------------------------------------------------------------
// Servers

export interface ServerRow {
  id: string;
  name: string;
  shortName: string;
  region: string;
  location: string;
  online: boolean;
  updatedAt: number | null;
  lastOnlineAt: number | null;
  status: ServerStatus | null;
  players: LivePlayer[];
  /** Players connected. Steam-query servers report a count but no player list. */
  playerCount: number;
  joinCode: string | null;
  startedAt: number | null;
  error: string | null;
}

interface RawServer {
  id: string;
  name: string;
  short_name: string;
  region: string;
  location: string;
  online: number | null;
  updated_at: number | null;
  last_online_at: number | null;
  status_json: string | null;
  players_json: string | null;
  join_code: string | null;
  started_at: number | null;
  error: string | null;
}

/** A server not heard from in this long is shown offline even if the last poll succeeded. */
const STALE_SECONDS = 60;

function toServer(r: RawServer, now: number): ServerRow {
  const fresh = r.updated_at != null && now - r.updated_at < STALE_SECONDS;
  const online = !!r.online && fresh;
  const status: ServerStatus | null = online && r.status_json ? JSON.parse(r.status_json) : null;
  const players: LivePlayer[] = online && r.players_json ? JSON.parse(r.players_json) : [];
  return {
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    region: r.region,
    location: r.location,
    online,
    updatedAt: r.updated_at,
    lastOnlineAt: r.last_online_at,
    status,
    players,
    playerCount: players.length || status?.players?.current || 0,
    joinCode: r.join_code,
    startedAt: r.started_at,
    error: r.error,
  };
}

const SERVER_SQL = `
  SELECT s.id, s.name, s.short_name, s.region, s.location, l.online, l.updated_at, l.last_online_at,
         l.status_json, l.players_json, l.join_code, l.started_at, l.error
  FROM servers s LEFT JOIN server_live l ON l.server_id = s.id`;

export function getServers(): ServerRow[] {
  const now = nowSec();
  return (stmt(db(), `${SERVER_SQL} ORDER BY s.sort`).all() as RawServer[]).map((r) => toServer(r, now));
}

export function getServer(id: string): ServerRow | null {
  const r = stmt(db(), `${SERVER_SQL} WHERE s.id = ?`).get(id) as RawServer | undefined;
  return r ? toServer(r, nowSec()) : null;
}

export interface NetworkSummary {
  playersOnline: number;
  capacity: number;
  serversOnline: number;
  serversTotal: number;
  killsToday: number;
  playersToday: number;
  matchesToday: number;
  totalPlayers: number;
  peakToday: number;
}

export function networkSummary(servers = getServers()): NetworkSummary {
  const conn = db();
  const now = nowSec();
  const today = dayOf(now);
  const dayStart = Date.parse(`${today}T00:00:00Z`) / 1000;
  const daily = stmt(
    conn,
    `SELECT COALESCE(SUM(kills), 0) kills, COUNT(DISTINCT steam_id) players FROM player_daily WHERE day = ?`,
  ).get(today) as { kills: number; players: number };
  const matches = stmt(conn, `SELECT COUNT(*) n FROM matches WHERE started_at >= ?`).get(dayStart) as { n: number };
  const total = stmt(conn, `SELECT COUNT(*) n FROM players`).get() as { n: number };
  const peak = stmt(
    conn,
    `SELECT COALESCE(MAX(total), 0) peak FROM (SELECT ts, SUM(players) total FROM population WHERE ts >= ? GROUP BY ts)`,
  ).get(dayStart) as { peak: number };
  const online = servers.filter((s) => s.online);
  return {
    playersOnline: online.reduce((a, s) => a + s.playerCount, 0),
    capacity: online.reduce((a, s) => a + (s.status?.players.max ?? 0), 0),
    serversOnline: online.length,
    serversTotal: servers.length,
    killsToday: daily.kills,
    playersToday: daily.players,
    matchesToday: matches.n,
    totalPlayers: total.n,
    peakToday: peak.peak,
  };
}

export interface PopulationPoint {
  ts: number;
  players: number;
  max: number;
}

/** Population in buckets (max within each bucket), for one server or the whole network. */
export function population(serverId: string | null, since: number, bucket: number): PopulationPoint[] {
  const conn = db();
  if (serverId) {
    return stmt(
      conn,
      `SELECT (ts / ?) * ? ts, MAX(players) players, MAX(max_players) max FROM population
       WHERE server_id = ? AND ts >= ? GROUP BY 1 ORDER BY 1`,
    ).all(bucket, bucket, serverId, since) as PopulationPoint[];
  }
  return stmt(
    conn,
    `SELECT b ts, MAX(total) players, MAX(cap) max FROM (
       SELECT (ts / ?) * ? b, ts, SUM(players) total, SUM(max_players) cap FROM population WHERE ts >= ? GROUP BY ts
     ) GROUP BY b ORDER BY b`,
  ).all(bucket, bucket, since) as PopulationPoint[];
}

// ---------------------------------------------------------------------------------------------
// Leaderboards

export const METRICS = ['kills', 'kd', 'kph', 'headshots', 'hsr', 'longest', 'playtime'] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric, string> = {
  kills: 'Kills',
  kd: 'K/D',
  kph: 'Kills / hour',
  headshots: 'Headshots',
  hsr: 'Headshot %',
  longest: 'Longest kill',
  playtime: 'Playtime',
};

export function parseMetric(v: unknown): Metric {
  return METRICS.includes(v as Metric) ? (v as Metric) : 'kills';
}

/** Minimum sample for ratio boards, so one lucky match does not top them. */
export const MIN_KILLS: Record<Period, number> = { today: 10, '7d': 50, '30d': 150, all: 250 };
const MIN_PLAYTIME: Record<Period, number> = { today: 3600, '7d': 3 * 3600, '30d': 8 * 3600, all: 12 * 3600 };

const METRIC_SQL: Record<Metric, { value: string; having: string }> = {
  kills: { value: 'SUM(d.kills)', having: 'SUM(d.kills) > 0' },
  kd: { value: 'CAST(SUM(d.kills) AS REAL) / MAX(SUM(d.deaths), 1)', having: 'SUM(d.kills) >= @minKills' },
  kph: { value: 'SUM(d.kills) * 3600.0 / SUM(d.playtime_s)', having: 'SUM(d.playtime_s) >= @minPlaytime' },
  headshots: { value: 'SUM(d.headshots)', having: 'SUM(d.headshots) > 0' },
  hsr: { value: 'CAST(SUM(d.headshots) AS REAL) / MAX(SUM(d.kills), 1)', having: 'SUM(d.kills) >= @minKills' },
  longest: { value: 'MAX(d.longest_kill_m)', having: 'MAX(d.longest_kill_m) > 0' },
  playtime: { value: 'SUM(d.playtime_s)', having: 'SUM(d.playtime_s) > 0' },
};

export interface LeaderRow {
  rank: number;
  steamId: string;
  name: string;
  avatarUrl: string | null;
  kills: number;
  deaths: number;
  headshots: number;
  playtime: number;
  longest: number;
  matches: number;
  value: number;
  lastSeen: number;
}

export interface LeaderboardQuery {
  metric: Metric;
  period: Period;
  serverId?: string | null;
  limit?: number;
  offset?: number;
}

function leaderboardSql(metric: Metric, serverFilter: boolean) {
  const m = METRIC_SQL[metric];
  return `
    SELECT d.steam_id steamId, p.name, p.avatar_url avatarUrl, p.last_seen lastSeen,
           SUM(d.kills) kills, SUM(d.deaths) deaths, SUM(d.headshots) headshots,
           SUM(d.playtime_s) playtime, MAX(d.longest_kill_m) longest, SUM(d.matches) matches,
           ${m.value} value
    FROM player_daily d JOIN players p ON p.steam_id = d.steam_id
    WHERE d.day >= @startDay ${serverFilter ? 'AND d.server_id = @serverId' : ''}
    GROUP BY d.steam_id
    HAVING ${m.having}`;
}

export function leaderboard(q: LeaderboardQuery): { rows: LeaderRow[]; total: number } {
  const conn = db();
  const params = {
    startDay: periodStartDay(q.period),
    serverId: q.serverId ?? null,
    minKills: MIN_KILLS[q.period],
    minPlaytime: MIN_PLAYTIME[q.period],
  };
  const base = leaderboardSql(q.metric, !!q.serverId);
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  const rows = stmt(conn, `${base} ORDER BY value DESC, kills DESC LIMIT @limit OFFSET @offset`).all({
    ...params,
    limit,
    offset,
  }) as Omit<LeaderRow, 'rank'>[];
  const total = (stmt(conn, `SELECT COUNT(*) n FROM (${base})`).get(params) as { n: number }).n;
  return { rows: rows.map((r, i) => ({ ...r, rank: offset + i + 1 })), total };
}

/** A player's position on a board, or null when they do not qualify. */
export function playerRank(steamId: string, metric: Metric, period: Period): { rank: number; of: number } | null {
  const conn = db();
  const params = {
    startDay: periodStartDay(period),
    serverId: null,
    minKills: MIN_KILLS[period],
    minPlaytime: MIN_PLAYTIME[period],
    steamId,
  };
  const base = leaderboardSql(metric, false);
  const row = stmt(
    conn,
    `SELECT rank, total FROM (SELECT steamId, RANK() OVER (ORDER BY value DESC) rank, COUNT(*) OVER () total FROM (${base}))
     WHERE steamId = @steamId`,
  ).get(params) as { rank: number; total: number } | undefined;
  return row ? { rank: row.rank, of: row.total } : null;
}

// ---------------------------------------------------------------------------------------------
// Players

export interface PlayerSearchRow {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  lastSeen: number;
  matchedAlias: string | null;
}

export function searchPlayers(q: string, limit = 25): PlayerSearchRow[] {
  const term = q.trim();
  if (!term) return [];
  const conn = db();
  if (/^\d{17}$/.test(term)) {
    return stmt(
      conn,
      `SELECT steam_id steamId, name, avatar_url avatarUrl, last_seen lastSeen, NULL matchedAlias FROM players WHERE steam_id = ?`,
    ).all(term) as PlayerSearchRow[];
  }
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return stmt(
    conn,
    `SELECT p.steam_id steamId, p.name, p.avatar_url avatarUrl, p.last_seen lastSeen,
            CASE WHEN p.name LIKE @like ESCAPE '\\' THEN NULL ELSE MAX(n.name) END matchedAlias
     FROM player_names n JOIN players p ON p.steam_id = n.steam_id
     WHERE n.name LIKE @like ESCAPE '\\'
     GROUP BY p.steam_id
     ORDER BY (p.name LIKE @prefix ESCAPE '\\') DESC, p.last_seen DESC
     LIMIT @limit`,
  ).all({ like, prefix: `${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, limit }) as PlayerSearchRow[];
}

export interface Totals {
  kills: number;
  deaths: number;
  headshots: number;
  suicides: number;
  teamkills: number;
  playtime: number;
  longest: number;
  matches: number;
}

export interface PlayerProfile {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  firstSeen: number;
  lastSeen: number;
  lastServerId: string | null;
  aliases: { name: string; lastSeen: number }[];
  totals: Totals;
  /** Where they are playing right now, if anywhere. */
  onlineOn: { serverId: string; serverName: string; live: LivePlayer } | null;
}

const TOTALS_SQL = `
  SELECT COALESCE(SUM(kills),0) kills, COALESCE(SUM(deaths),0) deaths, COALESCE(SUM(headshots),0) headshots,
         COALESCE(SUM(suicides),0) suicides, COALESCE(SUM(teamkills),0) teamkills,
         COALESCE(SUM(playtime_s),0) playtime, COALESCE(MAX(longest_kill_m),0) longest, COALESCE(SUM(matches),0) matches
  FROM player_daily WHERE steam_id = @steamId AND day >= @startDay`;

export function playerTotals(steamId: string, period: Period): Totals {
  return stmt(db(), TOTALS_SQL).get({ steamId, startDay: periodStartDay(period) }) as Totals;
}

export function getPlayer(steamId: string): PlayerProfile | null {
  const conn = db();
  const p = stmt(
    conn,
    `SELECT steam_id steamId, name, avatar_url avatarUrl, first_seen firstSeen, last_seen lastSeen, last_server_id lastServerId
     FROM players WHERE steam_id = ?`,
  ).get(steamId) as Omit<PlayerProfile, 'aliases' | 'totals' | 'onlineOn'> | undefined;
  if (!p) return null;
  const aliases = stmt(
    conn,
    `SELECT name, last_seen lastSeen FROM player_names WHERE steam_id = ? ORDER BY last_seen DESC LIMIT 12`,
  ).all(steamId) as { name: string; lastSeen: number }[];

  let onlineOn: PlayerProfile['onlineOn'] = null;
  for (const s of getServers()) {
    const live = s.players.find((x) => x.steamId === steamId);
    if (live) onlineOn = { serverId: s.id, serverName: s.name, live };
  }
  return { ...p, aliases, totals: playerTotals(steamId, 'all'), onlineOn };
}

export interface WeaponUse {
  cause: string;
  kills: number;
  headshots: number;
  longest: number;
  avgDistance: number;
}

export function playerWeapons(steamId: string, since = 0, limit = 50): WeaponUse[] {
  return stmt(
    db(),
    `SELECT cause, COUNT(*) kills, SUM(headshot) headshots, COALESCE(MAX(distance_m),0) longest,
            COALESCE(AVG(distance_m),0) avgDistance
     FROM kills WHERE killer_steam_id = ? AND ts >= ? AND suicide = 0 AND teamkill = 0 AND cause IS NOT NULL
     GROUP BY cause ORDER BY kills DESC LIMIT ?`,
  ).all(steamId, since, limit) as WeaponUse[];
}

export interface Rival {
  steamId: string;
  name: string;
  count: number;
}

/** Who they kill most (victims) and who kills them most (nemeses). */
export function playerRivals(steamId: string, since = 0, limit = 5): { victims: Rival[]; nemeses: Rival[] } {
  const conn = db();
  const victims = stmt(
    conn,
    `SELECT k.victim_steam_id steamId, p.name, COUNT(*) count FROM kills k JOIN players p ON p.steam_id = k.victim_steam_id
     WHERE k.killer_steam_id = ? AND k.ts >= ? AND k.suicide = 0 GROUP BY k.victim_steam_id ORDER BY count DESC LIMIT ?`,
  ).all(steamId, since, limit) as Rival[];
  const nemeses = stmt(
    conn,
    `SELECT k.killer_steam_id steamId, p.name, COUNT(*) count FROM kills k JOIN players p ON p.steam_id = k.killer_steam_id
     WHERE k.victim_steam_id = ? AND k.ts >= ? AND k.suicide = 0 GROUP BY k.killer_steam_id ORDER BY count DESC LIMIT ?`,
  ).all(steamId, since, limit) as Rival[];
  return { victims, nemeses };
}

export interface DailyPoint {
  day: string;
  kills: number;
  deaths: number;
  playtime: number;
}

export function playerDaily(steamId: string, days = 30): DailyPoint[] {
  const start = dayOf(nowSec() - (days - 1) * 86400);
  const rows = stmt(
    db(),
    `SELECT day, SUM(kills) kills, SUM(deaths) deaths, SUM(playtime_s) playtime FROM player_daily
     WHERE steam_id = ? AND day >= ? GROUP BY day`,
  ).all(steamId, start) as DailyPoint[];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const day = dayOf(nowSec() - (days - 1 - i) * 86400);
    return byDay.get(day) ?? { day, kills: 0, deaths: 0, playtime: 0 };
  });
}

export function playerServers(steamId: string): { serverId: string; name: string; playtime: number; kills: number }[] {
  return stmt(
    db(),
    `SELECT d.server_id serverId, s.short_name name, SUM(d.playtime_s) playtime, SUM(d.kills) kills
     FROM player_daily d JOIN servers s ON s.id = d.server_id WHERE d.steam_id = ?
     GROUP BY d.server_id ORDER BY playtime DESC`,
  ).all(steamId) as { serverId: string; name: string; playtime: number; kills: number }[];
}

export interface PlayerMatchRow {
  matchId: number;
  serverId: string;
  serverName: string;
  map: string;
  startedAt: number;
  endedAt: number | null;
  faction: string | null;
  winner: string | null;
  kills: number;
  deaths: number;
  timePlayed: number;
}

export function playerMatches(steamId: string, limit = 15, offset = 0): PlayerMatchRow[] {
  return stmt(
    db(),
    `SELECT m.id matchId, m.server_id serverId, s.short_name serverName, m.map, m.started_at startedAt,
            m.ended_at endedAt, m.winner, (SELECT faction FROM sessions x WHERE x.match_id = m.id AND x.steam_id = @steamId
            ORDER BY x.last_seen_at DESC LIMIT 1) faction,
            SUM(ss.kills) kills, SUM(ss.deaths) deaths, SUM(ss.last_seen_at - ss.started_at) timePlayed
     FROM sessions ss JOIN matches m ON m.id = ss.match_id JOIN servers s ON s.id = m.server_id
     WHERE ss.steam_id = @steamId
     GROUP BY m.id ORDER BY m.started_at DESC LIMIT @limit OFFSET @offset`,
  ).all({ steamId, limit, offset }) as PlayerMatchRow[];
}

// ---------------------------------------------------------------------------------------------
// Kill feed

export interface KillRow {
  /** Insertion order; used as the feed's pagination cursor. */
  seq: number;
  eventId: string;
  serverId: string;
  serverName: string;
  matchId: number | null;
  ts: number;
  killerSteamId: string | null;
  killerName: string | null;
  victimSteamId: string | null;
  victimName: string | null;
  cause: string | null;
  distance: number | null;
  headshot: number;
  suicide: number;
  teamkill: number;
  tags: string;
}

// Kill queries use CROSS JOIN, which in SQLite fixes the join order: kills stays the outer loop, so
// ORDER BY rowid or distance walks an index instead of sorting every matching row.
const KILL_COLUMNS = `k.rowid seq, k.event_id eventId, k.server_id serverId, s.short_name serverName, k.match_id matchId, k.ts,
  k.killer_steam_id killerSteamId, k.killer_name killerName, k.victim_steam_id victimSteamId, k.victim_name victimName,
  k.cause, k.distance_m distance, k.headshot, k.suicide, k.teamkill, k.tags`;

export interface KillQuery {
  serverId?: string | null;
  steamId?: string | null;
  matchId?: number | null;
  cause?: string | null;
  before?: number | null;
  limit?: number;
}

export function recentKills(q: KillQuery = {}): KillRow[] {
  const where: string[] = [];
  if (q.serverId) where.push('k.server_id = @serverId');
  if (q.steamId) where.push('(k.killer_steam_id = @steamId OR k.victim_steam_id = @steamId)');
  if (q.matchId) where.push('k.match_id = @matchId');
  if (q.cause) where.push('k.cause = @cause');
  if (q.before) where.push('k.rowid < @before');
  // A player's kills and deaths come from two indexes; UNION lets SQLite use both.
  if (q.steamId && !q.serverId && !q.matchId && !q.cause) {
    const b = q.before ? 'AND k.rowid < @before' : '';
    return stmt(
      db(),
      `SELECT * FROM (
         SELECT ${KILL_COLUMNS} FROM kills k CROSS JOIN servers s ON s.id = k.server_id WHERE k.killer_steam_id = @steamId ${b}
         UNION
         SELECT ${KILL_COLUMNS} FROM kills k CROSS JOIN servers s ON s.id = k.server_id WHERE k.victim_steam_id = @steamId ${b}
       ) ORDER BY seq DESC LIMIT @limit`,
    ).all({ steamId: q.steamId, before: q.before ?? null, limit: q.limit ?? 30 }) as KillRow[];
  }
  return stmt(
    db(),
    `SELECT ${KILL_COLUMNS} FROM kills k CROSS JOIN servers s ON s.id = k.server_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY k.rowid DESC LIMIT @limit`,
  ).all({
    serverId: q.serverId ?? null,
    steamId: q.steamId ?? null,
    matchId: q.matchId ?? null,
    cause: q.cause ?? null,
    before: q.before ?? null,
    limit: q.limit ?? 30,
  }) as KillRow[];
}

// ---------------------------------------------------------------------------------------------
// Matches

export interface MatchRow {
  id: number;
  serverId: string;
  serverName: string;
  map: string;
  experiences: string[];
  lighting: string | null;
  startedAt: number;
  endedAt: number | null;
  winner: string | null;
  scores: { name: string; colorHex: string; score: number }[];
  peakPlayers: number;
}

interface RawMatch {
  id: number;
  server_id: string;
  server_name: string;
  map: string;
  experiences: string;
  lighting: string | null;
  started_at: number;
  ended_at: number | null;
  winner: string | null;
  scores_json: string;
  peak_players: number;
}

function toMatch(r: RawMatch): MatchRow {
  return {
    id: r.id,
    serverId: r.server_id,
    serverName: r.server_name,
    map: r.map,
    experiences: JSON.parse(r.experiences),
    lighting: r.lighting,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    winner: r.winner,
    scores: JSON.parse(r.scores_json),
    peakPlayers: r.peak_players,
  };
}

const MATCH_SQL = `SELECT m.*, s.short_name server_name FROM matches m JOIN servers s ON s.id = m.server_id`;

/** Matches worth listing: ones that actually had people in them. */
export function listMatches(q: { serverId?: string | null; limit?: number; offset?: number } = {}): {
  rows: MatchRow[];
  total: number;
} {
  const conn = db();
  const where = `WHERE m.peak_players >= 2 ${q.serverId ? 'AND m.server_id = @serverId' : ''}`;
  const rows = stmt(conn, `${MATCH_SQL} ${where} ORDER BY m.started_at DESC LIMIT @limit OFFSET @offset`).all({
    serverId: q.serverId ?? null,
    limit: q.limit ?? 25,
    offset: q.offset ?? 0,
  }) as RawMatch[];
  const total = (
    stmt(conn, `SELECT COUNT(*) n FROM matches m ${where}`).get({ serverId: q.serverId ?? null }) as { n: number }
  ).n;
  return { rows: rows.map(toMatch), total };
}

export function getMatch(id: number): MatchRow | null {
  const r = stmt(db(), `${MATCH_SQL} WHERE m.id = ?`).get(id) as RawMatch | undefined;
  return r ? toMatch(r) : null;
}

export interface MatchPlayerRow {
  steamId: string;
  name: string;
  faction: string | null;
  kills: number;
  deaths: number;
  headshots: number;
  longest: number;
  cash: number;
  timePlayed: number;
}

export function matchScoreboard(matchId: number): MatchPlayerRow[] {
  return stmt(
    db(),
    `SELECT ss.steam_id steamId, p.name,
            (SELECT faction FROM sessions x WHERE x.match_id = @matchId AND x.steam_id = ss.steam_id
             ORDER BY x.last_seen_at DESC LIMIT 1) faction,
            SUM(ss.kills) kills, SUM(ss.deaths) deaths, MAX(ss.cash) cash,
            SUM(ss.last_seen_at - ss.started_at) timePlayed,
            COALESCE(k.headshots, 0) headshots, COALESCE(k.longest, 0) longest
     FROM sessions ss JOIN players p ON p.steam_id = ss.steam_id
     LEFT JOIN (SELECT killer_steam_id, SUM(headshot) headshots, MAX(distance_m) longest FROM kills
                WHERE match_id = @matchId AND suicide = 0 AND teamkill = 0 GROUP BY killer_steam_id) k
       ON k.killer_steam_id = ss.steam_id
     WHERE ss.match_id = @matchId
     GROUP BY ss.steam_id ORDER BY kills DESC, deaths ASC`,
  ).all({ matchId }) as MatchPlayerRow[];
}

export function matchWeapons(matchId: number, limit = 8): { cause: string; kills: number }[] {
  return stmt(
    db(),
    `SELECT cause, COUNT(*) kills FROM kills WHERE match_id = ? AND cause IS NOT NULL AND suicide = 0
     GROUP BY cause ORDER BY kills DESC LIMIT ?`,
  ).all(matchId, limit) as { cause: string; kills: number }[];
}

/** Kills per minute through a match, for the timeline strip. */
export function matchTimeline(matchId: number, bucket = 60): { ts: number; kills: number }[] {
  return stmt(db(), `SELECT (ts / ?) * ? ts, COUNT(*) kills FROM kills WHERE match_id = ? GROUP BY 1 ORDER BY 1`).all(
    bucket,
    bucket,
    matchId,
  ) as { ts: number; kills: number }[];
}

// ---------------------------------------------------------------------------------------------
// Weapons

export interface WeaponRow {
  cause: string;
  kills: number;
  headshots: number;
  longest: number;
  avgDistance: number;
}

export function weaponStats(period: Period, serverId?: string | null): WeaponRow[] {
  return stmt(
    db(),
    `SELECT cause, SUM(kills) kills, SUM(headshots) headshots, MAX(longest_m) longest,
            COALESCE(SUM(distance_sum) / NULLIF(SUM(distance_n), 0), 0) avgDistance
     FROM weapon_daily WHERE day >= @startDay ${serverId ? 'AND server_id = @serverId' : ''}
     GROUP BY cause ORDER BY kills DESC`,
  ).all({ startDay: periodStartDay(period), serverId: serverId ?? null }) as WeaponRow[];
}

export function weaponTopPlayers(
  cause: string,
  since: number,
  limit = 25,
): { steamId: string; name: string; kills: number; headshots: number; longest: number }[] {
  return stmt(
    db(),
    `SELECT k.killer_steam_id steamId, p.name, COUNT(*) kills, SUM(k.headshot) headshots, MAX(k.distance_m) longest
     FROM kills k JOIN players p ON p.steam_id = k.killer_steam_id
     WHERE k.cause = ? AND k.ts >= ? AND k.suicide = 0 AND k.teamkill = 0
     GROUP BY k.killer_steam_id ORDER BY kills DESC LIMIT ?`,
  ).all(cause, since, limit) as { steamId: string; name: string; kills: number; headshots: number; longest: number }[];
}

export function longestKills(since: number, limit = 10): KillRow[] {
  return stmt(
    db(),
    `SELECT ${KILL_COLUMNS} FROM kills k CROSS JOIN servers s ON s.id = k.server_id
     WHERE k.suicide = 0 AND k.teamkill = 0 AND k.distance_m IS NOT NULL AND k.ts >= ?
       AND k.cause NOT LIKE 'Id.Vehicle.%' AND k.cause NOT LIKE 'Vehicle.%'
     ORDER BY k.distance_m DESC LIMIT ?`,
  ).all(since, limit) as KillRow[];
}

// ---------------------------------------------------------------------------------------------
// Server-level aggregates

export function serverTotals(serverId: string, period: Period) {
  const startDay = periodStartDay(period);
  const conn = db();
  const d = stmt(
    conn,
    `SELECT COALESCE(SUM(kills),0) kills, COUNT(DISTINCT steam_id) players, COALESCE(SUM(playtime_s),0) playtime
     FROM player_daily WHERE server_id = ? AND day >= ?`,
  ).get(serverId, startDay) as { kills: number; players: number; playtime: number };
  const m = stmt(
    conn,
    `SELECT COUNT(*) matches, COALESCE(AVG(ended_at - started_at), 0) avgLength FROM matches
     WHERE server_id = ? AND started_at >= ? AND ended_at IS NOT NULL AND peak_players >= 2`,
  ).get(serverId, periodStartTs(period)) as { matches: number; avgLength: number };
  return { ...d, ...m };
}

export function factionWins(serverId: string | null, since: number): { faction: string; wins: number }[] {
  return stmt(
    db(),
    `SELECT winner faction, COUNT(*) wins FROM matches
     WHERE winner IS NOT NULL AND ended_at IS NOT NULL AND started_at >= @since AND peak_players >= 2
       ${serverId ? 'AND server_id = @serverId' : ''}
     GROUP BY winner ORDER BY wins DESC`,
  ).all({ since, serverId }) as { faction: string; wins: number }[];
}

export function mapStats(since: number): { map: string; matches: number; avgLength: number; avgPeak: number }[] {
  return stmt(
    db(),
    `SELECT map, COUNT(*) matches, AVG(ended_at - started_at) avgLength, AVG(peak_players) avgPeak FROM matches
     WHERE started_at >= ? AND ended_at IS NOT NULL AND peak_players >= 2 GROUP BY map ORDER BY matches DESC`,
  ).all(since) as { map: string; matches: number; avgLength: number; avgPeak: number }[];
}

export function recentPlayers(limit = 30): PlayerSearchRow[] {
  return stmt(
    db(),
    `SELECT steam_id steamId, name, avatar_url avatarUrl, last_seen lastSeen, NULL matchedAlias FROM players
     ORDER BY last_seen DESC LIMIT ?`,
  ).all(limit) as PlayerSearchRow[];
}

export function newPlayers(since: number, limit = 10): (PlayerSearchRow & { firstSeen: number })[] {
  return stmt(
    db(),
    `SELECT steam_id steamId, name, avatar_url avatarUrl, last_seen lastSeen, first_seen firstSeen, NULL matchedAlias
     FROM players WHERE first_seen >= ? ORDER BY first_seen DESC LIMIT ?`,
  ).all(since, limit) as (PlayerSearchRow & { firstSeen: number })[];
}

export function weaponLongest(cause: string, since: number, limit = 10): KillRow[] {
  return stmt(
    db(),
    `SELECT ${KILL_COLUMNS} FROM kills k CROSS JOIN servers s ON s.id = k.server_id
     WHERE k.cause = ? AND k.ts >= ? AND k.suicide = 0 AND k.teamkill = 0 AND k.distance_m IS NOT NULL
     ORDER BY k.distance_m DESC LIMIT ?`,
  ).all(cause, since, limit) as KillRow[];
}

export function weaponDaily(cause: string, days = 30): { day: string; kills: number }[] {
  const start = dayOf(nowSec() - (days - 1) * 86400);
  const rows = stmt(
    db(),
    `SELECT day, SUM(kills) kills FROM weapon_daily WHERE cause = ? AND day >= ? GROUP BY day`,
  ).all(cause, start) as { day: string; kills: number }[];
  const byDay = new Map(rows.map((r) => [r.day, r.kills]));
  return Array.from({ length: days }, (_, i) => {
    const day = dayOf(nowSec() - (days - 1 - i) * 86400);
    return { day, kills: byDay.get(day) ?? 0 };
  });
}

/** How often each of two players killed the other. */
export function headToHead(a: string, b: string): { aKills: number; bKills: number } {
  const count = stmt(
    db(),
    `SELECT COUNT(*) n FROM kills WHERE killer_steam_id = ? AND victim_steam_id = ? AND suicide = 0`,
  );
  return { aKills: (count.get(a, b) as { n: number }).n, bKills: (count.get(b, a) as { n: number }).n };
}
