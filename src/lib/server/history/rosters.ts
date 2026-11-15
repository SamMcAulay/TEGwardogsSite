// The starting teams: who is on each side two minutes into every match, kept in history.db. A
// finished round only says how long each player was on, so it can't tell a starter who left from a
// late joiner, and players leave the losing side: rosters taken from finished rounds give the
// result away. Predictions are tested on these instead (ratings and K/D going in are rebuilt from
// the rounds before). Two minutes in: after the balancer's match-start re-deal, before people leave.
import { jobRan } from '../jobs';
import type { History } from './store';

/** Taken this long into a match, and not later than ROSTER_LATE_S (a look missed for longer is skipped). */
export const ROSTER_AFTER_S = 120;
export const ROSTER_LATE_S = 300;
const LOOK_MS = 30_000;

export interface RosterDeps {
  history: History;
  serverIds(): Promise<string[]>;
  openMatch(serverId: string): Promise<{ id: number; startedAt: string } | null>;
  players(serverId: string): Promise<{ steamId: string; faction: string | null }[]>;
}

/** One look at every server; how many rosters it took. */
export async function rosterLook(deps: RosterDeps, now = Math.floor(Date.now() / 1000)): Promise<{ taken: number; errors: string[] }> {
  let taken = 0;
  const errors: string[] = [];
  for (const id of await deps.serverIds()) {
    try {
      const m = await deps.openMatch(id);
      if (!m) continue;
      const age = now - Date.parse(m.startedAt) / 1000;
      if (age < ROSTER_AFTER_S || age > ROSTER_LATE_S || deps.history.hasStartRoster(id, m.id)) continue;
      const on = (await deps.players(id)).filter((p): p is { steamId: string; faction: string } => !!p.faction);
      if (!on.length) continue;
      deps.history.addStartRoster(id, m.id, on, now);
      taken++;
    } catch (e) {
      errors.push(`${id.slice(0, 8)}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { taken, errors };
}

const g = globalThis as unknown as { __rosters?: ReturnType<typeof setInterval> };

export function startRosterCapture(deps: RosterDeps): void {
  if (g.__rosters) return;
  let running = false;
  g.__rosters = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await rosterLook(deps);
      jobRan('rosters', { error: r.errors.join('; ') || null, note: r.taken ? `took ${r.taken}` : null });
    } catch (e) {
      jobRan('rosters', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  }, LOOK_MS);
  g.__rosters.unref?.();
}
