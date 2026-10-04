// Deployment checks: run it on the machine the site runs on, since that's whose network matters.
//
//   npm run doctor                    (host with Node 22)
//   docker compose run --rm doctor    (no Node on the host)
//   npm run doctor -- --site https://stats.example.com
//
// Checks the config, each server's RCON and Steam query ports, the kill feed tokens, and, when
// SITE_URL (or --site) is set, the public site end to end through Cloudflare.

import fs from 'node:fs';
import path from 'node:path';
import { queryInfo } from '../src/lib/server/a2s';
import type { ServerConfig } from '../src/lib/server/config';
import { RconClient, RconError } from '../src/lib/server/rcon';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const C = process.stdout.isTTY
  ? { ok: '\x1b[32m', warn: '\x1b[33m', bad: '\x1b[31m', dim: '\x1b[2m', end: '\x1b[0m' }
  : { ok: '', warn: '', bad: '', dim: '', end: '' };
let failures = 0;
let warnings = 0;
const ok = (msg: string) => console.log(`  ${C.ok}✔${C.end} ${msg}`);
const warn = (msg: string, hint?: string) => {
  warnings++;
  console.log(`  ${C.warn}!${C.end} ${msg}${hint ? `\n    ${C.dim}${hint}${C.end}` : ''}`);
};
const bad = (msg: string, hint?: string) => {
  failures++;
  console.log(`  ${C.bad}✘${C.end} ${msg}${hint ? `\n    ${C.dim}${hint}${C.end}` : ''}`);
};
const heading = (s: string) => console.log(`\n${s}`);

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const v = await fn();
  return [v, Math.round(performance.now() - t)];
}

function siteArg(): string | null {
  const i = process.argv.indexOf('--site');
  const v = i >= 0 ? process.argv[i + 1] : process.env.SITE_URL;
  return v ? v.replace(/\/+$/, '') : null;
}

async function checkConfig(): Promise<ServerConfig[]> {
  heading('Config');
  // Imported here so a missing config is reported as a check, not a crash.
  const { env, getServerConfigs } = await import('../src/lib/server/config');
  if (env.demoMode) warn('DEMO_MODE=true: simulated servers, nothing real is polled');
  let servers: ServerConfig[] = [];
  try {
    servers = getServerConfigs();
    ok(`${servers.length} server(s) in ${env.serversConfigPath}`);
  } catch (e) {
    bad(
      `server config: ${(e as Error).message.split('\n')[0]}`,
      'cp config/servers.example.json config/servers.json, then edit it',
    );
    return [];
  }

  const dbDir = path.dirname(env.databasePath);
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    fs.accessSync(dbDir, fs.constants.W_OK);
    ok(`database directory ${dbDir} is writable`);
  } catch {
    bad(`database directory ${dbDir} is not writable`, 'Docker runs as uid 1001: sudo chown -R 1001:1001 data backups');
  }
  if (!process.env.SITE_URL) warn('SITE_URL is not set', 'needed for link previews, sitemap.xml and this check');
  if (!env.steamApiKey) console.log(`  ${C.dim}- STEAM_API_KEY not set (optional: player avatars)${C.end}`);
  if (!env.discordWebhookUrl) console.log(`  ${C.dim}- DISCORD_WEBHOOK_URL not set (optional: offline alerts)${C.end}`);
  return servers;
}

async function checkServer(s: ServerConfig) {
  heading(`${s.name} (${s.id})`);
  let source: string | null = null;

  if (s.rcon) {
    const password = process.env[s.rcon.passwordEnv];
    if (!password) {
      warn(`RCON: ${s.rcon.passwordEnv} is not set`, 'ask the server admin for the RCON password');
    } else {
      const client = new RconClient(s.rcon.url, password);
      try {
        const [status, ms] = await timed(() => client.status());
        const players = await client.players();
        ok(`RCON ${s.rcon.url}: ${status.serverName} on ${status.map}, ${players.length} players (${ms} ms)`);
        const code = await client.serverId().catch(() => null);
        if (code) ok(`join code ${code}`);
        source ??= 'rcon';
      } catch (e) {
        const err = e as RconError;
        if (err.status === 401 || err.status === 403) {
          bad(`RCON ${s.rcon.url}: password rejected (HTTP ${err.status})`, `check ${s.rcon.passwordEnv}`);
        } else if (err.status === 429) {
          warn(`RCON ${s.rcon.url}: rate limited`, 'something else is hammering the API; try again in a minute');
        } else if (err.status == null) {
          bad(
            `RCON ${s.rcon.url}: ${err.message}`,
            'the listener may be bound to 127.0.0.1 or firewalled; the server admin has to open it to this machine',
          );
        } else {
          bad(`RCON ${s.rcon.url}: ${err.message}`);
        }
      }
    }
  }

  if (s.query) {
    try {
      const [info, ms] = await timed(() => queryInfo(s.query!.host, s.query!.port));
      ok(
        `Steam query ${s.query.host}:${s.query.port}: ${info.name} on ${info.map}, ${info.players}/${info.maxPlayers} (${ms} ms)`,
      );
      source ??= 'query';
    } catch (e) {
      bad(
        `Steam query ${s.query.host}:${s.query.port}: ${(e as Error).message}`,
        'is that the query port (not the game port)?',
      );
    }
  }

  if (source)
    ok(
      `stats will come from ${source === 'rcon' ? 'RCON (full stats)' : 'Steam query (status and player count only)'}`,
    );
  else bad('no working data source: the site will show this server as offline');

  if (!s.feedTokenEnv) {
    console.log(`  ${C.dim}- no feedTokenEnv: no weapons, headshots or distances for this server${C.end}`);
  } else {
    const token = process.env[s.feedTokenEnv];
    if (!token) warn(`kill feed: ${s.feedTokenEnv} is not set`, 'generate one with: openssl rand -hex 32');
    else if (token.length < 24) warn(`kill feed: ${s.feedTokenEnv} is short`, 'use at least 24 random characters');
    else ok(`kill feed token set (${s.feedTokenEnv})`);
  }
}

async function checkSite(site: string, servers: ServerConfig[]) {
  heading(`Public site ${site}`);
  try {
    const [res, ms] = await timed(() => fetch(`${site}/api/health`, { signal: AbortSignal.timeout(10000) }));
    const via = res.headers.get('cf-ray') ? ' via Cloudflare' : '';
    const body = (await res.json().catch(() => null)) as { ok?: boolean; problems?: string[] } | null;
    if (res.ok && body?.ok) ok(`/api/health OK${via} (${ms} ms)`);
    else bad(`/api/health HTTP ${res.status}${via}: ${body?.problems?.join('; ') ?? 'not the stats site?'}`);
  } catch (e) {
    bad(`cannot reach ${site}: ${(e as Error).message}`, 'DNS, Cloudflare Tunnel or the container may be down');
    return;
  }

  // The game posts its kill feed here. Cloudflare's bot protection blocking it is the usual failure.
  const ingest = `${site}/api/ingest/events`;
  const post = (token: string) =>
    fetch(ingest, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'UnrealEngine' },
      body: JSON.stringify({ events: [] }),
      signal: AbortSignal.timeout(10000),
    });
  const probe = await post('doctor-invalid-token').catch(() => null);
  if (!probe) bad(`POST ${ingest} failed to connect`);
  else if (probe.status === 401) ok('kill feed endpoint reachable (bad token rejected with 401)');
  else if (probe.status === 403 || probe.status === 503) {
    bad(
      `POST ${ingest}: HTTP ${probe.status}, probably Cloudflare`,
      'add a WAF custom rule that skips bot protection for /api/ingest/ (docs/DEPLOYMENT.md, step 5)',
    );
  } else bad(`POST ${ingest}: unexpected HTTP ${probe.status}`);

  for (const s of servers) {
    const token = s.feedTokenEnv ? process.env[s.feedTokenEnv] : undefined;
    if (!token) continue;
    const res = await post(token).catch(() => null);
    if (res?.status === 200) ok(`${s.id}: site accepts its kill feed token`);
    else
      bad(
        `${s.id}: kill feed token rejected (HTTP ${res?.status ?? 'no response'})`,
        'is the site running with the same .env?',
      );
  }
}

async function main() {
  const servers = await checkConfig();
  for (const s of servers) await checkServer(s);
  const site = siteArg();
  if (site) await checkSite(site, servers);

  console.log(
    `\n${failures ? `${C.bad}${failures} problem(s)${C.end}` : `${C.ok}No problems${C.end}`}` +
      `${warnings ? `, ${C.warn}${warnings} warning(s)${C.end}` : ''}`,
  );
  process.exit(failures ? 1 : 0);
}

void main();
