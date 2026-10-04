import { NextResponse } from 'next/server';
import { env, feedEnabled, getServerConfigs } from '@/lib/server/config';
import { db, nowSec, stmt } from '@/lib/server/db';
import { getServers } from '@/lib/server/queries';
import { workerStatus } from '@/lib/server/worker';

export const dynamic = 'force-dynamic';

/**
 * Liveness and data-collection health, for Docker's HEALTHCHECK and uptime monitors.
 * 503 only when the site itself is broken (database unreadable, poller stalled or polling nothing);
 * game servers being offline is reported but stays 200, so a downed game server never restarts the site.
 */
export function GET() {
  const now = nowSec();
  const problems: string[] = [];

  let database = false;
  try {
    database = stmt(db(), 'SELECT 1 ok').get() != null;
  } catch (e) {
    problems.push(`database: ${(e as Error).message}`);
  }

  const worker = workerStatus();
  if (env.workerEnabled) {
    const stallAfter = Math.max(60, Math.ceil((env.pollIntervalMs / 1000) * 6));
    if (!worker) problems.push('worker: not running');
    else if (!worker.servers.length) problems.push('worker: no servers have an RCON password or query port');
    else if (now - (worker.lastTickAt ?? worker.startedAt) > stallAfter) problems.push('worker: stalled');
  }

  const lastKill = new Map<string, number>();
  const sources = new Map(worker?.servers.map((s) => [s.id, s.source]));
  const configs = new Map(getServerConfigs().map((c) => [c.id, c]));
  let servers: object[] = [];
  if (database) {
    for (const r of stmt(db(), `SELECT server_id, MAX(ts) ts FROM kills GROUP BY server_id`).all() as {
      server_id: string;
      ts: number;
    }[]) {
      lastKill.set(r.server_id, r.ts);
    }
    servers = getServers().map((s) => ({
      id: s.id,
      online: s.online,
      source: sources.get(s.id) ?? null,
      players: s.playerCount,
      lastPollAt: s.updatedAt,
      lastOnlineAt: s.lastOnlineAt,
      feed: configs.has(s.id) && feedEnabled(configs.get(s.id)!),
      lastKillAt: lastKill.get(s.id) ?? null,
      error: s.online ? null : s.error,
    }));
  }

  const ok = problems.length === 0;
  return NextResponse.json(
    {
      ok,
      problems,
      now,
      demo: env.demoMode,
      worker: worker
        ? { startedAt: worker.startedAt, lastTickAt: worker.lastTickAt, pollIntervalMs: worker.pollIntervalMs }
        : null,
      servers,
    },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
