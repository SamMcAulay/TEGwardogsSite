import { describe, expect, it } from 'vitest';
import { shouldSwipe } from './swipe';

describe('shouldSwipe', () => {
  it('swipes when moving to another page', () => {
    expect(shouldSwipe('/a', '/b')).toBe(true);
  });

  it('stays still for filters, refreshes and anchors on the same page', () => {
    expect(shouldSwipe('/leaderboards?metric=kd', '/leaderboards?metric=kills')).toBe(false);
    expect(shouldSwipe('/', '/')).toBe(false);
    expect(shouldSwipe('/x#top', '/x')).toBe(false);
  });
});
