import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import type { AccountsEnv } from './env';
import { COMMANDS, handleInteraction, registerCommands, verifyDiscordRequest } from './interactions';
import { openStore } from './store';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
/** The 32 raw key bytes, hex, as the Developer Portal shows them */
const PUBLIC_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const signed = (ts: string, body: string) => sign(null, Buffer.from(ts + body), privateKey).toString('hex');

const GUILD = '999999999999999999';
const STAFF = '100000000000000000';
const env: AccountsEnv = {
  discordClientId: '555555555555555555', discordClientSecret: 's', discordBotToken: 'bot', discordGuildId: GUILD,
  roles: { staff: [STAFF], premium: ['200000000000000000'], verified: [] },
  sessionSecret: 'x'.repeat(32), priorityApiKey: '', discordPublicKey: PUBLIC_HEX, dataDir: ':memory:',
};
const TARGET = '111111111111111111';
const STEAM = '76561198000000001';
const SITE = 'https://stats.example.com';

const lookup = (roles: string[], over: object = {}) => ({
  type: 2,
  guild_id: GUILD,
  member: { roles },
  data: {
    name: 'lookup',
    options: [{ name: 'member', value: TARGET }],
    resolved: { users: { [TARGET]: { username: 'owl', global_name: 'Night Owl' } }, members: { [TARGET]: { nick: null } } },
  },
  ...over,
});

const deps = (store = openStore(':memory:')) => ({ env, store, siteUrl: SITE, playerName: vi.fn(async () => 'RedOwl57') });
const text = (r: object) => (r as { data: { content: string; flags: number } }).data;

describe('verifyDiscordRequest', () => {
  const now = 1_700_000_000;
  const ts = String(now);
  const body = '{"type":1}';

  test('accepts a fresh request Discord signed', () => {
    expect(verifyDiscordRequest(PUBLIC_HEX, signed(ts, body), ts, body, now)).toBe(true);
  });

  test('rejects a changed body, another key, a stale timestamp, or missing headers', () => {
    expect(verifyDiscordRequest(PUBLIC_HEX, signed(ts, body), ts, '{"type":2}', now)).toBe(false);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    expect(verifyDiscordRequest(other, signed(ts, body), ts, body, now)).toBe(false);
    expect(verifyDiscordRequest(PUBLIC_HEX, signed(ts, body), ts, body, now + 6 * 60)).toBe(false);
    expect(verifyDiscordRequest(PUBLIC_HEX, null, ts, body, now)).toBe(false);
    expect(verifyDiscordRequest(PUBLIC_HEX, signed(ts, body), null, body, now)).toBe(false);
    expect(verifyDiscordRequest(PUBLIC_HEX, 'zz', ts, body, now)).toBe(false);
  });
});

describe('/lookup', () => {
  test('answers Discord\'s ping', async () => {
    expect(await handleInteraction({ type: 1 }, deps())).toEqual({ type: 1 });
  });

  test('staff get the linked member\'s profile link, privately, with no pings', async () => {
    const store = openStore(':memory:');
    store.link(TARGET, STEAM);
    const r = await handleInteraction(lookup(['42', STAFF]), deps(store));
    expect(text(r)).toEqual({
      content: `**Night Owl** plays as **RedOwl57**: ${SITE}/players/${STEAM}`,
      flags: 64,
      allowed_mentions: { parse: [] },
    });
  });

  test('not linked: one short line on how to link', async () => {
    const r = await handleInteraction(lookup([STAFF]), deps());
    expect(text(r).content).toBe(`**Night Owl** hasn't linked their Steam account. They can link it at <${SITE}/account>: sign in with Discord, then Steam.`);
  });

  test('everyone else, or another server, is turned away without a lookup', async () => {
    const store = openStore(':memory:');
    store.link(TARGET, STEAM);
    const d = deps(store);
    expect(text(await handleInteraction(lookup(['200000000000000000']), d)).content).toMatch(/staff only/);
    expect(text(await handleInteraction(lookup([STAFF], { guild_id: '888888888888888888' }), d)).content).toMatch(/staff only/);
    expect(d.playerName).not.toHaveBeenCalled();
  });

  test('a server nickname wins over the Discord name; no name in the index still gives the link', async () => {
    const store = openStore(':memory:');
    store.link(TARGET, STEAM);
    const i = lookup([STAFF]);
    i.data.resolved.members[TARGET].nick = 'Owl [TEG]' as unknown as null;
    const r = await handleInteraction(i, { ...deps(store), playerName: async () => null });
    expect(text(r).content).toBe(`**Owl [TEG]**: ${SITE}/players/${STEAM}`);
  });
});

describe('/lookup when the player list is slow', () => {
  test('replies in time without the name rather than miss Discord\'s 3 seconds', async () => {
    const store = openStore(':memory:');
    store.link(TARGET, STEAM);
    const slow = () => new Promise<string | null>((done) => setTimeout(() => done('RedOwl57'), 5_000));
    const started = Date.now();
    const r = await handleInteraction(lookup([STAFF]), { ...deps(store), playerName: slow, nameBudgetMs: 50 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(text(r).content).toBe(`**Night Owl**: ${SITE}/players/${STEAM}`);
  });

  test('a failing lookup also just drops the name', async () => {
    const store = openStore(':memory:');
    store.link(TARGET, STEAM);
    const r = await handleInteraction(lookup([STAFF]), { ...deps(store), playerName: async () => Promise.reject(new Error('down')) });
    expect(text(r).content).toBe(`**Night Owl**: ${SITE}/players/${STEAM}`);
  });
});

describe('registerCommands', () => {
  test('overwrites the guild commands with the bot token', async () => {
    const f = vi.fn(async () => Response.json([])) as unknown as typeof fetch;
    await registerCommands(env, f);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe(`https://discord.com/api/v10/applications/${env.discordClientId}/guilds/${GUILD}/commands`);
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bot bot');
    expect(JSON.parse(init.body as string)).toEqual(COMMANDS);
  });

  test('a refusal is an error', async () => {
    const f = vi.fn(async () => new Response('Missing Access', { status: 403 })) as unknown as typeof fetch;
    await expect(registerCommands(env, f)).rejects.toThrow(/403/);
  });
});
