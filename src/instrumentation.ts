export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Only the running server polls; `next build` also loads this file.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { env } = await import('./lib/server/config');
  if (!env.workerEnabled) return;
  const { startWorker } = await import('./lib/server/worker');
  startWorker();
}
