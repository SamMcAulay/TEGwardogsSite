// The staff team-kill watch: team kills added up per killer, worst first.
import type { KillRow } from './views';

export interface TeamKiller {
  steamId: string;
  name: string;
  count: number;
  /** how many different players they team-killed */
  victims: number;
  /** short server names, in the order first met */
  servers: string[];
  /** unix seconds of their latest team kill */
  lastAt: number;
  /** their team kills, newest first */
  kills: KillRow[];
}

/** Rows newest first, as data.teamKills gives them; kills with no killer or of themselves are left out. */
export function teamKillers(rows: KillRow[]): TeamKiller[] {
  const by = new Map<string, TeamKiller & { victimIds: Set<string> }>();
  for (const k of rows) {
    if (!k.killerSteamId || k.killerSteamId === k.victimSteamId) continue;
    let t = by.get(k.killerSteamId);
    if (!t) {
      t = {
        steamId: k.killerSteamId,
        name: k.killerName ?? k.killerSteamId,
        count: 0,
        victims: 0,
        servers: [],
        lastAt: k.ts,
        kills: [],
        victimIds: new Set(),
      };
      by.set(k.killerSteamId, t);
    }
    t.count++;
    t.kills.push(k);
    if (k.victimSteamId) t.victimIds.add(k.victimSteamId);
    if (!t.servers.includes(k.serverName)) t.servers.push(k.serverName);
    t.lastAt = Math.max(t.lastAt, k.ts);
  }
  return [...by.values()]
    .map(({ victimIds, ...t }) => ({ ...t, victims: victimIds.size }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}
