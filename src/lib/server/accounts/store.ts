// Linked accounts: one Discord account to one Steam account, the tier its roles last granted, and
// its Discord name as last seen (shown to staff on /admin only, never on public pages), plus a log
// of what staff did on /admin. Node's built-in SQLite, one file in DATA_DIR. Role ids aren't stored.
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
  /** server nickname or Discord name, as last seen; staff-only */
  discordName: string | null;
  /** a name style staff gave this account, shown while they hold a tier; null: the tier's own */
  nameStyle: string | null;
  /** custom profile, shown while they're Premium or staff (lib/profile-themes.ts) */
  bio: string | null;
  colour: string | null;
  featured: string[];
  linkedAt: number;
}

interface Row {
  discord_id: string;
  steam_id: string;
  tier: number | null;
  checked_at: number | null;
  linked_at: number;
  discord_name: string | null;
  name_style: string | null;
  bio: string | null;
  colour: string | null;
  featured: string | null;
}

function featuredList(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

const toLink = (r: Row): Link => ({
  discordId: r.discord_id,
  steamId: r.steam_id,
  tier: (r.tier as Tier | null) ?? null,
  checkedAt: r.checked_at,
  linkedAt: r.linked_at,
  discordName: r.discord_name ?? null,
  nameStyle: r.name_style ?? null,
  bio: r.bio ?? null,
  colour: r.colour ?? null,
  featured: featuredList(r.featured ?? null),
});

const now = () => Math.floor(Date.now() / 1000);

export type AdminAction = 'unlink' | 'recheck' | 'style' | 'profile' | 'export';

export interface AdminLogEntry {
  at: number;
  adminDiscordId: string;
  action: AdminAction;
  targetDiscordId: string;
  targetSteamId: string | null;
  adminName: string | null;
  targetName: string | null;
  /** what the action set, e.g. the name style */
  detail?: string | null;
}

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
  // v2: what staff did on /admin, and who did it
  `CREATE TABLE admin_log (
     id                INTEGER PRIMARY KEY,
     at                INTEGER NOT NULL,
     admin_discord_id  TEXT NOT NULL,
     action            TEXT NOT NULL,
     target_discord_id TEXT NOT NULL,
     target_steam_id   TEXT
   )`,
  // v3: Discord names for /admin, kept current by the tier sync; names in the log outlive unlinks
  `ALTER TABLE links ADD COLUMN discord_name TEXT;
   ALTER TABLE admin_log ADD COLUMN admin_name TEXT;
   ALTER TABLE admin_log ADD COLUMN target_name TEXT;`,
  // v4: rounds already posted to Discord, so each is posted once
  `CREATE TABLE announced_rounds (
     server_id TEXT NOT NULL,
     match_id  INTEGER NOT NULL,
     at        INTEGER NOT NULL,
     PRIMARY KEY (server_id, match_id)
   )`,
  // v5: a name style staff gave the account (see lib/name-styles.ts); what a staff action set
  `ALTER TABLE links ADD COLUMN name_style TEXT;
   ALTER TABLE admin_log ADD COLUMN detail TEXT;`,
  // v6: custom profiles (Premium and staff): bio, profile colour, featured milestone badges (JSON)
  `ALTER TABLE links ADD COLUMN bio TEXT;
   ALTER TABLE links ADD COLUMN colour TEXT;
   ALTER TABLE links ADD COLUMN featured TEXT;`,
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
    // a null name (they left the server) keeps the last one seen
    setTier: db.prepare('UPDATE links SET tier = ?, checked_at = ?, discord_name = COALESCE(?, discord_name) WHERE discord_id = ?'),
    due: db.prepare('SELECT * FROM links WHERE checked_at IS NULL OR checked_at < ? ORDER BY checked_at IS NOT NULL, checked_at LIMIT ?'),
    tiered: db.prepare('SELECT steam_id, tier, linked_at FROM links WHERE tier IS NOT NULL ORDER BY tier, linked_at, steam_id'),
    recent: db.prepare('SELECT * FROM links ORDER BY linked_at DESC, discord_id LIMIT ? OFFSET ?'),
    all: db.prepare('SELECT * FROM links ORDER BY linked_at, discord_id'),
    steamIds: db.prepare('SELECT steam_id FROM links'),
    announced: db.prepare('SELECT 1 FROM announced_rounds WHERE server_id = ? AND match_id = ?'),
    anyAnnounced: db.prepare('SELECT 1 FROM announced_rounds WHERE server_id = ? LIMIT 1'),
    announce: db.prepare('INSERT OR IGNORE INTO announced_rounds (server_id, match_id, at) VALUES (?, ?, ?)'),
    counts: db.prepare('SELECT tier, count(*) AS n FROM links GROUP BY tier'),
    log: db.prepare('INSERT INTO admin_log (at, admin_discord_id, action, target_discord_id, target_steam_id, admin_name, target_name, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    setStyle: db.prepare('UPDATE links SET name_style = ? WHERE discord_id = ?'),
    setProfile: db.prepare('UPDATE links SET bio = ?, colour = ?, featured = ? WHERE discord_id = ?'),
    clearBio: db.prepare('UPDATE links SET bio = NULL WHERE discord_id = ?'),
    byName: db.prepare("SELECT * FROM links WHERE discord_name LIKE ? ESCAPE '\\' ORDER BY discord_name LIMIT ?"),
    auditLog: db.prepare('SELECT * FROM admin_log ORDER BY at DESC, id DESC LIMIT ?'),
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
    setTier: (discordId: string, tier: Tier | null, at = now(), discordName: string | null = null) =>
      void q.setTier.run(tier, at, discordName, discordId),
    /** Links whose roles were last checked before `olderThan` (never-checked first). */
    due: (olderThan: number, limit: number) => (q.due.all(olderThan, limit) as unknown as Row[]).map(toLink),
    /** Every linked Steam account that has a tier: best tier first, then earliest linked. */
    tiered: () =>
      (q.tiered.all() as unknown as { steam_id: string; tier: Tier; linked_at: number }[]).map((r) => ({
        steamId: r.steam_id,
        tier: r.tier,
        linkedAt: r.linked_at,
      })),
    /** Give an account its own name style, or null for its tier's. */
    setNameStyle: (discordId: string, style: string | null) => void q.setStyle.run(style, discordId),
    /** Save a custom profile (already checked by the caller). */
    setProfile: (discordId: string, p: { bio: string | null; colour: string | null; featured: string[] }) =>
      void q.setProfile.run(p.bio, p.colour, JSON.stringify(p.featured), discordId),
    clearBio: (discordId: string) => void q.clearBio.run(discordId),
    /** Round results already posted (or skipped) for a server's match. */
    isAnnounced: (serverId: string, matchId: number) => !!q.announced.get(serverId, matchId),
    /** False until a server's first round is recorded: the first run records without posting. */
    knowsServer: (serverId: string) => !!q.anyAnnounced.get(serverId),
    markAnnounced: (serverId: string, matchId: number, at = now()) => void q.announce.run(serverId, matchId, at),
    /** Every linked Steam account. */
    linkedSteamIds: () => new Set((q.steamIds.all() as unknown as { steam_id: string }[]).map((r) => r.steam_id)),
    /** Newest links first. */
    recent: (limit: number, offset = 0) => (q.recent.all(limit, offset) as unknown as Row[]).map(toLink),
    /** Every link, oldest first. */
    all: () => (q.all.all() as unknown as Row[]).map(toLink),
    /** How many links hold each tier; `none` counts linked accounts with no tier. */
    counts() {
      const out = { total: 0, 1: 0, 2: 0, 3: 0, none: 0 };
      for (const r of q.counts.all() as unknown as { tier: Tier | null; n: number }[]) {
        out.total += r.n;
        if (r.tier) out[r.tier] = r.n;
        else out.none = r.n;
      }
      return out;
    },
    log(e: Omit<AdminLogEntry, 'at'>, at = now()) {
      q.log.run(at, e.adminDiscordId, e.action, e.targetDiscordId, e.targetSteamId, e.adminName, e.targetName, e.detail ?? null);
    },
    /** Newest admin actions first. */
    auditLog: (limit: number) =>
      (
        q.auditLog.all(limit) as unknown as {
          at: number;
          admin_discord_id: string;
          action: AdminAction;
          target_discord_id: string;
          target_steam_id: string | null;
          admin_name: string | null;
          target_name: string | null;
          detail: string | null;
        }[]
      ).map((r) => ({
        at: r.at,
        adminDiscordId: r.admin_discord_id,
        action: r.action,
        targetDiscordId: r.target_discord_id,
        targetSteamId: r.target_steam_id,
        adminName: r.admin_name,
        targetName: r.target_name,
        detail: r.detail ?? null,
      })),
    /** Links whose last-seen Discord name contains `text` (case-insensitive for ASCII). */
    byName: (text: string, limit = 25) =>
      (q.byName.all(`%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, limit) as unknown as Row[]).map(toLink),
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
