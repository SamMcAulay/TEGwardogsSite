// The team balancer job (staff /admin/teambalance). Staff arm it on a server; it waits for the next
// match to start, then, DEAL_AFTER_S in once players have loaded, deals everyone on out afresh by
// skill (plan.ts redeal), then places each player who arrives as they come in. Everyone it weighs up
// is held to the side they end on (balance_sides): switch and they are moved back, every time, staff
// excepted. It stops when that match ends. Watch mode decides and logs every move but sends none.
import { clanTag } from '@/lib/clans';
import { fresh } from '@/lib/rating';
import type { Store } from '../accounts/store';
import type { PlayerRating } from '../history/ratings';
import { jobRan } from '../jobs';
import { planMoves, redeal, type LivePlayer } from './plan';

export const LOOK_MS = 10_000;
/** Joiners placed per look at most. The start's re-deal goes out whole. */
export const MAX_MOVES_PER_LOOK = 6;
/** The start's re-deal waits this long into the match: at the start most players are still loading in. */
export const DEAL_AFTER_S = 90;
/** Gap between moves: Warcon allows a key 120 actions a minute, and a move with its whisper is two. */
const SEND_GAP_MS = 1000;
/** An armed run that never sees a new match is dropped after this long. */
export const ARM_MAX_S = 3 * 3600;
/** A running run that never sees its match end stops after this long. */
export const RUN_MAX_S = 2 * 3600;
/** A player is left this long after the balancer places or moves them before a switch counts: the game takes a moment. */
export const HOLD_GRACE_S = 30;
export const HOLD_MESSAGE = 'Teams are locked this match to keep it balanced: you were moved back to {team}.';
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

const g = globalThis as unknown as { __balancer?: ReturnType<typeof setInterval> };

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
      match = live.startedAt;
      run.startedAt = now;
    }
    if (!live) continue;
    if (live.startedAt !== match) {
      deps.store.endBalanceRun(run.id, 'done', 'The match ended.', now);
      continue;
    }
    if (now - (run.startedAt ?? now) > RUN_MAX_S) {
      deps.store.endBalanceRun(run.id, 'done', 'Stopped after 2 hours.', now);
      continue;
    }

    const sides = new Map(deps.store.balanceSides(run.id).map((x) => [x.steamId, x]));
    // A run from before sides were recorded counts its moves as weighed up too.
    const moved = new Set(deps.store.balanceMoves(run.id).map((m) => m.steamId));
    const kind = sides.size || moved.size ? 'join' : 'start';
    if (kind === 'start' && live.startedAt && now - Date.parse(live.startedAt) / 1000 < DEAL_AFTER_S) continue;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    // Hold: anyone who switched off the side they were given goes back, every time; staff may switch.
    const holds = live.players.filter((p) => {
      const side = sides.get(p.steamId);
      return side && p.faction && live.factions.includes(p.faction) && p.faction !== side.faction && now - side.at >= HOLD_GRACE_S && deps.store.bySteam(p.steamId)?.tier !== 1;
    });
    for (const p of holds) {
      const to = sides.get(p.steamId)!.faction;
      deps.store.holdBalanceSide(run.id, p.steamId, now);
      if (run.mode !== 'live' || !deps.act) {
        // Watch-only moves nobody: count each switch once by following them to where they went.
        deps.store.setBalanceSide(run.id, p.steamId, p.name, p.faction!, now);
        continue;
      }
      try {
        await deps.act(run.serverId, 'changeTeam', { steamId: p.steamId, faction: to });
        await deps.act(run.serverId, 'whisper', { steamId: p.steamId, message: HOLD_MESSAGE.replaceAll('{team}', to) }).catch(() => {});
      } catch {
        // tried again on a later look
      }
      await sleep(SEND_GAP_MS);
    }
    // Weigh everyone else up as if the held players are already back.
    const players = live.players.map((p) => (holds.includes(p) && run.mode === 'live' ? { ...p, faction: sides.get(p.steamId)!.faction } : p));

    const candidates = new Set(players.filter((p) => p.faction && live.factions.includes(p.faction) && !moved.has(p.steamId) && !sides.has(p.steamId)).map((p) => p.steamId));
    if (holds.length) notes.push(`run ${run.id}: ${holds.length} ${run.mode === 'live' ? 'held' : 'would hold'}`);
    if (!candidates.size) continue;
    const ratings = deps.ratings();
    const skillOf = (id: string) => ratings?.get(id)?.skill ?? fresh();
    const clanOf = (id: string) => {
      const name = players.find((p) => p.steamId === id)?.name;
      return name ? clanTag(name) : null;
    };
    const moves =
      kind === 'start'
        ? redeal({ players, factions: live.factions, skillOf, clanOf })
        : planMoves({ players, factions: live.factions, candidates, skillOf, clanOf, max: MAX_MOVES_PER_LOOK });
    // Everyone weighed up is held to the side they end on. A full look of joiners leaves the rest
    // to be weighed again next time, with these moves in place.
    if (kind === 'start' || moves.length < MAX_MOVES_PER_LOOK) {
      // watch-only moves nobody, so they are held where they really are
      const to = new Map(run.mode === 'live' ? moves.map((m) => [m.steamId, m.to]) : []);
      for (const p of players) if (candidates.has(p.steamId)) deps.store.setBalanceSide(run.id, p.steamId, p.name, to.get(p.steamId) ?? p.faction!, now);
    } else for (const m of moves) deps.store.setBalanceSide(run.id, m.steamId, m.name, run.mode === 'live' ? m.to : m.from, now);

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
      await sleep(SEND_GAP_MS);
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
