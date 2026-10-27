import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MIGRATIONS, openStore, SteamTakenError } from './store';

const D1 = '111111111111111111';
const D2 = '222222222222222222';
const S1 = '76561198000000001';
const S2 = '76561198000000002';

/** Pin the clock (unix seconds) that link dates are taken from. */
const at = (sec: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(sec * 1000);
};

describe('accounts store', () => {
  afterEach(() => vi.useRealTimers());

  test('links, re-links to another Steam account, and unlinks', () => {
    const s = openStore(':memory:');
    expect(s.link(D1, S1)).toMatchObject({ discordId: D1, steamId: S1, tier: null, checkedAt: null });
    expect(s.bySteam(S1)?.discordId).toBe(D1);
    s.link(D1, S2);
    expect(s.bySteam(S1)).toBeNull();
    expect(s.byDiscord(D1)?.steamId).toBe(S2);
    s.unlink(D1);
    expect(s.byDiscord(D1)).toBeNull();
  });

  test('a Steam account can only belong to one Discord account', () => {
    const s = openStore(':memory:');
    s.link(D1, S1);
    expect(() => s.link(D2, S1)).toThrow(SteamTakenError);
    expect(s.link(D1, S1).discordId).toBe(D1); // relinking your own is fine
  });

  test('re-linking keeps the known tier until the next check', () => {
    const s = openStore(':memory:');
    s.link(D1, S1);
    s.setTier(D1, 2, 1000);
    s.link(D1, S2);
    expect(s.byDiscord(D1)).toMatchObject({ tier: 2, checkedAt: 1000 });
  });

  test('due lists never-checked links first, then the stalest', () => {
    const s = openStore(':memory:');
    s.link(D1, S1);
    s.link(D2, S2);
    s.setTier(D1, 3, 500);
    expect(s.due(1000, 10).map((l) => l.discordId)).toEqual([D2, D1]);
    s.setTier(D2, null, 2000);
    expect(s.due(1000, 10).map((l) => l.discordId)).toEqual([D1]);
  });

  test('tiered lists only tiered accounts, best first, with when they linked', () => {
    const s = openStore(':memory:');
    at(1000);
    s.link(D1, S1);
    at(2000);
    s.link(D2, S2);
    s.setTier(D1, 3);
    s.setTier(D2, 1);
    expect(s.tiered()).toEqual([{ steamId: S2, tier: 1, linkedAt: 2000 }, { steamId: S1, tier: 3, linkedAt: 1000 }]);
    s.setTier(D2, null);
    expect(s.tiered()).toEqual([{ steamId: S1, tier: 3, linkedAt: 1000 }]);
  });

  test('recent lists newest links first; counts tally each tier', () => {
    const s = openStore(':memory:');
    at(1000);
    s.link(D1, S1);
    at(2000);
    s.link(D2, S2);
    s.setTier(D2, 1);
    expect(s.recent(10).map((l) => l.discordId)).toEqual([D2, D1]);
    expect(s.recent(1, 1).map((l) => l.discordId)).toEqual([D1]);
    expect(s.counts()).toEqual({ total: 2, 1: 1, 2: 0, 3: 0, none: 1 });
    expect(s.all().map((l) => l.discordId)).toEqual([D1, D2]);
  });

  test('announced rounds: per server, each once', () => {
    const s = openStore(':memory:');
    expect(s.knowsServer('s1')).toBe(false);
    s.markAnnounced('s1', 7);
    s.markAnnounced('s1', 7);
    expect(s.knowsServer('s1')).toBe(true);
    expect(s.isAnnounced('s1', 7)).toBe(true);
    expect(s.isAnnounced('s2', 7)).toBe(false);
  });

  test('linkedSteamIds lists every linked Steam account', () => {
    const s = openStore(':memory:');
    expect(s.linkedSteamIds()).toEqual(new Set());
    s.link(D1, S1);
    s.link(D2, S2);
    expect(s.linkedSteamIds()).toEqual(new Set([S1, S2]));
  });

  test('the audit log lists newest actions first', () => {
    const s = openStore(':memory:');
    s.log({ adminDiscordId: D1, adminName: 'Jan', action: 'recheck', targetDiscordId: D2, targetName: 'Owl', targetSteamId: S2 }, 100);
    s.log({ adminDiscordId: D1, adminName: 'Jan', action: 'unlink', targetDiscordId: D2, targetName: null, targetSteamId: S2 }, 200);
    expect(s.auditLog(10).map((e) => [e.at, e.action, e.targetName])).toEqual([[200, 'unlink', null], [100, 'recheck', 'Owl']]);
    expect(s.auditLog(1)).toHaveLength(1);
  });

  test('Discord names: stored with the tier, kept when Discord has none, searchable', () => {
    const s = openStore(':memory:');
    s.link(D1, S1);
    s.link(D2, S2);
    s.setTier(D1, 2, 100, 'Night Owl');
    s.setTier(D2, 3, 100, '100%_real');
    expect(s.byDiscord(D1)?.discordName).toBe('Night Owl');
    s.setTier(D1, null, 200, null); // left the server: name kept
    expect(s.byDiscord(D1)).toMatchObject({ tier: null, discordName: 'Night Owl' });
    expect(s.byName('owl').map((l) => l.discordId)).toEqual([D1]);
    expect(s.byName('%').map((l) => l.discordId)).toEqual([D2]); // wildcards match literally
    expect(s.byName('_r').map((l) => l.discordId)).toEqual([D2]);
    expect(s.byName('zzz')).toEqual([]);
  });

  test('re-linking the same Steam account keeps the original link date; switching accounts resets it', () => {
    const s = openStore(':memory:');
    at(1000);
    s.link(D1, S1);
    at(5000);
    expect(s.link(D1, S1).linkedAt).toBe(1000);
    expect(s.link(D1, S2).linkedAt).toBe(5000);
  });
});

describe('friends and privacy', () => {
  const D3 = '333333333333333333';
  const S3 = '76561198000000003';
  const store = () => {
    const s = openStore(':memory:');
    s.link(D1, S1);
    s.link(D2, S2);
    s.link(D3, S3);
    return s;
  };

  test('a request, accepted, makes friends both ways; either side can end it', () => {
    const s = store();
    expect(s.requestFriend(D1, D2, 10)).toBe('outgoing');
    expect([s.relation(D1, D2), s.relation(D2, D1)]).toEqual(['outgoing', 'incoming']);
    expect(s.incoming(D2)).toEqual([{ other: D1, since: 10 }]);
    expect(s.answerFriend(D2, D1, true, 20)).toBe(true);
    expect([s.relation(D1, D2), s.relation(D2, D1)]).toEqual(['friends', 'friends']);
    expect(s.friendsOf(D1)).toEqual([{ other: D2, since: 20 }]);
    expect(s.friendsOf(D2)).toEqual([{ other: D1, since: 20 }]);
    s.removeFriend(D2, D1);
    expect(s.relation(D1, D2)).toBe('none');
  });

  test('an accepted request is news to its sender until they open /friends', () => {
    const s = store();
    s.requestFriend(D1, D2, 10);
    expect(s.acceptedSince(D1)).toEqual([]);
    s.answerFriend(D2, D1, true, 20);
    expect(s.acceptedSince(D1)).toEqual([{ other: D2, since: 20 }]);
    // the one who accepted did it themselves: nothing to tell them
    expect(s.acceptedSince(D2)).toEqual([]);
    s.markFriendsSeen(D1, 25);
    expect(s.acceptedSince(D1)).toEqual([]);
    // a denial is never news
    s.requestFriend(D1, D3, 30);
    s.answerFriend(D3, D1, false, 40);
    expect(s.acceptedSince(D1)).toEqual([]);
  });

  test('asking someone who already asked you makes you friends', () => {
    const s = store();
    s.requestFriend(D1, D2);
    expect(s.requestFriend(D2, D1)).toBe('friends');
    expect(s.incoming(D2)).toEqual([]);
  });

  test('a denied request still looks pending to the sender, and cannot be sent again', () => {
    const s = store();
    s.requestFriend(D1, D2);
    expect(s.answerFriend(D2, D1, false)).toBe(true);
    expect(s.relation(D1, D2)).toBe('outgoing');
    expect(s.relation(D2, D1)).toBe('none');
    expect(s.incoming(D2)).toEqual([]);
    expect(s.requestFriend(D1, D2)).toBe('outgoing');
    expect(s.incoming(D2)).toEqual([]);
    // the denier can still ask them later
    expect(s.requestFriend(D2, D1)).toBe('outgoing');
    expect(s.answerFriend(D1, D2, false)).toBe(true);
    // taking back a request doesn't undo a denial the other way
    s.removeFriend(D2, D1);
    expect(s.relation(D1, D2)).toBe('outgoing');
  });

  test('answering a request that is not there; asking yourself', () => {
    const s = store();
    expect(s.answerFriend(D2, D1, true)).toBe(false);
    expect(s.requestFriend(D1, D1)).toBe('none');
  });

  test('unlinking ends friendships and requests', () => {
    const s = store();
    s.requestFriend(D1, D2);
    s.answerFriend(D2, D1, true);
    s.requestFriend(D3, D1);
    s.unlink(D1);
    expect(s.friendsOf(D2)).toEqual([]);
    expect(s.outgoing(D3)).toEqual([]);
  });

  test('hiding where you play', () => {
    const s = store();
    s.setHidePresence(D2, true);
    expect(s.byDiscord(D2)?.hidePresence).toBe(true);
    expect([...s.presenceHidden()]).toEqual([S2]);
    s.setHidePresence(D2, false);
    expect(s.presenceHidden().size).toBe(0);
  });
});

describe('accounts.db on disk', () => {
  let dir: string;
  const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'accounts-')));
  afterEach(() => {
    vi.useRealTimers();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('links survive a restart', () => {
    const file = join(fresh(), 'accounts.db');
    const a = openStore(file);
    a.link(D1, S1);
    a.setTier(D1, 2, 100);
    a.close();
    expect(openStore(file).byDiscord(D1)).toMatchObject({ steamId: S1, tier: 2, checkedAt: 100 });
  });

  test('a later migration upgrades existing links in place, after snapshotting the old file', () => {
    const file = join(fresh(), 'accounts.db');
    const v1 = openStore(file);
    v1.link(D1, S1);
    v1.close();
    const next = [...MIGRATIONS, 'ALTER TABLE links ADD COLUMN queue_note TEXT'];
    const s = openStore(file, next);
    expect(s.byDiscord(D1)?.steamId).toBe(S1);
    s.close();
    const raw = new DatabaseSync(file);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: next.length });
    expect(raw.prepare('SELECT queue_note FROM links').get()).toEqual({ queue_note: null });
    raw.close();
    const snap = new DatabaseSync(`${file}.pre-v${next.length}`);
    expect(snap.prepare('SELECT steam_id FROM links').get()).toEqual({ steam_id: S1 });
    snap.close();
  });

  test('a failed migration changes nothing', () => {
    const file = join(fresh(), 'accounts.db');
    openStore(file).link(D1, S1);
    expect(() => openStore(file, [...MIGRATIONS, 'ALTER TABLE links ADD COLUMN x TEXT', 'NOT SQL'])).toThrow();
    const raw = new DatabaseSync(file);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
    expect(raw.prepare('SELECT count(*) AS n FROM pragma_table_info(?) WHERE name = ?').get('links', 'x')).toEqual({ n: 0 });
    raw.close();
  });

  test('an older build refuses a database a newer one has upgraded', () => {
    const file = join(fresh(), 'accounts.db');
    openStore(file, [...MIGRATIONS, 'SELECT 1']).close();
    expect(() => openStore(file)).toThrow(/newer than this build/);
  });

  test('a brand-new file is not snapshotted', () => {
    const file = join(fresh(), 'accounts.db');
    openStore(file).close();
    expect(existsSync(`${file}.pre-v${MIGRATIONS.length}`)).toBe(false);
  });

  test('upgrading a v2 database (live since #14) keeps links and log, and adds names', () => {
    const file = join(fresh(), 'accounts.db');
    const v2 = new DatabaseSync(file);
    v2.exec(`${MIGRATIONS[0]}; ${MIGRATIONS[1]}; PRAGMA user_version = 2;`);
    v2.prepare('INSERT INTO links (discord_id, steam_id, tier, checked_at, linked_at) VALUES (?, ?, 2, 50, 40)').run(D1, S1);
    v2.prepare("INSERT INTO admin_log (at, admin_discord_id, action, target_discord_id, target_steam_id) VALUES (10, ?, 'recheck', ?, ?)").run(D2, D1, S1);
    v2.close();
    const s = openStore(file);
    expect(s.byDiscord(D1)).toMatchObject({ steamId: S1, tier: 2, linkedAt: 40, discordName: null });
    expect(s.auditLog(5)).toEqual([{ at: 10, adminDiscordId: D2, adminName: null, action: 'recheck', targetDiscordId: D1, targetName: null, targetSteamId: S1, detail: null }]);
    expect(existsSync(`${file}.pre-v${MIGRATIONS.length}`)).toBe(true);
  });

  test('upgrading a v3 database (live since #15) keeps everything and adds announced rounds', () => {
    const file = join(fresh(), 'accounts.db');
    const v3 = new DatabaseSync(file);
    v3.exec(`${MIGRATIONS[0]}; ${MIGRATIONS[1]}; ${MIGRATIONS[2]} PRAGMA user_version = 3;`);
    v3.prepare("INSERT INTO links (discord_id, steam_id, tier, checked_at, linked_at, discord_name) VALUES (?, ?, 1, 50, 40, 'Jan')").run(D1, S1);
    v3.prepare("INSERT INTO admin_log (at, admin_discord_id, action, target_discord_id, target_steam_id, admin_name, target_name) VALUES (10, ?, 'recheck', ?, ?, 'Jan', 'Jan')").run(D1, D1, S1);
    v3.close();
    const s = openStore(file);
    expect(s.byDiscord(D1)).toMatchObject({ steamId: S1, tier: 1, discordName: 'Jan', linkedAt: 40 });
    expect(s.auditLog(5)).toHaveLength(1);
    s.markAnnounced('srv', 1);
    expect(s.isAnnounced('srv', 1)).toBe(true);
    expect(existsSync(`${file}.pre-v${MIGRATIONS.length}`)).toBe(true);
  });

  test('upgrading a v4 database (live since #23) keeps everything and adds name styles', () => {
    const file = join(fresh(), 'accounts.db');
    const v4 = new DatabaseSync(file);
    v4.exec(`${MIGRATIONS.slice(0, 4).join(';\n')}; PRAGMA user_version = 4;`);
    v4.prepare("INSERT INTO links (discord_id, steam_id, tier, checked_at, linked_at, discord_name) VALUES (?, ?, 1, 50, 40, 'Jan')").run(D1, S1);
    v4.prepare("INSERT INTO announced_rounds (server_id, match_id, at) VALUES ('srv', 9, 1)").run();
    v4.close();
    const s = openStore(file);
    expect(s.byDiscord(D1)).toMatchObject({ steamId: S1, tier: 1, discordName: 'Jan', nameStyle: null });
    expect(s.isAnnounced('srv', 9)).toBe(true);
    s.setNameStyle(D1, 'pink');
    expect(s.bySteam(S1)?.nameStyle).toBe('pink');
    s.log({ adminDiscordId: D1, adminName: 'Jan', action: 'style', targetDiscordId: D1, targetName: 'Jan', targetSteamId: S1, detail: 'Pink' }, 5);
    expect(s.auditLog(1)[0]).toMatchObject({ action: 'style', detail: 'Pink' });
    expect(existsSync(`${file}.pre-v${MIGRATIONS.length}`)).toBe(true);
  });

  test('upgrading a v5 database (live since #26) keeps everything and adds custom profiles', () => {
    const file = join(fresh(), 'accounts.db');
    const v5 = new DatabaseSync(file);
    v5.exec(`${MIGRATIONS.slice(0, 5).join(';\n')}; PRAGMA user_version = 5;`);
    v5.prepare("INSERT INTO links (discord_id, steam_id, tier, checked_at, linked_at, discord_name, name_style) VALUES (?, ?, 1, 50, 40, 'Jan', 'pink')").run(D1, S1);
    v5.close();
    const s = openStore(file);
    expect(s.byDiscord(D1)).toMatchObject({ nameStyle: 'pink', bio: null, colour: null, featured: [] });
    s.setProfile(D1, { bio: 'Sniper main', colour: 'teal', featured: ['kills', 'class:sniper'] });
    expect(s.bySteam(S1)).toMatchObject({ bio: 'Sniper main', colour: 'teal', featured: ['kills', 'class:sniper'] });
    s.clearBio(D1);
    expect(s.byDiscord(D1)).toMatchObject({ bio: null, colour: 'teal' });
    expect(existsSync(`${file}.pre-v${MIGRATIONS.length}`)).toBe(true);
  });

  test('upgrading a v6 database (live since #31) keeps everything and adds alerts', () => {
    const file = join(fresh(), 'accounts.db');
    const v6 = new DatabaseSync(file);
    v6.exec(`${MIGRATIONS.slice(0, 6).join(';\n')}; PRAGMA user_version = 6;`);
    v6.prepare("INSERT INTO links (discord_id, steam_id, tier, checked_at, linked_at, discord_name, bio) VALUES (?, ?, 2, 50, 40, 'Jan', 'hi')").run(D1, S1);
    v6.prepare('INSERT INTO announced_rounds (server_id, match_id, at) VALUES (?, ?, ?)').run('s1', 7, 99);
    v6.close();
    const s = openStore(file);
    expect(s.byDiscord(D1)).toMatchObject({ tier: 2, discordName: 'Jan', bio: 'hi' });
    expect(s.isAnnounced('s1', 7)).toBe(true);
    expect(s.allAlerts()).toEqual([]);
    expect(existsSync(`${file}.pre-v${MIGRATIONS.length}`)).toBe(true);
  });

  test('alerts: add, list per member, update, pause and remove', () => {
    const s = openStore(':memory:');
    const a = s.addAlert({ discordId: D1, kind: 'players', serverId: 's1', threshold: 30, map: null }, 100);
    s.addAlert({ discordId: D1, kind: 'map', serverId: null, threshold: 10, map: 'Ozeti' }, 101);
    s.addAlert({ discordId: D2, kind: 'players', serverId: null, threshold: 20, map: null }, 102);
    expect(a).toEqual({ id: a.id, discordId: D1, kind: 'players', serverId: 's1', threshold: 30, map: null, armed: true, lastSent: null, failures: 0, createdAt: 100 });
    expect(s.alertsOf(D1).map((x) => x.kind)).toEqual(['players', 'map']);
    s.setAlertState(a.id, false, 500);
    expect(s.alertsOf(D1)[0]).toMatchObject({ armed: false, lastSent: 500 });
    s.setAlertFailures(D1, 3);
    expect(s.alertsOf(D1).map((x) => x.failures)).toEqual([3, 3]);
    expect(s.alertsOf(D2)[0].failures).toBe(0);
    // asking again un-pauses
    s.addAlert({ discordId: D1, kind: 'players', serverId: null, threshold: 50, map: null });
    expect(s.alertsOf(D1).map((x) => x.failures)).toEqual([0, 0, 0]);
    expect(s.removeAlerts(D2, a.id)).toBe(0); // not theirs
    expect(s.removeAlerts(D1, a.id)).toBe(1);
    expect(s.removeAlerts(D1)).toBe(2);
    expect(s.allAlerts().map((x) => x.discordId)).toEqual([D2]);
  });

  test('upgrading a v7 database (live since #42) keeps everything and adds friends and privacy', () => {
    const file = join(fresh(), 'accounts.db');
    const v7 = new DatabaseSync(file);
    v7.exec(`${MIGRATIONS.slice(0, 7).join(';\n')}; PRAGMA user_version = 7;`);
    v7.prepare("INSERT INTO links (discord_id, steam_id, tier, checked_at, linked_at, discord_name) VALUES (?, ?, 1, 50, 40, 'Jan')").run(D1, S1);
    v7.prepare("INSERT INTO alerts (discord_id, kind, threshold, created_at) VALUES (?, 'players', 30, 1)").run(D1);
    v7.close();
    const s = openStore(file);
    expect(s.byDiscord(D1)).toMatchObject({ tier: 1, discordName: 'Jan', hidePresence: false });
    expect(s.alertsOf(D1)).toHaveLength(1);
    expect(s.friendsOf(D1)).toEqual([]);
    expect(existsSync(`${file}.pre-v${MIGRATIONS.length}`)).toBe(true);
  });

  test('upgrading the live v1 database keeps its links and adds the admin log', () => {
    const file = join(fresh(), 'accounts.db');
    // what the deployed v1 build wrote
    const v1 = new DatabaseSync(file);
    v1.exec(`${MIGRATIONS[0]}; PRAGMA user_version = 1;`);
    v1.prepare('INSERT INTO links (discord_id, steam_id, tier, checked_at, linked_at) VALUES (?, ?, 1, 50, 40)').run(D1, S1);
    v1.close();
    const s = openStore(file);
    expect(s.byDiscord(D1)).toMatchObject({ steamId: S1, tier: 1, checkedAt: 50, linkedAt: 40 });
    expect(s.byDiscord(D1)?.steamId).toBe(S1);
    s.log({ adminDiscordId: D2, adminName: 'Jan', action: 'unlink', targetDiscordId: D1, targetName: 'Owl', targetSteamId: S1 }, 100);
    expect(s.auditLog(5)).toEqual([{ at: 100, adminDiscordId: D2, adminName: 'Jan', action: 'unlink', targetDiscordId: D1, targetName: 'Owl', targetSteamId: S1, detail: null }]);
    expect(existsSync(`${file}.pre-v${MIGRATIONS.length}`)).toBe(true);
  });
});
