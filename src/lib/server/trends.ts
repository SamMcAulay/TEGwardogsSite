// What pages read from history.db (lib/server/history): skill ratings and their board, a player's
// trends, rank movement on the all-time board, network activity and live team strength.
// Everything here degrades to "nothing yet" when history.db is unavailable or still filling.
import { orgBannedIds } from './bans';
import { getServers, metricValue, playerName, withAvatars } from './data';
import { ratings } from './history';
import { RANKED_MIN_ROUNDS, ratingOn, sideStrength, type PlayerRating } from './history/ratings';
import { history, type BoardTotals } from './history/store';
import { RECENT_S } from './presence';
import { SEASON_TWO_START } from './seasons';
import type { Metric } from './views';

const nowSec = () => Math.floor(Date.now() / 1000);
const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const daysAgo = (n: number, now = nowSec()) => dayOf(now - n * 86400);

/** Org-banned players, or none when the list can't be read (ratings are ours, not Warcon's boards). */
async function banned(): Promise<ReadonlySet<string>> {
  try {
    return (await orgBannedIds()).ids;
  } catch {
    return new Set();
  }
}

/** Rated players who qualify for the board, best first, banned players left out. */
function ranked(all: Map<string, PlayerRating>, ban: ReadonlySet<string>): PlayerRating[] {
  return [...all.values()].filter((p) => p.rounds >= RANKED_MIN_ROUNDS && !ban.has(p.steamId)).sort((a, b) => b.rating - a.rating || b.rounds - a.rounds);
}

/** Places on `day`, from each player's rating then, among those who qualify now. */
function placesOn(list: PlayerRating[], day: string): Map<string, number> {
  const then = list
    .map((p) => ({ id: p.steamId, r: ratingOn(p, day) }))
    .filter((x): x is { id: string; r: number } => x.r != null)
    .sort((a, b) => b.r - a.r);
  return new Map(then.map((x, i) => [x.id, i + 1]));
}

export interface SkillRow {
  rank: number;
  steamId: string;
  name: string;
  avatarUrl: string | null;
  rating: number;
  rounds: number;
  lastPlayed: number;
  /** places climbed in the last 7 days (negative: fell); null: not ranked then */
  moved: number | null;
}

export const SKILL_PAGE_SIZE = 50;

/** One page of the skill board. Null when history.db isn't available. */
export async function skillBoard(page = 1): Promise<{ rows: SkillRow[]; total: number; rated: number } | null> {
  const all = ratings();
  if (!all) return null;
  const list = ranked(all, await banned());
  const before = placesOn(list, daysAgo(7));
  const slice = list.slice((page - 1) * SKILL_PAGE_SIZE, page * SKILL_PAGE_SIZE);
  const rows = await Promise.all(
    slice.map(async (p, i) => {
      const rank = (page - 1) * SKILL_PAGE_SIZE + i + 1;
      const was = before.get(p.steamId);
      return {
        rank,
        steamId: p.steamId,
        name: (await playerName(p.steamId)) ?? 'Unknown player',
        avatarUrl: null,
        rating: p.rating,
        rounds: p.rounds,
        lastPlayed: p.lastPlayed,
        moved: was != null ? was - rank : null,
      };
    }),
  );
  return { rows: await withAvatars(rows).catch(() => rows), total: list.length, rated: all.size };
}

/** Where a rating standing is shown to someone not allowed to see a hidden player's recent play. */
function maskedRating(p: PlayerRating, masked: boolean, now: number): { rating: number; history: PlayerRating['history'] } {
  if (!masked || now - p.lastPlayed > RECENT_S) return { rating: p.rating, history: p.history };
  // Drop the day of their latest round: its change would show they've just played.
  const history = p.history.slice(0, -1);
  return { rating: history.at(-1)?.rating ?? p.rating, history };
}

export interface PlayerSkill {
  rating: number;
  /** place on the skill board; null until they have RANKED_MIN_ROUNDS rated rounds */
  rank: number | null;
  of: number;
  rounds: number;
  needed: number;
}

export async function playerSkill(steamId: string, masked = false): Promise<PlayerSkill | null> {
  const all = ratings();
  const p = all?.get(steamId);
  if (!all || !p) return null;
  const list = ranked(all, await banned());
  const { rating } = maskedRating(p, masked, nowSec());
  const i = list.findIndex((x) => x.steamId === steamId);
  return { rating, rank: i >= 0 ? i + 1 : null, of: list.length, rounds: p.rounds, needed: RANKED_MIN_ROUNDS };
}

export interface TrendDay {
  day: string;
  rounds: number;
  kills: number;
  deaths: number;
  seconds: number;
  wins: number;
  /** skill rating at the end of the day; null before their first rated round */
  rating: number | null;
}

export interface PlayerTrends {
  days: TrendDay[];
  /** their all-time kills place on the board snapshot of each day they're in it */
  killsRank: { day: string; rank: number }[];
}

/** Sorted (high to low) all-time kills on each snapshot day, banned players left out. Past days never change. */
const killsByDay = new Map<string, { banned: number; kills: Float64Array }>();

function killsRankOn(day: string, totals: () => Map<string, BoardTotals>, ban: ReadonlySet<string>): Float64Array {
  const hit = killsByDay.get(day);
  if (hit && hit.banned === ban.size) return hit.kills;
  const kills = Float64Array.from([...totals()].filter(([id]) => !ban.has(id)).map(([, t]) => t.kills)).sort().reverse();
  killsByDay.set(day, { banned: ban.size, kills });
  return kills;
}

/** How many values in a high-to-low array are above v. */
function above(sorted: Float64Array, v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] > v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A player's season-two days (from stored rounds) and their all-time kills place over time (from
 * the board snapshots). masked: the viewer may not see this hidden player's recent play, so
 * rounds from the last RECENT_S are left out.
 */
export async function playerTrends(steamId: string, masked = false): Promise<PlayerTrends | null> {
  const h = history();
  if (!h) return null;
  const now = nowSec();
  const rounds = h.playerRounds(steamId, SEASON_TWO_START).filter((r) => !masked || now - r.endedAt > RECENT_S);
  const p = ratings()?.get(steamId);
  const rated = p ? maskedRating(p, masked, now).history : [];
  const byDay = new Map<string, TrendDay>();
  for (const r of rounds) {
    const day = dayOf(r.endedAt);
    const d = byDay.get(day) ?? { day, rounds: 0, kills: 0, deaths: 0, seconds: 0, wins: 0, rating: null };
    d.rounds++;
    d.kills += r.kills;
    d.deaths += r.deaths;
    d.seconds += r.seconds;
    if (r.result === 'win') d.wins++;
    byDay.set(day, d);
  }
  for (const d of byDay.values()) {
    const at = rated.filter((x) => x.day <= d.day).at(-1);
    d.rating = at?.rating ?? null;
  }
  const ban = await banned();
  const mine = h.playerSnapshots(steamId);
  const killsRank: PlayerTrends['killsRank'] = [];
  if (mine.length && !ban.has(steamId)) {
    for (const day of h.snapshotDays()) {
      const own = mine.filter((m) => m.day <= day).at(-1);
      if (!own) continue;
      const sorted = killsRankOn(day, () => h.asOf(day), ban);
      killsRank.push({ day, rank: above(sorted, own.kills) + 1 });
    }
  }
  return { days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)), killsRank };
}

/** All-time board places a week ago (or as far back as snapshots go), per metric. */
const pastPlaces = new Map<string, Map<string, number>>();

/**
 * Places climbed on the all-time, all-servers board since about a week ago, by Steam id, for the
 * given rows. Empty until there's a snapshot at least a day old. minMinutes: the board's floor.
 */
export async function boardMoves(metric: Metric, rows: { steamId: string; rank: number }[], minMinutes = 60): Promise<{ since: string | null; moved: Map<string, number> }> {
  const h = history();
  const days = h?.snapshotDays() ?? [];
  const target = daysAgo(7);
  const day = days.filter((d) => d <= target).at(-1) ?? days.find((d) => d < dayOf(nowSec())) ?? null;
  if (!h || !day) return { since: null, moved: new Map() };
  const ban = await banned();
  const key = `${metric}:${day}:${ban.size}`;
  let places = pastPlaces.get(key);
  if (!places) {
    const then = [...h.asOf(day)]
      .filter(([id, t]) => !ban.has(id) && t.minutes >= minMinutes)
      .map(([id, t]) => ({ id, v: metricValue(metric, t) }))
      .sort((a, b) => b.v - a.v);
    places = new Map(then.map((x, i) => [x.id, i + 1]));
    pastPlaces.clear();
    pastPlaces.set(key, places);
  }
  const moved = new Map<string, number>();
  for (const r of rows) {
    const was = places.get(r.steamId);
    if (was != null) moved.set(r.steamId, was - r.rank);
  }
  return { since: day, moved };
}

/** Rounds, players and kills per UTC day across the network this season. */
export function networkActivity() {
  return history()?.daily(SEASON_TWO_START) ?? null;
}

/**
 * Each side's strength on a server right now from the skill of who's on it. Built from the unmasked
 * scoreboard, but only totals leave here, so nobody hidden is named.
 */
export async function liveStrength(serverId: string): Promise<{ faction: string; players: number; chance: number; avg: number | null }[] | null> {
  const all = ratings();
  if (!all) return null;
  const servers = await getServers({ unmasked: true });
  const s = servers.data.find((x) => x.id === serverId);
  if (!s?.players.length) return null;
  const factions = [...new Set(s.players.map((p) => p.faction).filter((f): f is string => !!f))];
  if (factions.length < 2) return null;
  const sides = factions.map((faction) => ({ faction, steamIds: s.players.filter((p) => p.faction === faction).map((p) => p.steamId) }));
  return sideStrength(sides, all).map((t) => {
    const rated = sides.find((x) => x.faction === t.faction)!.steamIds.map((id) => all.get(id)?.rating).filter((r): r is number => r != null);
    // Too few rated players and the average is one player's rating: it could point out a hidden one.
    return { faction: t.faction, players: t.players, chance: t.chance, avg: rated.length >= 3 ? Math.round(rated.reduce((a, r) => a + r, 0) / rated.length) : null };
  });
}
