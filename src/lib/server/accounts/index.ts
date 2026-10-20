// What pages and routes use: is linking on, who is signed in, and a player's tier.
import { cookies } from 'next/headers';
import { siteEnv } from '@/lib/server/warcon/env';
import { nameStyleFor, type NameStyle } from '@/lib/name-styles';
import { canCustomise, FEATURED_MAX, isProfileColour, type ProfileCustom } from '@/lib/profile-themes';
import type { Tier } from '@/lib/tiers';
import { accountsEnv, type AccountsEnv } from './env';
import { readSession, SESSION_COOKIE, type Session } from './session';
import { store, type Relation, type Store } from './store';

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

/**
 * Who is looking: the signed-in member's Discord id and, once linked, their Steam id. Null when
 * signed out or linking is off. Never throws: the header and boards just don't personalise.
 */
export async function viewer(): Promise<{ discordId: string; steamId: string | null } | null> {
  try {
    const a = accounts();
    if (!a) return null;
    const s = await currentSession(a);
    if (!s) return null;
    return { discordId: s.discordId, steamId: a.store.byDiscord(s.discordId)?.steamId ?? null };
  } catch (e) {
    console.error('[accounts] viewer lookup failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Steam accounts whose members hide where they're playing (lib/server/presence.ts); empty when linking is off. Never throws. */
export function presenceHidden(): ReadonlySet<string> {
  try {
    return accounts()?.store.presenceHidden() ?? new Set();
  } catch (e) {
    console.error('[accounts] hidden list failed:', e instanceof Error ? e.message : e);
    return new Set();
  }
}

/**
 * Where `viewer` stands with the linked player on `steamId`, for their profile: whether that
 * player is linked (and so can be friended), how they stand, and whether the viewer may see where
 * they're playing (not hidden, or it's the viewer themself, or they're friends). Never throws.
 */
export function standing(steamId: string, viewer: { discordId: string; steamId: string | null } | null): { linked: boolean; relation: Relation | 'self'; seesPresence: boolean } {
  try {
    const store = accounts()?.store;
    const them = store?.bySteam(steamId);
    if (!store || !them) return { linked: false, relation: 'none', seesPresence: true };
    if (viewer?.discordId === them.discordId) return { linked: true, relation: 'self', seesPresence: true };
    const relation = viewer?.steamId ? store.relation(viewer.discordId, them.discordId) : 'none';
    return { linked: true, relation, seesPresence: !them.hidePresence || relation === 'friends' };
  } catch (e) {
    console.error('[accounts] standing failed:', e instanceof Error ? e.message : e);
    // Fail closed for a hidden player: show nothing about where they are.
    return { linked: false, relation: 'none', seesPresence: false };
  }
}

export const secureCookies = () => siteEnv().siteUrl.startsWith('https://');
export const callbackUrl = (provider: 'discord' | 'steam') => `${siteEnv().siteUrl}/auth/${provider}/callback`;
