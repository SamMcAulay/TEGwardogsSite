// The shapes pages render, and the period/metric vocabulary. Filled from Warcon by data.ts.

export const PERIODS = ['7d', '30d', '90d', 's2', 'all'] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', s2: 'Season 2', all: 'All time' };
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
  /** points to win the round, when Warcon reports one */
  scoreCap: number | null;
  /** seconds between points for the team holding the hill, when reported */
  scoreTick: number | null;
  factionScores: FactionScore[];
  /** rotation slots (0-based) as the server reports them; null when it doesn't */
  rotation: { now: number | null; next: number | null };
}

/** No ping: the public site never shows one. */
export interface LivePlayer { name: string; steamId: string; faction: string; kills: number; deaths: number; cash: number }

export interface ServerRow {
  id: string;
  /** the page address, from the short name: "eu1", "naeast" (lib/url.ts) */
  slug: string;
  /** Warcon's full name */
  name: string;
  /** the part before the first " - ", e.g. "EU#1" */
  shortName: string;
  /** the letters before "#": EU, NA, OCE */
  region: string;
  /** null: Warcon didn't answer for this server, so its status is unknown (not "offline") */
  online: boolean | null;
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
  /** over the last 24 h, from analytics, summed per server */
  killsToday: number;
  /** sum of each server's unique players: a player on two servers counts twice */
  playersToday: number;
  matchesToday: number;
  /** the highest single-server peak (not a network-wide peak) */
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
export interface Rival { steamId: string; name: string; avatarUrl: string | null; count: number }

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
  totals: {
    kills: number; deaths: number; headshots: number; suicides: number; teamkills: number; playtime: number; longest: number;
    matches: number; wins: number; losses: number; draws: number;
    vehicleKills: number;
    /** most kills in one life, all time */
    killStreak: number;
  };
  /** all-time kills rank without org-banned players; 'unavailable' when it can't be worked out */
  rank: number | null | 'unavailable';
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

/** One record-holding kill: who, whom, with what, how far, when and where. */
export interface RecordShot {
  steamId: string;
  name: string;
  victim: string;
  cause: string;
  distance: number;
  ts: number;
  serverId: string;
  serverName: string;
}

/** A player and their record value. */
export interface RecordRow {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  value: number;
}

export interface Records {
  /** the ten longest rifle and machine-gun kills ever */
  longestShots: RecordShot[];
  /** most kills in one life, all time */
  streaks: RecordRow[];
  vehicleKills: RecordRow[];
  headshots: RecordRow[];
  /** most kills in the last 24 hours, across servers */
  today: RecordRow[];
}

export interface MatchAward { key: string; label: string; steamId: string; name: string; value: string }

/** One friend as /friends shows them: from the live servers and the player list, nothing per-player from Warcon. */
export interface FriendStatus {
  steamId: string;
  /** null: not in the top 10,000 player list and not online */
  name: string | null;
  avatarUrl: string | null;
  online: { serverId: string; serverName: string; serverSlug: string; faction: string; kills: number; deaths: number } | null;
  /** unix seconds; null when unknown */
  lastSeen: number | null;
}
