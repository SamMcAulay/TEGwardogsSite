// Page-facing reads: Warcon's answers turned into the view types in views.ts. Every function
// is async and says whether its data is stale and which servers failed (Loaded<T>).
import { siteEnv } from './warcon/env';
import { searchIndex, warcon } from './warcon';
import { fanOut, mergeNewest } from './warcon/merge';
import { TTL, type KillKind } from './warcon/api';
import type { WBoardRow, WKill, WLive, WMatchSummary, WWatchedPage } from './warcon/schemas';
import { orgBannedIds } from './bans';
import type {
  KillRow, LeaderRow, Loaded, MatchAward, MatchPlayerRow, MatchRow, Metric, NetworkSummary, Period,
  PlayerProfile, PlayerSearchRow, PopulationPoint, ServerRow, WatchRow,
} from './views';

const sec = (iso: string | null | undefined): number | null => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
const loaded = <T>(data: T, stale = false, missing: string[] = []): Loaded<T> => ({ data, stale, missing });

export const shortNameOf = (name: string) => name.split(' - ')[0].trim();
export function regionOf(shortName: string): string {
  const r = shortName.split('#')[0].toUpperCase();
  return r === 'OC' ? 'OCE' : r;
}

/** The servers to show: SERVER_IDS order when set, else Warcon's. */
async function serverList() {
  const { value, stale } = await warcon().servers();
  const ids = siteEnv().serverIds;
  const list = ids.length
    ? ids.map((id) => value.find((s) => s.id === id)).filter((s) => s !== undefined)
    : [...value].sort((a, b) => a.sortOrder - b.sortOrder);
  return { list, stale };
}

/** Server ids a caller may read: all visible ones for null, the one asked for if visible, else none. */
async function visibleIds(serverId: string | null | undefined): Promise<string[]> {
  const ids = (await serverList()).list.map((s) => s.id);
  if (!serverId) return ids;
  return ids.includes(serverId) ? [serverId] : [];
}

/** live: Warcon's answer (null = it has never observed the server); unknown = the call failed. */
function serverRow(s: { id: string; name: string }, live: WLive | null, unknown = false): ServerRow {
  const st = live?.status ?? null;
  const shortName = shortNameOf(s.name);
  return {
    id: s.id,
    name: s.name,
    shortName,
    region: regionOf(shortName),
    online: unknown ? null : !!live?.ok && !!st,
    updatedAt: sec(live?.observedAt),
    status: st && {
      serverName: st.serverName,
      map: st.map,
      experiences: st.experiences,
      lighting: st.lighting || null,
      matchSeconds: st.matchSeconds ?? undefined,
      players: { current: st.playerCount, max: st.maxPlayers },
      scoreCap: st.scoreCap,
      factionScores: st.scores,
    },
    players: (live?.players ?? []).map((p) => ({ name: p.name, steamId: p.steamId, faction: p.faction ?? '', kills: p.kills, deaths: p.deaths, cash: p.cash })),
    playerCount: st?.playerCount ?? 0,
    joinCode: live?.gameServerId || null,
    startedAt: sec(live?.startedAt),
  };
}

export async function getServers(): Promise<Loaded<ServerRow[]>> {
  const { list, stale } = await serverList();
  const r = await fanOut(list.map((s) => s.id), (id) => warcon().live(id));
  const rows = list.map((s) => serverRow(s, r.ok.find((o) => o.id === s.id)?.value ?? null, r.failed.includes(s.id)));
  return loaded(rows, stale || r.stale, r.failed);
}

export async function getServer(id: string): Promise<Loaded<ServerRow> | null> {
  const { list } = await serverList();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  try {
    const live = await warcon().live(id);
    return loaded(serverRow(s, live.value), live.stale);
  } catch {
    return loaded(serverRow(s, null, true), false, [id]);
  }
}

/** Servers whose live status is unknown count toward serversTotal only, and are listed in missing. */
export async function networkSummary(servers: ServerRow[]): Promise<Loaded<NetworkSummary>> {
  const r = await fanOut(servers.map((s) => s.id), (id) => warcon().analytics(id, '24h'));
  const sum = (f: (a: (typeof r.ok)[number]['value']) => number) => r.ok.reduce((n, o) => n + f(o.value), 0);
  const known = servers.filter((s) => s.online !== null);
  const unknown = servers.filter((s) => s.online === null).map((s) => s.id);
  return loaded(
    {
      playersOnline: known.reduce((n, s) => n + s.playerCount, 0),
      capacity: known.reduce((n, s) => n + (s.status?.players.max ?? 0), 0),
      serversOnline: known.filter((s) => s.online).length,
      serversTotal: servers.length,
      killsToday: sum((a) => a.combat?.kills ?? 0),
      playersToday: sum((a) => a.summary.uniquePlayers),
      matchesToday: sum((a) => a.summary.matches),
      peakToday: Math.max(0, ...r.ok.map((o) => o.value.summary.peakPlayers)),
    },
    r.stale,
    [...new Set([...unknown, ...r.failed])],
  );
}

export async function population(serverId: string | null, range: '24h' | '7d'): Promise<Loaded<PopulationPoint[]>> {
  const ids = await visibleIds(serverId);
  const r = await fanOut(ids, (id) => warcon().analytics(id, range));
  const byTs = new Map<number, PopulationPoint>();
  for (const { value } of r.ok) {
    for (const p of value.population) {
      const ts = sec(p.ts)!;
      const cur = byTs.get(ts) ?? { ts, players: 0, max: 0 };
      cur.players += p.avg ?? 0;
      cur.max += p.cap ?? 0;
      byTs.set(ts, cur);
    }
  }
  return loaded([...byTs.values()].sort((a, b) => a.ts - b.ts), r.stale, r.failed);
}

function metricValue(metric: Metric, r: { kills: number; deaths: number; minutes: number; matches: number; wins: number; losses: number; draws: number; cash: number }) {
  switch (metric) {
    case 'kills': return r.kills;
    case 'deaths': return r.deaths;
    case 'kd': return r.kills / Math.max(1, r.deaths);
    case 'perHour': return r.minutes > 0 ? r.kills / (r.minutes / 60) : 0;
    case 'playtime': return r.minutes * 60;
    case 'matches': return r.matches;
    case 'wins': return r.wins;
    case 'winRate': {
      const decided = r.wins + r.losses + r.draws;
      return decided ? r.wins / decided : 0;
    }
    case 'cash': return r.cash;
  }
}

/** Warcon board pages scanned past the one asked for, to fill it after removing banned players. */
const BOARD_SCAN_EXTRA = 10;
/** Deepest board page served (the top 1,000), as Warcon's own public boards; each deeper page costs Warcon one more query. */
export const MAX_BOARD_PAGE = 20;
/** Warcon board pages fetched at once for one request. */
const BOARD_FETCH_CONCURRENCY = 4;

/** fn over items, at most `limit` at a time, results in order. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * A leaderboard page without org-banned players. Warcon serves 50 rows a page with its own ranks;
 * banned rows are dropped, the page is filled from the following Warcon pages, and ranks are
 * renumbered so the board reads 1, 2, 3 with no gaps. Throws if the ban list has never loaded, so
 * the page shows "unavailable" rather than banned players.
 */
/** Rows a board page shows; the same as Warcon's own page size. */
const BOARD_PAGE_SIZE = 50;

type BoardQuery = { scope: 'server' | 'org'; range: Period; sort: Metric };
interface Kept {
  kept: WBoardRow[];
  total: number;
  pageSize: number;
  stale: boolean;
}

/** The whole board from one export, banned players removed: every page and the total are exact. */
async function keptFromExport(anchor: string, query: BoardQuery, banned: ReadonlySet<string>): Promise<Kept> {
  const ex = await warcon().boardExport(anchor, query);
  const kept = ex.value.filter((r) => !banned.has(r.steamId));
  return { kept, total: kept.length, pageSize: BOARD_PAGE_SIZE, stale: ex.stale };
}

/** The fallback when the export fails (e.g. its 10-a-minute limit): Warcon pages up to `page`, topped up. */
async function keptFromPages(anchor: string, query: BoardQuery, banned: ReadonlySet<string>, page: number): Promise<Kept> {
  const board = (p: number) => warcon().board(anchor, { ...query, page: p });
  const first = await board(1);
  const pageSize = first.value.pageSize;
  const want = page * pageSize;
  const lastWarconPage = Math.min(Math.max(1, Math.ceil(first.value.total / pageSize)), MAX_BOARD_PAGE + BOARD_SCAN_EXTRA);
  const kept: WBoardRow[] = [];
  let bannedSeen = 0;
  let stale = first.stale;
  const take = (cur: Awaited<ReturnType<typeof board>>) => {
    stale ||= cur.stale;
    for (const r of cur.value.rows) {
      if (banned.has(r.steamId)) bannedSeen++;
      else kept.push(r);
    }
  };
  take(first);
  const upTo = Math.min(page, lastWarconPage);
  const needed = await mapLimited(Array.from({ length: upTo - 1 }, (_, i) => i + 2), BOARD_FETCH_CONCURRENCY, board);
  for (const cur of needed) take(cur);
  let scanned = upTo;
  // Banned players removed leave the page short: top up from the following pages.
  for (let p = upTo + 1; p <= lastWarconPage && p <= page + BOARD_SCAN_EXTRA && kept.length < want; p++) {
    take(await board(p));
    scanned = p;
  }
  // Exact once every Warcon page was read; otherwise Warcon's total less the banned rows met so far.
  const total = scanned >= lastWarconPage ? kept.length : Math.max(kept.length, first.value.total - bannedSeen);
  return { kept, total, pageSize, stale };
}

/**
 * A leaderboard page without org-banned players, ranked 1, 2, 3 with no gaps. Built from the whole
 * board (one Warcon export, cached), so every page costs the same; falls back to Warcon's pages
 * when the export fails. Throws if the ban list has never loaded, so the page shows "unavailable"
 * rather than banned players. Boards stop at page MAX_BOARD_PAGE.
 */
export async function leaderboard(q: { metric: Metric; period: Period; serverId?: string | null; page?: number }) {
  const anchor = (await visibleIds(q.serverId))[0];
  if (!anchor) return loaded({ rows: [] as LeaderRow[], total: 0, pageSize: BOARD_PAGE_SIZE });
  const banned = await orgBannedIds();
  const page = Math.min(Math.max(1, Math.floor(q.page ?? 1)), MAX_BOARD_PAGE);
  const query: BoardQuery = { scope: q.serverId ? 'server' : 'org', range: q.period, sort: q.metric };

  let board: Kept;
  try {
    board = await keptFromExport(anchor, query, banned.ids);
  } catch (e) {
    console.error('[board] export failed, reading pages instead:', e instanceof Error ? e.message : e);
    board = await keptFromPages(anchor, query, banned.ids, page);
  }
  const { kept, pageSize } = board;
  const total = Math.min(board.total, MAX_BOARD_PAGE * pageSize);

  const start = (page - 1) * pageSize;
  const slice = kept.slice(start, start + pageSize);
  const avatars = await warcon().steamProfiles(slice.map((r) => r.steamId));
  const rows: LeaderRow[] = slice.map((r, i) => ({
    rank: start + i + 1,
    steamId: r.steamId,
    name: r.name,
    avatarUrl: avatars[r.steamId]?.avatar || null,
    kills: r.kills,
    deaths: r.deaths,
    headshots: r.headshots,
    playtime: r.minutes * 60,
    matches: r.matches,
    wins: r.wins,
    cash: r.cash,
    value: metricValue(q.metric, r),
    lastSeen: sec(r.lastSeen),
  }));
  return loaded({ rows, total, pageSize }, board.stale || banned.stale);
}

/** Warcon's floor for the career rank: players with less time on are not ranked. */
const RANK_FLOOR_MINUTES = 60;

/**
 * Warcon's all-time kills rank with org-banned players left out, so it agrees with the boards.
 * Warcon ranks a player 1 + the players (an hour or more on) with more kills; this subtracts the
 * banned ones among them, read from the board export the search index already holds. A banned
 * player is unranked. 'unavailable' when the ban list or the export can't be read.
 */
export async function adjustedRank(warconRank: number | null, steamId: string): Promise<number | null | 'unavailable'> {
  if (warconRank === null) return null;
  let banned;
  try {
    banned = await orgBannedIds();
  } catch {
    return 'unavailable';
  }
  if (banned.ids.has(steamId)) return null;
  const all = await searchIndex(async () => (await serverList()).list[0].id).snapshot();
  if (all === 'warming') return 'unavailable';
  const me = all.find((h) => h.steamId === steamId);
  if (!me) return 'unavailable';
  const bannedAbove = all.filter((h) => banned.ids.has(h.steamId) && h.minutes >= RANK_FLOOR_MINUTES && h.kills > me.kills).length;
  return Math.max(1, warconRank - bannedAbove);
}

export async function searchPlayers(q: string): Promise<PlayerSearchRow[] | 'warming'> {
  const idx = searchIndex(async () => (await serverList()).list[0].id);
  const hits = await idx.search(q);
  if (hits === 'warming') return hits;
  const avatars = await warcon().steamProfiles(hits.map((h) => h.steamId));
  return hits.map((h) => ({ steamId: h.steamId, name: h.name, avatarUrl: avatars[h.steamId]?.avatar || null, lastSeen: sec(h.lastSeen), matchedAlias: null }));
}

/**
 * Fills in Steam pictures. Warcon's player list always says steam: null, so rows built from it
 * ask the Steam profile lookup (cached per player for a day; never throws).
 */
async function withAvatars<T extends { steamId: string; avatarUrl?: string | null }>(rows: T[]): Promise<T[]> {
  const missing = rows.filter((r) => !r.avatarUrl).map((r) => r.steamId);
  if (!missing.length) return rows;
  const pics = await warcon().steamProfiles(missing);
  return rows.map((r) => (r.avatarUrl ? r : { ...r, avatarUrl: pics[r.steamId]?.avatar || null }));
}

export async function recentPlayers(limit = 30): Promise<Loaded<PlayerSearchRow[]>> {
  const { list } = await serverList();
  const r = await fanOut(list.map((s) => s.id), (id) => warcon().seen(id, { limit }));
  const seen = new Map<string, PlayerSearchRow>();
  for (const p of mergeNewest(r.ok.map((o) => o.value), (p) => Date.parse(p.lastSeen), limit * list.length)) {
    if (!seen.has(p.steamId)) seen.set(p.steamId, { steamId: p.steamId, name: p.name, avatarUrl: p.steam?.avatar || null, lastSeen: sec(p.lastSeen), matchedAlias: null });
  }
  return loaded(await withAvatars([...seen.values()].slice(0, limit)), r.stale, r.failed);
}

/** At most this many pages (100 players each) of the watchlist per server. */
const MAX_WATCH_PAGES = 20;

async function watchedOn(serverId: string) {
  const players: WWatchedPage['players'] = [];
  let stale = false;
  for (let p = 0; p < MAX_WATCH_PAGES; p++) {
    const { value, stale: s } = await warcon().watchedPage(serverId, p * 100);
    stale ||= s;
    players.push(...value.players);
    if ((p + 1) * 100 >= value.total || value.players.length === 0) break;
  }
  return { value: players, stale };
}

/** The org's watchlist, newest seen first. Org-banned players are left off; reasons are never read. */
export async function watchlist(): Promise<Loaded<WatchRow[]>> {
  const { list } = await serverList();
  const r = await fanOut(list.map((s) => s.id), watchedOn);
  if (list.length && !r.ok.length) throw new Error('watchlist unavailable');
  const names = new Map(list.map((s) => [s.id, shortNameOf(s.name)]));
  const rows = new Map<string, WatchRow>();
  for (const p of r.ok.flatMap((o) => o.value)) {
    if (p.banned === 'org') continue;
    const lastSeen = sec(p.lastSeen);
    const had = rows.get(p.steamId);
    if (had && (had.lastSeen ?? 0) >= (lastSeen ?? 0)) continue;
    const serverName = names.get(p.lastServerId) ?? null;
    rows.set(p.steamId, {
      steamId: p.steamId,
      name: p.name,
      avatarUrl: p.steam?.avatar || null,
      lastSeen,
      serverId: serverName ? p.lastServerId : null,
      serverName,
    });
  }
  const data = [...rows.values()].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  return loaded(await withAvatars(data), r.stale, r.failed);
}

function killRow(k: WKill, serverId: string, serverName: string): KillRow {
  return {
    eventId: k.eventId,
    serverId,
    serverName,
    ts: sec(k.ts)!,
    cursor: `${k.ts}~${k.eventTime}`,
    killerSteamId: k.killer?.steamId ?? null,
    killerName: k.killer?.name ?? null,
    victimSteamId: k.victim.steamId,
    victimName: k.victim.name,
    cause: k.cause,
    distance: k.distanceM,
    headshot: k.headshot ? 1 : 0,
    suicide: k.suicide ? 1 : 0,
    teamkill: k.teamKill ? 1 : 0,
    tags: k.tags.join(','),
  };
}

export async function getPlayer(steamId: string): Promise<Loaded<PlayerProfile> | null> {
  const { list } = await serverList();
  const anchor = list[0]?.id;
  if (!anchor) return null;
  let dossier, career;
  try {
    [dossier, career] = await Promise.all([warcon().dossier(anchor, steamId), warcon().career(anchor, steamId)]);
  } catch (e) {
    if ((e as { kind?: string }).kind === 'not_found') return null;
    throw e;
  }
  const d = dossier.value;
  const c = career.value;
  const [victims, nemeses] = await Promise.all([
    withAvatars((d.combat?.victims ?? []).map((v) => ({ steamId: v.steamId, name: v.name, avatarUrl: null, count: v.kills }))),
    withAvatars((d.combat?.nemeses ?? []).map((v) => ({ steamId: v.steamId, name: v.name, avatarUrl: null, count: v.deaths }))),
  ]);
  if (!d.summary.firstSeen && c.matches === 0) return null;
  const nameOf = new Map(list.map((s) => [s.id, s.name]));
  // SERVER_IDS hides servers everywhere, including a player's history on them.
  const shown = (serverId: string) => nameOf.has(serverId);
  const group = (g: { key: string; matches: number; wins: number; kills: number; deaths: number }) => ({ key: g.key, matches: g.matches, wins: g.wins, kills: g.kills, deaths: g.deaths });
  return loaded(
    {
      steamId,
      name: d.name,
      avatarUrl: d.steam?.avatar || null,
      firstSeen: sec(d.summary.firstSeen),
      lastSeen: sec(d.summary.lastSeen),
      aliases: d.names.filter((n) => n !== d.name),
      totals: {
        kills: c.kills, deaths: c.deaths, headshots: c.headshots, suicides: d.combat?.suicides ?? 0,
        teamkills: d.combat?.teamKills ?? 0, playtime: c.minutes * 60, longest: c.longestM ?? 0,
        matches: c.matches, wins: c.wins, losses: c.losses, draws: c.draws,
      },
      rank: await adjustedRank(c.rank.org, steamId),
      streak: c.streak,
      onlineOn: d.online && shown(d.online.serverId) ? d.online : null,
      weapons: (d.combat?.causes ?? []).map((w) => ({ cause: w.cause, kills: w.kills })),
      victims,
      nemeses,
      servers: d.perServer.filter((p) => shown(p.serverId)).map((p) => ({ serverId: p.serverId, name: p.serverName, playtime: p.minutes * 60, kills: p.kills })),
      matches: c.last.filter((m) => shown(m.serverId)).map((m) => ({
        matchId: m.matchId, serverId: m.serverId, serverName: shortNameOf(nameOf.get(m.serverId) ?? m.serverName),
        map: m.map ?? '', startedAt: sec(m.startedAt)!, endedAt: sec(m.endedAt), faction: m.faction, result: m.result,
        kills: m.kills, deaths: m.deaths, timePlayed: m.seconds,
      })),
      maps: c.maps.map(group),
      factions: c.factions.map(group),
      recentKills: (d.combat?.recent ?? []).filter((k) => shown(k.serverId)).map((k) => killRow(k, k.serverId, shortNameOf(k.serverName))),
    },
    dossier.stale || career.stale,
  );
}

export async function recentKills(q: { serverId?: string | null; steamId?: string; limit?: number; before?: string | null; kind?: KillKind; cause?: string; minM?: number | null }): Promise<Loaded<KillRow[]>> {
  const { list } = await serverList();
  const servers = q.serverId ? list.filter((s) => s.id === q.serverId) : list;
  const limit = q.limit ?? 50;
  const [ts, eventTime] = (q.before ?? '').split('~');
  const before = q.serverId && ts ? { ts, eventTime: Number(eventTime) || 0 } : null;
  const r = await fanOut(servers.map((s) => s.id), (id) =>
    warcon().kills(id, { limit, before, player: q.steamId, kind: q.kind, cause: q.cause, minM: q.minM }),
  );
  const lists = r.ok.map(({ id, value }) => value.kills.map((k) => killRow(k, id, shortNameOf(list.find((s) => s.id === id)!.name))));
  return loaded(mergeNewest(lists, (k) => k.ts, limit), r.stale, r.failed);
}

function matchRow(m: WMatchSummary, serverId: string, serverName: string, colours: Map<string, string | null>): MatchRow {
  return {
    id: m.id,
    serverId,
    serverName,
    map: m.map ?? '',
    experiences: m.experiences ? m.experiences.split(',').map((e) => e.trim()).filter(Boolean) : [],
    lighting: m.lighting,
    startedAt: sec(m.startedAt)!,
    endedAt: sec(m.endedAt),
    winner: m.winner,
    scores: (m.finalScores ?? []).map((f) => ({ name: f.name, score: f.score, colorHex: colours.get(f.name) ?? '' })),
    peakPlayers: m.peakPlayers,
    players: m.players,
  };
}

/** Pages only for one server: across all servers, the newest `limit` merged from each one's page 1
 *  (merging deeper pages per server would skip or repeat matches). */
export async function listMatches(q: { serverId?: string | null; limit?: number; page?: number } = {}) {
  const { list } = await serverList();
  const servers = q.serverId ? list.filter((s) => s.id === q.serverId) : list;
  const limit = q.limit ?? 50;
  const page = q.serverId ? (q.page ?? 1) : 1;
  const r = await fanOut(servers.map((s) => s.id), (id) => warcon().matches(id, page));
  const lists = r.ok.map(({ id, value }) => {
    const colours = new Map(value.live.map((f) => [f.name, f.colorHex]));
    return value.matches.map((m) => matchRow(m, id, shortNameOf(list.find((s) => s.id === id)!.name), colours));
  });
  const pages = q.serverId ? Math.max(1, ...r.ok.map((o) => o.value.pages)) : 1;
  return loaded({ rows: mergeNewest(lists, (m) => m.startedAt, limit), pages }, r.stale, r.failed);
}

export async function getMatch(serverId: string, matchId: number) {
  const { list } = await serverList();
  const server = list.find((s) => s.id === serverId);
  if (!server) return null;
  let view;
  try {
    view = await warcon().match(serverId, matchId);
  } catch (e) {
    if ((e as { kind?: string }).kind === 'not_found') return null;
    throw e;
  }
  const v = view.value;
  const colours = new Map(v.factions.map((f) => [f.name, f.colorHex]));
  // The match is still worth showing without its kill feed.
  let kills: { value: { kills: WKill[] }; stale: boolean };
  try {
    kills = await warcon().kills(serverId, { match: matchId, limit: 200 }, { ttl: v.match.endedAt ? TTL.endedMatch : TTL.stats });
  } catch (e) {
    console.error('[data] match kills failed:', e instanceof Error ? e.message : e);
    kills = { value: { kills: [] }, stale: true };
  }
  const killRows = kills.value.kills.map((k) => killRow(k, serverId, shortNameOf(server.name)));
  const weaponCounts = new Map<string, number>();
  for (const k of killRows) if (k.cause) weaponCounts.set(k.cause, (weaponCounts.get(k.cause) ?? 0) + 1);
  const lines: MatchPlayerRow[] = v.lines.map((l) => ({
    steamId: l.steamId, name: l.name, faction: l.faction, kills: l.kills, deaths: l.deaths, headshots: l.headshots,
    longest: l.longestM ?? 0, cash: l.cashDelta, timePlayed: l.seconds, killStreak: l.killStreak,
  }));
  const awards: MatchAward[] = v.awards;
  return loaded(
    {
      match: matchRow(v.match, serverId, shortNameOf(server.name), colours),
      lines,
      timeline: v.timeline,
      factions: v.factions,
      awards,
      kills: killRows,
      weapons: [...weaponCounts].map(([cause, n]) => ({ cause, kills: n })).sort((a, b) => b.kills - a.kills).slice(0, 8),
    },
    view.stale || kills.stale,
  );
}

export async function serverTotals(serverId: string) {
  if (!(await visibleIds(serverId)).length) return loaded({ uniquePlayers: 0, matches: 0, kills: 0, headshots: 0, peak: 0 });
  const { value, stale } = await warcon().analytics(serverId, '7d');
  return loaded(
    { uniquePlayers: value.summary.uniquePlayers, matches: value.summary.matches, kills: value.combat?.kills ?? 0, headshots: value.combat?.headshots ?? 0, peak: value.summary.peakPlayers },
    stale,
  );
}

export async function factionWins(serverId: string | null) {
  const ids = await visibleIds(serverId);
  const r = await fanOut(ids, (id) => warcon().analytics(id, '7d'));
  const wins = new Map<string, number>();
  for (const { value } of r.ok) for (const t of value.wins.teams) wins.set(t.name, (wins.get(t.name) ?? 0) + t.wins);
  return loaded([...wins].map(([faction, n]) => ({ faction, wins: n })).sort((a, b) => b.wins - a.wins), r.stale, r.failed);
}

export async function headToHead(a: string, b: string) {
  const { list } = await serverList();
  const count = async (killer: string, victim: string) => {
    const r = await fanOut(list.map((s) => s.id), (id) => warcon().kills(id, { killer, victim, limit: 1, count: true }, { ttl: TTL.stats }));
    return { n: r.ok.reduce((s, o) => s + (o.value.total ?? 0), 0), stale: r.stale, failed: r.failed };
  };
  const [ab, ba] = await Promise.all([count(a, b), count(b, a)]);
  return loaded({ aKills: ab.n, bKills: ba.n }, ab.stale || ba.stale, [...new Set([...ab.failed, ...ba.failed])]);
}
