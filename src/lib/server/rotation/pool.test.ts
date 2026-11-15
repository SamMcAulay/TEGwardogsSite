import { describe, expect, test } from 'vitest';
import { chances, configEntry, entryOf, pickNext, POOL, scoresOf } from './pool';

describe('weighted rotation pool', () => {
  test('11 entries: Sabatulo without early morning', () => {
    expect(POOL).toHaveLength(11);
    expect(POOL.filter((e) => e.map === 'Sabatulo').map((e) => e.lighting)).toEqual(['DayClear', 'DayLateRain']);
  });

  test('scores start at 0 / 0.75 / 1.5 by lighting, stored ones win', () => {
    const s = scoresOf(new Map([['Ozeti/DayClear', 4]]));
    expect(s.get('Bakurani/DayClear')).toBe(0);
    expect(s.get('Bakurani/DayStartClear')).toBe(0.75);
    expect(s.get('Bakurani/DayLateRain')).toBe(1.5);
    expect(s.get('Ozeti/DayClear')).toBe(4);
  });

  test('entryOf matches the in-game name or the id', () => {
    expect(entryOf('Sabatulo', 'DayClear')?.key).toBe('Sabatulo/DayClear');
    expect(entryOf('Kavkazi', 'daylaterain')?.key).toBe('Bakurani/DayLateRain');
    expect(entryOf('Sabatulo', 'DayStartClear')).toBeNull();
  });

  test('never the map being played; lowest scores favoured but not certain', () => {
    const odds = chances(scoresOf(new Map()), 'Bakurani');
    expect([...odds.keys()].some((k) => k.startsWith('Bakurani'))).toBe(false);
    expect([...odds.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    // the clear entries (0) each beat early morning (0.75), which beats rain (1.5)
    expect(odds.get('Ozeti/DayClear')!).toBeGreaterThan(odds.get('Ozeti/DayStartClear')!);
    expect(odds.get('Ozeti/DayStartClear')!).toBeGreaterThan(odds.get('Ozeti/DayLateRain')!);
    expect(odds.get('Ozeti/DayLateRain')!).toBeGreaterThan(0);
  });

  test('pickNext walks the chances with the random number', () => {
    const s = scoresOf(new Map());
    expect(pickNext(s, 'Bakurani', () => 0).map).not.toBe('Bakurani');
    expect(pickNext(s, 'Bakurani', () => 0.999999).map).not.toBe('Bakurani');
    const seen = new Set(Array.from({ length: 200 }, (_, i) => pickNext(s, null, () => i / 200).key));
    expect(seen.size).toBeGreaterThan(5);
  });

  test('config line in the game format', () => {
    expect(configEntry(entryOf('Bakurani', 'DayClear')!)).toBe('(Map="Kavkazi",Experiences="Bakurani_KOTH_02+KOTH_LimitedGear",Lighting="DayClear")');
  });
});
