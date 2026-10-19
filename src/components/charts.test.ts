import { describe, expect, it } from 'vitest';
import { weekGrid } from './charts';

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
