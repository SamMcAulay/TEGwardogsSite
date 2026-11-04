// Guards for the dark-only chunky redesign (docs/superpowers/specs/2026-11-04-visual-overhaul-design.md).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const self = path.resolve(import.meta.filename);

function sources(dir: string, exts: string[]): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p, exts);
    return exts.some((x) => p.endsWith(x)) && p !== self ? [p] : [];
  });
}

function offenders(exts: string[], bad: RegExp): string[] {
  return sources(root, exts).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(new RegExp(bad, 'g'))].map((m) => `${path.relative(root, file)}:${text.slice(0, m.index).split('\n').length}`);
  });
}

describe('design guard', () => {
  test('no light theme left', () => {
    expect(offenders(['.ts', '.tsx', '.css'], /data-theme=['"]light['"]|@\/lib\/theme['"]|ThemeToggle/)).toEqual([]);
  });

  test('no CDN scripts', () => {
    expect(offenders(['.tsx'], /cdnjs\.cloudflare\.com|unpkg\.com/)).toEqual([]);
  });
});
