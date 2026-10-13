import { describe, expect, test, vi } from 'vitest';
import { openStore } from './accounts/store';
import { announceRounds, MAX_AGE_S, MIN_PEAK_PLAYERS, roundMessage, webhookPoster, type EndedRound } from './rounds';

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

  test('a failed post leaves that round for the next pass', async () => {
    const { store, deps } = setup([round(1)]);
    await announceRounds(deps);
    deps.ended.mockResolvedValue([round(2)]);
    deps.post.mockRejectedValueOnce(new Error('webhook post failed (429)'));
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

describe('webhookPoster', () => {
  test('posts JSON and throws on a refusal', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await webhookPoster('https://discord.com/api/webhooks/1/abc', f)({ content: 'x' });
    expect((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body).toBe('{"content":"x"}');
    const bad = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(webhookPoster('https://discord.com/api/webhooks/1/abc', bad)({})).rejects.toThrow(/404/);
  });
});
