import { describe, expect, test } from 'vitest';
import { AHEAD, chances, configEntry, entryOf, pickNext, plan, POOL, scoresOf } from './pool';

describe('weighted rotation pool', () => {
  test('12 entries: Sabatulo with clear late afternoon in place of early morning', () => {
    expect(POOL).toHaveLength(12);
    expect(POOL.filter((e) => e.map === 'Sabatulo').map((e) => [e.lighting, e.kind])).toEqual([
      ['DayClear', 'clear'],
      ['DayLateClear', 'morning'],
      ['DayLateRain', 'rain'],
    ]);
  });

  test('scores start at 0 / 0.75 / 1.5 by lighting, stored ones win', () => {
    const s = scoresOf(new Map([['Ozeti/DayClear', 4]]));
    expect(s.get('Bakurani/DayClear')).toBe(0);
    expect(s.get('Bakurani/DayEarlyClear')).toBe(0.75);
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
    expect(odds.get('Ozeti/DayClear')!).toBeGreaterThan(odds.get('Ozeti/DayEarlyClear')!);
    expect(odds.get('Ozeti/DayEarlyClear')!).toBeGreaterThan(odds.get('Ozeti/DayLateRain')!);
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

describe('plan', () => {
  const mapOf = (k: string) => k.split('/')[0];

  test('plans AHEAD maps, never the same map twice in a row', () => {
    for (let i = 0; i < 50; i++) {
      const p = plan(scoresOf(new Map()), 'Sabatulo', []);
      expect(p).toHaveLength(AHEAD);
      ['Sabatulo', ...p.map(mapOf)].forEach((m, j, all) => j && expect(m).not.toBe(all[j - 1]));
    }
  });

  test('keeps what was planned and only tops it up', () => {
    const p = plan(scoresOf(new Map()), 'Sabatulo', ['Ozeti/DayClear', 'Zestafona/DayClear'], () => 0);
    expect(p.slice(0, 2)).toEqual(['Ozeti/DayClear', 'Zestafona/DayClear']);
    expect(mapOf(p[2])).not.toBe('Zestafona');
  });

  test('counts planned maps as played', () => {
    // Ozeti/DayClear far lowest: picked first; scored once it is planned, it loses its lead over Bakurani/DayClear
    const scores = new Map(POOL.map((e) => [e.key, 10]));
    scores.set('Ozeti/DayClear', 0).set('Zestafona/DayClear', 0).set('Bakurani/DayClear', 0.6);
    const p = plan(scores, 'Sabatulo', ['Ozeti/DayClear', 'Zestafona/DayClear'], () => 0.3);
    expect(p[2]).toBe('Bakurani/DayClear');
  });

  test('a key the pool no longer has is planned afresh, with what came after it', () => {
    const p = plan(scoresOf(new Map()), 'Sabatulo', ['Ozeti/DayClear', 'Zestafona/DayStartClear', 'Bakurani/DayClear'], () => 0);
    expect(p[0]).toBe('Ozeti/DayClear');
    expect(p.every((k) => POOL.some((e) => e.key === k))).toBe(true);
  });

  test('every 9 maps shown (now + 8 planned) hold a rain, even when rain scores far behind', () => {
    // like live 2026-11-18: fresh mornings at 0.75 while the rest have climbed to 2-3
    const scores = scoresOf(new Map(POOL.map((e) => [e.key, e.kind === 'morning' ? 0.75 : e.kind === 'rain' ? 3 : 2])));
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const isRain = (k: string) => k.endsWith('Rain');
    const played: string[] = [];
    let queue: string[] = [];
    let playing = 'Sabatulo';
    for (let i = 0; i < 500; i++) {
      queue = plan(scores, playing, queue, random);
      expect(queue.slice(0, AHEAD).some(isRain)).toBe(true);
      const [next, ...rest] = queue;
      const e = POOL.find((p) => p.key === next)!;
      scores.set(next, scores.get(next)! + (e.kind === 'rain' ? 1.5 : e.kind === 'morning' ? 1.25 : 1));
      played.push(next);
      playing = e.map;
      queue = rest;
    }
    for (let i = 0; i + 8 <= played.length; i++) expect(played.slice(i, i + 8).some(isRain)).toBe(true);
  });

  test('an old plan with no rain in 8 is cut at the 8th and redrawn with one', () => {
    const old = ['Ozeti/DayClear', 'Zestafona/DayClear', 'Bakurani/DayClear', 'Sabatulo/DayClear', 'Ozeti/DayEarlyClear', 'Zestafona/DayEarlyClear', 'Bakurani/DayEarlyClear', 'Ozeti/DayClear'];
    const p = plan(scoresOf(new Map()), 'Sabatulo', old, () => 0);
    expect(p.slice(0, 7)).toEqual(old.slice(0, 7));
    expect(p[7].endsWith('Rain')).toBe(true);
  });

  test('morning is DayEarlyClear, never DayStartClear (the game plays that as a random time of day)', () => {
    expect(POOL.some((e) => e.lighting === 'DayStartClear')).toBe(false);
    expect(entryOf('Ozeti', 'DayEarlyClear')?.kind).toBe('morning');
  });
});
