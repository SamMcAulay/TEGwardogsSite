import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env, getServerConfigs } from './config';

/**
 * Schema migrations, applied in order and tracked with `PRAGMA user_version`.
 * Times are unix seconds (UTC); `day` columns are `YYYY-MM-DD` in UTC.
 */
const MIGRATIONS: string[] = [
  /* sql */ `
  CREATE TABLE servers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    short_name  TEXT NOT NULL,
    region      TEXT NOT NULL,
    location    TEXT NOT NULL DEFAULT '',
    sort        INTEGER NOT NULL DEFAULT 0
  );

  -- Latest observation of each server, written by the poller on every tick.
  CREATE TABLE server_live (
    server_id       TEXT PRIMARY KEY REFERENCES servers(id),
    online          INTEGER NOT NULL DEFAULT 0,
    updated_at      INTEGER NOT NULL,
    last_online_at  INTEGER,
    fail_count      INTEGER NOT NULL DEFAULT 0,
    status_json     TEXT,
    players_json    TEXT,
    join_code       TEXT,
    started_at      INTEGER,
    error           TEXT
  );

  -- One population sample per server per minute.
  CREATE TABLE population (
    server_id   TEXT NOT NULL,
    ts          INTEGER NOT NULL,
    players     INTEGER NOT NULL,
    max_players INTEGER NOT NULL,
    PRIMARY KEY (server_id, ts)
  ) WITHOUT ROWID;

  CREATE TABLE players (
    steam_id           TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    first_seen         INTEGER NOT NULL,
    last_seen          INTEGER NOT NULL,
    last_server_id     TEXT,
    avatar_url         TEXT,
    avatar_checked_at  INTEGER
  );
  CREATE INDEX players_name ON players(name COLLATE NOCASE);
  CREATE INDEX players_last_seen ON players(last_seen);

  CREATE TABLE player_names (
    steam_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    PRIMARY KEY (steam_id, name)
  ) WITHOUT ROWID;
  CREATE INDEX player_names_name ON player_names(name COLLATE NOCASE);

  CREATE TABLE matches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id     TEXT NOT NULL,
    map           TEXT NOT NULL,
    experiences   TEXT NOT NULL DEFAULT '[]',
    lighting      TEXT,
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    winner        TEXT,
    scores_json   TEXT NOT NULL DEFAULT '[]',
    peak_players  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX matches_server ON matches(server_id, started_at);
  CREATE INDEX matches_started ON matches(started_at);

  -- A player's stay in one match. Kills/deaths/cash are the RCON scoreboard values.
  CREATE TABLE sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    steam_id      TEXT NOT NULL,
    server_id     TEXT NOT NULL,
    match_id      INTEGER NOT NULL,
    faction       TEXT,
    started_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    ended_at      INTEGER,
    kills         INTEGER NOT NULL DEFAULT 0,
    deaths        INTEGER NOT NULL DEFAULT 0,
    cash          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_player ON sessions(steam_id, started_at);
  CREATE INDEX sessions_match ON sessions(match_id);
  CREATE INDEX sessions_open ON sessions(server_id) WHERE ended_at IS NULL;

  -- Kill feed events ([WDServerFeed]).
  CREATE TABLE kills (
    event_id         TEXT PRIMARY KEY,
    server_id        TEXT NOT NULL,
    match_id         INTEGER,
    ts               INTEGER NOT NULL,
    map              TEXT,
    killer_steam_id  TEXT,
    killer_name      TEXT,
    victim_steam_id  TEXT,
    victim_name      TEXT,
    cause            TEXT,
    distance_m       REAL,
    headshot         INTEGER NOT NULL DEFAULT 0,
    suicide          INTEGER NOT NULL DEFAULT 0,
    teamkill         INTEGER NOT NULL DEFAULT 0,
    tags             TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX kills_ts ON kills(ts);
  CREATE INDEX kills_server_ts ON kills(server_id, ts);
  CREATE INDEX kills_killer ON kills(killer_steam_id, ts);
  CREATE INDEX kills_victim ON kills(victim_steam_id, ts);
  CREATE INDEX kills_match ON kills(match_id);
  CREATE INDEX kills_cause_ts ON kills(cause, ts);

  -- Per player, server and day totals. Leaderboards read this instead of scanning kills.
  CREATE TABLE player_daily (
    steam_id        TEXT NOT NULL,
    server_id       TEXT NOT NULL,
    day             TEXT NOT NULL,
    kills           INTEGER NOT NULL DEFAULT 0,
    deaths          INTEGER NOT NULL DEFAULT 0,
    headshots       INTEGER NOT NULL DEFAULT 0,
    suicides        INTEGER NOT NULL DEFAULT 0,
    teamkills       INTEGER NOT NULL DEFAULT 0,
    playtime_s      INTEGER NOT NULL DEFAULT 0,
    longest_kill_m  REAL NOT NULL DEFAULT 0,
    matches         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steam_id, server_id, day)
  ) WITHOUT ROWID;
  CREATE INDEX player_daily_day ON player_daily(day);
  `,
  /* sql */ `
  -- Per weapon, server and day totals for the weapons pages.
  CREATE TABLE weapon_daily (
    cause         TEXT NOT NULL,
    server_id     TEXT NOT NULL,
    day           TEXT NOT NULL,
    kills         INTEGER NOT NULL DEFAULT 0,
    headshots     INTEGER NOT NULL DEFAULT 0,
    longest_m     REAL NOT NULL DEFAULT 0,
    distance_sum  REAL NOT NULL DEFAULT 0,
    distance_n    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (cause, server_id, day)
  ) WITHOUT ROWID;
  CREATE INDEX weapon_daily_day ON weapon_daily(day);

  INSERT INTO weapon_daily (cause, server_id, day, kills, headshots, longest_m, distance_sum, distance_n)
  SELECT cause, server_id, date(ts, 'unixepoch'), COUNT(*), SUM(headshot), COALESCE(MAX(distance_m), 0),
         COALESCE(SUM(distance_m), 0), COUNT(distance_m)
  FROM kills WHERE cause IS NOT NULL AND suicide = 0 AND teamkill = 0
  GROUP BY cause, server_id, date(ts, 'unixepoch');

  CREATE INDEX kills_distance ON kills(distance_m DESC) WHERE suicide = 0 AND teamkill = 0;
  `,
];

type GlobalWithDb = typeof globalThis & { __tegDb?: Database.Database };

/** The shared connection. Kept on globalThis so dev-mode module reloads reuse it. */
export function db(): Database.Database {
  const g = globalThis as GlobalWithDb;
  if (!g.__tegDb) g.__tegDb = open(env.databasePath);
  return g.__tegDb;
}

export function open(file: string): Database.Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = NORMAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  conn.pragma('cache_size = -65536');
  conn.pragma('temp_store = MEMORY');
  migrate(conn);
  syncServers(conn);
  // Refresh planner statistics where they are missing or stale (cheap; see sqlite.org/lang_analyze.html).
  conn.pragma('optimize = 0x10002');
  return conn;
}

function migrate(conn: Database.Database) {
  const version = conn.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    conn.transaction(() => {
      conn.exec(MIGRATIONS[v]);
      conn.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Mirror the configured servers into the table the queries join against. */
function syncServers(conn: Database.Database) {
  const upsert = conn.prepare(`
    INSERT INTO servers (id, name, short_name, region, location, sort)
    VALUES (@id, @name, @shortName, @region, @location, @sort)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name,
      region = excluded.region, location = excluded.location, sort = excluded.sort`);
  conn.transaction(() => {
    getServerConfigs().forEach((s, i) => upsert.run({ ...s, location: s.location ?? '', sort: i }));
  })();
}

export function dayOf(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const statements = new WeakMap<Database.Database, Map<string, Database.Statement>>();

/** A prepared statement, cached per connection. */
export function stmt(conn: Database.Database, sql: string): Database.Statement {
  let cache = statements.get(conn);
  if (!cache) statements.set(conn, (cache = new Map()));
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = conn.prepare(sql)));
  return s;
}
