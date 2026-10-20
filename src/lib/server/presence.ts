// "Hide where I'm playing": linked members who switch it on show as "Hidden player" wherever the
// site would say which server they're on now or were on lately (live scoreboards, kill feeds, the
// players of current and recent rounds). Accepted friends still see them, on /friends and their
// profile. Older history and stats are left alone: by then where they played doesn't find them.
import type { KillRow, LivePlayer, MatchAward, MatchPlayerRow } from './views';

/** A round or kill is "recent" for this long after it ends; until then hidden members are masked. */
export const RECENT_S = 3 * 3600;
export const HIDDEN_NAME = 'Hidden player';

/** A live scoreboard row with no name or link. */
export const maskLive = (p: LivePlayer, hidden: ReadonlySet<string>): LivePlayer =>
  hidden.has(p.steamId) ? { ...p, name: HIDDEN_NAME, steamId: '' } : p;

/** A kill with the hidden members on either side unnamed, when it's recent. */
export function maskKill(k: KillRow, hidden: ReadonlySet<string>, now: number): KillRow {
  if (now - k.ts > RECENT_S) return k;
  const killer = !!k.killerSteamId && hidden.has(k.killerSteamId);
  const victim = !!k.victimSteamId && hidden.has(k.victimSteamId);
  if (!killer && !victim) return k;
  return {
    ...k,
    ...(killer ? { killerSteamId: null, killerName: HIDDEN_NAME } : {}),
    ...(victim ? { victimSteamId: null, victimName: HIDDEN_NAME } : {}),
  };
}

/** A round is recent while it runs and for RECENT_S after it ends. */
export const recentRound = (endedAt: number | null, now: number) => endedAt === null || now - endedAt <= RECENT_S;

export const maskLine = (l: MatchPlayerRow, hidden: ReadonlySet<string>): MatchPlayerRow =>
  hidden.has(l.steamId) ? { ...l, steamId: '', name: HIDDEN_NAME } : l;

export const maskAward = (a: MatchAward, hidden: ReadonlySet<string>): MatchAward =>
  hidden.has(a.steamId) ? { ...a, steamId: '', name: HIDDEN_NAME } : a;

/**
 * A hidden member's profile as everyone but themselves and their friends see it: not where they
 * are, not when they were last seen, and no rounds or kills from the last RECENT_S.
 */
export function withoutPresence<P extends { onlineOn: unknown; lastSeen: number | null; matches: { startedAt: number; endedAt: number | null }[]; recentKills: KillRow[] }>(
  p: P,
  now: number,
): P {
  return {
    ...p,
    onlineOn: null,
    lastSeen: null,
    matches: p.matches.filter((m) => m.endedAt !== null && now - m.endedAt > RECENT_S),
    recentKills: p.recentKills.filter((k) => now - k.ts > RECENT_S),
  };
}
