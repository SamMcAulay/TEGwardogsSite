// Who may use /admin: a signed-in member whose linked account's roles, checked with Discord right
// now, make them staff (tier 1). Everyone else, including when Discord can't answer, is turned away.
import { accounts, currentSession, type Accounts } from '.';
import type { AccountsEnv } from './env';
import type { Session } from './session';
import type { Store } from './store';
import { refreshTier } from './sync';

/** Staff now, by a live Discord check; also stores the fresh tier. Fails closed. */
export async function isStaffNow(env: AccountsEnv, store: Store, discordId: string, f: typeof fetch = fetch): Promise<boolean> {
  if (!store.byDiscord(discordId)) return false; // only linked accounts
  try {
    return (await refreshTier(env, store, discordId, f)) === 1;
  } catch (e) {
    console.error('[admin] role check failed, denying:', e instanceof Error ? e.message : e);
    return false;
  }
}

/** The signed-in staff member and the accounts store, or null for anyone else. */
export async function currentAdmin(): Promise<{ a: Accounts; admin: Session } | null> {
  let a: Accounts | null;
  try {
    a = accounts();
  } catch {
    return null;
  }
  if (!a) return null;
  const admin = await currentSession(a);
  if (!admin) return null;
  return (await isStaffNow(a.env, a.store, admin.discordId)) ? { a, admin } : null;
}

/** What staff typed into the search box: a SteamID64, a Discord id, or a profile URL holding one. */
export function parseLookup(q: string): { steamId: string } | { discordId: string } | null {
  const s = q.trim();
  const profile = /\/players\/(\d{17})\b/.exec(s) ?? /steamcommunity\.com\/profiles\/(\d{17})\b/.exec(s);
  if (profile) return { steamId: profile[1] };
  const discordUrl = /discord(?:app)?\.com\/users\/(\d{17,20})\b/.exec(s);
  if (discordUrl) return { discordId: discordUrl[1] };
  if (/^7656119\d{10}$/.test(s)) return { steamId: s };
  if (/^\d{17,20}$/.test(s)) return { discordId: s };
  return null;
}
