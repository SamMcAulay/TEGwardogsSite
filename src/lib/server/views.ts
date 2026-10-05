// The shapes pages render, and the period/metric vocabulary. Filled from Warcon by data.ts.

export const PERIODS = ['7d', '30d', '90d', 'all'] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' };
export function parsePeriod(v: unknown, fallback: Period = '7d'): Period {
  return PERIODS.includes(v as Period) ? (v as Period) : fallback;
}

export const METRICS = ['kills', 'deaths', 'kd', 'perHour', 'playtime', 'matches', 'wins', 'winRate', 'cash'] as const;
export type Metric = (typeof METRICS)[number];
export const METRIC_LABELS: Record<Metric, string> = {
  kills: 'Kills', deaths: 'Deaths', kd: 'K/D', perHour: 'Kills / hour', playtime: 'Playtime',
  matches: 'Matches', wins: 'Wins', winRate: 'Win rate', cash: 'Cash',
};
export function parseMetric(v: unknown): Metric {
  return METRICS.includes(v as Metric) ? (v as Metric) : 'kills';
}

/** What a data function returns: the data, whether any of it is past freshness, and which
 *  servers failed and were left out. */
export interface Loaded<T> {
  data: T;
  stale: boolean;
  missing: string[];
}

export interface FactionScore { name: string; colorHex: string; score: number }

export interface ServerStatus {
  serverName: string;
  map: string;
  experiences: string[];
  lighting: string | null;
  matchSeconds?: number;
  players: { current: number; max: number };
  factionScores: FactionScore[];
}

/** No ping: the public site never shows one. */
export interface LivePlayer { name: string; steamId: string; faction: string; kills: number; deaths: number; cash: number }

export interface ServerRow {
  id: string;
  /** Warcon's full name */
  name: string;
  /** the part before the first " - ", e.g. "EU#1" */
  shortName: string;
  /** the letters before "#": EU, NA, OCE */
  region: string;
  online: boolean;
  /** unix seconds of Warcon's last look */
  updatedAt: number | null;
  status: ServerStatus | null;
  players: LivePlayer[];
  playerCount: number;
  joinCode: string | null;
  startedAt: number | null;
}

export interface NetworkSummary {
  playersOnline: number;
  capacity: number;
  serversOnline: number;
  serversTotal: number;
  /** over the last 24 h, from analytics */
  killsToday: number;
  playersToday: number;
  matchesToday: number;
  peakToday: number;
}

export interface PopulationPoint { ts: number; players: number; max: number }

export interface LeaderRow {
  rank: number;
  steamId: string;
  name: string;
  avatarUrl: string | null;
  kills: number;
  deaths: number;
  headshots: number;
  playtime: number; // seconds
  matches: number;
  wins: number;
  cash: number;
  /** the sorted metric's value */
  value: number;
  lastSeen: number | null;
}

export interface PlayerSearchRow { steamId: string; name: string; avatarUrl: string | null; lastSeen: number | null; matchedAlias: string | null }

export interface WeaponUse { cause: string; kills: number }
export interface Rival { steamId: string; name: string; count: number }

export interface PlayerMatchRow {
  matchId: number;
  serverId: string;
  serverName: string;
  map: string;
  startedAt: number;
  endedAt: number | null;
  faction: string | null;
  result: 'win' | 'loss' | 'draw' | null;
  kills: number;
  deaths: number;
  timePlayed: number;
}

export interface PlayerProfile {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  aliases: string[];
  totals: { kills: number; deaths: number; headshots: number; suicides: number; teamkills: number; playtime: number; longest: number; matches: number; wins: number; losses: number; draws: number };
  rank: number | null;
  streak: { kind: 'win' | 'loss'; n: number } | null;
  onlineOn: { serverId: string; serverName: string } | null;
  weapons: WeaponUse[];
  victims: Rival[];
  nemeses: Rival[];
  servers: { serverId: string; name: string; playtime: number; kills: number }[];
  matches: PlayerMatchRow[];
  maps: { key: string; matches: number; wins: number; kills: number; deaths: number }[];
  factions: { key: string; matches: number; wins: number; kills: number; deaths: number }[];
  recentKills: KillRow[];
}

export interface KillRow {
  eventId: string;
  serverId: string;
  serverName: string;
  ts: number;
  /** Warcon's cursor for "older": the kill's ISO time and match clock */
  cursor: string;
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
  players: number;
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
  killStreak: number;
}

export interface MatchAward { key: string; label: string; steamId: string; name: string; value: string }
