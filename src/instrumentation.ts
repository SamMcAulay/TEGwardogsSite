// Runs once when the Next server starts: keep the most visited pages warm (src/lib/server/warm.ts).
// The Warcon client and its cache live on globalThis, so the warmer and the pages share one cache.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // `next build` also loads this file; only a running server warms.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startWarmer } = await import('./lib/server/warm');
  startWarmer();
}
