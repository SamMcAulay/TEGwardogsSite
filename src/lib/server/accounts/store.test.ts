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

  test('re-linking the same Steam account keeps the original link date; switching accounts resets it', () => {
    const s = openStore(':memory:');
    at(1000);
    s.link(D1, S1);
    at(5000);
    expect(s.link(D1, S1).linkedAt).toBe(1000);
    expect(s.link(D1, S2).linkedAt).toBe(5000);
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
    const v2 = [...MIGRATIONS, 'ALTER TABLE links ADD COLUMN queue_note TEXT'];
    const s = openStore(file, v2);
    expect(s.byDiscord(D1)?.steamId).toBe(S1);
    s.close();
    const raw = new DatabaseSync(file);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(raw.prepare('SELECT queue_note FROM links').get()).toEqual({ queue_note: null });
    raw.close();
    const snap = new DatabaseSync(`${file}.pre-v2`);
    expect(snap.prepare('SELECT steam_id FROM links').get()).toEqual({ steam_id: S1 });
    snap.close();
  });

  test('a failed migration changes nothing', () => {
    const file = join(fresh(), 'accounts.db');
    openStore(file).link(D1, S1);
    expect(() => openStore(file, [...MIGRATIONS, 'ALTER TABLE links ADD COLUMN x TEXT', 'NOT SQL'])).toThrow();
    const raw = new DatabaseSync(file);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
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
    expect(existsSync(`${file}.pre-v1`)).toBe(false);
  });
});
