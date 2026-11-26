import { describe, expect, it } from 'vitest';
import { nearestMilestone, nextBusiest, pickLongest, roundClock, sameRound, scored, turnsOf } from './feed';
import type { RecordShot, ServerRow } from './views';

const shot = (distance: number, ts: number): RecordShot => ({ steamId: 's', name: 'n', victim: 'v', cause: 'Id.Item.SVDM', distance, ts, serverId: 'x', serverName: 'EU' });
const totals = { kills: 4986, headshots: 10, playtime: 3600, longest: 0, wins: 0, matches: 0, vehicleKills: 0, killStreak: 0, classKills: {} as never };

describe('pickLongest', () => {
  const now = 1_000_000;
  it("takes today's longest over a longer one from before", () => {
    expect(pickLongest([shot(900, now - 200_000), shot(600, now - 60)], now)).toEqual({ shot: shot(600, now - 60), today: true });
  });
  it('falls back to the record when nothing landed today', () => {
    expect(pickLongest([shot(700, 1), shot(900, 2)], now)).toEqual({ shot: shot(900, 2), today: false });
  });
  it('is null with no shots', () => {
    expect(pickLongest([], now)).toBeNull();
  });
});

describe('nearestMilestone', () => {
  it('picks the career track closest to its next badge', () => {
    expect(nearestMilestone(totals)).toMatchObject({ label: 'Kills', value: 4986, next: 5000 });
  });
});

describe('turnsOf', () => {
  it('names each change of lead by faction', () => {
    const tl = [[60, 1, 0], [120, 1, 3], [300, 5, 3]];
    expect(turnsOf(tl, ['Valkyra', 'Lonestar'])).toEqual([
      { t: 60, faction: 'Valkyra', kind: 'lead' },
      { t: 120, faction: 'Lonestar', kind: 'lead' },
      { t: 300, faction: 'Valkyra', kind: 'retake' },
    ]);
  });
});

describe('roundClock', () => {
  const server = (players: number, scores: number[]) =>
    ({ playerCount: players, status: { factionScores: scores.map((score, i) => ({ name: `f${i}`, score })), rotation: { now: null, next: null } } }) as unknown as ServerRow;
  const open = { endedAt: null, startedAt: 1000 } as never;
  it('counts from the open match start', () => {
    expect(roundClock(server(10, [3, 4]), [open], 1600)).toBe(600);
  });
  it('has no clock on an empty, scoreless server', () => {
    expect(roundClock(server(0, [0, 0]), [open], 1600)).toBeNull();
  });
});

describe('scored', () => {
  it('drops rounds nobody scored in', () => {
    expect(scored([{ score: 0 }, { score: 0 }, { score: 0 }])).toBe(false);
    expect(scored([{ score: 0 }, { score: 3 }])).toBe(true);
  });
});

describe('sameRound', () => {
  const server = (matchSeconds: number | null) => ({ status: { matchSeconds } }) as unknown as ServerRow;
  const match = { startedAt: 1000 } as never;
  it("trusts the cached open match when the server's clock agrees or is unknown", () => {
    expect(sameRound(server(600), match, 1630)).toBe(true);
    expect(sameRound(server(null), match, 9999)).toBe(true);
  });
  it('drops it when the server says the round began much later', () => {
    expect(sameRound(server(30), match, 4000)).toBe(false);
  });
});

describe('nextBusiest', () => {
  const day = 86_400;
  // Two days of 2 h buckets: 20:00 UTC is the busy one.
  const points = [0, 1].flatMap((d) => Array.from({ length: 12 }, (_, h) => ({ ts: d * day + h * 7200, players: h === 10 ? 40 : 3 })));
  it("gives today's busy time when it is still to come", () => {
    expect(nextBusiest(points, 5 * day + 3600)).toBe(5 * day + 20 * 3600);
  });
  it("gives tomorrow's once today's has passed", () => {
    expect(nextBusiest(points, 5 * day + 21 * 3600)).toBe(6 * day + 20 * 3600);
  });
  it('is null with no history', () => {
    expect(nextBusiest([], 0)).toBeNull();
  });
});
