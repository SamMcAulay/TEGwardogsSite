import { describe, expect, test } from 'vitest';
import { tierFor } from './tiers';

const cfg = { staff: ['100', '101'], premium: ['200'], verified: ['300', '301'] };

describe('tierFor', () => {
  test('any one of a tier\'s roles is enough', () => {
    expect(tierFor(['101'], cfg)).toBe(1);
    expect(tierFor(['200'], cfg)).toBe(2);
    expect(tierFor(['301'], cfg)).toBe(3);
  });

  test('the best tier wins', () => {
    expect(tierFor(['300', '200'], cfg)).toBe(2);
    expect(tierFor(['300', '200', '100'], cfg)).toBe(1);
  });

  test('null without a tier role, or with no roles configured', () => {
    expect(tierFor(['999'], cfg)).toBeNull();
    expect(tierFor([], cfg)).toBeNull();
    expect(tierFor(['100'], { staff: [], premium: [], verified: [] })).toBeNull();
  });
});
