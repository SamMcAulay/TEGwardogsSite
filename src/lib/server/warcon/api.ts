// One cached function per Warcon endpoint the site reads. Freshness per kind of data is
// spec §5.1; everything else about caching is TtlCache's.
import type { Cached, TtlCache } from './cache';
import type { Warcon } from './http';
import {
  analyticsBody, boardBody, careerBody, dossierBody, killsBody, liveBody, matchBody, matchListBody,
  seenBody, serversBody, steamProfilesBody,
  type WAnalytics, type WBoard, type WCareer, type WDossier, type WKills, type WLive, type WMatchList,
  type WMatchView, type WSeenPlayer, type WServer, type WSteamProfiles,
} from './schemas';

export const TTL = { live: 10_000, kills: 10_000, stats: 60_000, endedMatch: 3_600_000, steam: 86_400_000 } as const;

export type Range = '7d' | '30d' | '90d' | 'all';
export type Sort = 'kills' | 'deaths' | 'kd' | 'perHour' | 'playtime' | 'matches' | 'wins' | 'winRate' | 'cash';
export interface BoardQuery {
  scope: 'server' | 'org';
  range: Range;
  sort: Sort;
  dir?: 'asc' | 'desc';
  page?: number;
  minMinutes?: number;
}
export type KillKind = 'headshot' | 'teamKill' | 'suicide' | 'vehicle' | 'environment' | '';
export interface KillQuery {
  limit?: number;
  before?: { ts: string; eventTime: number } | null;
  match?: number | null;
  player?: string;
  killer?: string;
  victim?: string;
  cause?: string;
  kind?: KillKind;
  minM?: number | null;
  count?: boolean;
}

const enc = encodeURIComponent;
const qs = (params: Record<string, string | number | null | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${enc(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export function createApi(client: Warcon, cache: TtlCache) {
  const cached = <T>(path: string, ttl: number, load: () => Promise<T>): Promise<Cached<T>> => cache.get<T>(path, ttl, load);

  return {
    servers(): Promise<Cached<WServer[]>> {
      const path = '/api/servers';
      return cached(path, TTL.live, async () => (await client.json(path, serversBody)).servers);
    },

    live(serverId: string): Promise<Cached<WLive | null>> {
      const path = `/api/servers/${enc(serverId)}/summary`;
      return cached(path, TTL.live, async () => (await client.json(path, liveBody)).live);
    },

    board(serverId: string, q: BoardQuery): Promise<Cached<WBoard>> {
      const path = `/api/servers/${enc(serverId)}/leaderboard${qs({
        scope: q.scope, range: q.range, sort: q.sort, dir: q.dir ?? 'desc', page: q.page ?? 1, minMinutes: q.minMinutes ?? 60,
      })}`;
      return cached(path, TTL.stats, () => client.json(path, boardBody));
    },

    career(serverId: string, steamId: string): Promise<Cached<WCareer>> {
      const path = `/api/servers/${enc(serverId)}/players/${enc(steamId)}/career`;
      return cached(path, TTL.stats, async () => (await client.json(path, careerBody)).career);
    },

    dossier(serverId: string, steamId: string): Promise<Cached<WDossier>> {
      const path = `/api/servers/${enc(serverId)}/players/${enc(steamId)}`;
      return cached(path, TTL.stats, async () => (await client.json(path, dossierBody)).dossier);
    },

    matches(serverId: string, page = 1): Promise<Cached<WMatchList>> {
      const path = `/api/servers/${enc(serverId)}/matches${qs({ page })}`;
      return cached(path, TTL.stats, () => client.json(path, matchListBody));
    },

    match(serverId: string, matchId: number): Promise<Cached<WMatchView>> {
      const path = `/api/servers/${enc(serverId)}/matches/${matchId}`;
      // An ended match never changes; one still running is refreshed like a list.
      return cache.get<WMatchView>(path, (v) => (v.match.endedAt ? TTL.endedMatch : TTL.stats), () => client.json(path, matchBody));
    },

    kills(serverId: string, q: KillQuery): Promise<Cached<WKills>> {
      const path = `/api/servers/${enc(serverId)}/kills${qs({
        limit: q.limit ?? 50,
        before: q.before?.ts,
        beforeTime: q.before?.eventTime,
        match: q.match,
        player: q.player,
        killer: q.killer,
        victim: q.victim,
        cause: q.cause,
        kind: q.kind,
        minM: q.minM,
        count: q.count ? 1 : undefined,
      })}`;
      return cached(path, q.match ? TTL.stats : TTL.kills, () => client.json(path, killsBody));
    },

    analytics(serverId: string, range: '24h' | '7d' | '30d'): Promise<Cached<WAnalytics>> {
      const path = `/api/servers/${enc(serverId)}/analytics${qs({ range })}`;
      return cached(path, TTL.stats, () => client.json(path, analyticsBody));
    },

    seen(serverId: string, q: { limit?: number; sort?: 'lastSeen' } = {}): Promise<Cached<WSeenPlayer[]>> {
      const path = `/api/servers/${enc(serverId)}/players/seen${qs({ sort: q.sort ?? 'lastSeen', dir: 'desc', limit: q.limit ?? 30 })}`;
      return cached(path, TTL.stats, async () => (await client.json(path, seenBody)).players);
    },

    async steamProfiles(ids: string[]): Promise<WSteamProfiles> {
      const unique = [...new Set(ids)].filter((id) => /^\d{17}$/.test(id)).sort();
      const out: WSteamProfiles = {};
      for (let i = 0; i < unique.length; i += 100) {
        const batch = unique.slice(i, i + 100);
        const path = `/api/steam/profiles?ids=${batch.join(',')}`;
        try {
          Object.assign(out, (await cached(path, TTL.steam, () => client.json(path, steamProfilesBody))).value);
        } catch {
          // Avatars are decoration: no Steam key on the panel, or the limit hit, means badges.
        }
      }
      return out;
    },

    boardExportCsv(serverId: string): Promise<string> {
      return client.text(`/api/servers/${enc(serverId)}/leaderboard/export?scope=org&range=all&sort=playtime&dir=desc&minMinutes=0`);
    },
  };
}

export type WarconApi = ReturnType<typeof createApi>;
