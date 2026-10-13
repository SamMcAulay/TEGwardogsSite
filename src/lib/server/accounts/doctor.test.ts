import { describe, expect, test, vi } from 'vitest';
import { runAccountChecks } from './doctor';
import type { AccountsEnv } from './env';

const env: AccountsEnv = {
  discordClientId: 'c', discordClientSecret: 's', discordBotToken: 'bot', discordGuildId: '999',
  roles: { staff: ['100', '101'], premium: ['200'], verified: [] },
  sessionSecret: 'x'.repeat(32), priorityApiKey: '', dataDir: './data',
};

const discord = (status: { me?: number; roles?: number } = {}) =>
  vi.fn(async (url: string) => {
    if (url.endsWith('/users/@me')) return Response.json({ username: 'JanGuard' }, { status: status.me ?? 200 });
    return Response.json([{ id: '100', name: 'Moderator' }, { id: '200', name: 'Premium' }], { status: status.roles ?? 200 });
  }) as unknown as typeof fetch;

describe('runAccountChecks', () => {
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
