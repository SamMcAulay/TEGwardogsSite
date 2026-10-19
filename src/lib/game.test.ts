import { describe, expect, it } from 'vitest';
import { mainFaction, mapArt, ROTATION, rotationView } from './game';

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
