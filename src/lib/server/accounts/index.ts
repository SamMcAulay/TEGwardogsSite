// What pages and routes use: is linking on, who is signed in, and a player's tier.
import { cookies } from 'next/headers';
import { siteEnv } from '@/lib/server/warcon/env';
import { nameStyleFor, type NameStyle } from '@/lib/name-styles';
import { canCustomise, FEATURED_MAX, isProfileColour, type ProfileCustom } from '@/lib/profile-themes';
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

export interface Look {
  tier: Tier;
  nameStyle: NameStyle;
  /** their custom profile, while they're Premium or staff; null otherwise or when it's all unset */
  custom: ProfileCustom | null;
}

/** What a linked member's profile shows: the custom fields only while they may customise. */
export function customOf(link: { tier: Tier | null; bio: string | null; colour: string | null; featured: string[] }): ProfileCustom | null {
  if (!canCustomise(link.tier)) return null;
  const custom = {
    bio: link.bio,
    colour: isProfileColour(link.colour) ? link.colour : null,
    featured: link.featured.slice(0, FEATURED_MAX),
  };
  return custom.bio || custom.colour || custom.featured.length ? custom : null;
}

/** A Steam account's tier, name style and custom profile; null when unlinked or untiered. Never throws. */
export function lookOfSteam(steamId: string): Look | null {
  try {
    const link = accounts()?.store.bySteam(steamId);
    if (!link?.tier) return null;
    return { tier: link.tier, nameStyle: nameStyleFor(link.tier, link.nameStyle)!, custom: customOf(link) };
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
