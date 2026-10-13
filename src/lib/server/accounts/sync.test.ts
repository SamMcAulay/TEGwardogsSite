import { describe, expect, test, vi } from 'vitest';
import type { AccountsEnv } from './env';
import { openStore } from './store';
import { refreshTier, sweep } from './sync';

const env: AccountsEnv = {
  discordClientId: 'c', discordClientSecret: 's', discordBotToken: 'bot', discordGuildId: '999999999999999999',
  roles: { staff: ['100'], premium: ['200'], verified: ['300'] },
  sessionSecret: 'x'.repeat(32), priorityApiKey: '', discordPublicKey: '', roundsChannelId: '', dataDir: ':memory:',
};
const D1 = '111111111111111111';
const D2 = '222222222222222222';

/** Fake Discord: member id to roles; missing members 404; '429' rate limits. */
function discord(members: Record<string, string[] | 429>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bot bot');
    const id = url.split('/').pop()!;
    const m = members[id];
    if (m === 429) return Response.json({ retry_after: 1.5 }, { status: 429 });
    if (!m) return Response.json({ code: 10007 }, { status: 404 });
    return Response.json({ user: { id, username: `user${id.slice(-1)}` }, nick: id === D1 ? 'Night Owl' : null, roles: m });
  }) as unknown as typeof fetch;
}

describe('tier sync', () => {
  test('stores the tier the roles grant, and null for someone who left the server', async () => {
    const s = openStore(':memory:');
    s.link(D1, '76561198000000001');
    expect(await refreshTier(env, s, D1, discord({ [D1]: ['300', '200'] }))).toBe(2);
    expect(s.byDiscord(D1)).toMatchObject({ tier: 2, discordName: 'Night Owl' });
    expect(await refreshTier(env, s, D1, discord({}))).toBeNull();
    expect(s.byDiscord(D1)).toMatchObject({ tier: null, discordName: 'Night Owl' });
  });

  test('an outage leaves the old tier in place', async () => {
    const s = openStore(':memory:');
    s.link(D1, '76561198000000001');
    s.setTier(D1, 1, 100);
    const down = vi.fn(async () => new Response('', { status: 502 })) as unknown as typeof fetch;
    await expect(refreshTier(env, s, D1, down)).rejects.toThrow(/502/);
    expect(s.byDiscord(D1)).toMatchObject({ tier: 1, checkedAt: 100 });
  });

  test('a sweep refreshes stale links and stops at a rate limit', async () => {
    const s = openStore(':memory:');
    s.link(D1, '76561198000000001');
    s.link(D2, '76561198000000002');
    s.setTier(D2, 3, 1);
    const r = await sweep(env, s, discord({ [D1]: ['100'], [D2]: 429 }), 10_000);
    expect(r).toEqual({ checked: 1, error: 'member lookup: rate limited' });
    expect(s.byDiscord(D1)?.tier).toBe(1);
    expect(s.byDiscord(D2)).toMatchObject({ tier: 3, checkedAt: 1 });
  });

  test('fresh links are left alone', async () => {
    const s = openStore(':memory:');
    s.link(D1, '76561198000000001');
    s.setTier(D1, 2, 10_000);
    const f = discord({});
    expect(await sweep(env, s, f, 10_100)).toEqual({ checked: 0 });
    expect(f).not.toHaveBeenCalled();
  });
});
