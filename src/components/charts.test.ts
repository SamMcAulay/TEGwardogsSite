import { describe, expect, it } from 'vitest';
import { lastDay, weekGrid } from './charts';

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
