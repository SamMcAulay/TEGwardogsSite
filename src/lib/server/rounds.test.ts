import { describe, expect, test, vi } from 'vitest';
import { openStore } from './accounts/store';
import { announceRounds, botPoster, MAX_AGE_S, MIN_PEAK_PLAYERS, playedSeconds, roundMessage, wasPlayed, type EndedRound } from './rounds';

const NOW = 1_800_000_000;
const SITE = 'https://stats.example.com';
const round = (id: number, o: Partial<EndedRound> = {}): EndedRound => ({
  serverId: 's1', serverName: 'EU#1', matchId: id, map: 'Kavkazi', startedAt: NOW - 3600 - id, endedAt: NOW - 600 + id,
  peakPlayers: 80, winner: 'Manticore', scores: [{ name: 'Valkyra', score: 16 }, { name: 'Manticore', score: 100 }], ...o,
});
const detail = { colours: { Manticore: '#1DD65C' }, awards: [{ key: 'kills', label: 'Most kills', name: 'Night Owl', value: '26' }, { key: 'cash', label: 'Richest match', name: 'X', value: '+$1' }] };

function setup(rounds: EndedRound[]) {
  const store = openStore(':memory:');
  const post = vi.fn<(body: object) => Promise<void>>(async () => {});
  const deps = { store, siteUrl: SITE, ended: vi.fn(async () => rounds), detail: vi.fn(async () => detail), post, nowSec: NOW };
  return { store, post, deps };
}

describe('roundMessage', () => {
  test('winner, map, scores best first, awards (not cash), length, players, link and faction colour', () => {
    const m = roundMessage(round(1), detail, SITE);
    const e = m.embeds[0];
    expect(e.title).toBe('Manticore win on Bakurani');
    expect(e.url).toBe(`${SITE}/matches/s1/1`);
    expect(e.description).toBe('Manticore **100** · Valkyra **16**');
    expect(e.color).toBe(0x1dd65c);
    expect(e.fields.map((f) => f.name)).toEqual(['Most kills', 'Length', 'Players']);
    expect(e.fields[0].value).toBe('Night Owl · 26');
    expect(m.allowed_mentions).toEqual({ parse: [] });
  });

  test('a hostile player name stays plain text; no winner reads "Round over"', () => {
    const m = roundMessage(round(1, { winner: null }), { colours: {}, awards: [{ key: 'kills', label: 'Most kills', name: '[x](https://evil.example)', value: '9' }] }, SITE);
    expect(m.embeds[0].title).toBe('Round over on Bakurani');
    expect(m.embeds[0].fields[0].value).not.toMatch(/\]\(|https:\/\/evil/);
  });
});

describe('announceRounds', () => {
  test('first sight of a server: records what has ended, posts nothing', async () => {
    const { store, post, deps } = setup([round(1), round(2)]);
    expect(await announceRounds(deps)).toEqual({ posted: 0, skipped: 2 });
    expect(post).not.toHaveBeenCalled();
    expect(store.isAnnounced('s1', 2)).toBe(true);
  });

  test('then each new round is posted once, oldest first', async () => {
    const { store, post, deps } = setup([round(1)]);
    await announceRounds(deps);
    deps.ended.mockResolvedValue([round(3), round(1), round(2)]);
    expect(await announceRounds(deps)).toEqual({ posted: 2, skipped: 0 });
    expect(post.mock.calls.map((c) => (c[0] as { embeds: { url: string }[] }).embeds[0].url)).toEqual([`${SITE}/matches/s1/2`, `${SITE}/matches/s1/3`]);
    expect(await announceRounds(deps)).toEqual({ posted: 0, skipped: 0 });
    expect(store.isAnnounced('s1', 3)).toBe(true);
  });

  test('near-empty and old rounds are recorded, not posted', async () => {
    const { post, deps } = setup([round(1)]);
    await announceRounds(deps);
    deps.ended.mockResolvedValue([round(2, { peakPlayers: MIN_PEAK_PLAYERS - 1 }), round(3, { endedAt: NOW - MAX_AGE_S - 1 })]);
    expect(await announceRounds(deps)).toEqual({ posted: 0, skipped: 2 });
    expect(post).not.toHaveBeenCalled();
  });

  test('a round nobody won with hardly any points is recorded, not posted', async () => {
    const { deps } = setup([round(1)]);
    await announceRounds(deps);
    deps.ended.mockResolvedValue([
      round(2, { winner: null, scores: [] }),
      round(3, { winner: null, scores: [{ name: 'Valkyra', score: 9 }, { name: 'Lonestar', score: 4 }] }),
      round(4, { winner: null, scores: [{ name: 'Valkyra', score: 66 }, { name: 'Lonestar', score: 19 }] }),
    ]);
    expect(await announceRounds(deps)).toEqual({ posted: 1, skipped: 2 });
  });

  test('a failed post leaves that round for the next pass', async () => {
    const { store, deps } = setup([round(1)]);
    await announceRounds(deps);
    deps.ended.mockResolvedValue([round(2)]);
    deps.post.mockRejectedValueOnce(new Error('posting the round failed (429)'));
    await expect(announceRounds(deps)).rejects.toThrow(/429/);
    expect(store.isAnnounced('s1', 2)).toBe(false);
    expect(await announceRounds(deps)).toEqual({ posted: 1, skipped: 0 });
  });

  test('missing details still post the round', async () => {
    const { post, deps } = setup([round(1)]);
    await announceRounds(deps);
    deps.ended.mockResolvedValue([round(2)]);
    deps.detail.mockRejectedValueOnce(new Error('down'));
    await announceRounds(deps);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('botPoster', () => {
  const env = { discordBotToken: 'bot', roundsChannelId: '123456789012345678' };
  const calls = (f: typeof fetch) => (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;

  test('posts JSON to the channel as the bot', async () => {
    const f = vi.fn(async () => Response.json({ id: '1' })) as unknown as typeof fetch;
    await botPoster(env, f)({ content: 'x' });
    const [url, init] = calls(f)[0];
    expect(url).toBe('https://discord.com/api/v10/channels/123456789012345678/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bot bot');
    expect(init.body).toBe('{"content":"x"}');
  });

  test('a missing permission says which ones to allow; other failures throw too', async () => {
    const denied = vi.fn(async () => Response.json({ code: 50013 }, { status: 403 })) as unknown as typeof fetch;
    await expect(botPoster(env, denied)({})).rejects.toThrow(/View Channel, Send Messages and Embed Links/);
    const busy = vi.fn(async () => Response.json({ retry_after: 1 }, { status: 429 })) as unknown as typeof fetch;
    await expect(botPoster(env, busy)({})).rejects.toThrow(/429/);
  });
});

describe('played time', () => {
  const H = 3600;
  const half = 1800;
  // A round from 03:00 to 18:00: busy 03:00-04:00, empty overnight, busy again 17:00-18:00.
  const start = NOW - 15 * H;
  const pop = Array.from({ length: 30 }, (_, i) => ({ ts: start + i * half, players: i < 2 || i >= 28 ? 90 : i === 10 ? 1 : 0 }));

  test('counts only the buckets with people on', () => {
    expect(playedSeconds(start, start + 15 * H, pop, half)).toBe(2 * H);
  });

  test('counts part buckets at the edges', () => {
    expect(playedSeconds(start + 900, start + H, pop, half)).toBe(H - 900);
  });

  test('time past the last bucket counts as played', () => {
    expect(playedSeconds(start, start + 15 * H + 600, pop, half)).toBe(2 * H + 600);
  });

  test('null without population', () => {
    expect(playedSeconds(start, start + H, [], half)).toBeNull();
  });

  test('the post shows time played, not start to end', () => {
    const msg = roundMessage(round(1, { startedAt: start, endedAt: start + 15 * H, playedSeconds: 2 * H }), null, SITE);
    expect(msg.embeds[0].fields.find((f) => f.name === 'Length')?.value).toBe('2 h 0 min');
  });

  test('a won round, or a fair few points, was played', () => {
    expect(wasPlayed({ winner: 'Lonestar', scores: [{ name: 'Lonestar', score: 100 }] })).toBe(true);
    expect(wasPlayed({ winner: null, scores: [{ name: 'Lonestar', score: 15 }, { name: 'Valkyra', score: 7 }] })).toBe(true);
    expect(wasPlayed({ winner: null, scores: [{ name: 'Lonestar', score: 0 }] })).toBe(false);
  });
});
