import { describe, expect, it } from 'vitest';
import { ingestRounds, snapshotToday, type RoundSource } from './ingest';
import { openHistory } from './store';

/** A server whose rounds are ids 1..n, newest first, `per` to a page; round i started at i*1000. */
function source(n: number, per = 3, live: number[] = []) {
  const fetched: number[] = [];
  const all = Array.from({ length: n }, (_, i) => n - i).map((id) => ({ id, startedAt: id * 1000, endedAt: live.includes(id) ? null : id * 1000 + 500 }));
  const src: RoundSource = {
    async page(_s, page) {
      return { rounds: all.slice((page - 1) * per, page * per), pages: Math.ceil(n / per) };
    },
    async round(serverId, id) {
      fetched.push(id);
      return {
        round: { serverId, matchId: id, startedAt: id * 1000, endedAt: id * 1000 + 500, map: null, lighting: null, winner: 'Valkyra', peak: 10, scores: [] },
        lines: [],
      };
    },
  };
  return { src, fetched };
}

describe('ingestRounds', () => {
  it('fills the backlog back to the season start over several passes, then only reads what is new', async () => {
    const h = openHistory(':memory:');
    const { src, fetched } = source(10);
    // rounds 3..10 are this season (started at 3000 or later)
    expect((await ingestRounds(h, src, ['s'], 3000, 5)).added).toBe(5);
    expect(h.meta('backfilled:s')).toBeNull();
    expect((await ingestRounds(h, src, ['s'], 3000, 5)).added).toBe(3);
    expect(h.meta('backfilled:s')).toBe('1');
    expect(fetched.sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await ingestRounds(h, src, ['s'], 3000, 5)).added).toBe(0);
  });

  it('skips a round still being played and picks it up once it ends', async () => {
    const h = openHistory(':memory:');
    const live = source(4, 3, [4]);
    await ingestRounds(h, live.src, ['s'], 0);
    expect(h.hasRound('s', 4)).toBe(false);
    expect(h.roundCount()).toBe(3);
    await ingestRounds(h, source(4).src, ['s'], 0);
    expect(h.hasRound('s', 4)).toBe(true);
  });

  it('reports a failing server and carries on with the rest', async () => {
    const h = openHistory(':memory:');
    const { src } = source(2);
    const broken: RoundSource = { ...src, page: async (s, p) => (s === 'bad' ? Promise.reject(new Error('down')) : src.page(s, p)) };
    const r = await ingestRounds(h, broken, ['bad', 'good'], 0);
    expect(r.added).toBe(2);
    expect(r.errors).toEqual(['bad: down']);
  });
});

describe('snapshotToday', () => {
  const board = async () => [{ steamId: '76561198000000001', totals: { kills: 1, deaths: 1, minutes: 1, matches: 1, wins: 1, losses: 0, draws: 0, headshots: 0, cash: 0 } }];
  it('takes one snapshot a UTC day', async () => {
    const h = openHistory(':memory:');
    const t = Date.UTC(2026, 9, 27, 3) / 1000;
    expect(await snapshotToday(h, board, t)).toBe(1);
    expect(await snapshotToday(h, board, t + 3600)).toBeNull();
    expect(h.snapshotDays()).toEqual(['2026-10-27']);
  });
  it('refuses an empty board', async () => {
    await expect(snapshotToday(openHistory(':memory:'), async () => [])).rejects.toThrow('empty');
  });
});
