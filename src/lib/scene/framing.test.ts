import { describe, expect, it } from 'vitest';
import { approach, viewOffset } from './framing';

describe('viewOffset', () => {
  it('centres the scene when there is no gap to frame', () => {
    expect(viewOffset({ w: 1000, h: 800 }, null)).toEqual({ x: 0, y: 0 });
  });

  it('moves the island onto the centre of the gap', () => {
    const o = viewOffset({ w: 1000, h: 800 }, { left: 0, top: 100, width: 600, height: 600 });
    expect(o.x).toBe(200);
    expect(o.y).toBe(0);
  });

  it('only counts the part of the gap inside the viewport', () => {
    expect(viewOffset({ w: 1000, h: 800 }, { left: 0, top: 100, width: 600, height: 2000 }).y).toBe(-50);
  });
});

describe('approach', () => {
  it('moves part of the way toward the target', () => {
    const v = approach(0, 10, 0.1);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(10);
  });

  it('never overshoots', () => {
    expect(approach(9.999, 10, 10)).toBeLessThanOrEqual(10);
    expect(approach(5, 5, 1)).toBe(5);
  });
});
