// One cached function per Warcon endpoint the site reads. Freshness per kind of data is
// spec §5.1; everything else about caching is TtlCache's.
import { TtlCache, type Cached } from './cache';
import type { Warcon } from './http';
import { parseBoardExport } from './board-csv';
import {
  analyticsBody, bannedBody, boardBody, careerBody, dossierBody, killsBody, liveBody, matchBody, matchListBody,
  seenBody, serversBody, steamProfilesBody,
  type WAnalytics, type WBannedPage, type WBoard, type WBoardRow, type WCareer, type WDossier, type WKills, type WLive, type WMatchList,
  type WMatchView, type WSeenPlayer, type WServer, type WSteamProfiles,
} from './schemas';

export const TTL = { live: 10_000, kills: 10_000, stats: 300_000, endedMatch: 3_600_000, steam: 86_400_000, bans: 600_000 } as const;

/**
 * How long past freshness the last copy is still served at once while a fresh one loads in the
 * background. Boards, careers and analytics barely move in half an hour; live status and the kill
 * feed are never more than one extra refresh behind.
 */
export const SERVE_STALE = { live: 20_000, kills: 20_000, stats: 1_800_000, bans: 1_800_000 } as const;

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

/** steamCache holds one entry per Steam ID, apart from the main cache so avatars don't evict it. */
/**
 * A player's record and career are Warcon's slowest answers (~5 s even when quiet), so they get
 * longer than the client's default 8 s before the page gives up on them.
 */
export const PLAYER_TIMEOUT_MS = 20_000;

/** Whole boards are up to 10,000 rows each: keep only this many (least recently used dropped). */
export const EXPORT_CACHE_ENTRIES = 40;

export function createApi(
  client: Warcon,
  cache: TtlCache,
  steamCache = new TtlCache({ maxEntries: 5000 }),
  exportCache = new TtlCache({ maxEntries: EXPORT_CACHE_ENTRIES }),
) {
  const serveStaleFor = (ttl: number) =>
    ttl === TTL.live || ttl === TTL.kills ? SERVE_STALE.live : ttl === TTL.bans ? SERVE_STALE.bans : ttl === TTL.stats ? SERVE_STALE.stats : 0;
  const cached = <T>(path: string, ttl: number, load: () => Promise<T>): Promise<Cached<T>> =>
    cache.get<T>(path, ttl, load, { serveStaleMs: serveStaleFor(ttl) });
  // After a failed profiles call (often: no Steam key on the panel) skip asking for a while.
  let steamFailedAt = -Infinity;

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

    /**
     * The whole board (up to 10,000 rows, Warcon's export) for one scope, period and sort: about the
     * cost of a single 50-row page, and every page then comes from it. Warcon allows 10 exports a
     * minute per key; callers fall back to board pages when this fails.
     */
    boardExport(serverId: string, q: { scope: 'server' | 'org'; range: Range; sort: Sort }): Promise<Cached<WBoardRow[]>> {
      const path = `/api/servers/${enc(serverId)}/leaderboard/export${qs({ scope: q.scope, range: q.range, sort: q.sort, dir: 'desc', minMinutes: 60 })}`;
      return exportCache.get(path, TTL.stats, async () => parseBoardExport(await client.text(path)), { serveStaleMs: SERVE_STALE.stats });
    },

    career(serverId: string, steamId: string): Promise<Cached<WCareer>> {
      const path = `/api/servers/${enc(serverId)}/players/${enc(steamId)}/career`;
      return cached(path, TTL.stats, async () => (await client.json(path, careerBody, { timeoutMs: PLAYER_TIMEOUT_MS })).career);
    },

    dossier(serverId: string, steamId: string): Promise<Cached<WDossier>> {
      const path = `/api/servers/${enc(serverId)}/players/${enc(steamId)}`;
      return cached(path, TTL.stats, async () => (await client.json(path, dossierBody, { timeoutMs: PLAYER_TIMEOUT_MS })).dossier);
    },

    matches(serverId: string, page = 1): Promise<Cached<WMatchList>> {
      const path = `/api/servers/${enc(serverId)}/matches${qs({ page })}`;
      return cached(path, TTL.stats, () => client.json(path, matchListBody));
    },

    match(serverId: string, matchId: number): Promise<Cached<WMatchView>> {
      const path = `/api/servers/${enc(serverId)}/matches/${matchId}`;
      // An ended match never changes; one still running is refreshed like a list.
      return cache.get<WMatchView>(path, (v) => (v.match.endedAt ? TTL.endedMatch : TTL.stats), () => client.json(path, matchBody), { serveStaleMs: SERVE_STALE.stats });
    },

    /** TTL: opts.ttl when given; counts and one match's kills use the stats TTL; else the feed's. */
    kills(serverId: string, q: KillQuery, opts: { ttl?: number } = {}): Promise<Cached<WKills>> {
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
      return cached(path, opts.ttl ?? (q.match || q.count ? TTL.stats : TTL.kills), () => client.json(path, killsBody));
    },

    analytics(serverId: string, range: '24h' | '7d' | '30d'): Promise<Cached<WAnalytics>> {
      const path = `/api/servers/${enc(serverId)}/analytics${qs({ range })}`;
      return cached(path, TTL.stats, () => client.json(path, analyticsBody));
    },

    seen(serverId: string, q: { limit?: number; sort?: 'lastSeen' } = {}): Promise<Cached<WSeenPlayer[]>> {
      const path = `/api/servers/${enc(serverId)}/players/seen${qs({ sort: q.sort ?? 'lastSeen', dir: 'desc', limit: q.limit ?? 30 })}`;
      return cached(path, TTL.stats, async () => (await client.json(path, seenBody)).players);
    },

    /** One page (100) of the players on this server who are banned, org list or the server's own. */
    bannedPage(serverId: string, offset: number): Promise<Cached<WBannedPage>> {
      const path = `/api/servers/${enc(serverId)}/players/seen${qs({ flag: 'banned', sort: 'lastSeen', dir: 'desc', limit: 100, offset })}`;
      return cached(path, TTL.bans, async () => {
        const { players, total } = await client.json(path, bannedBody);
        return { players, total };
      });
    },

    /** Cached per Steam ID for a day; only ids not cached are asked for, 100 per call. Never throws. */
    async steamProfiles(ids: string[]): Promise<WSteamProfiles> {
      const unique = [...new Set(ids)].filter((id) => /^\d{17}$/.test(id)).sort();
      const out: WSteamProfiles = {};
      const todo: string[] = [];
      for (const id of unique) {
        const hit = steamCache.peek<WSteamProfiles[string]>(id);
        if (!hit) todo.push(id);
        else if (hit.value) out[id] = hit.value;
      }
      if (Date.now() - steamFailedAt < 60_000) return out;
      let failed = false;
      for (let i = 0; i < todo.length; i += 100) {
        const batch = todo.slice(i, i + 100);
        try {
          const got = await client.json(`/api/steam/profiles?ids=${batch.join(',')}`, steamProfilesBody);
          for (const id of batch) {
            // An id Warcon has no profile for is remembered as null, so it isn't asked for again today.
            const p = got[id] ?? null;
            steamCache.put(id, p, TTL.steam);
            if (p) out[id] = p;
          }
        } catch {
          // Avatars are decoration: no Steam key on the panel, or the limit hit, means badges.
          failed = true;
        }
      }
      if (failed) steamFailedAt = Date.now();
      return out;
    },

    boardExportCsv(serverId: string): Promise<string> {
      return client.text(`/api/servers/${enc(serverId)}/leaderboard/export?scope=org&range=all&sort=playtime&dir=desc&minMinutes=0`);
    },
  };
}

export type WarconApi = ReturnType<typeof createApi>;
