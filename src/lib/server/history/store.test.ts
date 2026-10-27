import { describe, expect, it } from 'vitest';
import { openHistory, type BoardTotals } from './store';

const S1 = '76561198000000001';
const S2 = '76561198000000002';
const totals = (kills: number, extra: Partial<BoardTotals> = {}): BoardTotals => ({
  kills, deaths: 1, minutes: 60, matches: 1, wins: 0, losses: 0, draws: 0, headshots: 0, cash: 0, ...extra,
});
const round = (matchId: number, endedAt: number) => ({
  serverId: 'srv', matchId, startedAt: endedAt - 3600, endedAt, map: 'Europe', lighting: 'DayClear', winner: 'Valkyra', peak: 30,
  scores: [{ name: 'Valkyra', score: 100 }, { name: 'Lonestar', score: 60 }],
});
const line = (steamId: string, kills: number, faction = 'Valkyra') => ({ steamId, faction, seconds: 1800, kills, deaths: 2, headshots: 1, result: 'win' });

describe('rounds', () => {
  it('stores a round with its lines and reads them back oldest first', () => {
    const h = openHistory(':memory:');
    h.addRound(round(2, 2000), [line(S1, 5)]);
    h.addRound(round(1, 1000), [line(S1, 3), line(S2, 4, 'Lonestar')]);
    expect(h.hasRound('srv', 1)).toBe(true);
    expect(h.hasRound('srv', 3)).toBe(false);
    const all = h.rounds();
    expect(all.map((r) => r.matchId)).toEqual([1, 2]);
    expect(all[0].lines).toHaveLength(2);
    expect(all[0].scores[0]).toEqual({ name: 'Valkyra', score: 100 });
    expect(h.rounds(1500).map((r) => r.matchId)).toEqual([2]);
    expect(h.playerRounds(S1).map((r) => r.kills)).toEqual([3, 5]);
  });

  it('replaces a round stored twice instead of doubling its lines', () => {
    const h = openHistory(':memory:');
    h.addRound(round(1, 1000), [line(S1, 3), line(S2, 1)]);
    h.addRound(round(1, 1000), [line(S1, 4)]);
    expect(h.roundCount()).toBe(1);
    expect(h.rounds()[0].lines).toEqual([line(S1, 4)]);
  });

  it('sums each UTC day', () => {
    const h = openHistory(':memory:');
    const day = Date.UTC(2026, 9, 20) / 1000;
    h.addRound(round(1, day + 3600), [line(S1, 3), line(S2, 4)]);
    h.addRound(round(2, day + 7200), [line(S1, 5)]);
    h.addRound(round(3, day + 86400 + 60), []);
    expect(h.daily()).toEqual([
      { day: '2026-10-20', rounds: 2, players: 2, kills: 12, seconds: 5400 },
      { day: '2026-10-21', rounds: 1, players: 0, kills: 0, seconds: 0 },
    ]);
  });
});

describe('snapshots', () => {
  it('writes only the players whose totals moved, and reads the board as of any day', () => {
    const h = openHistory(':memory:');
    expect(h.saveSnapshot('2026-10-20', [{ steamId: S1, totals: totals(10) }, { steamId: S2, totals: totals(5) }])).toBe(2);
    expect(h.saveSnapshot('2026-10-21', [{ steamId: S1, totals: totals(10) }, { steamId: S2, totals: totals(9) }])).toBe(1);
    expect(h.hasSnapshot('2026-10-21')).toBe(true);
    // a day already taken is left alone
    expect(h.saveSnapshot('2026-10-21', [{ steamId: S1, totals: totals(99) }])).toBe(0);
    expect(h.snapshotDays()).toEqual(['2026-10-20', '2026-10-21']);
    expect(h.asOf('2026-10-20').get(S2)?.kills).toBe(5);
    expect(h.asOf('2026-10-21').get(S2)?.kills).toBe(9);
    expect(h.asOf('2026-10-21').get(S1)?.kills).toBe(10);
    expect(h.asOf('2026-10-19').size).toBe(0);
    expect(h.playerSnapshots(S2).map((r) => [r.day, r.kills])).toEqual([['2026-10-20', 5], ['2026-10-21', 9]]);
  });
});

describe('meta', () => {
  it('keeps small notes', () => {
    const h = openHistory(':memory:');
    expect(h.meta('x')).toBeNull();
    h.setMeta('x', '1');
    expect(h.meta('x')).toBe('1');
  });
});
