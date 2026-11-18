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
