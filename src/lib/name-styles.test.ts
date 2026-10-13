import { describe, expect, test } from 'vitest';
import { nameStyleFor } from './name-styles';

describe('nameStyleFor', () => {
  test("each tier's own style", () => {
    expect(nameStyleFor(1, null)).toBe('aurora');
    expect(nameStyleFor(2, null)).toBe('gold');
    expect(nameStyleFor(3, undefined)).toBe('pearl');
  });

  test("an account's own style wins while they hold a tier", () => {
    expect(nameStyleFor(1, 'pink')).toBe('pink');
    expect(nameStyleFor(3, 'gold')).toBe('gold');
  });

  test('no tier, no style; unknown styles are ignored', () => {
    expect(nameStyleFor(null, 'pink')).toBeNull();
    expect(nameStyleFor(2, 'rainbow')).toBe('gold');
  });
});
