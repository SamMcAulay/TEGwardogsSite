// The weighted map rotation job (staff /admin/rotation). On each server staff switched it on for,
// every new match: the entry that loaded scores its step, the plan of the next AHEAD maps is moved
// on one (or made afresh when the server loaded something else) and topped up (./pool.ts), and its
// first map is written into the server's rotation as [pick, pick], so whichever slot the server goes
// to next, or starts on after a restart, is the pick. A write that fails is tried again at the next look, and a server that loads something
// other than the pick is noted for staff.
import type { Store } from '../accounts/store';
import { jobRan } from '../jobs';
import type { RotationConfig } from '../warcon/rotation-config';
import { configEntry, entryOf, plan, scoresOf, START, STEP } from './pool';

export const LOOK_MS = 15_000;

export interface OpenMatch {
  startedAt: string;
  map: string | null;
  lighting: string | null;
}

export interface RotationDeps {
  store: Store;
  /** the match being played, as it opened; null between matches */
  openMatch(serverId: string): Promise<OpenMatch | null>;
  config: RotationConfig;
  random?: () => number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** One look at every server it is switched on for. Returns notes for the health page, and errors. */
export async function rotationLook(deps: RotationDeps): Promise<{ notes: string[]; errors: string[] }> {
  const notes: string[] = [];
  const errors: string[] = [];
  for (const s of deps.store.rotationServers()) {
    if (!s.enabled) continue;
    const id = s.serverId;
    try {
      const open = await deps.openMatch(id);
      if (!open) continue;
      const write = async (key: string) => {
        // Switched off since this look began: its old rotation is going back, so leave it be.
        if (!deps.store.rotationServer(id)?.enabled) throw new Error('switched off');
        const e = entryOf(...(key.split('/') as [string, string]))!;
        await deps.config.write(id, [configEntry(e), configEntry(e)]);
      };

      if (open.startedAt === s.match) {
        // The same match: only a pick that didn't reach the server needs anything.
        if (s.written || !s.nextKey) continue;
        await write(s.nextKey);
        deps.store.setRotationPick(id, { match: open.startedAt, nextKey: s.nextKey, later: s.later, written: true, note: null });
        notes.push(`${id.slice(0, 8)}: set ${s.nextKey} next on a retry`);
        continue;
      }

      // A new match.
      const on = entryOf(open.map, open.lighting);
      if (on) deps.store.addRotationScore(id, on.key, START[on.kind], STEP[on.kind]);
      const loaded = `${open.map ?? 'unknown'}/${open.lighting ?? 'unknown'}`;
      const missed = s.match && s.nextKey && on?.key !== s.nextKey ? `Picked ${s.nextKey}, but the server loaded ${loaded}. ` : '';
      // What was planned after the pick still stands only if the pick is what loaded.
      const kept = on && on.key === s.nextKey ? s.later : [];
      const [nextKey, ...later] = plan(scoresOf(deps.store.rotationScores(id)), on?.map ?? open.map, kept, deps.random);
      try {
        await write(nextKey);
        deps.store.setRotationPick(id, { match: open.startedAt, nextKey, later, written: true, note: missed || null });
        notes.push(`${id.slice(0, 8)}: ${loaded} on, ${nextKey} next`);
      } catch (e) {
        deps.store.setRotationPick(id, { match: open.startedAt, nextKey, later, written: false, note: `${missed}Couldn't set ${nextKey} next: ${errText(e)}` });
        throw e;
      }
      if (missed) errors.push(`${id.slice(0, 8)}: ${missed.trim()}`);
    } catch (e) {
      errors.push(`${id.slice(0, 8)}: ${errText(e)}`);
    }
  }
  return { notes, errors };
}

const g = globalThis as unknown as { __rotation?: ReturnType<typeof setInterval> };

/** Starts the job (once per process). Idle, it only reads the rotation table. */
export function startWeightedRotation(deps: RotationDeps): void {
  if (g.__rotation) return;
  let running = false;
  g.__rotation = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { notes, errors } = await rotationLook(deps);
      if (notes.length || errors.length) console.log(`[rotation] ${[...notes, ...errors].join('; ')}`);
      jobRan('mapRotation', { error: errors.join('; ') || null, note: notes.join('; ') || null });
    } catch (e) {
      jobRan('mapRotation', { error: errText(e) });
    } finally {
      running = false;
    }
  }, LOOK_MS);
  g.__rotation.unref?.();
}
