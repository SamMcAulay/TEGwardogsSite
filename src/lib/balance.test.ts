import { describe, expect, it } from 'vitest';
import { analyse, bandOf, closeness, refrags, sideTotals } from './balance';

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
  it('counts a teammate killing the killer within the window, once per avenging kill', () => {
    const r = refrags([
      // newest first, as Warcon sends them
      kill(30, ['b1', 'B'], ['a3', 'A']), // a3 dies; never avenged
      kill(12, ['a2', 'A'], ['b1', 'B']), // a2 avenges a1 and a4 together: one refrag
      kill(8, ['b1', 'B'], ['a4', 'A']),
      kill(5, ['b1', 'B'], ['a1', 'A']),
      kill(4, ['a1', 'A'], ['a5', 'A'], true), // team kill: ignored
      kill(50, ['a2', 'A'], ['b1', 'B']), // 20s after a3: too late
    ]);
    expect(r.A).toEqual({ deaths: 3, refrags: 1 });
    expect(r.B).toEqual({ deaths: 2, refrags: 0 });
  });

  it('does not count killing someone other than the killer', () => {
    const r = refrags([kill(1, ['b1', 'B'], ['a1', 'A']), kill(2, ['a2', 'A'], ['b2', 'B'])]);
    expect(r.A.refrags).toBe(0);
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
      teamplay: { A: { deaths: 10, refrags: 2 }, B: { deaths: 10, refrags: 1 } },
    });
    const t = sideTotals([analyse(r('A', 10))!, analyse(r('A', 95))!, analyse(r('B', 90))!]);
    expect(t.map((x) => [x.faction, x.rounds, x.wins, x.bigWins])).toEqual([['A', 3, 2, 1], ['B', 3, 1, 0]]);
    expect(t[0].why).toEqual({ teamwork: 1 });
    expect(t[0].teamplay).toEqual({ deaths: 30, refrags: 6 });
  });
});
