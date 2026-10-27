// Runs once when the Next server starts: keep the most visited pages warm (src/lib/server/warm.ts),
// keep history.db filled (src/lib/server/history),
// and, when account linking is configured, keep linked members' tiers in step with Discord and
// send /notify alerts.
// The Warcon client and its cache live on globalThis, so the warmer and the pages share one cache.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // `next build` also loads this file; only a running server warms.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startWarmer } = await import('./lib/server/warm');
  startWarmer();
  // The site's own record of rounds and the daily board (trends, skill ratings): no accounts needed.
  const { startHistory } = await import('./lib/server/history');
  const { historyBoard, visibleServerIds } = await import('./lib/server/data');
  startHistory({ serverIds: visibleServerIds, board: historyBoard });
  const { accounts } = await import('./lib/server/accounts');
  const { startTierSync } = await import('./lib/server/accounts/sync');
  try {
    const a = accounts();
    if (a) startTierSync(a.env, a.store);
    if (a?.env.roundsChannelId) {
      const { startRoundAnnouncer, botPoster } = await import('./lib/server/rounds');
      const { endedRounds, roundDetail } = await import('./lib/server/data');
      const { siteEnv } = await import('./lib/server/warcon/env');
      startRoundAnnouncer({ store: a.store, siteUrl: siteEnv().siteUrl, ended: endedRounds, detail: roundDetail, post: botPoster(a.env) });
    }
    if (a?.env.discordPublicKey) {
      const { registerCommands } = await import('./lib/server/accounts/interactions');
      const { getServers } = await import('./lib/server/data');
      const { siteEnv } = await import('./lib/server/warcon/env');
      const { botDms, startAlertWatcher } = await import('./lib/server/alerts');
      // Every start, so the commands always match this build; a failure leaves the old ones. The
      // servers become /notify's choices; without them it takes a typed name instead.
      getServers()
        .then((s) => s.data, () => [])
        .then((servers) => registerCommands(a.env, fetch, servers))
        .catch((e) => console.error('[discord] slash commands:', e instanceof Error ? e.message : e));
      startAlertWatcher({ store: a.store, siteUrl: siteEnv().siteUrl, servers: async () => (await getServers()).data, send: botDms(a.env) });
    }
  } catch (e) {
    // The stats still work; /account shows the error, and the doctor fails the deploy on it.
    console.error('[accounts] not started:', e instanceof Error ? e.message : e);
  }
}
