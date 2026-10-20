// Clans: players grouped by the tag in their in-game name, with their board stats added up.
import { clanTag } from '@/lib/clans';

/** Fewer players than this sharing a tag isn't a clan, just a coincidence. */
export const MIN_CLAN_SIZE = 3;

export interface ClanMemberRow {
  steamId: string;
  name: string;
  minutes: number;
  kills: number;
  deaths: number;
  headshots: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  lastSeen: string | null;
}

export interface Clan {
  tag: string;
  /** board rows, most kills first */
  members: ClanMemberRow[];
  kills: number;
  deaths: number;
  headshots: number;
  minutes: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** unix seconds of the latest member seen */
  lastSeen: number | null;
}

export const CLAN_SORTS = ['kills', 'kd', 'perHour', 'winRate', 'playtime', 'members'] as const;
export type ClanSort = (typeof CLAN_SORTS)[number];
export const CLAN_SORT_LABELS: Record<ClanSort, string> = {
  kills: 'Kills',
  kd: 'K/D',
  perHour: 'Kills / hour',
  winRate: 'Win rate',
  playtime: 'Playtime',
  members: 'Players',
};

export function clanValue(sort: ClanSort, c: Clan): number {
  switch (sort) {
    case 'kills':
      return c.kills;
    case 'kd':
      return c.kills / Math.max(1, c.deaths);
    case 'perHour':
      return c.minutes > 0 ? c.kills / (c.minutes / 60) : 0;
    case 'winRate': {
      const decided = c.wins + c.losses + c.draws;
      return decided ? c.wins / decided : 0;
    }
    case 'playtime':
      return c.minutes;
    case 'members':
      return c.members.length;
  }
}

/** Every tag that at least MIN_CLAN_SIZE players on the board carry, sorted by `sort`, best first. */
export function groupClans(rows: ClanMemberRow[], sort: ClanSort = 'kills'): Clan[] {
  const by = new Map<string, ClanMemberRow[]>();
  for (const r of rows) {
    const tag = clanTag(r.name);
    if (!tag) continue;
    const list = by.get(tag);
    if (list) list.push(r);
    else by.set(tag, [r]);
  }
  const clans: Clan[] = [];
  for (const [tag, members] of by) {
    if (members.length < MIN_CLAN_SIZE) continue;
    const sum = (f: (m: ClanMemberRow) => number) => members.reduce((n, m) => n + f(m), 0);
    const seen = members.map((m) => Date.parse(m.lastSeen ?? '')).filter((t) => !Number.isNaN(t));
    clans.push({
      tag,
      members: [...members].sort((a, b) => b.kills - a.kills || b.minutes - a.minutes),
      kills: sum((m) => m.kills),
      deaths: sum((m) => m.deaths),
      headshots: sum((m) => m.headshots),
      minutes: sum((m) => m.minutes),
      matches: sum((m) => m.matches),
      wins: sum((m) => m.wins),
      losses: sum((m) => m.losses),
      draws: sum((m) => m.draws),
      lastSeen: seen.length ? Math.floor(Math.max(...seen) / 1000) : null,
    });
  }
  return clans.sort((a, b) => clanValue(sort, b) - clanValue(sort, a) || b.kills - a.kills || a.tag.localeCompare(b.tag));
}

export const parseClanSort = (v: unknown): ClanSort => (CLAN_SORTS.includes(v as ClanSort) ? (v as ClanSort) : 'kills');
