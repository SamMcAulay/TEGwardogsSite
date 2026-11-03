import { describe, expect, it } from 'vitest';
import { analyse, bandOf, calibration, clanSides, closeness, loyalty, refrags, sideTotals, splitBy } from './balance';

const kill = (t: number, killer: [string, string] | null, victim: [string, string], own = false) => ({
  eventTime: t,
  killer: killer && { steamId: killer[0], faction: killer[1] },
  victim: { steamId: victim[0], faction: victim[1] },
  teamKill: own,
  suicide: false,
});

describe('closeness', () => {
  it('scores the ideal and the worst rounds', () => {
    expect(closeness([100, 99, 99])).toBe(99);
    expect(closeness([99, 100, 99])).toBe(99);
    expect(closeness([0, 100, 0])).toBe(0);
    expect(closeness([100, 50, 50])).toBe(50);
    expect(closeness([0, 0, 0])).toBeNull();
    expect(closeness([100])).toBeNull();
    expect([99, 70, 40, 5].map(bandOf)).toEqual(['close', 'fair', 'one-sided', 'landslide']);
  });
});

describe('refrags', () => {
  it('counts every death traded when a teammate kills the killer within the window', () => {
    const r = refrags([
      // newest first, as Warcon sends them
      kill(30, ['b1', 'B'], ['a3', 'A']), // a3 dies; never avenged
      kill(12, ['a2', 'A'], ['b1', 'B']), // a2 avenges a1 and a4 together: two deaths traded
      kill(8, ['b1', 'B'], ['a4', 'A']),
      kill(5, ['b1', 'B'], ['a1', 'A']),
      kill(4, ['a1', 'A'], ['a5', 'A'], true), // team kill: ignored
      kill(51, ['a2', 'A'], ['b1', 'B']), // 21s after a3: too late
    ]);
    expect(r.A).toEqual({ deaths: 3, traded: 2 });
    expect(r.B).toEqual({ deaths: 2, traded: 0 });
  });

  it('does not count killing someone other than the killer', () => {
    const r = refrags([kill(1, ['b1', 'B'], ['a1', 'A']), kill(2, ['a2', 'A'], ['b2', 'B'])]);
    expect(r.A.traded).toBe(0);
  });
});

describe('analyse', () => {
  const line = (faction: string, kills: number, deaths: number, seconds = 1800) => ({ faction, seconds, kills, deaths, headshots: 0 });
  const round = (lines: ReturnType<typeof line>[], scores = [100, 20, 15]) => ({
    startedAt: 0,
    endedAt: 1800,
    winner: 'Manticore',
    scores: [
      { name: 'Manticore', score: scores[0] },
      { name: 'Valkyra', score: scores[1] },
      { name: 'Lonestar', score: scores[2] },
    ],
    lines,
  });

  it('puts a landslide with even stats down to communication', () => {
    const lines = ['Manticore', 'Valkyra', 'Lonestar'].flatMap((f) => [line(f, 10, 10), line(f, 10, 10)]);
    const a = analyse(round(lines))!;
    expect(a.band).toBe('landslide');
    expect(a.reasons.map((r) => r.kind)).toEqual(['even']);
    expect(a.reasons[0].text).toMatch(/communication/);
  });

  it('names more players, stacked skill and better gunfights when they happened', () => {
    const lines = [line('Manticore', 30, 10), line('Manticore', 30, 10), line('Manticore', 30, 10), line('Valkyra', 10, 20), line('Lonestar', 10, 20)];
    const pre = [
      { faction: 'Manticore', rating: 30, chance: 0.6 },
      { faction: 'Valkyra', rating: 20, chance: 0.2 },
      { faction: 'Lonestar', rating: 20, chance: 0.2 },
    ];
    const a = analyse(round(lines), pre)!;
    expect(a.reasons.map((r) => r.kind)).toEqual(['numbers', 'skill', 'gunfights']);
    expect(a.sides[0].avgOn).toBe(3);
  });
});

describe('sideTotals', () => {
  it('adds up wins, big wins and their reasons per faction', () => {
    const line = (faction: string) => ({ faction, seconds: 1800, kills: 10, deaths: 10, headshots: 2 });
    const r = (winner: string, top: number) => ({
      startedAt: 0, endedAt: 1800, winner,
      scores: [{ name: winner, score: 100 }, { name: winner === 'A' ? 'B' : 'A', score: top }],
      lines: [line('A'), line('B')],
      teamplay: { A: { deaths: 10, traded: 2 }, B: { deaths: 10, traded: 1 } },
    });
    const t = sideTotals([analyse(r('A', 10))!, analyse(r('A', 95))!, analyse(r('B', 90))!]);
    expect(t.map((x) => [x.faction, x.rounds, x.wins, x.bigWins])).toEqual([['A', 3, 2, 1], ['B', 3, 1, 0]]);
    expect(t[0].why).toEqual({ teamwork: 1 });
    expect(t[0].teamplay).toEqual({ deaths: 30, traded: 6 });
  });
});

describe('splits, carry and loyalty', () => {
  const line = (steamId: string, faction: string, kills: number) => ({ steamId, faction, seconds: 1800, kills, deaths: 5, headshots: 0 });
  const r = (winner: string, loser: string, top: number, lines: ReturnType<typeof line>[]) => ({
    startedAt: 0, endedAt: 1800, winner, lines,
    scores: [{ name: winner, score: 100 }, { name: loser, score: top }],
  });

  it('works out how much of a side the top three carried', () => {
    const a = analyse(r('A', 'B', 50, [line('1', 'A', 30), line('2', 'A', 20), line('3', 'A', 10), line('4', 'A', 0), line('5', 'A', 40), line('6', 'B', 5)]))!;
    expect(a.sides[0].top3).toBe(0.9);
    expect(sideTotals([a]).find((t) => t.faction === 'A')!.carryWon).toBe(0.9);
    expect(sideTotals([a]).find((t) => t.faction === 'A')!.carryLost).toBeNull();
  });

  it('groups rounds by a key', () => {
    const a = analyse(r('A', 'B', 10, [line('1', 'A', 1), line('2', 'B', 1)]))!;
    const b = analyse(r('B', 'A', 95, [line('1', 'A', 1), line('2', 'B', 1)]))!;
    expect(splitBy([{ key: 'Map1', a }, { key: 'Map1', a: b }, { key: 'Map2', a }])).toEqual([
      { key: 'Map1', rounds: 2, wins: { A: 1, B: 1 }, big: 1, closeness: 52.5 },
      { key: 'Map2', rounds: 1, wins: { A: 1 }, big: 1, closeness: 10 },
    ]);
  });

  it('finds players and clans who keep to one side', () => {
    const rounds = [
      { lines: [line('1', 'A', 1), line('2', 'A', 1), line('3', 'B', 1)] },
      { lines: [line('1', 'A', 1), line('2', 'B', 1), { ...line('3', 'A', 1), seconds: 60 }] },
    ];
    const l = loyalty(rounds);
    expect(l.find((p) => p.steamId === '1')).toEqual({ steamId: '1', rounds: 2, sides: { A: 2 }, faction: 'A', share: 1 });
    expect(l.find((p) => p.steamId === '3')!.rounds).toBe(1);
    expect(clanSides(l, (id) => (id === '3' ? null : 'TEG'), 2)).toEqual([{ tag: 'TEG', members: 2, rounds: 4, sides: { A: 3, B: 1 } }]);
  });
});

describe('teamplay and calibration', () => {
  it('does not call an upset even', () => {
    const a = analyse(r('B', null), pre(0.9))!;
    expect(a.reasons.map((x) => x.kind)).toEqual(['upset']);
  });

  const line = (faction: string) => ({ faction, seconds: 1800, kills: 10, deaths: 10, headshots: 0 });
  const r = (winner: string, teamplay: Record<string, { deaths: number; traded: number }> | null) => ({
    startedAt: 0, endedAt: 1800, winner, teamplay,
    scores: [{ name: 'A', score: 100 }, { name: 'B', score: 50 }],
    lines: [line('A'), line('B')],
  });
  const pre = (a: number) => [{ faction: 'A', rating: 20, chance: a }, { faction: 'B', rating: 20, chance: 1 - a }];

  it('treats an empty kill feed as not measured, not as zero', () => {
    expect(analyse(r('A', {}))!.sides.map((s) => s.teamplay)).toEqual([null, null]);
    expect(sideTotals([analyse(r('A', {}))!])[0].teamplay).toBeNull();
  });

  it('groups rounds by the favourite and checks how often it won', () => {
    const rounds = [analyse(r('A', null), pre(0.65))!, analyse(r('B', null), pre(0.62))!, analyse(r('A', null), pre(0.45))!, analyse(r('A', null))!];
    const c = calibration(rounds);
    expect(c.map((g) => [g.from, g.rounds, g.won])).toEqual([[0.5, 1, 0], [0.6, 2, 0.5]]);
    expect(c[1].predicted).toBeCloseTo(0.635);
  });
});
