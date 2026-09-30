// Fills the database with simulated history for demo mode by running the demo servers through the
// real recorder, so every page has something to show. Usage: npm run seed [-- --days 10]

import fs from 'node:fs';
import { DemoNetwork } from '../src/lib/demo/network';
import { env, feedEnabled, getServerConfigs } from '../src/lib/server/config';
import { open } from '../src/lib/server/db';
import { ingestKills, loadState, recordObservation } from '../src/lib/server/recorder';

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 10;
const step = 300;

if (!env.demoMode) {
  console.error('Refusing to seed: set DEMO_MODE=true (seeding writes fake players and kills).');
  process.exit(1);
}
for (const f of [env.databasePath, `${env.databasePath}-wal`, `${env.databasePath}-shm`]) fs.rmSync(f, { force: true });

const conn = open(env.databasePath);
const configs = getServerConfigs();
const end = Math.floor(Date.now() / 1000);
const start = end - days * 86400;
const network = new DemoNetwork(configs, start, 7);
const states = new Map(configs.map((c) => [c.id, loadState(conn, c.id, start, step * 2)]));

const t0 = Date.now();
let kills = 0;
const stepAll = conn.transaction((now: number) => {
  for (const cfg of configs) {
    network.advance(cfg.id, now);
    const snap = network.snapshot(cfg.id, now);
    recordObservation(
      conn,
      states.get(cfg.id)!,
      { now, ...snap, uptimeSeconds: null },
      {
        feedEnabled: feedEnabled(cfg),
        maxGapSeconds: step * 2,
      },
    );
    const events = network.drainEvents(cfg.id);
    kills += ingestKills(conn, cfg.id, events, now).accepted;
  }
});
for (let now = start; now <= end; now += step) {
  stepAll(now);
  if ((now - start) % 86400 < step) {
    process.stdout.write(`\r  day ${Math.round((now - start) / 86400)}/${days}  ${kills.toLocaleString()} kills`);
  }
}

// Leave everything closed: the live demo worker starts a fresh world.
conn.prepare(`UPDATE sessions SET ended_at = last_seen_at WHERE ended_at IS NULL`).run();
conn.prepare(`UPDATE matches SET ended_at = ? WHERE ended_at IS NULL`).run(end);
conn.pragma('optimize');
conn.close();
console.log(
  `\nSeeded ${days} days, ${kills.toLocaleString()} kills in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${env.databasePath}`,
);
