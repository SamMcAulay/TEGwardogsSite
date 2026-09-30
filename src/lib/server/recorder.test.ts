import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { open } from './db';
import type { LivePlayer, ServerStatus } from './rcon';
import { ingestKills, isNewMatch, loadState, recordFailure, recordObservation, type ServerState } from './recorder';

const OPTS = { feedEnabled: false, maxGapSeconds: 15 };
const T0 = 1_790_000_000;

function status(map: string, scores: [number, number, number]): ServerStatus {
  return {
    serverName: 'TEG | EU #1',
    map,
    experiences: [`${map}_KOTH_01`],
    lighting: 'DayClear',
    players: { current: 2, max: 98 },
    factionScores: [
      { name: 'Valkyra', colorHex: '#D86060', score: scores[0] },
      { name: 'Lonestar', colorHex: '#5B95D8', score: scores[1] },
      { name: 'Manticore', colorHex: '#7BC462', score: scores[2] },
    ],
  };
}

function player(steamId: string, faction: string, kills: number, deaths: number): LivePlayer {
  return { name: `P${steamId.slice(-2)}`, steamId, faction, kills, deaths, cash: 1000, pingMs: 30 };
}

const A = '76561198000000001';
const B = '76561198000000002';

let conn: Database.Database;
let state: ServerState;

beforeEach(() => {
  conn = open(':memory:');
  state = loadState(conn, 'eu-1', T0, 15);
});

const daily = (steamId: string) =>
  conn.prepare(`SELECT kills, deaths, playtime_s, matches FROM player_daily WHERE steam_id = ?`).get(steamId) as {
    kills: number;
    deaths: number;
    playtime_s: number;
    matches: number;
  };

describe('recordObservation', () => {
  it('opens a match and sessions, then counts scoreboard deltas and playtime', () => {
    recordObservation(
      conn,
      state,
      { now: T0, status: status('Kavkazi', [0, 0, 0]), players: [player(A, 'Valkyra', 0, 0)] },
      OPTS,
    );
    recordObservation(
      conn,
      state,
      { now: T0 + 5, status: status('Kavkazi', [1, 0, 0]), players: [player(A, 'Valkyra', 3, 1)] },
      OPTS,
    );
    recordObservation(
      conn,
      state,
      { now: T0 + 10, status: status('Kavkazi', [2, 0, 0]), players: [player(A, 'Valkyra', 4, 1)] },
      OPTS,
    );

    expect(conn.prepare(`SELECT COUNT(*) n FROM matches`).get()).toEqual({ n: 1 });
    expect(daily(A)).toEqual({ kills: 4, deaths: 1, playtime_s: 10, matches: 1 });
    const session = conn.prepare(`SELECT kills, deaths, ended_at FROM sessions`).get();
    expect(session).toEqual({ kills: 4, deaths: 1, ended_at: null });
  });

  it('treats a mid-match joiner’s existing score as a baseline', () => {
    recordObservation(conn, state, { now: T0, status: status('Kavkazi', [5, 5, 5]), players: [] }, OPTS);
    recordObservation(
      conn,
      state,
      { now: T0 + 5, status: status('Kavkazi', [6, 5, 5]), players: [player(B, 'Lonestar', 7, 2)] },
      OPTS,
    );
    recordObservation(
      conn,
      state,
      { now: T0 + 10, status: status('Kavkazi', [7, 5, 5]), players: [player(B, 'Lonestar', 8, 2)] },
      OPTS,
    );
    expect(daily(B).kills).toBe(1);
  });

  it('starts a new match when the map changes or scores reset, closing sessions', () => {
    recordObservation(
      conn,
      state,
      { now: T0, status: status('Kavkazi', [90, 40, 30]), players: [player(A, 'Valkyra', 5, 0)] },
      OPTS,
    );
    recordObservation(
      conn,
      state,
      { now: T0 + 5, status: status('Kavkazi', [100, 41, 30]), players: [player(A, 'Valkyra', 6, 0)] },
      OPTS,
    );
    // Same map, scores back to zero: next round.
    recordObservation(
      conn,
      state,
      { now: T0 + 10, status: status('Kavkazi', [0, 0, 0]), players: [player(A, 'Valkyra', 0, 0)] },
      OPTS,
    );
    const matches = conn.prepare(`SELECT winner, ended_at FROM matches ORDER BY id`).all();
    expect(matches).toEqual([
      { winner: 'Valkyra', ended_at: T0 + 5 },
      { winner: null, ended_at: null },
    ]);
    expect(conn.prepare(`SELECT COUNT(*) n FROM sessions WHERE ended_at IS NULL`).get()).toEqual({ n: 1 });
  });

  it('closes sessions of players who left', () => {
    recordObservation(
      conn,
      state,
      {
        now: T0,
        status: status('Europe', [0, 0, 0]),
        players: [player(A, 'Valkyra', 0, 0), player(B, 'Lonestar', 0, 0)],
      },
      OPTS,
    );
    recordObservation(
      conn,
      state,
      { now: T0 + 5, status: status('Europe', [1, 0, 0]), players: [player(A, 'Valkyra', 0, 0)] },
      OPTS,
    );
    const b = conn.prepare(`SELECT ended_at FROM sessions WHERE steam_id = ?`).get(B);
    expect(b).toEqual({ ended_at: T0 });
  });

  it('leaves kills to the feed when the server has one', () => {
    const feed = { ...OPTS, feedEnabled: true };
    recordObservation(
      conn,
      state,
      { now: T0, status: status('Europe', [0, 0, 0]), players: [player(A, 'Valkyra', 0, 0)] },
      feed,
    );
    recordObservation(
      conn,
      state,
      { now: T0 + 5, status: status('Europe', [0, 0, 0]), players: [player(A, 'Valkyra', 2, 0)] },
      feed,
    );
    expect(daily(A).kills).toBe(0);
    expect(conn.prepare(`SELECT kills FROM sessions`).get()).toEqual({ kills: 2 });
  });

  it('resumes the open match after a restart', () => {
    recordObservation(
      conn,
      state,
      { now: T0, status: status('Europe', [3, 0, 0]), players: [player(A, 'Valkyra', 2, 0)] },
      OPTS,
    );
    const resumed = loadState(conn, 'eu-1', T0 + 8, 15);
    expect(resumed.matchId).toBe(state.matchId);
    expect(isNewMatch(resumed, status('Europe', [4, 0, 0]))).toBe(false);
    recordObservation(
      conn,
      resumed,
      { now: T0 + 10, status: status('Europe', [4, 0, 0]), players: [player(A, 'Valkyra', 3, 0)] },
      OPTS,
    );
    // The first tick after a restart re-baselines rather than guessing.
    expect(conn.prepare(`SELECT COUNT(*) n FROM sessions`).get()).toEqual({ n: 1 });
  });

  it('marks a server offline after repeated failures and ends its match', () => {
    recordObservation(
      conn,
      state,
      { now: T0, status: status('Europe', [3, 0, 0]), players: [player(A, 'Valkyra', 0, 0)] },
      OPTS,
    );
    for (let i = 1; i <= 3; i++) recordFailure(conn, state, T0 + i * 5, 'unreachable');
    expect(conn.prepare(`SELECT online, fail_count FROM server_live`).get()).toEqual({ online: 0, fail_count: 3 });
    expect(conn.prepare(`SELECT ended_at FROM matches`).get()).toEqual({ ended_at: T0 });
  });
});

describe('ingestKills', () => {
  const kill = (id: string, extra: Record<string, unknown> = {}) => ({
    eventId: id,
    type: 'killed',
    killerName: 'PA',
    killerSteamId: A,
    victimName: 'PB',
    victimSteamId: B,
    cause: 'Id.Item.SV98',
    distance: 45_000,
    contextTags: ['Meta.Progression.Context.Player.KillContext.Headshot', 'Meta.PlayerKillFlag.Player.Local.Kill'],
    ...extra,
  });

  it('records kills once, with headshots and distance in metres', () => {
    recordObservation(
      conn,
      state,
      {
        now: T0,
        status: status('Europe', [0, 0, 0]),
        players: [player(A, 'Valkyra', 0, 0), player(B, 'Lonestar', 0, 0)],
      },
      OPTS,
    );
    const first = ingestKills(conn, 'eu-1', [kill('e1'), kill('e2', { contextTags: [] })], T0 + 1);
    const again = ingestKills(conn, 'eu-1', [kill('e1')], T0 + 2);
    expect(first).toEqual({ accepted: 2, duplicates: 0, ignored: 0 });
    expect(again).toEqual({ accepted: 0, duplicates: 1, ignored: 0 });

    const a = conn.prepare(`SELECT kills, headshots, longest_kill_m FROM player_daily WHERE steam_id = ?`).get(A);
    expect(a).toEqual({ kills: 2, headshots: 1, longest_kill_m: 450 });
    expect(daily(B).deaths).toBe(2);
    expect(conn.prepare(`SELECT kills, headshots FROM weapon_daily`).get()).toEqual({ kills: 2, headshots: 1 });
    expect(conn.prepare(`SELECT match_id FROM kills LIMIT 1`).get()).toEqual({ match_id: state.matchId });
  });

  it('flags teamkills and suicides and keeps them off kill totals', () => {
    recordObservation(
      conn,
      state,
      {
        now: T0,
        status: status('Europe', [0, 0, 0]),
        players: [player(A, 'Valkyra', 0, 0), player(B, 'Valkyra', 0, 0)],
      },
      OPTS,
    );
    ingestKills(
      conn,
      'eu-1',
      [
        kill('tk'),
        kill('s', { victimSteamId: A, victimName: 'PA', contextTags: ['Meta.PlayerKillFlag.Player.Suicide'] }),
      ],
      T0 + 1,
    );
    const rows = conn.prepare(`SELECT event_id, teamkill, suicide FROM kills ORDER BY event_id`).all();
    expect(rows).toEqual([
      { event_id: 's', teamkill: 0, suicide: 1 },
      { event_id: 'tk', teamkill: 1, suicide: 0 },
    ]);
    const a = conn.prepare(`SELECT kills, teamkills, suicides, deaths FROM player_daily WHERE steam_id = ?`).get(A);
    expect(a).toEqual({ kills: 0, teamkills: 1, suicides: 1, deaths: 1 });
  });

  it('ignores event types it does not know', () => {
    expect(ingestKills(conn, 'eu-1', [{ eventId: 'x', type: 'spawned' }], T0)).toEqual({
      accepted: 0,
      duplicates: 0,
      ignored: 1,
    });
  });
});
