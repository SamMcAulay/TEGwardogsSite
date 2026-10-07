import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PlayerProfile } from './views';

const data = { getPlayer: vi.fn() };
vi.mock('./data', async (orig) => ({ ...(await orig<typeof import('./data')>()), getPlayer: (id: string) => data.getPlayer(id) }));
const og = {
  renderPng: vi.fn<(el: unknown) => Promise<ArrayBuffer>>(async () => new Uint8Array([1, 2, 3]).buffer),
  fetchAvatar: vi.fn<(url: string) => Promise<string | null>>(async () => null),
};
vi.mock('./og-render', () => ({
  renderPng: (el: unknown) => og.renderPng(el),
  fetchAvatar: (url: string) => og.fetchAvatar(url),
}));

// vi.mock is hoisted above imports, so this import already sees the mocked modules.
import { cardModel, playerCard, playerMetadata, resetCards } from './card';

const ID = '76561198180146179';
const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  steamId: ID, name: '[TEG] s k r u b', avatarUrl: 'https://avatars.steamstatic.com/x_medium.jpg',
  firstSeen: 1_000, lastSeen: 1_000_000 - 3 * 3600, aliases: [],
  totals: { kills: 102, deaths: 122, headshots: 0, suicides: 0, teamkills: 0, playtime: 51_480, longest: 0, matches: 14, wins: 6, losses: 8, draws: 0 },
  rank: 1580, streak: null, onlineOn: null, weapons: [], victims: [], nemeses: [],
  servers: [
    { serverId: 's3', name: 'EU#3 - TEG.gg', playtime: 7_380, kills: 24 },
    { serverId: 's1', name: 'EU#1 - TEG.gg', playtime: 41_700, kills: 67 },
  ],
  matches: [], maps: [], factions: [], recentKills: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetCards();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('cardModel', () => {
  test('headline stats, rank, last seen and the server they play most', () => {
    const m = cardModel(profile(), 1_000_000);
    expect(m).toMatchObject({ name: '[TEG] s k r u b', rank: '#1,580 all-time', seen: 'Last seen 3h ago · mostly EU#1' });
    expect(m.stats).toEqual([
      { label: 'Kills', value: '102' },
      { label: 'K/D', value: '0.84' },
      { label: 'Kills / hr', value: '7.1' },
      { label: 'Playtime', value: '14h 18m' },
      { label: 'Win rate', value: '43%' },
    ]);
  });

  test('no rank line for a banned player or when the rank is unavailable', () => {
    expect(cardModel(profile({ rank: null }), 1_000_000).rank).toBeNull();
    expect(cardModel(profile({ rank: 'unavailable' }), 1_000_000).rank).toBeNull();
  });

  test('a player with no time or matches gets dashes, not NaN', () => {
    const m = cardModel(profile({ servers: [], totals: { ...profile().totals, playtime: 0, matches: 0, wins: 0 } }), 1_000_000);
    expect(m.stats.find((s) => s.label === 'Kills / hr')?.value).toBe('—');
    expect(m.stats.find((s) => s.label === 'Win rate')?.value).toBe('—');
    expect(m.seen).toBe('Last seen 3h ago');
  });
});

describe('playerCard', () => {
  test('a player card is drawn once and then served from memory for an hour', async () => {
    data.getPlayer.mockResolvedValue({ data: profile(), stale: false, missing: [] });
    const a = await playerCard(ID);
    const b = await playerCard(ID);
    expect(a).toMatchObject({ kind: 'player', maxAge: 3600 });
    expect(b.png).toBe(a.png);
    expect(og.renderPng).toHaveBeenCalledTimes(1);
    expect(og.fetchAvatar).toHaveBeenCalledWith('https://avatars.steamstatic.com/x_medium.jpg');
  });

  test('an unknown player or a malformed id gets the plain site card', async () => {
    data.getPlayer.mockResolvedValue(null);
    expect(await playerCard(ID)).toMatchObject({ kind: 'site' });
    expect(await playerCard('not-an-id')).toMatchObject({ kind: 'site' });
    expect(data.getPlayer).toHaveBeenCalledTimes(1);
  });

  test('when Warcon fails the site card is sent briefly, and the player card is tried again next time', async () => {
    data.getPlayer.mockRejectedValueOnce(new Error('down'));
    expect(await playerCard(ID)).toMatchObject({ kind: 'site', maxAge: 60 });
    data.getPlayer.mockResolvedValue({ data: profile(), stale: false, missing: [] });
    expect(await playerCard(ID)).toMatchObject({ kind: 'player' });
  });
});

describe('playerMetadata', () => {
  test('title, summary, the card as a large image, and the site name', () => {
    const m = playerMetadata(profile());
    expect(m.title).toBe('[TEG] s k r u b');
    expect(m.description).toBe('102 kills · 0.84 K/D · 14h 18m played on TEG WARDOGS servers.');
    expect(m.openGraph).toMatchObject({
      title: '[TEG] s k r u b',
      description: m.description,
      siteName: 'TEG WARDOGS',
      images: [{ url: `/players/${ID}/card.png`, width: 1200, height: 630 }],
    });
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', images: [`/players/${ID}/card.png`] });
  });
});
