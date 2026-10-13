// Linked accounts: one Discord account to one Steam account, and the tier its roles last granted.
// Node's built-in SQLite, one file in DATA_DIR. Role ids and Discord names are never stored.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Tier } from '@/lib/tiers';

export interface Link {
  discordId: string;
  steamId: string;
  tier: Tier | null;
  /** unix seconds of the last answer from Discord about this member's roles */
  checkedAt: number | null;
  linkedAt: number;
}

interface Row {
  discord_id: string;
  steam_id: string;
  tier: number | null;
  checked_at: number | null;
  linked_at: number;
}

const toLink = (r: Row): Link => ({
  discordId: r.discord_id,
  steamId: r.steam_id,
  tier: (r.tier as Tier | null) ?? null,
  checkedAt: r.checked_at,
  linkedAt: r.linked_at,
});

const now = () => Math.floor(Date.now() / 1000);

export class SteamTakenError extends Error {
  constructor() {
    super('That Steam account is already linked to another Discord account.');
  }
}

/**
 * Schema changes, in order; never edit or remove one that has shipped, only append. Each runs once,
 * inside a transaction, and `PRAGMA user_version` records how many have run, so links made today
 * carry forward into whatever the queue later needs.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS links (
     discord_id TEXT PRIMARY KEY,
     steam_id   TEXT NOT NULL UNIQUE,
     tier       INTEGER CHECK (tier IN (1, 2, 3)),
     checked_at INTEGER,
     linked_at  INTEGER NOT NULL
   )`,
];

/** Brings the file up to date; snapshots it first (`<file>.pre-v<n>`) when it already holds links. */
function migrate(db: DatabaseSync, file: string, migrations: string[]) {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version > migrations.length) {
    throw new Error(`accounts.db is at schema v${version}, newer than this build (v${migrations.length}); refusing to run an older site against it`);
  }
  if (version === migrations.length) return;
  if (version > 0 && file !== ':memory:') db.exec(`VACUUM INTO '${`${file}.pre-v${migrations.length}`.replaceAll("'", "''")}'`);
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

export function openStore(file: string, migrations: string[] = MIGRATIONS) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  migrate(db, file, migrations);
  const q = {
    byDiscord: db.prepare('SELECT * FROM links WHERE discord_id = ?'),
    bySteam: db.prepare('SELECT * FROM links WHERE steam_id = ?'),
    upsert: db.prepare(`
      INSERT INTO links (discord_id, steam_id, tier, checked_at, linked_at) VALUES (?, ?, NULL, NULL, ?)
      ON CONFLICT (discord_id) DO UPDATE SET
        -- the date only moves when they switch to a different Steam account
        linked_at = CASE WHEN steam_id = excluded.steam_id THEN linked_at ELSE excluded.linked_at END,
        steam_id = excluded.steam_id
    `),
    remove: db.prepare('DELETE FROM links WHERE discord_id = ?'),
    setTier: db.prepare('UPDATE links SET tier = ?, checked_at = ? WHERE discord_id = ?'),
    due: db.prepare('SELECT * FROM links WHERE checked_at IS NULL OR checked_at < ? ORDER BY checked_at IS NOT NULL, checked_at LIMIT ?'),
    tiered: db.prepare('SELECT steam_id, tier, linked_at FROM links WHERE tier IS NOT NULL ORDER BY tier, linked_at, steam_id'),
  };
  const one = (r: unknown) => (r ? toLink(r as Row) : null);

  return {
    byDiscord: (discordId: string) => one(q.byDiscord.get(discordId)),
    bySteam: (steamId: string) => one(q.bySteam.get(steamId)),
    /** Links (or re-links) a Discord account to a Steam account. */
    link(discordId: string, steamId: string): Link {
      const holder = one(q.bySteam.get(steamId));
      if (holder && holder.discordId !== discordId) throw new SteamTakenError();
      q.upsert.run(discordId, steamId, now());
      return one(q.byDiscord.get(discordId))!;
    },
    unlink: (discordId: string) => void q.remove.run(discordId),
    setTier: (discordId: string, tier: Tier | null, at = now()) => void q.setTier.run(tier, at, discordId),
    /** Links whose roles were last checked before `olderThan` (never-checked first). */
    due: (olderThan: number, limit: number) => (q.due.all(olderThan, limit) as unknown as Row[]).map(toLink),
    /** Every linked Steam account that has a tier: best tier first, then earliest linked. */
    tiered: () =>
      (q.tiered.all() as unknown as { steam_id: string; tier: Tier; linked_at: number }[]).map((r) => ({
        steamId: r.steam_id,
        tier: r.tier,
        linkedAt: r.linked_at,
      })),
    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof openStore>;

const g = globalThis as unknown as { __accountsStore?: Store };

/** The process-wide store in `dataDir`, opened on first use. */
export function store(dataDir: string): Store {
  if (!g.__accountsStore) {
    mkdirSync(dataDir, { recursive: true });
    g.__accountsStore = openStore(join(dataDir, 'accounts.db'));
  }
  return g.__accountsStore;
}
