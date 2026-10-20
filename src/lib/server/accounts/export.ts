// The linked-accounts CSV staff download from /admin (for Bulkhead's priority queue, or a backup).
// Discord names are chosen by members, so a cell that a spreadsheet would read as a formula is
// written as text instead.
import { TIERS } from '@/lib/tiers';
import type { Link } from './store';

const HEADER = [
  'discord_id',
  'discord_name',
  'steam_id',
  'player_name',
  'tier',
  'tier_label',
  'linked_at',
  'roles_checked_at',
];

const iso = (sec: number | null) => (sec ? new Date(sec * 1000).toISOString() : '');

/** One CSV cell: quoted when needed, and a leading = + - @ tab or CR made inert with a quote mark. */
export function csvCell(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function linksCsv(links: Link[], playerName: (steamId: string) => string | null): string {
  const rows = links.map((l) => [
    l.discordId,
    l.discordName,
    l.steamId,
    playerName(l.steamId),
    l.tier,
    l.tier ? TIERS[l.tier].label : '',
    iso(l.linkedAt),
    iso(l.checkedAt),
  ]);
  return [HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
