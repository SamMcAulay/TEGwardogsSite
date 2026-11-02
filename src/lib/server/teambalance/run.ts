// The team balancer job (staff /admin/teambalance). Staff arm it on a server; it waits for the next
// match to start, then evens the sides by skill: one sort of who is on at the start, then each
// player who arrives is placed as they come in. Nobody is moved twice in a game (balance_moves'
// key), and it stops when that match ends. Watch mode decides and logs every move but sends none.
import { clanTag } from '@/lib/clans';
import { fresh } from '@/lib/rating';
import type { Store } from '../accounts/store';
import type { PlayerRating } from '../history/ratings';
import { jobRan } from '../jobs';
import { planMoves, type LivePlayer } from './plan';

export const LOOK_MS = 10_000;
/** Moves sent per look at most, so a full server's start sort goes out over a few looks. */
export const MAX_MOVES_PER_LOOK = 6;
/** Gap between moves sent to Warcon, under its per-key rate limit. */
const SEND_GAP_MS = 400;
/** An armed run that never sees a new match is dropped after this long. */
export const ARM_MAX_S = 3 * 3600;
/** A running run that never sees its match end stops after this long. */
export const RUN_MAX_S = 2 * 3600;
export const DEFAULT_MESSAGE = 'You were moved to {team} to balance the teams. Good luck!';

export interface LiveRound {
  /** Warcon's start time for the match on now; a new value is a new match */
  startedAt: string | null;
  factions: string[];
  players: LivePlayer[];
}

export interface BalancerDeps {
  store: Store;
  live(serverId: string): Promise<LiveRound | null>;
  ratings(): Map<string, PlayerRating> | null;
  /** sends a Warcon action; null when no key with move rights is set, so only watch runs work */
  act: ((serverId: string, action: 'changeTeam' | 'whisper', body: Record<string, unknown>) => Promise<void>) | null;
  sleep?: (ms: number) => Promise<void>;
}

const g = globalThis as unknown as { __balancer?: ReturnType<typeof setInterval>; __balancerSeen?: Map<number, Set<string>> };
// Who each run has already weighed up. shortcut: kept in memory, so after a restart mid-match
// everyone on is weighed once more (still never moved twice); persist it if restarts mid-match matter.
const seenOf = (runId: number) => {
  const m = (g.__balancerSeen ??= new Map());
  let s = m.get(runId);
  if (!s) m.set(runId, (s = new Set()));
  return s;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** One look at every armed or running run. Returns a note for the health page. */
export async function balancerLook(deps: BalancerDeps, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const notes: string[] = [];
  for (const run of deps.store.activeBalanceRuns()) {
    let live: LiveRound | null;
    try {
      live = await deps.live(run.serverId);
    } catch (e) {
      notes.push(`run ${run.id}: ${errText(e)}`);
      continue;
    }
    let match = run.match;
    if (run.status === 'armed') {
      if (now - run.armedAt > ARM_MAX_S) {
        deps.store.endBalanceRun(run.id, 'cancelled', 'No new match started within 3 hours.', now);
        continue;
      }
      // Only a match that began after it was armed: never one already being played.
      if (!live?.startedAt || Date.parse(live.startedAt) / 1000 < run.armedAt) continue;
      if (run.mode === 'live' && !deps.act) {
        deps.store.endBalanceRun(run.id, 'cancelled', 'No Warcon key with move rights is set (WARCON_MOVE_TOKEN).', now);
        continue;
      }
      deps.store.startBalanceRun(run.id, live.startedAt, now);
      g.__balancerSeen?.delete(run.id);
      match = live.startedAt;
      run.startedAt = now;
    }
    if (!live) continue;
    if (live.startedAt !== match) {
      deps.store.endBalanceRun(run.id, 'done', 'The match ended.', now);
      g.__balancerSeen?.delete(run.id);
      continue;
    }
    if (now - (run.startedAt ?? now) > RUN_MAX_S) {
      deps.store.endBalanceRun(run.id, 'done', 'Stopped after 2 hours.', now);
      continue;
    }

    const moved = new Set(deps.store.balanceMoves(run.id).map((m) => m.steamId));
    const seen = seenOf(run.id);
    const kind = seen.size || moved.size ? 'join' : 'start';
    const candidates = new Set(live.players.filter((p) => p.faction && !moved.has(p.steamId) && !seen.has(p.steamId)).map((p) => p.steamId));
    if (!candidates.size) continue;
    const ratings = deps.ratings();
    const moves = planMoves({
      players: live.players,
      factions: live.factions,
      candidates,
      skillOf: (id) => ratings?.get(id)?.skill ?? fresh(),
      clanOf: (id) => {
        const name = live.players.find((p) => p.steamId === id)?.name;
        return name ? clanTag(name) : null;
      },
      max: MAX_MOVES_PER_LOOK,
    });
    // A full look leaves the rest to be weighed again next time, with these moves in place.
    if (moves.length < MAX_MOVES_PER_LOOK) for (const id of candidates) seen.add(id);

    for (const m of moves) {
      if (!deps.store.addBalanceMove(run.id, { ...m, kind }, now)) continue;
      if (run.mode !== 'live' || !deps.act) continue;
      try {
        await deps.act(run.serverId, 'changeTeam', { steamId: m.steamId, faction: m.to });
        deps.store.setBalanceMoveResult(run.id, m.steamId, true, null);
      } catch (e) {
        deps.store.setBalanceMoveResult(run.id, m.steamId, false, errText(e));
        continue;
      }
      if (run.message) {
        // A whisper that fails doesn't undo the move.
        await deps.act(run.serverId, 'whisper', { steamId: m.steamId, message: run.message.replaceAll('{team}', m.to) }).catch(() => {});
      }
      await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(SEND_GAP_MS);
    }
    if (moves.length) notes.push(`run ${run.id}: ${moves.length} ${run.mode === 'live' ? 'moved' : 'would move'}`);
  }
  return notes.join('; ');
}

/** Starts the balancer job (once per process). Idle, it only reads the runs table. */
export function startTeamBalancer(deps: BalancerDeps): void {
  if (g.__balancer) return;
  let running = false;
  g.__balancer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const note = await balancerLook(deps);
      jobRan('teamBalance', { note: note || null });
    } catch (e) {
      jobRan('teamBalance', { error: errText(e) });
    } finally {
      running = false;
    }
  }, LOOK_MS);
  g.__balancer.unref?.();
}
