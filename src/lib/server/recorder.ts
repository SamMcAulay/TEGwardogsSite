// Turns RCON observations and kill feed batches into rows. Pure with respect to the connection it
// is handed, so tests run it against an in-memory database.

import type Database from 'better-sqlite3';
import { causeInfo } from '../game';
import { dayOf, stmt } from './db';
import type { LivePlayer, ServerStatus } from './rcon';

/** A player we are tracking in the current match. */
interface Tracked {
  sessionId: number;
  kills: number;
  deaths: number;
  lastSeen: number;
}

export interface ServerState {
  serverId: string;
  matchId: number | null;
  map: string | null;
  scoreTotal: number;
  matchSeconds: number | null;
  lastTick: number | null;
  players: Map<string, Tracked>;
}

export interface Observation {
  now: number;
  status: ServerStatus;
  players: LivePlayer[];
  uptimeSeconds?: number | null;
  joinCode?: string | null;
}

export interface RecorderOptions {
  /** When the server feeds kill events, kills and deaths come from the feed, not the scoreboard. */
  feedEnabled: boolean;
  /** Longest gap between two ticks that still counts as continuous play. */
  maxGapSeconds: number;
}

/** Rebuild tracking state from the open match and sessions, so a restart continues where it left off. */
export function loadState(conn: Database.Database, serverId: string, now: number, maxGap: number): ServerState {
  const state: ServerState = {
    serverId,
    matchId: null,
    map: null,
    scoreTotal: 0,
    matchSeconds: null,
    lastTick: null,
    players: new Map(),
  };
  const match = stmt(
    conn,
    `SELECT id, map, scores_json FROM matches WHERE server_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`,
  ).get(serverId) as { id: number; map: string; scores_json: string } | undefined;
  const open = stmt(
    conn,
    `SELECT id, steam_id, kills, deaths, last_seen_at FROM sessions WHERE server_id = ? AND ended_at IS NULL`,
  ).all(serverId) as { id: number; steam_id: string; kills: number; deaths: number; last_seen_at: number }[];
  const lastSeen = Math.max(0, ...open.map((s) => s.last_seen_at));

  if (match && (open.length === 0 || now - lastSeen <= maxGap)) {
    state.matchId = match.id;
    state.map = match.map;
    state.scoreTotal = sumScores(JSON.parse(match.scores_json));
    state.lastTick = open.length ? lastSeen : null;
    for (const s of open) {
      // Session kills are deltas; the scoreboard values we compare against are not known after a
      // restart, so re-baseline on the first tick (marked with -1).
      state.players.set(s.steam_id, { sessionId: s.id, kills: -1, deaths: -1, lastSeen: s.last_seen_at });
    }
  } else {
    // Too stale to continue: close everything that was left open.
    stmt(conn, `UPDATE sessions SET ended_at = last_seen_at WHERE server_id = ? AND ended_at IS NULL`).run(serverId);
    if (match) stmt(conn, `UPDATE matches SET ended_at = ? WHERE id = ?`).run(lastSeen || now, match.id);
  }
  return state;
}

function sumScores(scores: { score: number }[]): number {
  return scores.reduce((a, f) => a + (f.score || 0), 0);
}

/** True when the status belongs to a different match than the one we are tracking. */
export function isNewMatch(state: ServerState, status: ServerStatus): boolean {
  if (state.matchId == null) return true;
  if (state.map !== status.map) return true;
  // Scores only ever rise during a match; a drop means the next round started on the same map.
  if (sumScores(status.factionScores) < state.scoreTotal) return true;
  if (status.matchSeconds != null && state.matchSeconds != null && status.matchSeconds < state.matchSeconds - 30) {
    return true;
  }
  return false;
}

export function recordObservation(
  conn: Database.Database,
  state: ServerState,
  obs: Observation,
  opts: RecorderOptions,
): void {
  const { now, status } = obs;
  conn.transaction(() => {
    let freshMatch = false;
    if (isNewMatch(state, status)) {
      closeMatch(conn, state, state.lastTick ?? now);
      const res = stmt(
        conn,
        `INSERT INTO matches (server_id, map, experiences, lighting, started_at, scores_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        state.serverId,
        status.map,
        JSON.stringify(status.experiences ?? []),
        status.lighting ?? null,
        now,
        JSON.stringify(status.factionScores ?? []),
      );
      state.matchId = Number(res.lastInsertRowid);
      state.map = status.map;
      freshMatch = true;
    }
    state.scoreTotal = sumScores(status.factionScores ?? []);
    state.matchSeconds = status.matchSeconds ?? null;
    const matchId = state.matchId!;

    const scores = [...(status.factionScores ?? [])].sort((a, b) => b.score - a.score);
    stmt(
      conn,
      `UPDATE matches SET scores_json = ?, winner = ?, lighting = COALESCE(?, lighting),
           peak_players = MAX(peak_players, ?) WHERE id = ?`,
    ).run(
      JSON.stringify(status.factionScores ?? []),
      scores[0]?.score ? scores[0].name : null,
      status.lighting ?? null,
      // Steam-query servers report a count but no player list.
      obs.players.length || status.players?.current || 0,
      matchId,
    );

    recordPlayers(conn, state, obs, opts, matchId, freshMatch);

    const minute = Math.floor(now / 60) * 60;
    stmt(conn, `INSERT OR REPLACE INTO population (server_id, ts, players, max_players) VALUES (?, ?, ?, ?)`).run(
      state.serverId,
      minute,
      status.players?.current ?? obs.players.length,
      status.players?.max ?? 0,
    );

    stmt(
      conn,
      `INSERT INTO server_live (server_id, online, updated_at, last_online_at, fail_count, status_json, players_json, join_code, started_at, error)
         VALUES (@id, 1, @now, @now, 0, @status, @players, @join, @started, NULL)
         ON CONFLICT(server_id) DO UPDATE SET online = 1, updated_at = @now, last_online_at = @now, fail_count = 0,
           status_json = @status, players_json = @players, join_code = COALESCE(@join, join_code),
           started_at = COALESCE(@started, started_at), error = NULL`,
    ).run({
      id: state.serverId,
      now,
      status: JSON.stringify(status),
      players: JSON.stringify(obs.players),
      join: obs.joinCode ?? null,
      started: obs.uptimeSeconds != null ? now - Math.round(obs.uptimeSeconds) : null,
    });

    state.lastTick = now;
  })();
}

function recordPlayers(
  conn: Database.Database,
  state: ServerState,
  obs: Observation,
  opts: RecorderOptions,
  matchId: number,
  freshMatch: boolean,
) {
  const { now } = obs;
  const day = dayOf(now);
  const upsertPlayer = stmt(
    conn,
    `INSERT INTO players (steam_id, name, first_seen, last_seen, last_server_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(steam_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen,
       last_server_id = excluded.last_server_id`,
  );
  const upsertName = stmt(
    conn,
    `INSERT INTO player_names (steam_id, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(steam_id, name) DO UPDATE SET last_seen = excluded.last_seen`,
  );
  const openSession = stmt(
    conn,
    `INSERT INTO sessions (steam_id, server_id, match_id, faction, started_at, last_seen_at, cash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateSession = stmt(
    conn,
    `UPDATE sessions SET kills = kills + ?, deaths = deaths + ?, cash = ?, faction = ?, last_seen_at = ? WHERE id = ?`,
  );
  const addDaily = stmt(
    conn,
    `INSERT INTO player_daily (steam_id, server_id, day, kills, deaths, playtime_s, matches) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(steam_id, server_id, day) DO UPDATE SET kills = kills + excluded.kills,
       deaths = deaths + excluded.deaths, playtime_s = playtime_s + excluded.playtime_s,
       matches = matches + excluded.matches`,
  );
  const closeSession = stmt(conn, `UPDATE sessions SET ended_at = last_seen_at WHERE id = ?`);

  const seen = new Set<string>();
  for (const p of obs.players) {
    if (!p.steamId) continue;
    seen.add(p.steamId);
    upsertPlayer.run(p.steamId, p.name, now, now, state.serverId);
    upsertName.run(p.steamId, p.name, now, now);

    const tracked = state.players.get(p.steamId);
    if (!tracked) {
      // Joining mid-match: whatever the scoreboard already shows happened before we saw them
      // (a reconnect keeps its score), so it is the baseline. In a match we saw start, it is theirs.
      const baseKills = freshMatch ? 0 : p.kills;
      const baseDeaths = freshMatch ? 0 : p.deaths;
      const res = openSession.run(p.steamId, state.serverId, matchId, p.faction ?? null, now, now, p.cash ?? 0);
      const sessionId = Number(res.lastInsertRowid);
      const dk = p.kills - baseKills;
      const dd = p.deaths - baseDeaths;
      if (dk || dd) updateSession.run(dk, dd, p.cash ?? 0, p.faction ?? null, now, sessionId);
      addDaily.run(p.steamId, state.serverId, day, opts.feedEnabled ? 0 : dk, opts.feedEnabled ? 0 : dd, 0, 1);
      state.players.set(p.steamId, { sessionId, kills: p.kills, deaths: p.deaths, lastSeen: now });
      continue;
    }

    const dk = tracked.kills < 0 ? 0 : delta(tracked.kills, p.kills);
    const dd = tracked.deaths < 0 ? 0 : delta(tracked.deaths, p.deaths);
    const played = Math.max(0, Math.min(now - tracked.lastSeen, opts.maxGapSeconds));
    updateSession.run(dk, dd, p.cash ?? 0, p.faction ?? null, now, tracked.sessionId);
    addDaily.run(p.steamId, state.serverId, day, opts.feedEnabled ? 0 : dk, opts.feedEnabled ? 0 : dd, played, 0);
    tracked.kills = p.kills;
    tracked.deaths = p.deaths;
    tracked.lastSeen = now;
  }

  for (const [steamId, tracked] of state.players) {
    if (seen.has(steamId)) continue;
    closeSession.run(tracked.sessionId);
    state.players.delete(steamId);
  }
}

/** Scoreboard counters only rise within a match; a drop means they were reset. */
function delta(prev: number, next: number): number {
  return next >= prev ? next - prev : next;
}

function closeMatch(conn: Database.Database, state: ServerState, at: number) {
  for (const t of state.players.values()) {
    stmt(conn, `UPDATE sessions SET ended_at = last_seen_at WHERE id = ?`).run(t.sessionId);
  }
  state.players.clear();
  if (state.matchId != null) {
    stmt(conn, `UPDATE matches SET ended_at = ? WHERE id = ? AND ended_at IS NULL`).run(at, state.matchId);
  }
  state.matchId = null;
  state.scoreTotal = 0;
  state.matchSeconds = null;
}

export function recordFailure(
  conn: Database.Database,
  state: ServerState,
  now: number,
  error: string,
  offlineAfter = 3,
) {
  conn.transaction(() => {
    stmt(
      conn,
      `INSERT INTO server_live (server_id, online, updated_at, fail_count, error) VALUES (?, 0, ?, 1, ?)
         ON CONFLICT(server_id) DO UPDATE SET fail_count = fail_count + 1, updated_at = excluded.updated_at,
           error = excluded.error, online = CASE WHEN fail_count + 1 >= ? THEN 0 ELSE online END`,
    ).run(state.serverId, now, error, offlineAfter);
    const live = stmt(conn, `SELECT online FROM server_live WHERE server_id = ?`).get(state.serverId) as {
      online: number;
    };
    if (!live.online) {
      closeMatch(conn, state, state.lastTick ?? now);
      stmt(conn, `INSERT OR REPLACE INTO population (server_id, ts, players, max_players) VALUES (?, ?, 0, 0)`).run(
        state.serverId,
        Math.floor(now / 60) * 60,
      );
    }
  })();
}

// ---------------------------------------------------------------------------------------------
// Kill feed

export interface FeedEvent {
  eventId: string;
  type: string;
  eventTime?: number;
  matchId?: string;
  mapName?: string;
  killerName?: string;
  killerId?: string;
  killerSteamId?: string;
  victimName?: string;
  victimId?: string;
  victimSteamId?: string;
  cause?: string;
  /** Unreal units (centimetres). */
  distance?: number;
  contextTags?: string[];
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  ignored: number;
}

export function ingestKills(conn: Database.Database, serverId: string, events: FeedEvent[], now: number): IngestResult {
  const result: IngestResult = { accepted: 0, duplicates: 0, ignored: 0 };
  const day = dayOf(now);

  const match = stmt(
    conn,
    `SELECT id FROM matches WHERE server_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`,
  ).get(serverId) as { id: number } | undefined;
  const live = stmt(conn, `SELECT players_json FROM server_live WHERE server_id = ?`).get(serverId) as
    { players_json: string | null } | undefined;
  const factionOf = new Map<string, string>();
  for (const p of JSON.parse(live?.players_json ?? '[]') as LivePlayer[]) factionOf.set(p.steamId, p.faction);

  const insert = stmt(
    conn,
    `INSERT OR IGNORE INTO kills (event_id, server_id, match_id, ts, map, killer_steam_id, killer_name,
       victim_steam_id, victim_name, cause, distance_m, headshot, suicide, teamkill, tags)
     VALUES (@eventId, @serverId, @matchId, @ts, @map, @killer, @killerName, @victim, @victimName, @cause,
       @distance, @headshot, @suicide, @teamkill, @tags)`,
  );
  const daily = stmt(
    conn,
    `INSERT INTO player_daily (steam_id, server_id, day, kills, deaths, headshots, suicides, teamkills, longest_kill_m)
     VALUES (@steamId, @serverId, @day, @kills, @deaths, @headshots, @suicides, @teamkills, @longest)
     ON CONFLICT(steam_id, server_id, day) DO UPDATE SET kills = kills + excluded.kills,
       deaths = deaths + excluded.deaths, headshots = headshots + excluded.headshots,
       suicides = suicides + excluded.suicides, teamkills = teamkills + excluded.teamkills,
       longest_kill_m = MAX(longest_kill_m, excluded.longest_kill_m)`,
  );
  const weapon = stmt(
    conn,
    `INSERT INTO weapon_daily (cause, server_id, day, kills, headshots, longest_m, distance_sum, distance_n)
     VALUES (@cause, @serverId, @day, 1, @headshot, @distance, @distance, @hasDistance)
     ON CONFLICT(cause, server_id, day) DO UPDATE SET kills = kills + 1, headshots = headshots + excluded.headshots,
       longest_m = MAX(longest_m, excluded.longest_m), distance_sum = distance_sum + excluded.distance_sum,
       distance_n = distance_n + excluded.distance_n`,
  );
  const touchPlayer = stmt(
    conn,
    `INSERT INTO players (steam_id, name, first_seen, last_seen, last_server_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(steam_id) DO UPDATE SET name = excluded.name, last_seen = MAX(last_seen, excluded.last_seen)`,
  );

  conn.transaction(() => {
    for (const e of events) {
      if (e.type !== 'killed' || !e.eventId) {
        result.ignored++;
        continue;
      }
      const tags = (e.contextTags ?? []).map((t) => t.split('.').pop() ?? t);
      const killer = e.killerSteamId || null;
      const victim = e.victimSteamId || null;
      const suicide = tags.includes('Suicide') || (!!killer && killer === victim);
      const headshot = tags.includes('Headshot');
      const teamkill =
        !suicide && !!killer && !!victim && !!factionOf.get(killer) && factionOf.get(killer) === factionOf.get(victim);
      const distance = e.distance != null ? e.distance / 100 : null;
      // Longest-kill records are for infantry shots; artillery and vehicle guns would own them otherwise.
      const kind = causeInfo(e.cause).kind;
      const infantry = kind !== 'vehicle' && kind !== 'vehicle weapon';

      const res = insert.run({
        eventId: e.eventId,
        serverId,
        matchId: match?.id ?? null,
        ts: now,
        map: e.mapName ?? null,
        killer,
        killerName: e.killerName ?? null,
        victim,
        victimName: e.victimName ?? null,
        cause: e.cause ?? null,
        distance,
        headshot: headshot ? 1 : 0,
        suicide: suicide ? 1 : 0,
        teamkill: teamkill ? 1 : 0,
        tags: tags.filter((t) => t !== 'Kill' && t !== 'Death').join(','),
      });
      if (!res.changes) {
        result.duplicates++;
        continue;
      }
      result.accepted++;

      if (killer && e.killerName) touchPlayer.run(killer, e.killerName, now, now, serverId);
      if (victim && e.victimName) touchPlayer.run(victim, e.victimName, now, now, serverId);

      if (e.cause && !suicide && !teamkill) {
        weapon.run({
          cause: e.cause,
          serverId,
          day,
          headshot: headshot ? 1 : 0,
          distance: distance ?? 0,
          hasDistance: distance != null ? 1 : 0,
        });
      }
      if (killer && !suicide) {
        daily.run({
          steamId: killer,
          serverId,
          day,
          kills: teamkill ? 0 : 1,
          deaths: 0,
          headshots: headshot && !teamkill ? 1 : 0,
          suicides: 0,
          teamkills: teamkill ? 1 : 0,
          longest: !teamkill && infantry && distance ? distance : 0,
        });
      }
      if (victim) {
        daily.run({
          steamId: victim,
          serverId,
          day,
          kills: 0,
          deaths: 1,
          headshots: 0,
          suicides: suicide ? 1 : 0,
          teamkills: 0,
          longest: 0,
        });
      }
    }
  })();
  return result;
}
