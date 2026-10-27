import { describe, expect, it } from 'vitest';
import { mainFaction, mapArt, mapWins, ROTATION, roundEta, rotationStarts, rotationView, typicalRound } from './game';

describe('mainFaction', () => {
  it('picks a faction holding at least 65% of rounds', () => {
    expect(mainFaction([{ key: 'Valkyra', matches: 72 }, { key: 'Lonestar', matches: 28 }])).toBe('Valkyra');
    expect(mainFaction([{ key: 'Manticore', matches: 65 }, { key: 'Lonestar', matches: 35 }])).toBe('Manticore');
  });

  it('returns null below the threshold, with no rounds, or for unknown factions', () => {
    expect(mainFaction([{ key: 'Valkyra', matches: 50 }, { key: 'Lonestar', matches: 50 }])).toBeNull();
    expect(mainFaction([{ key: 'Valkyra', matches: 64 }, { key: 'Lonestar', matches: 36 }])).toBeNull();
    expect(mainFaction([])).toBeNull();
    expect(mainFaction([{ key: 'Valkyra', matches: 0 }])).toBeNull();
    expect(mainFaction([{ key: 'Pirates', matches: 90 }, { key: 'Valkyra', matches: 10 }])).toBeNull();
  });
});

describe('rotationView', () => {
  const list = [
    { map: 'A', lighting: 'DayClear' },
    { map: 'B', lighting: 'DayLateRain' },
    { map: 'C', lighting: 'DayStartClear' },
  ];
  const live = (now: number | null, next: number | null, map = 'B', lighting: string | null = 'DayLateRain') => ({
    map,
    lighting,
    rotation: { now, next },
  });

  it('reads previous, current and next from the slots', () => {
    expect(rotationView(live(1, 2), list)).toEqual({
      prev: { map: 'A', lighting: 'DayClear', slot: 0 },
      now: { map: 'B', lighting: 'DayLateRain', slot: 1 },
      next: { map: 'C', lighting: 'DayStartClear', slot: 2 },
      length: 3,
    });
  });

  it('wraps round at both ends', () => {
    const v = rotationView(live(0, 1, 'A', 'DayClear'), list)!;
    expect(v.prev?.slot).toBe(2);
    expect(rotationView(live(2, 0, 'C', 'DayStartClear'), list)!.next?.slot).toBe(0);
  });

  it("keeps the server's own map as current", () => {
    expect(rotationView(live(0, 1, 'Ozeti', 'DayClear'), list)!.now).toEqual({ map: 'Ozeti', lighting: 'DayClear', slot: 0 });
  });

  it('shows an off-rotation map with no previous', () => {
    const v = rotationView(live(-1, 1, 'Z', null), list)!;
    expect(v.prev).toBeNull();
    expect(v.now.slot).toBeNull();
    expect(v.next?.map).toBe('B');
  });

  it('falls back to the slot after current when next is missing', () => {
    expect(rotationView(live(1, null), list)!.next?.slot).toBe(2);
  });

  it('is null without any rotation data', () => {
    expect(rotationView(live(null, null), list)).toBeNull();
    expect(rotationView(live(-1, -1), list)).toBeNull();
  });

  it('lists TEG’s nine-map rotation', () => {
    expect(ROTATION).toHaveLength(9);
    expect(ROTATION[0]).toEqual({ map: 'Bakurani', lighting: 'DayLateRain' });
  });
});

describe('mapArt', () => {
  it('has a picture for every rotation map, and none for anything else', () => {
    expect(mapArt('Ozeti', 'DayLateRain')).toBe('/maps/Ozeti-DayLateRain.webp');
    expect(mapArt('Ozeti', 'Night')).toBeNull();
    expect(mapArt('Ozeti', null)).toBeNull();
  });

  it('points at files that exist', async () => {
    const { existsSync } = await import('node:fs');
    for (const r of ROTATION) expect(existsSync(`public${mapArt(r.map, r.lighting)}`), `${r.map} ${r.lighting}`).toBe(true);
  });
});

describe('roundEta', () => {
  it('is the points still needed over the leader\u2019s share of the scoring', () => {
    // 40 of 44 points so far: about 60 more for the leader at ~0.87 of 24 s ticks, with slack
    expect(roundEta([0, 40, 4], 24, 100)).toBe(Math.round((60 / (41 / 47)) * 24 * 1.1));
  });

  it('runs longer when the hill keeps changing hands', () => {
    expect(roundEta([30, 30, 30], 24, 100)!).toBeGreaterThan(roundEta([60, 0, 0], 24, 100)! * 2);
  });

  it('roughly matches finished rounds', () => {
    // a 100/46/37 round took 81 minutes; from 50/23/18 about half of it remains
    const eta = roundEta([50, 23, 18], 24, 100)! / 60;
    expect(eta).toBeGreaterThan(30);
    expect(eta).toBeLessThan(55);
  });

  it('is 0 at the cap and null with nothing to go on', () => {
    expect(roundEta([100, 20, 3], 24, 100)).toBe(0);
    expect(roundEta([0, 0, 0], 24, 100)).toBeNull();
    expect(roundEta([10, 2, 0], null, 100)).toBeNull();
    expect(roundEta([10, 2, 0], 24, null)).toBeNull();
    expect(roundEta([], 24, 100)).toBeNull();
  });
});

describe('rotationStarts', () => {
  it('counts forward from the current slot, wrapping round', () => {
    // slot 2 of 4 on now, 10 min left, rounds of an hour
    expect(rotationStarts(2, 4, 600, 3600)).toEqual([600 + 3600, 600 + 2 * 3600, null, 600]);
  });

  it('is null off rotation or without the times', () => {
    expect(rotationStarts(null, 4, 600, 3600)).toBeNull();
    expect(rotationStarts(-1, 4, 600, 3600)).toBeNull();
    expect(rotationStarts(1, 4, null, 3600)).toBeNull();
    expect(rotationStarts(1, 4, 600, null)).toBeNull();
  });
});

describe('typicalRound', () => {
  it('takes the median finished round, ignoring the one in progress', () => {
    expect(typicalRound([
      { startedAt: 0, endedAt: 3000 },
      { startedAt: 0, endedAt: 5000 },
      { startedAt: 0, endedAt: 99999 },
      { startedAt: 0, endedAt: null },
    ])).toBe(5000);
    expect(typicalRound([{ startedAt: 0, endedAt: 3000 }, { startedAt: 0, endedAt: 5000 }])).toBe(4000);
    expect(typicalRound([{ startedAt: 0, endedAt: null }])).toBeNull();
  });
});

describe('mapWins', () => {
  const r = (map: string, winner: string | null, peakPlayers = 20, endedAt: number | null = 1) => ({ map, winner, peakPlayers, endedAt });
  it('counts wins per map in faction order, busiest map first', () => {
    expect(
      mapWins([r('Europe', 'Lonestar'), r('Europe', 'Valkyra'), r('Europe', 'Lonestar'), r('Kavkazi', 'Manticore')]),
    ).toEqual([
      { map: 'Ozeti', rounds: 3, wins: [{ faction: 'Valkyra', n: 1 }, { faction: 'Lonestar', n: 2 }] },
      { map: 'Bakurani', rounds: 1, wins: [{ faction: 'Manticore', n: 1 }] },
    ]);
  });

  it('leaves out unfinished, winnerless and near-empty rounds', () => {
    expect(mapWins([r('Europe', null), r('Europe', 'Valkyra', 3), r('Europe', 'Valkyra', 20, null)])).toEqual([]);
  });
});
