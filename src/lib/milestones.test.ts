import { describe, expect, test } from 'vitest';
import { milestones, TRACKS } from './milestones';
import { classKills } from './weapon-classes';

const zero = { kills: 0, headshots: 0, playtime: 0, longest: 0, wins: 0, matches: 0, vehicleKills: 0, killStreak: 0, classKills: classKills([]) };
const track = (t: Partial<typeof zero>, key: string) => milestones({ ...zero, ...t }).find((m) => m.key === key)!;

describe('milestones', () => {
  test('a new player has no badges and is working towards the first of each', () => {
    for (const m of milestones(zero)) {
      expect(m).toMatchObject({ level: 0, earned: null });
      expect(m.next).not.toBeNull();
    }
  });

  test('the best badge reached, and the next one', () => {
    expect(track({ kills: 1200 }, 'kills')).toMatchObject({ level: 3, earned: '1K kills', next: { at: 2500, badge: '2.5K kills' } });
    expect(track({ kills: 1000 }, 'kills')).toMatchObject({ level: 3, earned: '1K kills' }); // exactly on the line counts
    expect(track({ kills: 999 }, 'kills')).toMatchObject({ level: 2, earned: '500 kills' });
  });

  test('hours come from seconds, rounded down', () => {
    expect(track({ playtime: 50 * 3600 - 1 }, 'playtime')).toMatchObject({ value: 49, earned: '10 hours' });
    expect(track({ playtime: 50 * 3600 }, 'playtime')).toMatchObject({ value: 50, earned: '50 hours' });
  });

  test('every badge earned: no next', () => {
    expect(track({ longest: 1400 }, 'longest')).toMatchObject({ level: 4, steps: 4, earned: '1000 m shot', next: null });
  });

  test('vehicle kills and kill streaks', () => {
    expect(track({ vehicleKills: 60 }, 'vehicleKills')).toMatchObject({ earned: '50 vehicle kills', next: { at: 100 } });
    expect(track({ killStreak: 12 }, 'killStreak')).toMatchObject({ earned: '10 in one life', next: { at: 15 } });
  });

  test('weapon classes, worded per class', () => {
    const t = { ...zero, classKills: classKills([{ cause: 'Id.Item.MP9', kills: 120 }, { cause: 'Id.Item.Vector', kills: 10 }, { cause: 'Id.Item.SVDM', kills: 300 }]) };
    expect(milestones(t).find((m) => m.key === 'class:smg')).toMatchObject({ value: 130, earned: '100 SMG kills', group: 'class' });
    expect(milestones(t).find((m) => m.key === 'class:marksman')).toMatchObject({ value: 300, earned: '250 marksman kills' });
    expect(milestones(t).find((m) => m.key === 'class:sniper')).toMatchObject({ value: 0, earned: null });
  });

  test('thresholds ascend on every track', () => {
    for (const t of TRACKS) expect([...t.steps].sort((a, b) => a - b)).toEqual(t.steps);
  });
});
