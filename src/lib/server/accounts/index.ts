// What pages and routes use: is linking on, who is signed in, and a player's tier.
import { cookies } from 'next/headers';
import { siteEnv } from '@/lib/server/warcon/env';
import { nameStyleFor, type NameStyle } from '@/lib/name-styles';
import type { Tier } from '@/lib/tiers';
import { accountsEnv, type AccountsEnv } from './env';
import { readSession, SESSION_COOKIE, type Session } from './session';
import { store, type Store } from './store';

export interface Accounts {
  env: AccountsEnv;
  store: Store;
}

/** null when account linking isn't configured. */
export function accounts(): Accounts | null {
  const env = accountsEnv();
  return env ? { env, store: store(env.dataDir) } : null;
}

export async function currentSession(a: Accounts): Promise<Session | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value, a.env.sessionSecret);
}

/** A Steam account's tier and the name style it's drawn in; null when unlinked or untiered. Never throws. */
export function lookOfSteam(steamId: string): { tier: Tier; nameStyle: NameStyle } | null {
  try {
    const link = accounts()?.store.bySteam(steamId);
    if (!link?.tier) return null;
    return { tier: link.tier, nameStyle: nameStyleFor(link.tier, link.nameStyle)! };
  } catch (e) {
    console.error('[accounts] look lookup failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Every linked Steam account; null when linking isn't configured or the store can't be read. */
export function linkedSteamIds(): Set<string> | null {
  try {
    return accounts()?.store.linkedSteamIds() ?? null;
  } catch (e) {
    console.error('[accounts] linked list failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export const secureCookies = () => siteEnv().siteUrl.startsWith('https://');
export const callbackUrl = (provider: 'discord' | 'steam') => `${siteEnv().siteUrl}/auth/${provider}/callback`;
