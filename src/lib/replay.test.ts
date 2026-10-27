import { describe, expect, it } from 'vitest';
import { HEADSHOT, killsBefore, scoreAt, standings, TEAM_KILL, turningPoints, type ReplayData } from './replay';

const timeline = [
  [0, 0, 0],
  [60, 1, 0],
  [120, 1, 1],
  [180, 1, 3],
  [240, 4, 3],
];

describe('scoreAt', () => {
  it('holds the last score at or before the moment', () => {
    expect(scoreAt(timeline, 2, 30)).toEqual([0, 0]);
    expect(scoreAt(timeline, 2, 150)).toEqual([1, 1]);
    expect(scoreAt(timeline, 2, 999)).toEqual([4, 3]);
    expect(scoreAt([], 3, 10)).toEqual([0, 0, 0]);
  });
});

describe('turningPoints', () => {
  it('marks the first lead and each change of leader, skipping ties', () => {
    expect(turningPoints(timeline, 2)).toEqual([
      { t: 60, faction: 0, kind: 'lead' },
      { t: 180, faction: 1, kind: 'lead' },
      { t: 240, faction: 0, kind: 'retake' },
    ]);
  });
});

describe('replay kills', () => {
  const data: ReplayData = {
    people: [
      { steamId: 'a', name: 'A', faction: 'Valkyra' },
      { steamId: 'b', name: 'B', faction: 'Lonestar' },
      { steamId: 'c', name: 'C', faction: 'Valkyra' },
    ],
    causes: ['AK'],
    kills: [
      [10, 0, 1, 0, HEADSHOT, 50],
      [20, 0, 1, 0, 0, 40],
      [30, 0, 2, 0, TEAM_KILL, 5],
      [40, 1, 0, 0, 0, 10],
    ],
  };

  it('counts kills up to a moment', () => {
    expect(killsBefore(data.kills, 5)).toBe(0);
    expect(killsBefore(data.kills, 20)).toBe(2);
    expect(killsBefore(data.kills, 100)).toBe(4);
  });

  it('ranks people by kills so far, not counting team kills', () => {
    expect(standings(data, 3)).toEqual([{ person: 0, kills: 2, deaths: 0 }]);
    expect(standings(data, 4)).toEqual([
      { person: 0, kills: 2, deaths: 1 },
      { person: 1, kills: 1, deaths: 2 },
    ]);
  });
});
