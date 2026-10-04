// Background poller: reads every configured server over RCON on an interval and records what it
// sees. Started once per process from instrumentation.ts.

import { DemoNetwork } from '../demo/network';
import { QueryClient } from './a2s';
import { env, feedEnabled, getServerConfigs, rconPassword, type ServerConfig } from './config';
import { db, nowSec, stmt } from './db';
import { RconClient, type GameSource } from './rcon';
import { notifyServerState } from './notify';
import { ingestKills, loadState, recordFailure, recordObservation, type ServerState } from './recorder';
import { refreshAvatars } from './steam';

/** Where a server's data comes from, best first. */
export type SourceKind = 'rcon' | 'query' | 'demo';

type Source = GameSource & { drainEvents?: () => ReturnType<DemoNetwork['drainEvents']> };

interface Job {
  cfg: ServerConfig;
  source: Source;
  kind: SourceKind;
  state: ServerState;
  busy: boolean;
  lastIdentityCheck: number;
  joinCode: string | null;
  uptimeSeconds: number | null;
  /** Last known state, for alerts. Null until the first poll settles it. */
  online: boolean | null;
  offlineAlerted: boolean;
}

export interface WorkerStatus {
  startedAt: number;
  /** Last time any poll finished, successful or not. */
  lastTickAt: number | null;
  pollIntervalMs: number;
  servers: { id: string; source: SourceKind }[];
}

type GlobalWithWorker = typeof globalThis & { __tegWorker?: { stop(): void; status: WorkerStatus } };

/** The running worker's heartbeat, or null when this process does not poll. */
export function workerStatus(): WorkerStatus | null {
  return (globalThis as GlobalWithWorker).__tegWorker?.status ?? null;
}

export function startWorker(): void {
  const g = globalThis as GlobalWithWorker;
  if (g.__tegWorker) return;

  const conn = db();
  const now = nowSec();
  const maxGap = Math.ceil((env.pollIntervalMs / 1000) * 3);
  const demo = env.demoMode ? new DemoNetwork(getServerConfigs(), now) : null;

  const jobs: Job[] = [];
  for (const cfg of getServerConfigs()) {
    const picked = pickSource(cfg, demo);
    if (!picked) {
      console.warn(`[worker] ${cfg.id}: no RCON password or query port configured, skipping`);
      continue;
    }
    if (cfg.rcon && picked.kind !== 'rcon') {
      console.warn(`[worker] ${cfg.id}: ${cfg.rcon.passwordEnv} is not set, falling back to ${picked.kind}`);
    }
    jobs.push({
      cfg,
      ...picked,
      state: loadState(conn, cfg.id, now, maxGap),
      busy: false,
      lastIdentityCheck: 0,
      joinCode: null,
      uptimeSeconds: null,
      online: null,
      offlineAlerted: false,
    });
  }

  const heartbeat: WorkerStatus = {
    startedAt: now,
    lastTickAt: null,
    pollIntervalMs: env.pollIntervalMs,
    servers: jobs.map((j) => ({ id: j.cfg.id, source: j.kind })),
  };

  const alert = (job: Job, online: boolean, detail?: string) => {
    notifyServerState(job.cfg.name, online, detail).catch((e) => console.warn('[notify]', (e as Error).message));
  };

  const tick = async (job: Job) => {
    if (job.busy) return;
    job.busy = true;
    const t = nowSec();
    try {
      const [status, players] = await Promise.all([job.source.status(), job.source.players()]);
      // Identity and uptime change rarely; read them every few minutes.
      if (t - job.lastIdentityCheck > 300) {
        job.lastIdentityCheck = t;
        const [health, joinCode] = await Promise.all([
          job.source.health().catch(() => null),
          job.source.serverId().catch(() => null),
        ]);
        job.uptimeSeconds = health?.uptimeSeconds ?? null;
        job.joinCode = joinCode;
      }
      recordObservation(
        conn,
        job.state,
        { now: t, status, players, uptimeSeconds: job.uptimeSeconds, joinCode: job.joinCode },
        { feedEnabled: feedEnabled(job.cfg), maxGapSeconds: maxGap },
      );
      job.uptimeSeconds = null; // only anchor start time when freshly read
      const events = job.source.drainEvents?.();
      if (events?.length) ingestKills(conn, job.cfg.id, events, t);
      if (job.offlineAlerted) alert(job, true);
      job.online = true;
      job.offlineAlerted = false;
    } catch (e) {
      const message = (e as Error).message;
      recordFailure(conn, job.state, t, message);
      console.warn(`[worker] ${job.cfg.id}: ${message}`);
      const live = stmt(conn, `SELECT online FROM server_live WHERE server_id = ?`).get(job.cfg.id) as
        { online: number } | undefined;
      const online = !!live?.online;
      if (job.online && !online) {
        alert(job, false, message);
        job.offlineAlerted = true;
      }
      job.online = online;
    } finally {
      job.busy = false;
      heartbeat.lastTickAt = nowSec();
    }
  };

  // Stagger servers across the interval so requests do not bunch up.
  const timers: NodeJS.Timeout[] = [];
  jobs.forEach((job, i) => {
    const offset = Math.floor((env.pollIntervalMs / Math.max(1, jobs.length)) * i);
    timers.push(
      setTimeout(() => {
        void tick(job);
        timers.push(setInterval(() => void tick(job), env.pollIntervalMs));
      }, offset),
    );
  });

  // Housekeeping: population samples older than 90 days, Steam avatars.
  const housekeeping = async () => {
    conn.prepare(`DELETE FROM population WHERE ts < ?`).run(nowSec() - 90 * 86400);
    conn.pragma('optimize');
    if (env.steamApiKey) await refreshAvatars(conn, env.steamApiKey).catch((e) => console.warn('[steam]', e.message));
  };
  timers.push(setInterval(() => void housekeeping(), 10 * 60 * 1000));
  void housekeeping();

  const stop = () => timers.forEach((t) => clearInterval(t));
  g.__tegWorker = { stop, status: heartbeat };
  // Stop polling once the server starts draining, and checkpoint the WAL into the main file on exit
  // so a copied database file is complete.
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.once('exit', () => {
    try {
      conn.close();
    } catch {
      // already closed
    }
  });
  console.log(`[worker] polling ${jobs.length} server(s) every ${env.pollIntervalMs}ms${demo ? ' (demo mode)' : ''}`);
}

function pickSource(cfg: ServerConfig, demo: DemoNetwork | null): { source: Source; kind: SourceKind } | null {
  const password = rconPassword(cfg);
  if (cfg.rcon && password) return { source: new RconClient(cfg.rcon.url, password), kind: 'rcon' };
  if (cfg.query) return { source: new QueryClient(cfg.query.host, cfg.query.port), kind: 'query' };
  if (demo) return { source: demo.source(cfg.id, nowSec), kind: 'demo' };
  return null;
}
