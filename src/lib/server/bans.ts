// Players on the org's ban list, kept off every leaderboard. Read with the View key from each
// server's banned-player list; server-only bans are left alone (the org doesn't give those out).
// Never shown anywhere: this set is only used to filter.
import { warcon } from './warcon';

/** At most this many pages (100 players each) per server. */
const MAX_PAGES = 50;

let lastGood: Set<string> | null = null;

async function orgBansOn(serverId: string): Promise<{ ids: string[]; stale: boolean }> {
  const ids: string[] = [];
  let stale = false;
  for (let p = 0; p < MAX_PAGES; p++) {
    const { value, stale: s } = await warcon().bannedPage(serverId, p * 100);
    stale ||= s;
    for (const pl of value.players) if (pl.banned === 'org') ids.push(pl.steamId);
    if ((p + 1) * 100 >= value.total || value.players.length === 0) break;
  }
  return { ids, stale };
}

/**
 * Steam IDs on the org ban list. When a server fails, the last complete list is merged in and the
 * result is stale; with no list yet and a failure, it throws, so boards show "unavailable" rather
 * than showing banned players.
 */
export async function orgBannedIds(): Promise<{ ids: ReadonlySet<string>; stale: boolean }> {
  const servers = (await warcon().servers()).value;
  const results = await Promise.allSettled(servers.map((s) => orgBansOn(s.id)));
  const ids = new Set<string>();
  let failed = false;
  let stale = false;
  for (const r of results) {
    if (r.status === 'rejected') {
      failed = true;
      continue;
    }
    stale ||= r.value.stale;
    for (const id of r.value.ids) ids.add(id);
  }
  if (failed || servers.length === 0) {
    if (!lastGood) throw new Error('org ban list unavailable');
    for (const id of lastGood) ids.add(id);
    return { ids, stale: true };
  }
  lastGood = ids;
  return { ids, stale };
}

/** Tests only: forget the last good list. */
export function resetBans(): void {
  lastGood = null;
}
