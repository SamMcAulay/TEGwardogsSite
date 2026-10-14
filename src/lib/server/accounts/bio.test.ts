import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkBio, fold, loadBlockedWords } from './bio';

// Stand-in words: the real list is staff's, kept on the server.
const BLOCKED = ['banana', 'fig'];

describe('checkBio', () => {
  test('one tidy paragraph; empty clears', () => {
    expect(checkBio('  Sniper main.\n\nEU evenings  ', BLOCKED)).toEqual({ ok: true, bio: 'Sniper main. EU evenings' });
    expect(checkBio('   ', BLOCKED)).toEqual({ ok: true, bio: null });
  });

  test('too long', () => {
    expect(checkBio('x'.repeat(161), BLOCKED)).toEqual({ ok: false, problem: 'long' });
    expect(checkBio('x'.repeat(160), BLOCKED)).toMatchObject({ ok: true });
  });

  test('no links, invites or mass pings', () => {
    for (const bad of ['see https://x.example', 'join discord.gg/abc', 'www.site.org', 'my clan site.gg', 'hey @everyone', 'ask <@123456789012345678>']) {
      expect(checkBio(bad, BLOCKED)).toMatchObject({ ok: false });
    }
    expect(checkBio('K/D 2.5, 1.2km best', BLOCKED)).toMatchObject({ ok: true });
  });

  test("staff's blocked words, whatever the disguise; but not inside innocent words", () => {
    for (const bad of ['I love BANANA', 'b4n4n4 time', 'b a n a n a', 'xbananax', 'f1g']) {
      expect(checkBio(bad, BLOCKED)).toMatchObject({ ok: false });
    }
    expect(checkBio('figure skating fan', BLOCKED)).toMatchObject({ ok: true }); // short words match whole only
    expect(checkBio('anything goes', [])).toMatchObject({ ok: true });
  });
});

describe('blocked words file', () => {
  test('read from DATA_DIR, folded, blanks skipped; missing file = none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bio-'));
    expect(loadBlockedWords(dir)).toEqual([]);
    writeFileSync(join(dir, 'blocked-words.txt'), 'Banana\n\n  GR4PE \r\nx\n');
    expect(loadBlockedWords(dir)).toEqual(['banana', 'grape']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('fold', () => {
    expect(fold('Ünïcödé 1337 $tuff!')).toBe('unicode ieet stuffi');
  });
});
