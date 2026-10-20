import { describe, expect, test, vi } from 'vitest';
import type { Alert } from './accounts/store';
import { openStore } from './accounts/store';
import { alertPass, describeAlert, DmRefused, dmSender, evaluate, MAP_COOLDOWN_S, PLAYERS_COOLDOWN_S, REARM_GAP } from './alerts';
import type { ServerRow } from './views';

const D = '111111111111111111';
const SITE = 'https://stats.example.com';
const NOW = 1_800_000_000;

const alert = (o: Partial<Alert>): Alert => ({
  id: 1, discordId: D, kind: 'players', serverId: null, threshold: 30, map: null, armed: true, lastSent: null, failures: 0, createdAt: 0, ...o,
});
const live = (id: string, playerCount: number, map: string | null = 'Europe', o: object = {}) => ({
  id, slug: id, shortName: id.toUpperCase(), online: true as boolean | null, playerCount, joinCode: 'ABCD', map, ...o,
});

describe('players alerts', () => {
  test('fire when the busiest matching server reaches the count, then disarm', () => {
    const r = evaluate([alert({})], [live('eu1', 12), live('eu2', 31)], new Map(), SITE, NOW);
    expect(r.due).toHaveLength(1);
    expect(r.due[0].text).toBe(`**EU2** has **31 players** now (your alert: 30+).\nJoin code \`ABCD\` · <${SITE}/servers/eu2>`);
    expect(r.states).toEqual([{ id: 1, armed: false, lastSent: NOW }]);
  });

  test('only the named server counts; offline servers never do', () => {
    expect(evaluate([alert({ serverId: 'eu1' })], [live('eu1', 12), live('eu2', 40)], new Map(), SITE, NOW).due).toEqual([]);
    expect(evaluate([alert({})], [live('eu1', 40, 'Europe', { online: false })], new Map(), SITE, NOW).due).toEqual([]);
  });

  test('re-arm only once the count drops well below, and wait out the cooldown', () => {
    const fired = alert({ armed: false, lastSent: NOW - 60 });
    expect(evaluate([fired], [live('eu1', 30 - REARM_GAP)], new Map(), SITE, NOW).states).toEqual([]);
    expect(evaluate([fired], [live('eu1', 30 - REARM_GAP - 1)], new Map(), SITE, NOW).states).toEqual([{ id: 1, armed: true, lastSent: NOW - 60 }]);
    const rearmed = alert({ armed: true, lastSent: NOW - 60 });
    expect(evaluate([rearmed], [live('eu1', 40)], new Map(), SITE, NOW).due).toEqual([]);
    expect(evaluate([rearmed], [live('eu1', 40)], new Map(), SITE, NOW - 60 + PLAYERS_COOLDOWN_S).due).toHaveLength(1);
  });

  test('paused alerts (DMs failing) are skipped', () => {
    expect(evaluate([alert({ failures: 3 })], [live('eu1', 50)], new Map(), SITE, NOW).due).toEqual([]);
  });
});

describe('map alerts', () => {
  const ozeti = alert({ kind: 'map', map: 'Ozeti', threshold: 10 });
  test('fire when the map changes to theirs with enough playing', () => {
    const r = evaluate([ozeti], [live('eu1', 20, 'Europe')], new Map([['eu1', 'Kavkazi']]), SITE, NOW);
    expect(r.due[0].text).toBe(`**Ozeti** just started on **EU1**, 20 playing.\nJoin code \`ABCD\` · <${SITE}/servers/eu1>`);
    expect(r.states).toEqual([{ id: 1, armed: true, lastSent: NOW }]);
  });

  test('not on a fresh start, not when the map stayed, not when too few play, not within the cooldown', () => {
    const servers = [live('eu1', 20, 'Europe')];
    expect(evaluate([ozeti], servers, new Map(), SITE, NOW).due).toEqual([]);
    expect(evaluate([ozeti], servers, new Map([['eu1', 'Europe']]), SITE, NOW).due).toEqual([]);
    expect(evaluate([ozeti], [live('eu1', 9, 'Europe')], new Map([['eu1', 'Kavkazi']]), SITE, NOW).due).toEqual([]);
    expect(evaluate([{ ...ozeti, lastSent: NOW - MAP_COOLDOWN_S + 1 }], servers, new Map([['eu1', 'Kavkazi']]), SITE, NOW).due).toEqual([]);
  });
});

test('describeAlert', () => {
  const name = (id: string) => id.toUpperCase();
  expect(describeAlert({ kind: 'players', serverId: 'eu1', threshold: 30, map: null }, name)).toBe('EU1 reaches 30 players');
  expect(describeAlert({ kind: 'map', serverId: null, threshold: 10, map: 'Ozeti' }, name)).toBe('Ozeti starts on any server with 10+ playing');
  expect(describeAlert({ kind: 'map', serverId: null, threshold: 0, map: 'Ozeti' }, name)).toBe('Ozeti starts on any server');
});

describe('alertPass', () => {
  const row = (id: string, playerCount: number, map: string | null, online: boolean | null = true) =>
    ({ id, slug: id, shortName: id, online, playerCount, joinCode: null, status: map ? { map } : null }) as unknown as ServerRow;

  test('saves states, sends, counts refused DMs against the member, and remembers maps', async () => {
    const store = openStore(':memory:');
    const a = store.addAlert({ discordId: D, kind: 'players', serverId: null, threshold: 10, map: null });
    const send = vi.fn(async () => {
      throw new DmRefused('closed');
    });
    const r = await alertPass({ store, siteUrl: SITE, servers: async () => [row('eu1', 12, 'Europe'), row('eu2', 0, null, null)], send }, new Map([['eu2', 'Kavkazi']]), NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(store.alertsOf(D)[0]).toMatchObject({ id: a.id, armed: false, lastSent: NOW, failures: 1 });
    // eu2 didn't answer: its last known map is kept
    expect([...r.next]).toEqual([['eu2', 'Kavkazi'], ['eu1', 'Europe']]);
  });
});

describe('dmSender', () => {
  test('opens the DM channel once, then posts without pings', async () => {
    const f = vi.fn(async (url: string) => (url.endsWith('/users/@me/channels') ? Response.json({ id: '42' }) : Response.json({})));
    const send = dmSender({ discordBotToken: 'bot' }, f as unknown as typeof fetch);
    await send(D, 'hi');
    await send(D, 'again');
    const urls = f.mock.calls.map(([u]) => u);
    expect(urls).toEqual([
      'https://discord.com/api/v10/users/@me/channels',
      'https://discord.com/api/v10/channels/42/messages',
      'https://discord.com/api/v10/channels/42/messages',
    ]);
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({ content: 'hi', allowed_mentions: { parse: [] } });
  });

  test('closed DMs are DmRefused; other failures are plain errors', async () => {
    const closed = vi.fn(async (url: string) => (url.endsWith('/users/@me/channels') ? Response.json({ id: '42' }) : new Response('', { status: 403 })));
    await expect(dmSender({ discordBotToken: 'bot' }, closed as unknown as typeof fetch)(D, 'x')).rejects.toBeInstanceOf(DmRefused);
    const down = vi.fn(async () => new Response('', { status: 500 }));
    await expect(dmSender({ discordBotToken: 'bot' }, down as unknown as typeof fetch)(D, 'x')).rejects.not.toBeInstanceOf(DmRefused);
  });
});
