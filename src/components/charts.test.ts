import { describe, expect, it } from 'vitest';
import { busyLevel, busySeries, lastDay, weekGrid, weekGridFrom } from './charts';

// Monday 2026-10-19 00:00 UTC
const MON = Date.UTC(2026, 9, 19) / 1000;

describe('weekGrid', () => {
  it('averages players per weekday and hour, spreading each bucket over its hours', () => {
    const g = weekGrid(
      [
        { ts: MON + 20 * 3600, players: 80 }, // Mon 20:00-22:00
        { ts: MON + 7 * 86400 + 20 * 3600, players: 40 }, // the next Monday, same time
      ],
      7200,
      0,
    );
    expect(g[0][20]).toBe(60);
    expect(g[0][21]).toBe(60);
    expect(g[0][22]).toBeNull();
    expect(g[1][20]).toBeNull();
  });

  it('shifts into the viewer’s timezone, across midnight', () => {
    // Sun 23:00 UTC is Mon 01:00 at UTC+2
    const g = weekGrid([{ ts: MON - 3600, players: 10 }], 3600, 120);
    expect(g[0][1]).toBe(10);
    expect(g[6][23]).toBeNull();
  });

  it('puts Sunday last', () => {
    const g = weekGrid([{ ts: MON - 86400 + 12 * 3600, players: 5 }], 3600, 0);
    expect(g[6][12]).toBe(5);
  });
});

describe('lastDay', () => {
  const pts = [
    { ts: MON - 7 * 86400 + 20 * 3600, players: 5 }, // the Monday before
    { ts: MON + 20 * 3600, players: 80 }, // Mon 20:00
    { ts: MON + 20 * 3600 + 1800, players: 90 }, // Mon 20:30
    { ts: MON + 86400 + 3600, players: 30 }, // Tue 01:00
  ];

  it('takes the latest day on that weekday, as minutes past midnight', () => {
    expect(lastDay(pts, 0, 0)).toEqual({ date: '2026-10-19', points: [{ m: 1200, v: 80 }, { m: 1230, v: 90 }] });
  });

  it('reads days in the viewer’s time', () => {
    // Tue 01:00 UTC is still Monday 21:00 at UTC-4
    expect(lastDay(pts, -240, 0)?.points.at(-1)).toEqual({ m: 21 * 60, v: 30 });
  });

  it('is null with no such day', () => {
    expect(lastDay(pts, 0, 4)).toBeNull();
  });
});

describe('weekGridFrom', () => {
  it('weights short buckets by the share of the hour they cover', () => {
    // two 30-minute buckets in Mon 20:00 and one hour-long bucket the next Monday
    const g = weekGridFrom(
      [
        { bucketSeconds: 1800, points: [{ ts: MON + 20 * 3600, players: 10 }, { ts: MON + 20 * 3600 + 1800, players: 30 }] },
        { bucketSeconds: 3600, points: [{ ts: MON + 7 * 86400 + 20 * 3600, players: 60 }] },
      ],
      0,
    );
    // (10*.5 + 30*.5 + 60*1) / 2
    expect(g[0][20]).toBe(40);
  });

  it('splits a bucket that straddles the hour', () => {
    const g = weekGridFrom([{ bucketSeconds: 3600, points: [{ ts: MON + 20 * 3600 + 1800, players: 8 }] }], 0);
    expect(g[0][20]).toBe(8);
    expect(g[0][21]).toBe(8);
  });

  it('reads half-hour offsets', () => {
    // Mon 00:00 UTC is Mon 05:30 at UTC+5:30
    const g = weekGridFrom([{ bucketSeconds: 3600, points: [{ ts: MON, players: 4 }] }], 330);
    expect(g[0][5]).toBe(4);
    expect(g[0][6]).toBe(4);
  });
});

describe('busySeries', () => {
  const month = { bucketSeconds: 21600, points: [{ ts: MON, players: 1 }, { ts: MON + 21600, players: 2 }] };
  it('swaps the month for the finer week where they overlap', () => {
    const week = { bucketSeconds: 600, points: [{ ts: MON + 21600, players: 3 }] };
    expect(busySeries(month, week)).toEqual([{ bucketSeconds: 21600, points: [{ ts: MON, players: 1 }] }, week]);
  });
  it('keeps the month alone when the week is no finer or empty', () => {
    expect(busySeries(month, { bucketSeconds: 21600, points: [{ ts: MON, players: 1 }] })).toEqual([month]);
    expect(busySeries(month, { bucketSeconds: 600, points: [] })).toEqual([month]);
  });
});

describe('busyLevel', () => {
  it('steps from 0 to 5', () => {
    expect(busyLevel(0, 50)).toBe(0);
    expect(busyLevel(1, 50)).toBe(1);
    expect(busyLevel(25, 50)).toBe(3);
    expect(busyLevel(50, 50)).toBe(5);
  });
  it('steps up from the quietest hour', () => {
    expect(busyLevel(20, 24, 20)).toBe(1);
    expect(busyLevel(22, 24, 20)).toBe(3);
    expect(busyLevel(24, 24, 20)).toBe(5);
    expect(busyLevel(5, 5, 5)).toBe(5);
  });
});
