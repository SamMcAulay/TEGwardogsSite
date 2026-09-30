// Background poller: reads every configured server over RCON on an interval and records what it
// sees. Started once per process from instrumentation.ts.

import { DemoNetwork } from '../demo/network';
import { env, feedEnabled, getServerConfigs, rconPassword, type ServerConfig } from './config';
import { db, nowSec } from './db';
import { RconClient, type GameSource } from './rcon';
import { ingestKills, loadState, recordFailure, recordObservation, type ServerState } from './recorder';
import { refreshAvatars } from './steam';

type Source = GameSource & { drainEvents?: () => ReturnType<DemoNetwork['drainEvents']> };

interface Job {
  cfg: ServerConfig;
  source: Source;
  state: ServerState;
  busy: boolean;
  lastIdentityCheck: number;
  joinCode: string | null;
  uptimeSeconds: number | null;
}

type GlobalWithWorker = typeof globalThis & { __tegWorker?: { stop(): void } };

export function startWorker(): void {
  const g = globalThis as GlobalWithWorker;
  if (g.__tegWorker) return;

  const conn = db();
  const now = nowSec();
  const maxGap = Math.ceil((env.pollIntervalMs / 1000) * 3);
  const demo = env.demoMode ? new DemoNetwork(getServerConfigs(), now) : null;

  const jobs: Job[] = [];
  for (const cfg of getServerConfigs()) {
    let source: Source | null = null;
    const password = rconPassword(cfg);
    if (cfg.rcon && password) source = new RconClient(cfg.rcon.url, password);
    else if (demo) source = demo.source(cfg.id, nowSec);
    if (!source) {
      console.warn(`[worker] ${cfg.id}: no RCON url/password configured, skipping`);
      continue;
    }
    jobs.push({
      cfg,
      source,
      state: loadState(conn, cfg.id, now, maxGap),
      busy: false,
      lastIdentityCheck: 0,
      joinCode: null,
      uptimeSeconds: null,
    });
  }

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
    } catch (e) {
      recordFailure(conn, job.state, t, (e as Error).message);
      console.warn(`[worker] ${job.cfg.id}: ${(e as Error).message}`);
    } finally {
      job.busy = false;
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

  g.__tegWorker = {
    stop: () => timers.forEach((t) => clearInterval(t)),
  };
  console.log(`[worker] polling ${jobs.length} server(s) every ${env.pollIntervalMs}ms${demo ? ' (demo mode)' : ''}`);
}
