import { describe, expect, test, vi } from 'vitest';
import { runAccountChecks } from './doctor';
import type { AccountsEnv } from './env';

const env: AccountsEnv = {
  discordClientId: 'c', discordClientSecret: 's', discordBotToken: 'bot', discordGuildId: '999',
  roles: { staff: ['100', '101'], premium: ['200'], verified: [] },
  sessionSecret: 'x'.repeat(32), priorityApiKey: '', discordPublicKey: '', roundsChannelId: '', dataDir: './data',
};

const discord = (status: { me?: number; roles?: number; channel?: number } = {}) =>
  vi.fn(async (url: string) => {
    if (url.endsWith('/users/@me')) return Response.json({ username: 'JanGuard' }, { status: status.me ?? 200 });
    if (url.includes('/channels/')) return Response.json({ name: 'round-results' }, { status: status.channel ?? 200 });
    return Response.json([{ id: '100', name: 'Moderator' }, { id: '200', name: 'Premium' }], { status: status.roles ?? 200 });
  }) as unknown as typeof fetch;

describe('runAccountChecks', () => {
  test('a round results channel the bot can see passes; one it cannot fails with what to allow', async () => {
    const withChannel = { ...env, roundsChannelId: '123456789012345678' };
    expect((await runAccountChecks(withChannel, discord())).at(-1)).toEqual({ name: 'round results channel', ok: true, detail: '#round-results' });
    expect((await runAccountChecks(withChannel, discord({ channel: 403 }))).at(-1)).toMatchObject({ ok: false, detail: expect.stringMatching(/View Channel, Send Messages and Embed Links/) });
  });

  test('names each configured role, and flags ids that are not roles in the guild', async () => {
    const checks = await runAccountChecks(env, discord());
    expect(checks.map((c) => [c.name, c.ok, c.detail])).toEqual([
      ['discord bot', true, 'signed in as JanGuard'],
      ['discord guild', true, '2 roles'],
      ['staff roles', false, 'not roles in the guild: 101'],
      ['premium roles', true, 'Premium'],
      ['verified roles', true, 'none configured'],
    ]);
  });

  test('stops at a rejected token or a guild the bot is not in', async () => {
    expect((await runAccountChecks(env, discord({ me: 401 })))[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/DISCORD_BOT_TOKEN/) });
    expect((await runAccountChecks(env, discord({ roles: 403 }))).at(-1)).toMatchObject({ name: 'discord guild', ok: false });
  });
});
