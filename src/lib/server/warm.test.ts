import { beforeEach, describe, expect, test, vi } from 'vitest';

const data = {
  getServers: vi.fn(),
  networkSummary: vi.fn(),
  population: vi.fn(),
  leaderboard: vi.fn(),
  recentKills: vi.fn(),
  factionWins: vi.fn(),
  searchPlayers: vi.fn(),
  watchlist: vi.fn(),
};
vi.mock('./data', () => ({
  getServers: () => data.getServers(),
  networkSummary: (s: unknown) => data.networkSummary(s),
  population: (id: unknown, r: unknown) => data.population(id, r),
  leaderboard: (q: unknown) => data.leaderboard(q),
  recentKills: (q: unknown) => data.recentKills(q),
  factionWins: (id: unknown) => data.factionWins(id),
  searchPlayers: (q: unknown) => data.searchPlayers(q),
  watchlist: () => data.watchlist(),
}));

// vi.mock is hoisted above imports, so this import already sees the mocked module.
import { warmCommonPages } from './warm';

const servers = { data: [{ id: 's1' }, { id: 's2' }], stale: false, missing: [] };

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of Object.values(data)) f.mockResolvedValue({ data: [], stale: false, missing: [] });
  data.getServers.mockResolvedValue(servers);
});

describe('warmCommonPages', () => {
  test('touches what the home page, servers page and default leaderboard read', async () => {
    await warmCommonPages();
    expect(data.networkSummary).toHaveBeenCalledWith(servers.data);
    expect(data.population).toHaveBeenCalledWith(null, '24h');
    expect(data.population).toHaveBeenCalledWith('s1', '24h');
    expect(data.population).toHaveBeenCalledWith('s2', '24h');
    expect(data.leaderboard).toHaveBeenCalledWith({ metric: 'kills', period: '7d' });
    expect(data.leaderboard).toHaveBeenCalledWith({ metric: 'kd', period: '7d' });
    expect(data.recentKills).toHaveBeenCalledWith({ limit: 12 });
    expect(data.factionWins).toHaveBeenCalledWith(null);
    expect(data.watchlist).toHaveBeenCalled();
  });

  test('a failure in one part never throws and the rest still run', async () => {
    data.leaderboard.mockRejectedValue(new Error('down'));
    data.getServers.mockRejectedValue(new Error('down'));
    await expect(warmCommonPages()).resolves.toBeUndefined();
    expect(data.recentKills).toHaveBeenCalled();
  });
});
