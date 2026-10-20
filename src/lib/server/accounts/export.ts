// The linked-accounts download from /admin, as an Excel file for staff (ids kept as text, so a
// spreadsheet can't round them) or a CSV for scripts and Bulkhead's priority queue. Discord names
// are chosen by members, so a CSV cell that a spreadsheet would read as a formula is written as text.
import { TIERS } from '@/lib/tiers';
import { xlsx } from '../xlsx';
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

/** Column widths for the Excel file, in characters. */
const WIDTHS = [22, 24, 20, 24, 6, 10, 20, 20];

const iso = (sec: number | null) => (sec ? new Date(sec * 1000).toISOString() : '');
/** `2026-10-13 14:02 UTC`: reads plainly, and sorts in date order as text. */
const readable = (sec: number | null) => (sec ? `${iso(sec).slice(0, 16).replace('T', ' ')} UTC` : '');

type PlayerName = (steamId: string) => string | null;

function rows(links: Link[], playerName: PlayerName, when: (sec: number | null) => string) {
  return links.map((l) => [
    l.discordId,
    l.discordName,
    l.steamId,
    playerName(l.steamId),
    l.tier,
    l.tier ? TIERS[l.tier].label : '',
    when(l.linkedAt),
    when(l.checkedAt),
  ]);
}

/** One CSV cell: quoted when needed, and a leading = + - @ tab or CR made inert with a quote mark. */
export function csvCell(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function linksCsv(links: Link[], playerName: PlayerName): string {
  return [HEADER, ...rows(links, playerName, iso)].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function linksXlsx(links: Link[], playerName: PlayerName): Uint8Array<ArrayBuffer> {
  return xlsx('Linked accounts', [HEADER, ...rows(links, playerName, readable)], WIDTHS);
}
