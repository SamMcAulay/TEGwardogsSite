import { describe, expect, it } from 'vitest';
import { parseTheme } from './theme';

describe('parseTheme', () => {
  it('reads the two themes', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
  });

  it('treats anything else as not picked yet', () => {
    expect(parseTheme(undefined)).toBeNull();
    expect(parseTheme('')).toBeNull();
    expect(parseTheme('Light')).toBeNull();
    expect(parseTheme('dark; path=/')).toBeNull();
  });
});
