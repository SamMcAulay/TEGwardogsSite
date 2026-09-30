import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const serverSchema = z.object({
  /** URL slug, e.g. `eu-1`. Stable: stats are keyed on it. */
  id: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes only'),
  name: z.string().min(1),
  shortName: z.string().min(1),
  region: z.enum(['NA', 'EU', 'OCE', 'ASIA', 'SA']),
  location: z.string().default(''),
  rcon: z
    .object({
      /** Base URL of the WDRCON listener, e.g. `http://203.0.113.10:7776`. */
      url: z.string().url(),
      /** Name of the environment variable that holds the RCON password. */
      passwordEnv: z.string().min(1),
    })
    .optional(),
  /**
   * Name of the environment variable holding the bearer token the game server sends with its
   * kill feed (`[WDServerFeed] Token=`). Servers without one get kill/death totals from RCON only.
   */
  feedTokenEnv: z.string().optional(),
});

const configSchema = z.object({ servers: z.array(serverSchema).min(1) });

export type ServerConfig = z.infer<typeof serverSchema>;

export const env = {
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'teg-wardogs.db'),
  serversConfigPath:
    process.env.SERVERS_CONFIG ?? path.join(/*turbopackIgnore: true*/ process.cwd(), 'config', 'servers.json'),
  demoMode: process.env.DEMO_MODE === 'true',
  pollIntervalMs: Math.max(2000, Number(process.env.POLL_INTERVAL_MS ?? 5000)),
  steamApiKey: process.env.STEAM_API_KEY || null,
  workerEnabled: process.env.WORKER_ENABLED !== 'false',
};

/** The servers shown when no config file exists: TEG's WARDOGS network, used by demo mode. */
const DEMO_SERVERS: ServerConfig[] = [
  { id: 'na-1', name: 'TEG | NA #1', shortName: 'NA #1', region: 'NA', location: 'Chicago, US' },
  { id: 'na-2', name: 'TEG | NA #2', shortName: 'NA #2', region: 'NA', location: 'Dallas, US' },
  { id: 'na-3', name: 'TEG | NA #3', shortName: 'NA #3', region: 'NA', location: 'Ashburn, US' },
  { id: 'eu-1', name: 'TEG | EU #1', shortName: 'EU #1', region: 'EU', location: 'Amsterdam, NL' },
  { id: 'eu-2', name: 'TEG | EU #2', shortName: 'EU #2', region: 'EU', location: 'Amsterdam, NL' },
  { id: 'oce-1', name: 'TEG | OCE #1', shortName: 'OCE #1', region: 'OCE', location: 'Sydney, AU' },
];

let cached: ServerConfig[] | null = null;

export function getServerConfigs(): ServerConfig[] {
  if (cached) return cached;
  if (fs.existsSync(/*turbopackIgnore: true*/ env.serversConfigPath)) {
    const raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ env.serversConfigPath, 'utf8'));
    cached = configSchema.parse(raw).servers;
  } else if (env.demoMode) {
    cached = DEMO_SERVERS;
  } else {
    throw new Error(
      `No server config at ${env.serversConfigPath}. Copy config/servers.example.json, or set DEMO_MODE=true.`,
    );
  }
  return cached;
}

export function rconPassword(server: ServerConfig): string | null {
  return server.rcon ? (process.env[server.rcon.passwordEnv] ?? null) : null;
}

/** The server whose kill feed token matches, or null. */
export function serverForFeedToken(token: string): ServerConfig | null {
  for (const s of getServerConfigs()) {
    const expected = s.feedTokenEnv ? process.env[s.feedTokenEnv] : undefined;
    if (expected && timingSafeEqual(expected, token)) return s;
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function feedEnabled(server: ServerConfig): boolean {
  if (env.demoMode && !server.rcon) return true;
  return !!(server.feedTokenEnv && process.env[server.feedTokenEnv]);
}
