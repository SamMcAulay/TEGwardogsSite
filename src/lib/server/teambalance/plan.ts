// The team balancer's decisions (staff /admin/teambalance): which players to move so each side's
// chance of winning, by skill rating, is as even as it can be. Pure; run.ts feeds it the live
// player list and sends the moves.
import type { Skill } from '@/lib/rating';
import { chancesOf } from '../history/ratings';

/** The most the sides' player counts may differ by after a move (Warcon's Team balance default). */
export const GAP = 3;
/** A move must cut the gap between the likeliest and least likely side's win chance by this much. */
export const MIN_GAIN = 0.02;
/** Clan mates this many or more on one side count as stronger than their ratings: they play together. */
export const STACK = 4;
export const STACK_BONUS = 1.15;

export interface LivePlayer {
  steamId: string;
  name: string;
  faction: string | null;
}

export interface Move {
  steamId: string;
  name: string;
  from: string;
  to: string;
  /** the win-chance spread before and after this move, 0-1 */
  before: number;
  after: number;
}

type Sides = Map<string, string[]>;

const countSpread = (sides: Sides) => {
  const n = [...sides.values()].map((s) => s.length);
  return Math.max(...n) - Math.min(...n);
};

/** Each side's chance of winning, with big clan stacks counted stronger. */
export function chances(sides: Sides, skillOf: (id: string) => Skill, clanOf: (id: string) => string | null, stretch?: number): Map<string, number> {
  const teams = [...sides.values()].map((ids) => {
    const clans = new Map<string, number>();
    for (const id of ids) {
      const c = clanOf(id);
      if (c) clans.set(c, (clans.get(c) ?? 0) + 1);
    }
    let mu = 0;
    let sigmaSq = 0;
    for (const id of ids) {
      const k = skillOf(id);
      const c = clanOf(id);
      mu += k.mu * (c && clans.get(c)! >= STACK ? STACK_BONUS : 1);
      sigmaSq += k.sigma ** 2;
    }
    return { mu, sigmaSq };
  });
  const odds = chancesOf(teams, stretch);
  return new Map([...sides.keys()].map((f, i) => [f, odds[i]]));
}

const spreadOf = (c: Map<string, number>) => Math.max(...c.values()) - Math.min(...c.values());

/**
 * The moves that even the sides most, best first, at most `max`. Only `candidates` may be moved,
 * each once; a move never pushes the player counts further apart than GAP (or than they already
 * are). Players not yet on one of `factions` are left alone.
 */
export function planMoves(o: {
  players: LivePlayer[];
  factions: string[];
  candidates: Set<string>;
  skillOf: (id: string) => Skill;
  clanOf: (id: string) => string | null;
  max: number;
}): Move[] {
  if (o.factions.length < 2) return [];
  const sides: Sides = new Map(o.factions.map((f) => [f, []]));
  const byId = new Map<string, LivePlayer>();
  for (const p of o.players) {
    if (!p.faction || !sides.has(p.faction)) continue;
    sides.get(p.faction)!.push(p.steamId);
    byId.set(p.steamId, p);
  }
  const sideOf = new Map([...byId.values()].map((p) => [p.steamId, p.faction!]));
  const moves: Move[] = [];
  const done = new Set<string>();
  while (moves.length < o.max) {
    // Decided on the smooth odds; the move records the stretched ones staff see.
    const now = spreadOf(chances(sides, o.skillOf, o.clanOf, 1));
    const allowed = Math.max(GAP, countSpread(sides));
    let best: { id: string; to: string; after: number } | null = null;
    for (const id of o.candidates) {
      const from = sideOf.get(id);
      if (!from || done.has(id)) continue;
      for (const to of o.factions) {
        if (to === from) continue;
        const trial: Sides = new Map([...sides].map(([f, ids]) => [f, f === from ? ids.filter((x) => x !== id) : f === to ? [...ids, id] : ids]));
        if (countSpread(trial) > allowed) continue;
        const after = spreadOf(chances(trial, o.skillOf, o.clanOf, 1));
        if (!best || after < best.after) best = { id, to, after };
      }
    }
    if (!best || now - best.after < MIN_GAIN) break;
    const from = sideOf.get(best.id)!;
    const shown = spreadOf(chances(sides, o.skillOf, o.clanOf));
    sides.set(from, sides.get(from)!.filter((x) => x !== best.id));
    sides.get(best.to)!.push(best.id);
    sideOf.set(best.id, best.to);
    done.add(best.id);
    moves.push({ steamId: best.id, name: byId.get(best.id)!.name, from, to: best.to, before: shown, after: spreadOf(chances(sides, o.skillOf, o.clanOf)) });
  }
  return moves;
}

/** Every ordering of `items` (sides are 2 or 3, so at most 6). */
const orderings = <T>(items: T[]): T[][] =>
  items.length <= 1 ? [items] : items.flatMap((x, i) => orderings([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]));

/** Random deals tried; the evenest is kept. */
const DEALS = 60;

/**
 * The match-start shuffle: everyone on a side dealt out afresh. Players are ranked by skill and
 * taken a block of one-per-side at a time; each block goes to the sides in a random order, so
 * every side gets one of each skill level but who plays with whom is down to chance (groups and
 * stacks break up). Of DEALS such deals, the one with the closest skill totals. Of the ways to
 * name the dealt sides, the one that leaves most players where they are: with two sides about half
 * the server moves, the most that means anything (moving more is the same teams with names swapped).
 */
export function redeal(o: { players: LivePlayer[]; factions: string[]; skillOf: (id: string) => Skill; clanOf: (id: string) => string | null; random?: () => number }): Move[] {
  const k = o.factions.length;
  if (k < 2) return [];
  const rand = o.random ?? Math.random;
  const on = o.players.filter((p) => p.faction && o.factions.includes(p.faction));
  const mu = (p: LivePlayer) => o.skillOf(p.steamId).mu;
  const sorted = [...on].sort((a, b) => mu(b) - mu(a) || a.steamId.localeCompare(b.steamId));
  const spread = (d: LivePlayer[][]) => {
    const t = d.map((side) => side.reduce((a, p) => a + mu(p), 0));
    return Math.max(...t) - Math.min(...t);
  };
  let dealt: LivePlayer[][] = [];
  for (let n = 0; n < DEALS; n++) {
    const d: LivePlayer[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < sorted.length; i += k) {
      // the last, short block goes to the sides with fewest so counts stay within one
      const order = d.map((_, s) => s).sort((a, b) => d[a].length - d[b].length || rand() - 0.5);
      sorted.slice(i, i + k).forEach((p, j) => d[order[j]].push(p));
    }
    if (!dealt.length || spread(d) < spread(dealt)) dealt = d;
  }
  const stays = (names: string[]) => dealt.reduce((a, side, i) => a + side.filter((p) => p.faction === names[i]).length, 0);
  const names = orderings(o.factions).reduce((best, n) => (stays(n) > stays(best) ? n : best));

  const sidesOf = (place: (p: LivePlayer) => string): Sides => new Map(o.factions.map((f) => [f, on.filter((p) => place(p) === f).map((p) => p.steamId)]));
  const target = new Map(dealt.flatMap((side, i) => side.map((p) => [p.steamId, names[i]] as const)));
  const before = spreadOf(chances(sidesOf((p) => p.faction!), o.skillOf, o.clanOf));
  const after = spreadOf(chances(sidesOf((p) => target.get(p.steamId)!), o.skillOf, o.clanOf));
  return on
    .filter((p) => target.get(p.steamId) !== p.faction)
    .map((p) => ({ steamId: p.steamId, name: p.name, from: p.faction!, to: target.get(p.steamId)!, before, after }));
}
