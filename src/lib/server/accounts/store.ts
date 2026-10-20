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
  /** "hide where I'm playing": only accepted friends see their server and recent rounds */
  hidePresence: boolean;
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
  hide_presence?: number;
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
  hidePresence: r.hide_presence === 1,
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

/** A /notify alert. players: DM when a server reaches `threshold` players. map: DM when `map` starts with `threshold`+ playing. */
export interface Alert {
  id: number;
  discordId: string;
  kind: 'players' | 'map';
  /** null: any server */
  serverId: string | null;
  threshold: number;
  map: string | null;
  /** players alerts: may fire again (the count has dropped back since the last DM) */
  armed: boolean;
  lastSent: number | null;
  /** DMs that failed in a row; at ALERT_MAX_FAILURES the member's alerts pause */
  failures: number;
  createdAt: number;
}

interface AlertRow {
  id: number;
  discord_id: string;
  kind: 'players' | 'map';
  server_id: string | null;
  threshold: number;
  map: string | null;
  armed: number;
  last_sent: number | null;
  failures: number;
  created_at: number;
}

const toAlert = (r: AlertRow): Alert => ({
  id: r.id,
  discordId: r.discord_id,
  kind: r.kind,
  serverId: r.server_id,
  threshold: r.threshold,
  map: r.map,
  armed: r.armed === 1,
  lastSent: r.last_sent,
  failures: r.failures,
  createdAt: r.created_at,
});

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
  // v7: /notify alerts: a Discord DM when a server fills up or a map starts. Anyone in the TEG
  // server may set them, linked or not, so they key on the Discord id alone.
  `CREATE TABLE alerts (
     id         INTEGER PRIMARY KEY,
     discord_id TEXT NOT NULL,
     kind       TEXT NOT NULL CHECK (kind IN ('players', 'map')),
     server_id  TEXT,
     threshold  INTEGER NOT NULL,
     map        TEXT,
     armed      INTEGER NOT NULL DEFAULT 1,
     last_sent  INTEGER,
     failures   INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX alerts_by_member ON alerts (discord_id);`,
  // v8: friend requests between linked members, and "hide where I'm playing" (lib/server/presence.ts)
  `ALTER TABLE links ADD COLUMN hide_presence INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE friendships (
     from_discord TEXT NOT NULL,
     to_discord   TEXT NOT NULL,
     status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'denied')),
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL,
     PRIMARY KEY (from_discord, to_discord)
   );
   CREATE INDEX friendships_to ON friendships (to_discord);`,
];

/** Friends one member may have, and requests they may have waiting on others at once. */
export const MAX_FRIENDS = 100;
export const MAX_PENDING_REQUESTS = 30;

/**
 * How another member stands with you. A request they denied still reads 'outgoing' to you: you
 * aren't told, and can't send it again.
 */
export type Relation = 'none' | 'outgoing' | 'incoming' | 'friends';

export class FriendLimitError extends Error {}

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
    dropFriendships: db.prepare('DELETE FROM friendships WHERE from_discord = ? OR to_discord = ?'),
    setHide: db.prepare('UPDATE links SET hide_presence = ? WHERE discord_id = ?'),
    hiddenSteam: db.prepare('SELECT steam_id FROM links WHERE hide_presence = 1'),
    friendRow: db.prepare('SELECT status FROM friendships WHERE from_discord = ? AND to_discord = ?'),
    friendInsert: db.prepare("INSERT INTO friendships (from_discord, to_discord, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)"),
    friendSet: db.prepare('UPDATE friendships SET status = ?, updated_at = ? WHERE from_discord = ? AND to_discord = ?'),
    friendDelete: db.prepare('DELETE FROM friendships WHERE from_discord = ? AND to_discord = ?'),
    friendsOf: db.prepare(`SELECT CASE WHEN from_discord = ?1 THEN to_discord ELSE from_discord END AS other, updated_at AS since
      FROM friendships WHERE status = 'accepted' AND (from_discord = ?1 OR to_discord = ?1) ORDER BY updated_at`),
    incoming: db.prepare("SELECT from_discord AS other, created_at AS since FROM friendships WHERE to_discord = ? AND status = 'pending' ORDER BY created_at"),
    outgoing: db.prepare("SELECT to_discord AS other, created_at AS since FROM friendships WHERE from_discord = ? AND status IN ('pending', 'denied') ORDER BY created_at"),
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
    addAlert: db.prepare('INSERT INTO alerts (discord_id, kind, server_id, threshold, map, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    alertsOf: db.prepare('SELECT * FROM alerts WHERE discord_id = ? ORDER BY id'),
    allAlerts: db.prepare('SELECT * FROM alerts ORDER BY id'),
    removeAlert: db.prepare('DELETE FROM alerts WHERE discord_id = ? AND id = ?'),
    removeAlerts: db.prepare('DELETE FROM alerts WHERE discord_id = ?'),
    alertState: db.prepare('UPDATE alerts SET armed = ?, last_sent = ? WHERE id = ?'),
    alertFailures: db.prepare('UPDATE alerts SET failures = ? WHERE discord_id = ?'),
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
    /** Unlinks, and ends their friendships and requests: they belonged to the linked player. */
    unlink(discordId: string) {
      q.remove.run(discordId);
      q.dropFriendships.run(discordId, discordId);
    },
    setHidePresence: (discordId: string, hide: boolean) => void q.setHide.run(hide ? 1 : 0, discordId),
    /** Steam accounts whose members hide where they're playing. */
    presenceHidden: () => new Set((q.hiddenSteam.all() as unknown as { steam_id: string }[]).map((r) => r.steam_id)),
    /** How `other` stands with `me` (Discord ids). */
    relation(me: string, other: string): Relation {
      const out = (q.friendRow.get(me, other) as { status: string } | undefined)?.status;
      const inc = (q.friendRow.get(other, me) as { status: string } | undefined)?.status;
      if (out === 'accepted' || inc === 'accepted') return 'friends';
      if (inc === 'pending') return 'incoming';
      if (out) return 'outgoing';
      return 'none';
    },
    /**
     * `me` asks `other` to be friends. If `other` already asked `me`, that makes them friends. A
     * request `other` denied stays as it is. Throws FriendLimitError past the limits.
     */
    requestFriend(me: string, other: string, at = now()): Relation {
      if (me === other) return 'none';
      const rel = this.relation(me, other);
      if (rel === 'friends' || rel === 'outgoing') return rel;
      if (this.friendsOf(me).length >= MAX_FRIENDS) throw new FriendLimitError(`You can have up to ${MAX_FRIENDS} friends.`);
      if (rel === 'incoming') {
        q.friendSet.run('accepted', at, other, me);
        return 'friends';
      }
      if (this.outgoing(me).length >= MAX_PENDING_REQUESTS) throw new FriendLimitError(`You can have up to ${MAX_PENDING_REQUESTS} requests waiting at once.`);
      // A request of mine they denied long ago, or one I took back: start afresh.
      q.friendDelete.run(me, other);
      q.friendInsert.run(me, other, at, at);
      return 'outgoing';
    },
    /** `me` accepts or denies `other`'s request; false when there was none. */
    answerFriend(me: string, other: string, accept: boolean, at = now()): boolean {
      if ((q.friendRow.get(other, me) as { status: string } | undefined)?.status !== 'pending') return false;
      if (accept && this.friendsOf(me).length >= MAX_FRIENDS) throw new FriendLimitError(`You can have up to ${MAX_FRIENDS} friends.`);
      q.friendSet.run(accept ? 'accepted' : 'denied', at, other, me);
      return true;
    },
    /** Ends a friendship, or takes back `me`'s request. A request `me` denied stays denied. */
    removeFriend(me: string, other: string) {
      q.friendDelete.run(me, other);
      if ((q.friendRow.get(other, me) as { status: string } | undefined)?.status === 'accepted') q.friendDelete.run(other, me);
    },
    friendsOf: (me: string) => q.friendsOf.all(me) as unknown as { other: string; since: number }[],
    incoming: (me: string) => q.incoming.all(me) as unknown as { other: string; since: number }[],
    outgoing: (me: string) => q.outgoing.all(me) as unknown as { other: string; since: number }[],
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
    /** Adds an alert; the member's alerts un-pause, since they've just asked again. */
    addAlert(a: Pick<Alert, 'discordId' | 'kind' | 'serverId' | 'threshold' | 'map'>, at = now()): Alert {
      const { lastInsertRowid } = q.addAlert.run(a.discordId, a.kind, a.serverId, a.threshold, a.map, at);
      q.alertFailures.run(0, a.discordId);
      return toAlert(db.prepare('SELECT * FROM alerts WHERE id = ?').get(lastInsertRowid) as unknown as AlertRow);
    },
    alertsOf: (discordId: string) => (q.alertsOf.all(discordId) as unknown as AlertRow[]).map(toAlert),
    allAlerts: () => (q.allAlerts.all() as unknown as AlertRow[]).map(toAlert),
    /** Removes one of the member's alerts, or all of them with no id; how many went. */
    removeAlerts: (discordId: string, id?: number) => Number((id === undefined ? q.removeAlerts.run(discordId) : q.removeAlert.run(discordId, id)).changes),
    setAlertState: (id: number, armed: boolean, lastSent: number | null) => void q.alertState.run(armed ? 1 : 0, lastSent, id),
    /** DMs to the member that failed in a row (0 after one gets through), on all their alerts. */
    setAlertFailures: (discordId: string, failures: number) => void q.alertFailures.run(failures, discordId),
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
