import { describe, expect, test, vi } from 'vitest';
import { openStore } from '../accounts/store';
import { configEntry, entryOf } from './pool';
import { rotationLook, type OpenMatch } from './run';

const setup = (open: OpenMatch | null) => {
  const store = openStore(':memory:');
  const write = vi.fn<(id: string, entries: string[]) => Promise<void>>(async () => {});
  const deps = { store, openMatch: vi.fn(async () => open), config: { read: vi.fn(), write }, random: () => 0 };
  return { store, write, deps };
};
const M1: OpenMatch = { startedAt: '2026-11-16T10:00:00.000Z', map: 'Sabatulo', lighting: 'DayClear' };

describe('rotationLook', () => {
  test('does nothing for a server switched off', async () => {
    const { store, write, deps } = setup(M1);
    store.setRotationEnabled('s1', false, null, 'staff');
    await rotationLook(deps);
    expect(write).not.toHaveBeenCalled();
    expect(deps.openMatch).not.toHaveBeenCalled();
  });

  test('a new match: scores what loaded, picks another map and writes it twice', async () => {
    const { store, write, deps } = setup(M1);
    store.setRotationEnabled('s1', true, ['old'], 'staff');
    const r = await rotationLook(deps);
    expect(r.errors).toEqual([]);
    expect(store.rotationScores('s1')).toEqual(new Map([['Sabatulo/DayClear', 1]]));
    const s = store.rotationServer('s1')!;
    expect(s).toMatchObject({ match: M1.startedAt, written: true, note: null });
    expect(s.nextKey!.startsWith('Sabatulo')).toBe(false);
    const e = configEntry(entryOf(...(s.nextKey!.split('/') as [string, string]))!);
    expect(write).toHaveBeenCalledWith('s1', [e, e]);
  });

  test('the same match again: nothing more', async () => {
    const { store, write, deps } = setup(M1);
    store.setRotationEnabled('s1', true, ['old'], 'staff');
    await rotationLook(deps);
    await rotationLook(deps);
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.rotationScores('s1').get('Sabatulo/DayClear')).toBe(1);
  });

  test('a failed write is kept, noted and tried again at the next look', async () => {
    const { store, write, deps } = setup(M1);
    store.setRotationEnabled('s1', true, ['old'], 'staff');
    write.mockRejectedValueOnce(new Error('configApply: Warcon answered HTTP 502'));
    const r = await rotationLook(deps);
    expect(r.errors[0]).toMatch(/HTTP 502/);
    expect(store.rotationServer('s1')).toMatchObject({ written: false, note: expect.stringMatching(/^Couldn't set .* next: configApply/) });
    await rotationLook(deps);
    expect(write).toHaveBeenCalledTimes(2);
    expect(store.rotationServer('s1')).toMatchObject({ written: true, note: null });
  });

  test('a server that loads something other than the pick is noted', async () => {
    const { store, deps } = setup(M1);
    store.setRotationEnabled('s1', true, ['old'], 'staff');
    await rotationLook(deps);
    deps.openMatch.mockResolvedValue({ startedAt: '2026-11-16T11:00:00.000Z', map: 'Sabatulo', lighting: 'DayLateRain' });
    const r = await rotationLook(deps);
    expect(r.errors[0]).toMatch(/but the server loaded Sabatulo\/DayLateRain/);
    expect(store.rotationServer('s1')!.note).toMatch(/^Picked .*, but the server loaded Sabatulo\/DayLateRain/);
    // what loaded still scores
    expect(store.rotationScores('s1').get('Sabatulo/DayLateRain')).toBe(3);
  });

  test('plans ahead, moves the plan on when the pick loads, and plans afresh when it does not', async () => {
    const { store, deps } = setup(M1);
    store.setRotationEnabled('s1', true, ['old'], 'staff');
    await rotationLook(deps);
    const first = store.rotationServer('s1')!;
    expect(first.later).toHaveLength(2);
    const [map, lighting] = first.nextKey!.split('/');
    deps.openMatch.mockResolvedValue({ startedAt: '2026-11-16T11:00:00.000Z', map, lighting });
    await rotationLook(deps);
    const second = store.rotationServer('s1')!;
    expect([second.nextKey, ...second.later.slice(0, 1)]).toEqual(first.later);
    expect(second.later).toHaveLength(2);
    // the server loads something else: the old plan is dropped
    deps.random = () => 0.999;
    deps.openMatch.mockResolvedValue({ startedAt: '2026-11-16T12:00:00.000Z', map: 'Sabatulo', lighting: 'DayLateRain' });
    await rotationLook(deps);
    const third = store.rotationServer('s1')!;
    expect(third.nextKey!.startsWith('Sabatulo')).toBe(false);
    expect(third.later).toHaveLength(2);
  });

  test('step through 300 matches: rolls one on each match, never the same map twice running, every map comes back', async () => {
    const { store, write, deps } = setup(M1);
    let seed = 42; // repeatable "random": a small LCG
    deps.random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    store.setRotationEnabled('s1', true, ['old'], 'staff');
    await rotationLook(deps);
    const played = ['Sabatulo'];
    let soonAfter = 0; // plans where the map just played shows up again 2 or 3 maps on
    for (let i = 1; i <= 300; i++) {
      const before = store.rotationServer('s1')!;
      const [map, lighting] = before.nextKey!.split('/');
      deps.openMatch.mockResolvedValue({ startedAt: `match-${i}`, map, lighting });
      await rotationLook(deps);
      const after = store.rotationServer('s1')!;
      // rolling: what was 2nd is now next, what was 3rd is now 2nd, and one new map on the end
      expect([after.nextKey, after.later[0]]).toEqual(before.later);
      expect(after.later).toHaveLength(2);
      // never back to back, in what was played or anywhere in the plan
      const chain = [map, ...[after.nextKey!, ...after.later].map((k) => k.split('/')[0])];
      chain.forEach((m, j) => j && expect(m, `match ${i}: ${chain.join(' > ')}`).not.toBe(chain[j - 1]));
      if (chain.slice(2).includes(map)) soonAfter++;
      played.push(map);
    }
    // the map being played is only kept out of the very next slot
    expect(soonAfter).toBeGreaterThan(30);
    for (const m of ['Sabatulo', 'Bakurani', 'Ozeti', 'Zestafona']) expect(played.filter((p) => p === m).length).toBeGreaterThan(40);
    expect(write).toHaveBeenCalledTimes(301);
  });

  test('a match with no plan yet (as after an upgrade) is planned at once, without scoring it twice', async () => {
    const { store, write, deps } = setup(M1);
    store.setRotationEnabled('s1', true, ['old'], 'staff');
    store.setRotationPick('s1', { match: M1.startedAt, nextKey: null, written: true, note: null });
    await rotationLook(deps);
    const s = store.rotationServer('s1')!;
    expect(s.nextKey!.startsWith('Sabatulo')).toBe(false);
    expect(s.later).toHaveLength(2);
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.rotationScores('s1').size).toBe(0);
  });

  test('between matches: waits', async () => {
    const { store, write, deps } = setup(null);
    store.setRotationEnabled('s1', true, ['old'], 'staff');
    await rotationLook(deps);
    expect(write).not.toHaveBeenCalled();
  });
});

test('switched off while a look is under way: writes nothing', async () => {
  const { store, write, deps } = setup(M1);
  store.setRotationEnabled('s1', true, ['old'], 'staff');
  deps.openMatch.mockImplementation(async () => {
    store.setRotationEnabled('s1', false, null, 'staff');
    return M1;
  });
  await rotationLook(deps);
  expect(write).not.toHaveBeenCalled();
});
