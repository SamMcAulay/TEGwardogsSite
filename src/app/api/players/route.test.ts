import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/server/data', () => ({
  getPlayer: async () => ({
    stale: false,
    missing: [],
    data: {
      steamId: '76561198000000001', name: 'A', avatarUrl: null, firstSeen: 1, lastSeen: 2, aliases: [],
      totals: { kills: 1, deaths: 1, headshots: 0, suicides: 0, teamkills: 0, playtime: 60, longest: 0, matches: 1, wins: 1, losses: 0, draws: 0 },
      rank: 3, streak: null, onlineOn: null, weapons: [], victims: [], nemeses: [], servers: [], matches: [], maps: [], factions: [], recentKills: [],
    },
  }),
}));

describe('GET /api/players/:steamId', () => {
  test('answers the public shape and nothing private', async () => {
    const { GET } = await import('./[steamId]/route');
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ steamId: '76561198000000001' }) } as never);
    const body = await res.json();
    expect(body).toMatchObject({ steamId: '76561198000000001', name: 'A', rank: 3 });
    expect(JSON.stringify(body)).not.toMatch(/ping|watch|risk|notes|banned/i);
  });
});
