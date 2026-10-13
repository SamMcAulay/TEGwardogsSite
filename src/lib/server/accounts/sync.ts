// Keeps each link's tier in step with the member's Discord roles, so a lapsed Premium or a
// departed moderator loses their badge and priority within one sweep.
import { tierFor, type Tier } from '@/lib/tiers';
import { DiscordError, member } from './discord';
import type { AccountsEnv } from './env';
import type { Store } from './store';

/** How old a tier may get before a sweep asks Discord again */
export const TIER_MAX_AGE = 10 * 60;
const PER_SWEEP = 200;

/**
 * Ask Discord for the member's roles and store the tier, and their current name for /admin.
 * Leaves both as they were when Discord can't answer.
 */
export async function refreshTier(env: AccountsEnv, store: Store, discordId: string, f: typeof fetch = fetch): Promise<Tier | null> {
  const m = await member(env, discordId, f);
  const tier = m ? tierFor(m.roles, env.roles) : null;
  store.setTier(discordId, tier, undefined, m?.name ?? null);
  return tier;
}

/** Refresh every stale link, one at a time; stops early on a rate limit or outage. */
export async function sweep(env: AccountsEnv, store: Store, f: typeof fetch = fetch, nowSec = Math.floor(Date.now() / 1000)): Promise<{ checked: number; error?: string }> {
  let checked = 0;
  for (const link of store.due(nowSec - TIER_MAX_AGE, PER_SWEEP)) {
    try {
      await refreshTier(env, store, link.discordId, f);
      checked++;
    } catch (e) {
      // The next sweep picks up where this one stopped.
      return { checked, error: e instanceof DiscordError ? e.message : String(e) };
    }
  }
  return { checked };
}

const g = globalThis as unknown as { __tierSync?: ReturnType<typeof setInterval> };

export function startTierSync(env: AccountsEnv, store: Store, intervalMs = 2 * 60_000): void {
  if (g.__tierSync) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await sweep(env, store);
      if (r.error) console.error(`[accounts] tier sync stopped after ${r.checked}: ${r.error}`);
    } finally {
      running = false;
    }
  };
  void run();
  g.__tierSync = setInterval(() => void run(), intervalMs);
  g.__tierSync.unref?.();
}
