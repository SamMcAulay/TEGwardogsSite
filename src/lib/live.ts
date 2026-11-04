// The Live page's server tabs: what each tab shows, which opens first, and a one-line headline per
// round. Client-safe (types only from the server side).
import { KOTH_CAP, mapName } from '@/lib/game';
import type { FriendStatus, ServerRow } from '@/lib/server/views';

export interface TabServer {
  id: string;
  shortName: string;
  slug: string;
  online: boolean | null;
  playerCount: number;
  maxPlayers: number | null;
  map: string | null;
  lighting: string | null;
  scores: { name: string; score: number }[];
  cap: number;
  /** seconds into the current round, when the server says */
  roundSeconds: number | null;
  topKillers: { name: string; steamId: string; faction: string; kills: number }[];
}

export function toTabServer(s: ServerRow): TabServer {
  const st = s.status;
  return {
    id: s.id,
    shortName: s.shortName,
    slug: s.slug,
    online: s.online,
    playerCount: s.playerCount,
    maxPlayers: st?.players.max ?? null,
    map: st ? mapName(st.map) : null,
    lighting: st?.lighting ?? null,
    scores: st?.factionScores.map((f) => ({ name: f.name, score: f.score })) ?? [],
    cap: st?.scoreCap ?? KOTH_CAP,
    roundSeconds: st?.matchSeconds ?? null,
    topKillers: [...s.players]
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 3)
      .map((p) => ({ name: p.name, steamId: p.steamId, faction: p.faction, kills: p.kills })),
  };
}

export const isLive = (s: TabServer) => s.online === true && s.scores.length > 0;

/** The live server with the most players, or null when none is live. */
export function defaultOpenServer(servers: TabServer[]): string | null {
  return servers.filter(isLive).sort((a, b) => b.playerCount - a.playerCount)[0]?.id ?? null;
}

/** Keeps the viewer's open tab across refreshes while that server stays live. */
export function keepOpen(prev: string | null, servers: TabServer[]): string | null {
  return servers.some((s) => s.id === prev && isLive(s)) ? prev : defaultOpenServer(servers);
}

/** One short factual line about where a round stands. */
export function roundHeadline(s: { map: string | null; scores: { name: string; score: number }[]; cap: number }): string {
  const [a, b, c] = [...s.scores].sort((x, y) => y.score - x.score);
  if (!a || a.score <= 0) return `Round just started on ${s.map ?? 'the map'}.`;
  if (a.score >= s.cap) return `${a.name} have taken it.`;
  if (b && c && a.score - c.score <= 8) return `Dead even on ${s.map ?? 'the map'}.`;
  if (b && a.score - b.score <= 3) return `${a.name} and ${b.name}, neck and neck.`;
  const left = s.cap - a.score;
  if (left <= 20) return `${a.name} are ${left} point${left === 1 ? '' : 's'} from taking it.`;
  if (b && a.score - b.score >= 25) return `${a.name} are running away with it.`;
  return `${a.name} lead ${[a, b, c].filter(Boolean).map((x) => x!.score).join('–')}.`;
}

export function killerLine(top: { name: string; kills: number } | undefined): string | null {
  return top && top.kills >= 10 ? `${top.name} has ${top.kills} kills.` : null;
}

/** Friends by the server they're on. `online` is already null for anyone hiding where they play. */
export function friendsByServer(friends: FriendStatus[]): Record<string, { steamId: string; name: string }[]> {
  const out: Record<string, { steamId: string; name: string }[]> = {};
  for (const f of friends) {
    if (!f.online || !f.name) continue;
    (out[f.online.serverId] ??= []).push({ steamId: f.steamId, name: f.name });
  }
  return out;
}
