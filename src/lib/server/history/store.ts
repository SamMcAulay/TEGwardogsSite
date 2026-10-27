// The site's own memory of the stats, which Warcon only serves as they stand now: every finished
// round since season two began (who played it, on which side, how they did) and a daily snapshot
// of the all-time board. Trends, skill ratings and rank movement are worked out from these.
// Node's built-in SQLite, history.db in DATA_DIR. Rebuildable: losing it loses only the snapshots
// (the rounds come back from Warcon), so it holds nothing private and needs no backup.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const HISTORY_MIGRATIONS = [
  `CREATE TABLE rounds (
     server_id  TEXT NOT NULL,
     match_id   INTEGER NOT NULL,
     started_at INTEGER NOT NULL,
     ended_at   INTEGER NOT NULL,
     map        TEXT,
     lighting   TEXT,
     winner     TEXT,
     peak       INTEGER NOT NULL,
     -- [{"name": faction, "score": n}], as the round ended
     scores     TEXT NOT NULL,
     PRIMARY KEY (server_id, match_id)
   );
   CREATE INDEX rounds_by_end ON rounds (ended_at);
   CREATE TABLE round_lines (
     server_id TEXT NOT NULL,
     match_id  INTEGER NOT NULL,
     steam_id  TEXT NOT NULL,
     faction   TEXT,
     seconds   INTEGER NOT NULL,
     kills     INTEGER NOT NULL,
     deaths    INTEGER NOT NULL,
     headshots INTEGER NOT NULL,
     result    TEXT,
     PRIMARY KEY (server_id, match_id, steam_id)
   );
   CREATE INDEX lines_by_player ON round_lines (steam_id);
   -- the all-time board once a UTC day; a player's row is written only when it changed
   CREATE TABLE snapshot_days (day TEXT PRIMARY KEY, taken_at INTEGER NOT NULL, players INTEGER NOT NULL);
   CREATE TABLE snapshots (
     steam_id  TEXT NOT NULL,
     day       TEXT NOT NULL,
     kills     INTEGER NOT NULL,
     deaths    INTEGER NOT NULL,
     minutes   INTEGER NOT NULL,
     matches   INTEGER NOT NULL,
     wins      INTEGER NOT NULL,
     losses    INTEGER NOT NULL,
     draws     INTEGER NOT NULL,
     headshots INTEGER NOT NULL,
     cash      INTEGER NOT NULL,
     PRIMARY KEY (steam_id, day)
   );
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

export interface StoredRound {
  serverId: string;
  matchId: number;
  startedAt: number;
  endedAt: number;
  map: string | null;
  lighting: string | null;
  winner: string | null;
  peak: number;
  scores: { name: string; score: number }[];
}

export interface StoredLine {
  steamId: string;
  faction: string | null;
  seconds: number;
  kills: number;
  deaths: number;
  headshots: number;
  result: string | null;
}

export interface BoardTotals {
  kills: number;
  deaths: number;
  minutes: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  headshots: number;
  cash: number;
}

const TOTAL_KEYS = ['kills', 'deaths', 'minutes', 'matches', 'wins', 'losses', 'draws', 'headshots', 'cash'] as const;

function migrate(db: DatabaseSync, migrations: string[]) {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version > migrations.length) {
    throw new Error(`history.db is at schema v${version}, newer than this build (v${migrations.length})`);
  }
  if (version === migrations.length) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let v = version; v < migrations.length; v++) db.exec(migrations[v]);
    db.exec(`PRAGMA user_version = ${migrations.length}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

type Totals = Record<(typeof TOTAL_KEYS)[number], number>;
const totalsOf = (r: Record<string, unknown>): BoardTotals =>
  Object.fromEntries(TOTAL_KEYS.map((k) => [k, Number(r[k]) || 0])) as Totals;
const same = (a: BoardTotals, b: BoardTotals) => TOTAL_KEYS.every((k) => a[k] === b[k]);

export function openHistory(file: string, migrations: string[] = HISTORY_MIGRATIONS) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  migrate(db, migrations);
  const q = {
    hasRound: db.prepare('SELECT 1 FROM rounds WHERE server_id = ? AND match_id = ?'),
    addRound: db.prepare(`INSERT OR REPLACE INTO rounds (server_id, match_id, started_at, ended_at, map, lighting, winner, peak, scores)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    dropLines: db.prepare('DELETE FROM round_lines WHERE server_id = ? AND match_id = ?'),
    addLine: db.prepare(`INSERT OR REPLACE INTO round_lines (server_id, match_id, steam_id, faction, seconds, kills, deaths, headshots, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    rounds: db.prepare('SELECT * FROM rounds WHERE ended_at >= ? ORDER BY ended_at, server_id, match_id'),
    lines: db.prepare(`SELECT l.* FROM round_lines l JOIN rounds r USING (server_id, match_id) WHERE r.ended_at >= ?`),
    roundCount: db.prepare('SELECT count(*) AS n FROM rounds'),
    playerRounds: db.prepare(`SELECT r.ended_at, l.seconds, l.kills, l.deaths, l.headshots, l.result
      FROM round_lines l JOIN rounds r USING (server_id, match_id) WHERE l.steam_id = ? AND r.ended_at >= ? ORDER BY r.ended_at`),
    daily: db.prepare(`SELECT date(r.ended_at, 'unixepoch') AS day, count(DISTINCT r.server_id || ':' || r.match_id) AS rounds,
      count(DISTINCT l.steam_id) AS players, coalesce(sum(l.kills), 0) AS kills, coalesce(sum(l.seconds), 0) AS seconds
      FROM rounds r LEFT JOIN round_lines l USING (server_id, match_id) WHERE r.ended_at >= ? GROUP BY day ORDER BY day`),
    hasDay: db.prepare('SELECT 1 FROM snapshot_days WHERE day = ?'),
    addDay: db.prepare('INSERT INTO snapshot_days (day, taken_at, players) VALUES (?, ?, ?)'),
    days: db.prepare('SELECT day FROM snapshot_days ORDER BY day'),
    latest: db.prepare(`SELECT s.* FROM snapshots s JOIN (SELECT steam_id, max(day) AS day FROM snapshots WHERE day <= ? GROUP BY steam_id) m
      USING (steam_id, day)`),
    addSnap: db.prepare(`INSERT OR REPLACE INTO snapshots (steam_id, day, kills, deaths, minutes, matches, wins, losses, draws, headshots, cash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    playerSnaps: db.prepare('SELECT * FROM snapshots WHERE steam_id = ? ORDER BY day'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'),
  };

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const asOf = (day: string): Map<string, BoardTotals> =>
    new Map((q.latest.all(day) as Record<string, unknown>[]).map((r) => [String(r.steam_id), totalsOf(r)]));

  return {
    hasRound: (serverId: string, matchId: number) => !!q.hasRound.get(serverId, matchId),
    /** Stores a finished round and its lines, replacing any earlier copy. */
    addRound(r: StoredRound, lines: StoredLine[]) {
      tx(() => {
        q.addRound.run(r.serverId, r.matchId, r.startedAt, r.endedAt, r.map, r.lighting, r.winner, r.peak, JSON.stringify(r.scores));
        q.dropLines.run(r.serverId, r.matchId);
        for (const l of lines) q.addLine.run(r.serverId, r.matchId, l.steamId, l.faction, l.seconds, l.kills, l.deaths, l.headshots, l.result);
      });
    },
    roundCount: () => (q.roundCount.get() as { n: number }).n,
    /** Every round ended since `since`, oldest first, each with its lines. */
    rounds(since = 0): (StoredRound & { lines: StoredLine[] })[] {
      const byKey = new Map<string, StoredLine[]>();
      for (const l of q.lines.all(since) as Record<string, unknown>[]) {
        const key = `${l.server_id}:${l.match_id}`;
        const list = byKey.get(key) ?? [];
        list.push({
          steamId: String(l.steam_id),
          faction: (l.faction as string | null) ?? null,
          seconds: Number(l.seconds),
          kills: Number(l.kills),
          deaths: Number(l.deaths),
          headshots: Number(l.headshots),
          result: (l.result as string | null) ?? null,
        });
        byKey.set(key, list);
      }
      return (q.rounds.all(since) as Record<string, unknown>[]).map((r) => ({
        serverId: String(r.server_id),
        matchId: Number(r.match_id),
        startedAt: Number(r.started_at),
        endedAt: Number(r.ended_at),
        map: (r.map as string | null) ?? null,
        lighting: (r.lighting as string | null) ?? null,
        winner: (r.winner as string | null) ?? null,
        peak: Number(r.peak),
        scores: JSON.parse(String(r.scores)) as { name: string; score: number }[],
        lines: byKey.get(`${r.server_id}:${r.match_id}`) ?? [],
      }));
    },
    /** One player's rounds since `since`, oldest first. */
    playerRounds: (steamId: string, since = 0) =>
      (q.playerRounds.all(steamId, since) as Record<string, unknown>[]).map((r) => ({
        endedAt: Number(r.ended_at),
        seconds: Number(r.seconds),
        kills: Number(r.kills),
        deaths: Number(r.deaths),
        headshots: Number(r.headshots),
        result: (r.result as string | null) ?? null,
      })),
    /** Rounds, different players, kills and seconds played per UTC day since `since`. */
    daily: (since = 0) =>
      (q.daily.all(since) as Record<string, unknown>[]).map((r) => ({
        day: String(r.day),
        rounds: Number(r.rounds),
        players: Number(r.players),
        kills: Number(r.kills),
        seconds: Number(r.seconds),
      })),

    hasSnapshot: (day: string) => !!q.hasDay.get(day),
    snapshotDays: () => (q.days.all() as { day: string }[]).map((r) => r.day),
    /**
     * Saves the board as it stands on `day` (UTC, YYYY-MM-DD): only the players whose totals moved
     * since their last row, so an unchanged player costs nothing. Returns how many rows were written.
     */
    saveSnapshot(day: string, rows: { steamId: string; totals: BoardTotals }[], at = Math.floor(Date.now() / 1000)): number {
      if (q.hasDay.get(day)) return 0;
      const before = asOf(day);
      return tx(() => {
        let written = 0;
        for (const { steamId, totals } of rows) {
          const prev = before.get(steamId);
          if (prev && same(prev, totals)) continue;
          q.addSnap.run(steamId, day, ...TOTAL_KEYS.map((k) => totals[k]));
          written++;
        }
        q.addDay.run(day, at, rows.length);
        return written;
      });
    },
    /** Every player's totals as they stood on `day`: their latest row on or before it. */
    asOf,
    /** One player's snapshot rows (the days their totals changed), oldest first. */
    playerSnapshots: (steamId: string) =>
      (q.playerSnaps.all(steamId) as Record<string, unknown>[]).map((r) => ({ day: String(r.day), ...totalsOf(r) })),

    meta: (key: string) => (q.getMeta.get(key) as { value: string } | undefined)?.value ?? null,
    setMeta: (key: string, value: string) => void q.setMeta.run(key, value),
    close: () => db.close(),
  };
}

export type History = ReturnType<typeof openHistory>;

const g = globalThis as unknown as { __history?: History | null };

/**
 * The process-wide history in DATA_DIR (./data by default, the same volume as accounts.db),
 * opened on first use. Null when it can't be opened: trends and ratings then just don't show.
 */
export function history(): History | null {
  if (g.__history === undefined) {
    try {
      const dir = (process.env.DATA_DIR ?? '').trim() || './data';
      mkdirSync(dir, { recursive: true });
      g.__history = openHistory(join(dir, 'history.db'));
    } catch (e) {
      console.error('[history] not available:', e instanceof Error ? e.message : e);
      g.__history = null;
    }
  }
  return g.__history;
}
