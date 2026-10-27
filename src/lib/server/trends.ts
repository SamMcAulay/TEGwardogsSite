// What pages read from history.db (lib/server/history): skill ratings and their board, a player's
// trends, rank movement on the all-time board, network activity and live team strength.
// Everything here degrades to "nothing yet" when history.db is unavailable or still filling.
import { orgBannedIds } from './bans';
import { presenceHidden, standing } from './accounts';
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

/** Who's looking: for whether they may see a hidden player's recent play. */
export type Viewer = { discordId: string; steamId: string | null } | null;

/** A rating as one viewer may see it. */
interface Seen {
  p: PlayerRating;
  rating: number;
  rounds: number;
  /** null: hidden from this viewer, and they've played in the last RECENT_S */
  lastPlayed: number | null;
}

/**
 * A rating as seen by someone who may (masked false) or may not see the player's recent play: for
 * the latter, as it stood RECENT_S ago, so it can't show they've just played. Null when they had no
 * rated round before then.
 */
export function seenRating(p: PlayerRating, masked: boolean, now = nowSec()): Seen | null {
  if (!masked || now - p.lastPlayed > RECENT_S) return { p, rating: p.rating, rounds: p.rounds, lastPlayed: p.lastPlayed };
  const before = p.steps.filter((s) => now - s.t > RECENT_S);
  const last = before.at(-1);
  return last ? { p, rating: last.rating, rounds: before.length, lastPlayed: null } : null;
}

/** For one viewer: whether a player's recent play is hidden from them (hidden, and not them or a friend). */
function maskerFor(viewer: Viewer): (steamId: string) => boolean {
  const hidden = presenceHidden();
  return (steamId) => hidden.has(steamId) && !standing(steamId, viewer).seesPresence;
}

/** Rated players who qualify for the board as this viewer sees them, best first, banned players left out. */
function ranked(all: Map<string, PlayerRating>, ban: ReadonlySet<string>, viewer: Viewer): Seen[] {
  const masked = maskerFor(viewer);
  const now = nowSec();
  return [...all.values()]
    .filter((p) => !ban.has(p.steamId))
    .map((p) => seenRating(p, masked(p.steamId), now))
    .filter((x): x is Seen => x != null && x.rounds >= RANKED_MIN_ROUNDS)
    .sort((a, b) => b.rating - a.rating || b.rounds - a.rounds);
}

/** Places on `day`, from each player's rating then, among those who qualify now. */
function placesOn(list: Seen[], day: string): Map<string, number> {
  const then = list
    .map((x) => ({ id: x.p.steamId, r: ratingOn(x.p, day) }))
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
  /** null: a hidden player who has played in the last few hours */
  lastPlayed: number | null;
  /** places climbed in the last 7 days (negative: fell); null: not ranked then */
  moved: number | null;
}

export const SKILL_PAGE_SIZE = 50;

/** One page of the skill board. Null when history.db isn't available. */
export async function skillBoard(page = 1, viewer: Viewer = null): Promise<{ rows: SkillRow[]; total: number; rated: number } | null> {
  const all = ratings();
  if (!all) return null;
  const list = ranked(all, await banned(), viewer);
  // A week back is well past RECENT_S, so past places show nothing recent.
  const before = placesOn(list, daysAgo(7));
  const slice = list.slice((page - 1) * SKILL_PAGE_SIZE, page * SKILL_PAGE_SIZE);
  const rows = await Promise.all(
    slice.map(async (x, i) => {
      const rank = (page - 1) * SKILL_PAGE_SIZE + i + 1;
      const was = before.get(x.p.steamId);
      return {
        rank,
        steamId: x.p.steamId,
        name: (await playerName(x.p.steamId)) ?? 'Unknown player',
        avatarUrl: null,
        rating: x.rating,
        rounds: x.rounds,
        lastPlayed: x.lastPlayed,
        moved: was != null ? was - rank : null,
      };
    }),
  );
  return { rows: await withAvatars(rows).catch(() => rows), total: list.length, rated: all.size };
}

export interface PlayerSkill {
  rating: number;
  /** place on the skill board; null until they have RANKED_MIN_ROUNDS rated rounds */
  rank: number | null;
  of: number;
  rounds: number;
  needed: number;
}

export async function playerSkill(steamId: string, viewer: Viewer = null): Promise<PlayerSkill | null> {
  const all = ratings();
  const p = all?.get(steamId);
  if (!all || !p) return null;
  const seen = seenRating(p, maskerFor(viewer)(steamId));
  if (!seen) return null;
  const list = ranked(all, await banned(), viewer);
  const i = list.findIndex((x) => x.p.steamId === steamId);
  return { rating: seen.rating, rank: i >= 0 ? i + 1 : null, of: list.length, rounds: seen.rounds, needed: RANKED_MIN_ROUNDS };
}

/** A player's end-of-day ratings counting only rounds ended at or before `t`. */
function historyBefore(p: PlayerRating, t: number): PlayerRating['history'] {
  const out: PlayerRating['history'] = [];
  for (const s of p.steps) {
    if (s.t > t) break;
    const day = dayOf(s.t);
    if (out.at(-1)?.day === day) out[out.length - 1].rating = s.rating;
    else out.push({ day, rating: s.rating });
  }
  return out;
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
  // Masked: only rounds that ended over RECENT_S ago, as with the days above.
  const rated = !p ? [] : masked ? historyBefore(p, now - RECENT_S) : p.history;
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
    // Masked: a snapshot under RECENT_S old could hold a round they just played.
    for (const { day, takenAt } of h.snapshotTimes()) {
      if (masked && now - takenAt <= RECENT_S) continue;
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
  // Hidden members count as unrated newcomers: their skill would hint at who's on which side.
  const hidden = presenceHidden();
  const known = new Map([...all].filter(([id]) => !hidden.has(id)));
  const sides = factions.map((faction) => ({ faction, steamIds: s.players.filter((p) => p.faction === faction).map((p) => p.steamId) }));
  return sideStrength(sides, known).map((t) => {
    const rated = sides.find((x) => x.faction === t.faction)!.steamIds.map((id) => known.get(id)?.rating).filter((r): r is number => r != null);
    // Too few rated players and the average is one player's rating: it could point out a hidden one.
    return { faction: t.faction, players: t.players, chance: t.chance, avg: rated.length >= 3 ? Math.round(rated.reduce((a, r) => a + r, 0) / rated.length) : null };
  });
}
