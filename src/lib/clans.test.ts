import { describe, expect, test } from 'vitest';
import { clanSlug, clanTag, parseClanSlug } from './clans';

describe('clanTag', () => {
  test('a bracketed tag at the start or end, upper-cased', () => {
    expect(clanTag('[TEG] Sammy')).toBe('TEG');
    expect(clanTag('[teg]Sammy')).toBe('TEG');
    expect(clanTag('{DPB} WarcrimesTom')).toBe('DPB');
    expect(clanTag('(NOR) Overdose')).toBe('NOR');
    expect(clanTag('<ERJO>KAPPA')).toBe('ERJO');
    expect(clanTag('  [ CLT ] Tetz')).toBe('CLT');
    expect(clanTag('Tetz [CLT]')).toBe('CLT');
    expect(clanTag('Tetz (CLT)  ')).toBe('CLT');
  });

  test('no tag: plain names, digits only, mismatched brackets, tags in the middle or too long', () => {
    for (const name of ['FleecyJake', '[1] Bob', 'Bob (2024)', '[TEG) Bob', 'Bob [TEG] Smith', '[TOOLONGX] Bob', '[A] Bob', '[T-G] Bob', ''])
      expect(clanTag(name)).toBeNull();
  });

  test('slugs round-trip, and junk is refused', () => {
    expect(clanSlug('TEG')).toBe('teg');
    expect(parseClanSlug('teg')).toBe('TEG');
    expect(parseClanSlug('12')).toBeNull();
    expect(parseClanSlug('te%20g')).toBeNull();
    expect(parseClanSlug('toolongx')).toBeNull();
  });
});
