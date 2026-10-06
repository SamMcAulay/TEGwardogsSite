// The whole leaderboard as Warcon's CSV export, read into the same rows as a board page.
// Like the zod schemas, only the named columns are kept: anything else in the export is dropped.
import { cells } from './search';
import type { WBoardRow } from './schemas';

const NUMBERS = {
  rank: 'rank',
  minutes: 'playtime_min',
  kills: 'kills',
  deaths: 'deaths',
  headshots: 'headshots',
  matches: 'matches',
  wins: 'wins',
  losses: 'losses',
  draws: 'draws',
  cash: 'cash',
} as const;

/** Throws when a column the site needs is missing (a changed format, not an empty board). */
export function parseBoardExport(csv: string): WBoardRow[] {
  const [head = '', ...lines] = csv.split(/\r?\n/).filter(Boolean);
  const cols = cells(head);
  const at = (name: string) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`board export has no ${name} column`);
    return i;
  };
  const id = at('steam_id');
  const name = at('name');
  const lastSeen = at('last_seen');
  const nums = Object.entries(NUMBERS).map(([key, col]) => [key, at(col)] as const);
  const out: WBoardRow[] = [];
  for (const line of lines) {
    const c = cells(line);
    const steamId = c[id] ?? '';
    if (!/^\d{17}$/.test(steamId)) continue;
    const row = { steamId, name: c[name] ?? '', lastSeen: c[lastSeen] || null } as WBoardRow;
    for (const [key, i] of nums) (row as unknown as Record<string, number>)[key] = Number(c[i]) || 0;
    out.push(row);
  }
  return out;
}
