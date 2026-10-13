import { describe, expect, test, vi } from 'vitest';
import { isStaffNow, parseLookup } from './admin';
import type { AccountsEnv } from './env';
import { openStore } from './store';

const env: AccountsEnv = {
  discordClientId: 'c', discordClientSecret: 's', discordBotToken: 'bot', discordGuildId: '999999999999999999',
  roles: { staff: ['100'], premium: ['200'], verified: ['300'] },
  sessionSecret: 'x'.repeat(32), priorityApiKey: '', discordPublicKey: '', roundsWebhookUrl: '', dataDir: ':memory:',
};
const D1 = '111111111111111111';
const S1 = '76561198000000001';

const discordSays = (status: number, roles: string[] = []) =>
  vi.fn(async () => Response.json({ roles, user: { username: 'jan' } }, { status })) as unknown as typeof fetch;

describe('isStaffNow', () => {
  test('a linked member with a staff role right now', async () => {
    const s = openStore(':memory:');
    s.link(D1, S1);
    expect(await isStaffNow(env, s, D1, discordSays(200, ['300', '100']))).toBe(true);
    expect(s.byDiscord(D1)?.tier).toBe(1);
  });

  test('not staff any more: denied at once, even though the stored tier said staff', async () => {
    const s = openStore(':memory:');
    s.link(D1, S1);
    s.setTier(D1, 1);
    expect(await isStaffNow(env, s, D1, discordSays(200, ['200']))).toBe(false);
    expect(s.byDiscord(D1)?.tier).toBe(2);
  });

  test('left the server, or Discord down: denied', async () => {
    const s = openStore(':memory:');
    s.link(D1, S1);
    s.setTier(D1, 1);
    expect(await isStaffNow(env, s, D1, discordSays(404))).toBe(false);
    s.setTier(D1, 1);
    expect(await isStaffNow(env, s, D1, discordSays(503))).toBe(false);
  });

  test('not linked: denied without asking Discord', async () => {
    const f = discordSays(200, ['100']);
    expect(await isStaffNow(env, openStore(':memory:'), D1, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('parseLookup', () => {
  test('SteamIDs, Discord ids, and profile URLs of either', () => {
    expect(parseLookup(' 76561198000000001 ')).toEqual({ steamId: S1 });
    expect(parseLookup('https://stats.tegwardogs.fyi/players/76561198000000001')).toEqual({ steamId: S1 });
    expect(parseLookup('https://steamcommunity.com/profiles/76561198000000001/')).toEqual({ steamId: S1 });
    expect(parseLookup(D1)).toEqual({ discordId: D1 });
    expect(parseLookup(`https://discord.com/users/${D1}`)).toEqual({ discordId: D1 });
  });

  test('other text searches Discord names; one character is too short', () => {
    expect(parseLookup(' RedOwl57 ')).toEqual({ name: 'RedOwl57' });
    expect(parseLookup('12345')).toEqual({ name: '12345' });
    expect(parseLookup('x')).toBeNull();
    expect(parseLookup('')).toBeNull();
  });
});
