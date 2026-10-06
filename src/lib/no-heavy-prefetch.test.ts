// Next.js pre-loads every <Link> as it scrolls into view. A player or match page costs Warcon its
// heaviest queries, and a leaderboard lists 50 players: pre-loading them swamped Warcon and made
// real profile visits time out. Every link to those pages must say prefetch={false}.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

const root = path.resolve(import.meta.dirname, '..');

describe('links to heavy pages', () => {
  test('every <Link> to /players/… or /matches/… has prefetch={false}', () => {
    const offenders: string[] = [];
    for (const file of sources(root)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/<Link\b[\s\S]*?>/g)) {
        const tag = m[0];
        if (!/href=\{?[`'"]\/(players|matches)\//.test(tag)) continue;
        if (!/prefetch=\{false\}/.test(tag)) {
          const line = text.slice(0, m.index).split('\n').length;
          offenders.push(`${path.relative(root, file)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
