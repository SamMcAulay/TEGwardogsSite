// Keeps the most visited pages' data warm so the first visitor after a refresh never waits on
// Warcon. Each touch is a cache hit until the data expires; then it starts the background refresh
// (TtlCache serve-stale), so the cost to Warcon is one load per refresh interval, not per minute.
import { factionWins, getServers, leaderboard, networkSummary, population, recentKills, watchlist } from './data';

const quietly = (p: Promise<unknown>) => p.then(
  () => undefined,
  () => undefined,
);

/** What the home page, the servers page, the default leaderboard tab and the watchlist read. Never throws. */
export async function warmCommonPages(): Promise<void> {
  await Promise.all([
    quietly(
      getServers().then((servers) =>
        Promise.all([
          quietly(networkSummary(servers.data)),
          ...servers.data.map((s) => quietly(population(s.id, '24h'))),
        ]),
      ),
    ),
    quietly(population(null, '24h')),
    quietly(leaderboard({ metric: 'kills', period: '7d' })),
    quietly(leaderboard({ metric: 'kd', period: '7d' })),
    quietly(recentKills({ limit: 12 })),
    quietly(factionWins(null)),
    quietly(watchlist()),
  ]);
}

const g = globalThis as unknown as { __warmer?: ReturnType<typeof setInterval> };

/** Start once per process: warm now, then every intervalMs. */
export function startWarmer(intervalMs = 60_000): void {
  if (g.__warmer) return;
  void warmCommonPages();
  g.__warmer = setInterval(() => void warmCommonPages(), intervalMs);
  g.__warmer.unref?.();
}
