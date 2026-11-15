import { describe, expect, it } from 'vitest';
import { buildRatings, chancesOf, ODDS_STRETCH, ratingOn, sideStrength, sidesOf } from './ratings';
import type { StoredLine, StoredRound } from './store';

const A = '76561198000000001';
const B = '76561198000000002';
const C = '76561198000000003';
const line = (steamId: string, faction: string, seconds = 3600): StoredLine => ({ steamId, faction, seconds, kills: 1, deaths: 1, headshots: 0, result: null });
const round = (id: number, endedAt: number, winner: string, lines: StoredLine[], extra: Partial<StoredRound> = {}): StoredRound & { lines: StoredLine[] } => ({
  serverId: 's', matchId: id, startedAt: endedAt - 3600, endedAt, map: null, lighting: null, winner, peak: 20,
  scores: [{ name: 'Valkyra', score: winner === 'Valkyra' ? 100 : 50 }, { name: 'Lonestar', score: winner === 'Lonestar' ? 100 : 50 }],
  lines, ...extra,
});
const DAY = Date.UTC(2026, 9, 20) / 1000;

describe('sidesOf', () => {
  it('weights each player by their share of the round and drops short stays', () => {
    const s = sidesOf(round(1, DAY, 'Valkyra', [line(A, 'Valkyra'), line(B, 'Lonestar', 900), line(C, 'Lonestar', 60)]))!;
    expect(s.places).toEqual([1, 2]);
    expect(s.teams[0].seats).toEqual([{ steamId: A, weight: 1 }]);
    expect(s.teams[1].seats).toEqual([{ steamId: B, weight: 0.25 }]);
  });

  it('skips rounds that were near empty, had no winner, or one side', () => {
    expect(sidesOf(round(1, DAY, 'Valkyra', [line(A, 'Valkyra'), line(B, 'Lonestar')], { peak: 4 }))).toBeNull();
    expect(sidesOf(round(1, DAY, '', [line(A, 'Valkyra'), line(B, 'Lonestar')], { winner: null }))).toBeNull();
    expect(sidesOf(round(1, DAY, 'Valkyra', [line(A, 'Valkyra')]))).toBeNull();
  });

  it('puts the named winner first even when the scores disagree', () => {
    const r = round(1, DAY, 'Lonestar', [line(A, 'Valkyra'), line(B, 'Lonestar')], { scores: [{ name: 'Valkyra', score: 100 }, { name: 'Lonestar', score: 100 }] });
    expect(sidesOf(r)!.places).toEqual([2, 1]);
  });
});

describe('buildRatings', () => {
  it('lifts a player who keeps winning and keeps a rating per day', () => {
    const rounds = [
      round(1, DAY + 100, 'Valkyra', [line(A, 'Valkyra'), line(B, 'Lonestar')]),
      round(2, DAY + 200, 'Valkyra', [line(A, 'Valkyra'), line(B, 'Lonestar')]),
      round(3, DAY + 86400, 'Lonestar', [line(A, 'Valkyra'), line(B, 'Lonestar')]),
    ];
    const r = buildRatings(rounds);
    const a = r.get(A)!;
    expect(a.rounds).toBe(3);
    expect(a.skill.mu).toBeGreaterThan(r.get(B)!.skill.mu);
    expect(a.history.map((h) => h.day)).toEqual(['2026-10-20', '2026-10-21']);
    expect(ratingOn(a, '2026-10-20')).toBe(a.history[0].rating);
    expect(ratingOn(a, '2026-10-19')).toBeNull();
    expect(ratingOn(a, '2026-12-01')).toBe(a.rating);
  });

  it('rates in time order whatever order the rounds come in', () => {
    const one = round(1, DAY + 100, 'Valkyra', [line(A, 'Valkyra'), line(B, 'Lonestar')]);
    const two = round(2, DAY + 200, 'Lonestar', [line(A, 'Valkyra'), line(B, 'Lonestar')]);
    expect(buildRatings([two, one]).get(A)).toEqual(buildRatings([one, two]).get(A));
  });
});

describe('sideStrength', () => {
  it('favours the bigger side and splits evenly between equal ones', () => {
    const even = sideStrength([{ faction: 'Valkyra', steamIds: [A] }, { faction: 'Lonestar', steamIds: [B] }], new Map());
    expect(even[0].chance).toBeCloseTo(0.5);
    const uneven = sideStrength([{ faction: 'Valkyra', steamIds: [A, C] }, { faction: 'Lonestar', steamIds: [B] }], new Map());
    expect(uneven[0].chance).toBeGreaterThan(0.6);
    expect(uneven[0].chance + uneven[1].chance).toBeCloseTo(1);
  });

  it('counts each player by their share of the round, so a side that churned through joiners is not the favourite', () => {
    // Valkyra kept its 2 all round; Lonestar's 2 left halfway and 3 joiners played a third each:
    // the same time on the field, so even (counted by heads, Lonestar was a 96% favourite).
    const s = sideStrength(
      [
        { faction: 'Valkyra', steamIds: [A, B], weights: [1, 1] },
        { faction: 'Lonestar', steamIds: [C, 'd', 'e', 'f', 'g'], weights: [0.5, 0.5, 0.34, 0.33, 0.33] },
      ],
      new Map(),
    );
    expect(s[1].chance).toBeCloseTo(0.5, 1);
    expect(s[1].players).toBe(5);
  });
});

describe('chancesOf', () => {
  it('is stretched by ODDS_STRETCH: the same skill gap gives a surer favourite', () => {
    const teams = [{ mu: 130, sigmaSq: 20 }, { mu: 125, sigmaSq: 20 }];
    const c = Math.sqrt(40 + 2 * (25 / 6) ** 2);
    const plain = Math.exp(130 / c) / (Math.exp(130 / c) + Math.exp(125 / c));
    expect(ODDS_STRETCH).toBe(2.5);
    expect(chancesOf(teams)[0]).toBeGreaterThan(plain);
    expect(chancesOf(teams)[0]).toBeCloseTo(1 / (1 + Math.exp((-ODDS_STRETCH * 5) / c)));
    expect(chancesOf(teams, 1)[0]).toBeCloseTo(plain);
  });
});
