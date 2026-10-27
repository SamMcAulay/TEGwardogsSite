import { describe, expect, it } from 'vitest';
import { RECENT_S } from './presence';
import { seenRating } from './trends';
import type { PlayerRating } from './history/ratings';

const NOW = 2_000_000_000;
const player: PlayerRating = {
  steamId: '76561198000000001',
  skill: { mu: 30, sigma: 3 },
  rating: 1500,
  rounds: 3,
  lastPlayed: NOW - 600,
  history: [],
  steps: [
    { t: NOW - 2 * 86400, rating: 1300 },
    { t: NOW - RECENT_S - 60, rating: 1400 },
    { t: NOW - 600, rating: 1500 },
  ],
};

describe('seenRating', () => {
  it('shows everything to someone who may see their play', () => {
    expect(seenRating(player, false, NOW)).toMatchObject({ rating: 1500, rounds: 3, lastPlayed: NOW - 600 });
  });

  it('rolls a hidden player back to before their last few hours, and withholds when they last played', () => {
    expect(seenRating(player, true, NOW)).toMatchObject({ rating: 1400, rounds: 2, lastPlayed: null });
  });

  it('shows nothing of a hidden player whose only rounds are recent', () => {
    expect(seenRating({ ...player, rounds: 1, steps: [{ t: NOW - 600, rating: 1100 }] }, true, NOW)).toBeNull();
  });

  it('changes nothing once their latest round is old enough', () => {
    const old = { ...player, lastPlayed: NOW - RECENT_S - 1 };
    expect(seenRating(old, true, NOW)).toMatchObject({ rating: 1500, rounds: 3, lastPlayed: NOW - RECENT_S - 1 });
  });
});
