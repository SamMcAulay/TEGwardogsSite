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
export function chances(sides: Sides, skillOf: (id: string) => Skill, clanOf: (id: string) => string | null): Map<string, number> {
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
  const odds = chancesOf(teams);
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
    const now = spreadOf(chances(sides, o.skillOf, o.clanOf));
    const allowed = Math.max(GAP, countSpread(sides));
    let best: { id: string; to: string; after: number } | null = null;
    for (const id of o.candidates) {
      const from = sideOf.get(id);
      if (!from || done.has(id)) continue;
      for (const to of o.factions) {
        if (to === from) continue;
        const trial: Sides = new Map([...sides].map(([f, ids]) => [f, f === from ? ids.filter((x) => x !== id) : f === to ? [...ids, id] : ids]));
        if (countSpread(trial) > allowed) continue;
        const after = spreadOf(chances(trial, o.skillOf, o.clanOf));
        if (!best || after < best.after) best = { id, to, after };
      }
    }
    if (!best || now - best.after < MIN_GAIN) break;
    const from = sideOf.get(best.id)!;
    sides.set(from, sides.get(from)!.filter((x) => x !== best.id));
    sides.get(best.to)!.push(best.id);
    sideOf.set(best.id, best.to);
    done.add(best.id);
    moves.push({ steamId: best.id, name: byId.get(best.id)!.name, from, to: best.to, before: now, after: best.after });
  }
  return moves;
}
