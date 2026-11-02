import { describe, expect, it } from 'vitest';
import { fresh, type Skill } from '@/lib/rating';
import { chances, planMoves, type LivePlayer } from './plan';

const F = ['Manticore', 'Valkyra', 'Lonestar'];
const skills: Record<string, Skill> = {};
const p = (steamId: string, faction: string | null, mu = 25): LivePlayer => {
  skills[steamId] = { mu, sigma: 2 };
  return { steamId, name: `n${steamId}`, faction };
};
const skillOf = (id: string) => skills[id] ?? fresh();
const noClan = () => null;
const all = (ps: LivePlayer[]) => new Set(ps.map((x) => x.steamId));

describe('planMoves', () => {
  it('moves a strong player off the stacked side', () => {
    const ps = [p('a1', 'Manticore', 40), p('a2', 'Manticore', 40), p('a3', 'Manticore', 40), p('b1', 'Valkyra', 15), p('b2', 'Valkyra', 15), p('b3', 'Valkyra', 15), p('c1', 'Lonestar', 15), p('c2', 'Lonestar', 15), p('c3', 'Lonestar', 15)];
    const m = planMoves({ players: ps, factions: F, candidates: all(ps), skillOf, clanOf: noClan, max: 6 });
    expect(m[0].from).toBe('Manticore');
    expect(m[0].after).toBeLessThan(m[0].before);
    expect(new Set(m.map((x) => x.steamId)).size).toBe(m.length);
  });

  it('only moves candidates, and leaves an even game alone', () => {
    const ps = [p('a1', 'Manticore', 40), p('a2', 'Manticore', 40), p('b1', 'Valkyra', 15), p('b2', 'Valkyra', 15), p('j', 'Manticore', 30)];
    const m = planMoves({ players: ps, factions: ['Manticore', 'Valkyra'], candidates: new Set(['j']), skillOf, clanOf: noClan, max: 6 });
    expect(m.map((x) => [x.steamId, x.to])).toEqual([['j', 'Valkyra']]);
    const even = [p('x1', 'Manticore'), p('x2', 'Valkyra'), p('x3', 'Lonestar')];
    expect(planMoves({ players: even, factions: F, candidates: all(even), skillOf, clanOf: noClan, max: 6 })).toEqual([]);
  });

  it('never pushes the player counts more than 3 apart', () => {
    // one great player alone on Valkyra: moving a Manticore newcomer over would help, but 5-1 -> 4-2 is fine and 4-2 -> 3-3 too
    const ps = [p('m1', 'Manticore', 10), p('m2', 'Manticore', 10), p('m3', 'Manticore', 10), p('m4', 'Manticore', 10), p('v1', 'Valkyra', 60)];
    const m = planMoves({ players: ps, factions: ['Manticore', 'Valkyra'], candidates: all(ps), skillOf, clanOf: noClan, max: 6 });
    expect(m.every((x) => x.steamId !== 'v1')).toBe(true);
    const ps2 = [p('a', 'Manticore', 60), p('b', 'Valkyra', 10), p('c', 'Valkyra', 10), p('d', 'Valkyra', 10), p('e', 'Valkyra', 10)];
    // moving 'a' would make it 0-5
    expect(planMoves({ players: ps2, factions: ['Manticore', 'Valkyra'], candidates: new Set(['a']), skillOf, clanOf: noClan, max: 6 })).toEqual([]);
  });

  it('skips players who have not picked a side', () => {
    const ps = [p('a', null, 60), p('b', 'Valkyra', 10)];
    expect(planMoves({ players: ps, factions: ['Manticore', 'Valkyra'], candidates: all(ps), skillOf, clanOf: noClan, max: 6 })).toEqual([]);
  });
});

describe('chances', () => {
  it('counts a clan stack of 4 or more as stronger', () => {
    const sides = new Map([['A', ['1', '2', '3', '4']], ['B', ['5', '6', '7', '8']]]);
    for (const id of ['1', '2', '3', '4', '5', '6', '7', '8']) skills[id] = { mu: 25, sigma: 2 };
    const plain = chances(sides, skillOf, noClan);
    const stacked = chances(sides, skillOf, (id) => (Number(id) <= 4 ? 'TEG' : null));
    expect(plain.get('A')).toBeCloseTo(0.5);
    expect(stacked.get('A')!).toBeGreaterThan(0.55);
  });
});
