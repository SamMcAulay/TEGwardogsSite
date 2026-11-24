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
  const { historyBoard, roundKills, visibleServerIds } = await import('./lib/server/data');
  startHistory({ serverIds: visibleServerIds, board: historyBoard, kills: roundKills });
  // The starting teams two minutes into each match, for honest prediction tests (history/rosters.ts).
  const { history } = await import('./lib/server/history/store');
  const { startRosterCapture } = await import('./lib/server/history/rosters');
  const { warcon } = await import('./lib/server/warcon');
  const h = history();
  if (h) {
    startRosterCapture({
      history: h,
      serverIds: visibleServerIds,
      openMatch: (id) => warcon().openMatch(id),
      players: async (id) => (await warcon().live(id)).value?.players ?? [],
    });
  }
  // A test copy beside the live site (SITE_JOBS=off) reads everything but acts on nothing: no Discord
  // syncs, posts or alerts, and nothing that moves players or changes maps on the game servers.
  if (process.env.SITE_JOBS === 'off') return;
  const { accounts } = await import('./lib/server/accounts');
  const { startTierSync } = await import('./lib/server/accounts/sync');
  try {
    const a = accounts();
    if (a) startTierSync(a.env, a.store);
    if (a) {
      // Reserved slots: only when WARCON_SLOTS_TOKEN and WARCON_ORG_ID are set.
      const { startSlotSync } = await import('./lib/server/warcon/slots');
      const { siteEnv } = await import('./lib/server/warcon/env');
      startSlotSync(a.store, siteEnv().warconBaseUrl);
      // Team balancer: idle until staff arm it on /admin/teambalance.
      const { startTeamBalancer } = await import('./lib/server/teambalance/run');
      const { warconActor } = await import('./lib/server/warcon/act');
      const { ratings } = await import('./lib/server/history');
      startTeamBalancer({
        store: a.store,
        ratings,
        act: warconActor(siteEnv().warconBaseUrl, process.env.WARCON_MOVE_TOKEN),
        live: async (id) => {
          const [v, startedAt] = await Promise.all([warcon().live(id).then((c) => c.value), warcon().openMatch(id).then((m) => m?.startedAt ?? null)]);
          return v && { startedAt, factions: (v.status?.scores ?? []).map((s) => s.name), players: v.players };
        },
      });
      // Weighted map rotation: idle until staff switch it on for a server on /admin/rotation.
      const { rotationConfig } = await import('./lib/server/warcon/rotation-config');
      const config = rotationConfig(siteEnv().warconBaseUrl, process.env.WARCON_ROTATION_TOKEN);
      if (config) {
        const { startWeightedRotation } = await import('./lib/server/rotation/run');
        startWeightedRotation({ store: a.store, config, openMatch: (id) => warcon().openMatch(id) });
      }
    }
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
