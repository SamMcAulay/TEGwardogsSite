# Warcon Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stats site's own collection (RCON, Steam query, kill feed ingest, SQLite) with reads from Warcon's keyed API, cached in memory, and deploy it at `stats.tegwardogs.fyi`.

**Architecture:** A Warcon client (`src/lib/server/warcon/`) fetches, validates (zod, which strips every field it does not name) and caches Warcon responses. `src/lib/server/data.ts` turns them into the view types the pages already use (moved to `src/lib/server/views.ts`), so pages mostly change from synchronous calls to `await`. The old data layer stays compiling until every page has moved, then is deleted in one task.

**Tech Stack:** Next.js 16.3 (app router, server components), React 19, TypeScript, zod 4, vitest 5, Node 22, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-04-warcon-data-layer-design.md` (read section 12, "Corrections made while planning", first).

## Global Constraints

- Node >= 22; no new runtime dependencies (zod is already there). `better-sqlite3` is removed in Task 12.
- Warcon is reached only at `WARCON_BASE_URL` with `Authorization: Bearer <WARCON_TOKEN>`; timeout 8 s.
- Fields never returned by the client, never shown, never in the public JSON API: `ping`, notes, `watch`/`watched`, `risk`, `bannedOn`/`banned`, `orgLists`, `actions`, `host`, `port`, `notes`, `caps`, `build`, IPs.
- Cache freshness: live status 10 s, kills 10 s, boards/careers/dossiers/match lists/analytics/recent players 60 s, ended match 1 h, Steam profiles 24 h; stale-on-error 5 min; at most 500 entries.
- Search index: org board export (`scope=org&range=all&sort=playtime&minMinutes=0`) every 15 min; 25 results.
- Periods: `7d`, `30d`, `90d`, `all`. Sorts: `kills`, `deaths`, `kd`, `perHour`, `playtime`, `matches`, `wins`, `winRate`, `cash`. Board page size 50.
- Timestamps inside the site stay **unix seconds** (`nowSec()`); Warcon's ISO strings are converted in `data.ts` only.
- Colours only in `:root` tokens in `src/app/globals.css` (CLAUDE.md).
- Read `node_modules/next/dist/docs/` before using any Next API not already used in this repo (AGENTS.md).
- Commit after each task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A server that is offline or never observed** (`summary` answers `live: null` or `ok:false`): its card says offline, every other server still renders. Pinned in Task 6 (`getServers` test).
- **A Steam ID that Warcon has never seen** on `/players/<id>`: 404 page, not a crash. Pinned in Task 6 (`getPlayer` test).
- **Warcon down for longer than the stale window**: each page section shows the unavailable panel; the page itself still returns 200. Pinned in Task 2 (cache test) and Task 7 (`Section` test).
- **One of six servers failing during a merge**: merged lists still show the other five and name the missing one. Pinned in Task 4.
- **Dossier for a watched / banned / noted player**: none of that reaches the page or `/api/players/:id`. Pinned in Task 3 (schema privacy test) and Task 11 (API route test).

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/server/warcon/env.ts` | read and validate site env (`WARCON_BASE_URL`, `WARCON_TOKEN`, `SITE_URL`, `SERVER_IDS`, `ALLOW_INDEXING`) |
| `src/lib/server/warcon/http.ts` | `createWarcon()`: fetch, auth, timeout, typed `WarconError`, zod parse |
| `src/lib/server/warcon/cache.ts` | `TtlCache`: freshness, shared in-flight load, stale-on-error, LRU |
| `src/lib/server/warcon/schemas.ts` | zod schemas for every endpoint; the privacy boundary |
| `src/lib/server/warcon/api.ts` | one cached function per Warcon endpoint |
| `src/lib/server/warcon/merge.ts` | cross-server merge helpers |
| `src/lib/server/warcon/search.ts` | player search index from the board export |
| `src/lib/server/warcon/index.ts` | process-wide singletons: `warcon()`, `searchIndex()` |
| `src/lib/server/views.ts` | view types and period/metric vocabulary (moved from `queries.ts`) |
| `src/lib/server/data.ts` | page-facing async functions returning view types |
| `src/components/section.tsx` | `<Section>`: renders children or the unavailable panel |
| `scripts/mock-warcon.mjs` | the mock Warcon for dev and fixtures |
| `scripts/doctor.ts` | rewritten connectivity checks |
| `scripts/deploy.sh` | VPS deploy with doctor gate |

Tests sit next to code as `*.test.ts` (vitest `include: ['src/**/*.test.ts']`).

---

### Task 1: Site env and the HTTP client

**Files:**
- Create: `src/lib/server/warcon/env.ts`, `src/lib/server/warcon/http.ts`
- Test: `src/lib/server/warcon/env.test.ts`, `src/lib/server/warcon/http.test.ts`
- Modify: `vitest.config.mts` (test env)

**Interfaces:**
- Produces: `loadSiteEnv(src?: NodeJS.ProcessEnv): SiteEnv`; `siteEnv(): SiteEnv` (memoised); `interface SiteEnv { warconBaseUrl: string; warconToken: string; siteUrl: string; serverIds: string[]; allowIndexing: boolean }`
- Produces: `class WarconError extends Error { status: number | null; kind: WarconErrorKind; endpoint: string }`, `type WarconErrorKind = 'unreachable' | 'timeout' | 'rejected' | 'forbidden' | 'not_found' | 'http' | 'schema'`
- Produces: `createWarcon(opts: { baseUrl: string; token: string; timeoutMs?: number; fetch?: typeof fetch }): Warcon`, `interface Warcon { json<T>(path: string, schema: z.ZodType<T>): Promise<T>; text(path: string): Promise<string> }`

- [ ] **Step 1: Write the failing env test** — `src/lib/server/warcon/env.test.ts`

```ts
import { describe, expect, test } from 'vitest';
import { loadSiteEnv } from './env';

const base = { WARCON_BASE_URL: 'http://warcon:3000/', WARCON_TOKEN: 'wk_x', SITE_URL: 'https://stats.example.com/' };

describe('loadSiteEnv', () => {
  test('trims trailing slashes and applies defaults', () => {
    expect(loadSiteEnv(base)).toEqual({
      warconBaseUrl: 'http://warcon:3000',
      warconToken: 'wk_x',
      siteUrl: 'https://stats.example.com',
      serverIds: [],
      allowIndexing: false,
    });
  });

  test('SERVER_IDS keeps order and drops blanks', () => {
    expect(loadSiteEnv({ ...base, SERVER_IDS: ' b, a ,,' }).serverIds).toEqual(['b', 'a']);
  });

  test('ALLOW_INDEXING is true only for "true"', () => {
    expect(loadSiteEnv({ ...base, ALLOW_INDEXING: 'true' }).allowIndexing).toBe(true);
    expect(loadSiteEnv({ ...base, ALLOW_INDEXING: 'yes' }).allowIndexing).toBe(false);
  });

  test('names every missing required variable', () => {
    expect(() => loadSiteEnv({})).toThrow(/WARCON_BASE_URL[\s\S]*WARCON_TOKEN[\s\S]*SITE_URL/);
  });

  test('rejects a non-http SITE_URL or WARCON_BASE_URL', () => {
    expect(() => loadSiteEnv({ ...base, SITE_URL: 'stats.example.com' })).toThrow(/SITE_URL/);
    expect(() => loadSiteEnv({ ...base, WARCON_BASE_URL: 'warcon:3000' })).toThrow(/WARCON_BASE_URL/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/server/warcon/env.test.ts`
Expected: FAIL, cannot resolve `./env`.

- [ ] **Step 3: Implement `env.ts`**

```ts
// Site configuration from the environment. Everything the site needs to reach Warcon.

export interface SiteEnv {
  warconBaseUrl: string;
  warconToken: string;
  /** public origin, for canonical links, sitemap.xml and robots.txt */
  siteUrl: string;
  /** Warcon server ids to show, in order; empty: every server the key sees */
  serverIds: string[];
  /** false keeps search engines out (the temporary address) */
  allowIndexing: boolean;
}

const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

export function loadSiteEnv(src: NodeJS.ProcessEnv = process.env): SiteEnv {
  const missing: string[] = [];
  const req = (key: string) => {
    const v = (src[key] ?? '').trim();
    if (!v) missing.push(key);
    return v.replace(/\/+$/, '');
  };
  const warconBaseUrl = req('WARCON_BASE_URL');
  const warconToken = req('WARCON_TOKEN');
  const siteUrl = req('SITE_URL');
  if (missing.length) throw new Error(`Missing required environment variables:\n  ${missing.join('\n  ')}`);
  for (const [key, v] of [['WARCON_BASE_URL', warconBaseUrl], ['SITE_URL', siteUrl]] as const) {
    if (!isHttpUrl(v)) throw new Error(`${key} must be an absolute http(s) URL, got: ${v}`);
  }
  return {
    warconBaseUrl,
    warconToken,
    siteUrl,
    serverIds: (src.SERVER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    allowIndexing: (src.ALLOW_INDEXING ?? '').trim() === 'true',
  };
}

let memo: SiteEnv | null = null;
export function siteEnv(): SiteEnv {
  return (memo ??= loadSiteEnv());
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/server/warcon/env.test.ts` — Expected: 5 passed.

- [ ] **Step 5: Write the failing client test** — `src/lib/server/warcon/http.test.ts`

```ts
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { createWarcon, WarconError } from './http';

const okSchema = z.object({ ok: z.literal(true), n: z.number() });
const res = (status: number, body: unknown, type = 'application/json') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });

const client = (f: typeof fetch) => createWarcon({ baseUrl: 'http://w', token: 'tok', fetch: f, timeoutMs: 50 });

describe('createWarcon', () => {
  test('sends the bearer token and parses the body', async () => {
    const f = vi.fn(async () => res(200, { ok: true, n: 1 }));
    await expect(client(f).json('/api/x', okSchema)).resolves.toEqual({ ok: true, n: 1 });
    expect(f).toHaveBeenCalledWith('http://w/api/x', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer tok' }) }));
  });

  test.each([
    [401, 'rejected'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'http'],
  ] as const)('HTTP %i becomes kind %s', async (status, kind) => {
    const err = await client(async () => res(status, { ok: false })).json('/api/x', okSchema).catch((e) => e);
    expect(err).toBeInstanceOf(WarconError);
    expect(err).toMatchObject({ status, kind, endpoint: '/api/x' });
  });

  test('a body that fails its schema names the endpoint and the path', async () => {
    const err = await client(async () => res(200, { ok: true, n: 'one' })).json('/api/x', okSchema).catch((e) => e);
    expect(err).toMatchObject({ kind: 'schema', endpoint: '/api/x' });
    expect(String(err.message)).toMatch(/\/api\/x[\s\S]*n/);
  });

  test('a network failure is unreachable', async () => {
    const err = await client(async () => {
      throw new TypeError('fetch failed');
    }).json('/api/x', okSchema).catch((e) => e);
    expect(err).toMatchObject({ kind: 'unreachable', status: null });
  });

  test('a slow answer is a timeout', async () => {
    const slow: typeof fetch = (_u, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'TimeoutError'))));
    const err = await client(slow).json('/api/x', okSchema).catch((e) => e);
    expect(err).toMatchObject({ kind: 'timeout' });
  });

  test('a Cloudflare login page (HTML 200) is rejected, not parsed', async () => {
    const err = await client(async () => res(200, '<html>', 'text/html')).json('/api/x', okSchema).catch((e) => e);
    expect(err).toMatchObject({ kind: 'http' });
  });

  test('text() returns the raw body', async () => {
    await expect(client(async () => res(200, 'a,b\n1,2', 'text/csv')).text('/api/e')).resolves.toBe('a,b\n1,2');
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run src/lib/server/warcon/http.test.ts` — Expected: FAIL, cannot resolve `./http`.

- [ ] **Step 7: Implement `http.ts`**

```ts
// The only code that talks to Warcon over HTTP. Answers are parsed with a zod schema, which
// also drops every field the schema does not name: that is the site's privacy boundary.
import type { z } from 'zod';

export type WarconErrorKind = 'unreachable' | 'timeout' | 'rejected' | 'forbidden' | 'not_found' | 'http' | 'schema';

export class WarconError extends Error {
  constructor(
    message: string,
    readonly kind: WarconErrorKind,
    readonly status: number | null,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = 'WarconError';
  }
}

export interface Warcon {
  json<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  text(path: string): Promise<string>;
}

const KIND_OF: Record<number, WarconErrorKind> = { 401: 'rejected', 403: 'forbidden', 404: 'not_found' };

export function createWarcon(opts: { baseUrl: string; token: string; timeoutMs?: number; fetch?: typeof fetch }): Warcon {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function request(path: string, accept: string): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${opts.token}`, accept },
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new WarconError(`${path}: ${timedOut ? `no answer in ${timeoutMs} ms` : 'Warcon unreachable'}`, timedOut ? 'timeout' : 'unreachable', null, path);
    }
    if (!res.ok) {
      throw new WarconError(`${path}: Warcon answered HTTP ${res.status}`, KIND_OF[res.status] ?? 'http', res.status, path);
    }
    return res;
  }

  return {
    async json(path, schema) {
      const res = await request(path, 'application/json');
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
        throw new WarconError(`${path}: expected JSON, got ${res.headers.get('content-type') ?? 'nothing'}`, 'http', res.status, path);
      }
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) {
        const where = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        throw new WarconError(`${path}: unexpected answer (${where})`, 'schema', res.status, path);
      }
      return parsed.data;
    },
    async text(path) {
      return (await request(path, 'text/csv')).text();
    },
  };
}
```

- [ ] **Step 8: Run both tests**

Run: `npx vitest run src/lib/server/warcon/` — Expected: all pass.

- [ ] **Step 9: Give the test run the new env** — in `vitest.config.mts` change the `env` line to:

```ts
    env: {
      DEMO_MODE: 'true',
      SERVERS_CONFIG: '/nonexistent/servers.json',
      WARCON_BASE_URL: 'http://warcon.test',
      WARCON_TOKEN: 'test-token',
      SITE_URL: 'https://stats.test',
    },
```

(`DEMO_MODE` and `SERVERS_CONFIG` go in Task 12 with the code that reads them.)

- [ ] **Step 10: Run the whole suite and commit**

Run: `npm test` — Expected: all pass.

```bash
git add src/lib/server/warcon vitest.config.mts
git commit -m "feat: Warcon HTTP client and site env"
```

---

### Task 2: The cache

**Files:**
- Create: `src/lib/server/warcon/cache.ts`
- Test: `src/lib/server/warcon/cache.test.ts`

**Interfaces:**
- Produces: `class TtlCache { constructor(opts?: { maxEntries?: number; staleMs?: number; now?: () => number }); get<T>(key: string, ttlMs: number | ((value: T) => number), load: () => Promise<T>): Promise<Cached<T>>; get size(): number }`, `interface Cached<T> { value: T; stale: boolean }`

- [ ] **Step 1: Write the failing test** — `src/lib/server/warcon/cache.test.ts`

```ts
import { describe, expect, test, vi } from 'vitest';
import { TtlCache } from './cache';

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('TtlCache', () => {
  test('serves a fresh value without loading again', async () => {
    const c = clock();
    const cache = new TtlCache({ now: c.now });
    const load = vi.fn(async () => 1);
    await cache.get('k', 1000, load);
    c.advance(999);
    expect(await cache.get('k', 1000, load)).toEqual({ value: 1, stale: false });
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('reloads once the value is past its freshness', async () => {
    const c = clock();
    const cache = new TtlCache({ now: c.now });
    let n = 0;
    const load = async () => ++n;
    await cache.get('k', 1000, load);
    c.advance(1001);
    expect((await cache.get('k', 1000, load)).value).toBe(2);
  });

  test('concurrent callers share one load', async () => {
    const cache = new TtlCache();
    let release!: (v: number) => void;
    const load = vi.fn(() => new Promise<number>((r) => (release = r)));
    const all = Promise.all(Array.from({ length: 50 }, () => cache.get('k', 1000, load)));
    release(7);
    expect((await all).every((r) => r.value === 7)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('a failed refresh serves the last value as stale for up to 5 minutes, then throws', async () => {
    const c = clock();
    const cache = new TtlCache({ now: c.now, staleMs: 300_000 });
    await cache.get('k', 1000, async () => 1);
    const boom = async () => {
      throw new Error('down');
    };
    c.advance(1000 + 299_000);
    expect(await cache.get('k', 1000, boom)).toEqual({ value: 1, stale: true });
    c.advance(2000);
    await expect(cache.get('k', 1000, boom)).rejects.toThrow('down');
  });

  test('a failure with nothing cached throws, and is not cached', async () => {
    const cache = new TtlCache();
    await expect(cache.get('k', 1000, async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect((await cache.get('k', 1000, async () => 2)).value).toBe(2);
  });

  test('the TTL may depend on the loaded value', async () => {
    const c = clock();
    const cache = new TtlCache({ now: c.now });
    const load = vi.fn(async () => ({ ended: true }));
    const ttl = (v: { ended: boolean }) => (v.ended ? 3_600_000 : 1000);
    await cache.get('k', ttl, load);
    c.advance(60_000);
    await cache.get('k', ttl, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('evicts the least recently used past maxEntries', async () => {
    const cache = new TtlCache({ maxEntries: 2 });
    const load = vi.fn(async () => 1);
    await cache.get('a', 1000, load);
    await cache.get('b', 1000, load);
    await cache.get('a', 1000, load); // a is now most recent
    await cache.get('c', 1000, load); // evicts b
    expect(cache.size).toBe(2);
    load.mockClear();
    await cache.get('a', 1000, load);
    await cache.get('b', 1000, load);
    expect(load).toHaveBeenCalledTimes(1); // only b reloaded
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/server/warcon/cache.test.ts` — Expected: FAIL, cannot resolve `./cache`.

- [ ] **Step 3: Implement `cache.ts`**

```ts
// In-memory cache for Warcon answers: one load per key at a time, the last good value served
// (flagged stale) for a while when Warcon fails, and a size cap evicting the least recently used.

export interface Cached<T> {
  value: T;
  stale: boolean;
}

interface Entry {
  value: unknown;
  freshUntil: number;
}

export class TtlCache {
  private entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly staleMs: number;
  private readonly now: () => number;

  constructor(opts: { maxEntries?: number; staleMs?: number; now?: () => number } = {}) {
    this.maxEntries = opts.maxEntries ?? 500;
    this.staleMs = opts.staleMs ?? 300_000;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  async get<T>(key: string, ttlMs: number | ((value: T) => number), load: () => Promise<T>): Promise<Cached<T>> {
    const hit = this.entries.get(key);
    if (hit) {
      // Map keeps insertion order: re-inserting marks the key most recently used.
      this.entries.delete(key);
      this.entries.set(key, hit);
      if (this.now() < hit.freshUntil) return { value: hit.value as T, stale: false };
    }

    let pending = this.loading.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load().finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }

    try {
      const value = await pending;
      this.store(key, { value, freshUntil: this.now() + (typeof ttlMs === 'function' ? ttlMs(value) : ttlMs) });
      return { value, stale: false };
    } catch (e) {
      const last = this.entries.get(key);
      if (last && this.now() < last.freshUntil + this.staleMs) return { value: last.value as T, stale: true };
      throw e;
    }
  }

  private store(key: string, entry: Entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/server/warcon/cache.test.ts` — Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/warcon/cache.ts src/lib/server/warcon/cache.test.ts
git commit -m "feat: TTL cache with shared loads, stale-on-error and LRU cap"
```

---

### Task 3: Schemas and the endpoint functions

**Files:**
- Create: `src/lib/server/warcon/schemas.ts`, `src/lib/server/warcon/api.ts`, `src/lib/server/warcon/index.ts`
- Test: `src/lib/server/warcon/schemas.test.ts`, `src/lib/server/warcon/api.test.ts`

**Interfaces:**
- Consumes: `Warcon`, `WarconError` (Task 1); `TtlCache`, `Cached` (Task 2)
- Produces (types inferred from schemas, exported from `schemas.ts`): `WServer`, `WLive`, `WPlayer`, `WBoardRow`, `WBoard`, `WCareer`, `WCareerMatch`, `WCombat`, `WDossier`, `WMatchSummary`, `WMatchList`, `WMatchLine`, `WMatchView`, `WKill`, `WKills`, `WAnalytics`, `WSeenPlayer`, `WSteamProfiles`
- Produces (`api.ts`): `createApi(client: Warcon, cache: TtlCache): WarconApi` with
  - `servers(): Promise<Cached<WServer[]>>`
  - `live(serverId): Promise<Cached<WLive | null>>`
  - `board(serverId, q: BoardQuery): Promise<Cached<WBoard>>`, `interface BoardQuery { scope: 'server' | 'org'; range: '7d'|'30d'|'90d'|'all'; sort: Sort; dir?: 'asc'|'desc'; page?: number; minMinutes?: number }`, `type Sort = 'kills'|'deaths'|'kd'|'perHour'|'playtime'|'matches'|'wins'|'winRate'|'cash'`
  - `career(serverId, steamId): Promise<Cached<WCareer>>`
  - `dossier(serverId, steamId): Promise<Cached<WDossier>>`
  - `matches(serverId, page?): Promise<Cached<WMatchList>>`
  - `match(serverId, matchId): Promise<Cached<WMatchView>>`
  - `kills(serverId, q: KillQuery): Promise<Cached<WKills>>`, `interface KillQuery { limit?: number; before?: { ts: string; eventTime: number } | null; match?: number | null; player?: string; killer?: string; victim?: string; cause?: string; kind?: 'headshot'|'teamKill'|'suicide'|'vehicle'|'environment'|''; minM?: number | null; count?: boolean }`
  - `analytics(serverId, range: '24h'|'7d'|'30d'): Promise<Cached<WAnalytics>>`
  - `seen(serverId, q: { limit?: number; sort?: 'lastSeen' }): Promise<Cached<WSeenPlayer[]>>`
  - `steamProfiles(ids: string[]): Promise<WSteamProfiles>` (never throws: `{}` on failure)
  - `boardExportCsv(serverId): Promise<string>` (uncached; the search index owns its refresh)
- Produces (`index.ts`): `warcon(): WarconApi` process-wide singleton built from `siteEnv()`.

- [ ] **Step 1: Write the failing schema test** — `src/lib/server/warcon/schemas.test.ts`

```ts
import { describe, expect, test } from 'vitest';
import { dossierBody, liveBody, seenBody, serversBody } from './schemas';

describe('schemas are the privacy boundary', () => {
  test('a dossier comes out without risk, watch, bans, lists, notes or actions', () => {
    const raw = {
      ok: true,
      dossier: {
        steamId: '76561198000000001',
        name: 'Alpha',
        names: ['Alpha', 'Old'],
        online: null,
        steamEnabled: true,
        steam: { persona: 'Alpha', avatar: 'https://a/1.jpg', profileUrl: 'x', vacBans: 2, friendsTotal: 9 },
        risk: { level: 'high', reasons: ['vac'] },
        watch: { watched: true, reason: 'aimbot report', updatedByName: 'mod', updatedAt: null },
        bannedOn: [{ serverId: 's', serverName: 'S', reason: 'x', bannedBy: 'mod' }],
        orgServerCount: 6,
        orgLists: { ban: null, reserve: null, canBan: true, canReserve: true },
        summary: { sessions: 3, minutes: 90, kills: 10, deaths: 5, firstSeen: '2026-09-01T00:00:00Z', lastSeen: '2026-10-01T00:00:00Z' },
        combat: null,
        perServer: [],
        recent: [{ ip: '203.0.113.9' }],
        notes: [{ body: 'secret' }],
        actions: [{ id: 1 }],
      },
    };
    const out = JSON.stringify(dossierBody.parse(raw));
    for (const word of ['risk', 'watch', 'aimbot', 'bannedOn', 'orgLists', 'notes', 'secret', 'actions', 'vacBans', '203.0.113.9']) {
      expect(out).not.toContain(word);
    }
    expect(dossierBody.parse(raw).dossier.steam).toEqual({ avatar: 'https://a/1.jpg' });
  });

  test('live players come out without ping', () => {
    const out = liveBody.parse({
      ok: true,
      live: {
        serverId: 's',
        ok: true,
        error: '',
        build: '1.2.3',
        gameServerId: 'JOIN1',
        startedAt: null,
        status: {
          serverName: 'S', map: 'M', experiences: [], lighting: 'Day', matchSeconds: 10,
          playerCount: 1, maxPlayers: 64, scores: [{ name: 'Valkyra', colorHex: '#f00', score: 3 }],
        },
        players: [{ name: 'A', steamId: '76561198000000001', faction: 'Valkyra', kills: 1, deaths: 0, cash: 5, ping: 40 }],
        observedAt: '2026-10-04T12:00:00Z',
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/ping|build/);
  });

  test('servers come out without host, port or notes', () => {
    const out = serversBody.parse({ ok: true, servers: [{ id: 's', orgId: 'o', name: 'EU#1 - x', sortOrder: 0, host: '10.0.0.1', port: 7776, notes: 'pw in vault' }] });
    expect(out.servers[0]).toEqual({ id: 's', orgId: 'o', name: 'EU#1 - x', sortOrder: 0 });
  });

  test('seen players come out without banned or watched', () => {
    const out = seenBody.parse({
      ok: true,
      total: 1,
      players: [{ steamId: '76561198000000001', name: 'A', aliases: [], firstSeen: 'x', lastSeen: 'y', minutes: 1, kills: 0, deaths: 0, online: false, lastServerId: 's', banned: 'org', watched: true, steam: null }],
    });
    expect(JSON.stringify(out)).not.toMatch(/banned|watched/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/server/warcon/schemas.test.ts` — Expected: FAIL, cannot resolve `./schemas`.

- [ ] **Step 3: Implement `schemas.ts`**

zod `z.object` strips keys it does not name (never use `.passthrough()` / `.loose()` here).

```ts
// zod schemas for the Warcon answers the site reads. Each names only what a page shows:
// zod drops everything else, so private fields (pings, notes, watchlist, risk, bans, IPs,
// RCON hosts) never leave this module. Never make these schemas loose.
import { z } from 'zod';

const steamId = z.string().regex(/^\d{17}$/);
const iso = z.string();

export const serversBody = z.object({
  ok: z.literal(true),
  servers: z.array(z.object({ id: z.string(), orgId: z.string(), name: z.string(), sortOrder: z.number() })),
});
export type WServer = z.infer<typeof serversBody>['servers'][number];

const player = z.object({
  name: z.string(),
  steamId: z.string(),
  faction: z.string().nullable(),
  kills: z.number(),
  deaths: z.number(),
  cash: z.number(),
});
export type WPlayer = z.infer<typeof player>;

const live = z.object({
  ok: z.boolean(),
  gameServerId: z.string(),
  startedAt: iso.nullable(),
  observedAt: iso.nullable(),
  status: z
    .object({
      serverName: z.string(),
      map: z.string(),
      experiences: z.array(z.string()),
      lighting: z.string(),
      matchSeconds: z.number().nullable(),
      playerCount: z.number(),
      maxPlayers: z.number(),
      scores: z.array(z.object({ name: z.string(), colorHex: z.string(), score: z.number() })),
    })
    .nullable(),
  players: z.array(player),
});
export const liveBody = z.object({ live: live.nullable() });
export type WLive = z.infer<typeof live>;

const boardRow = z.object({
  rank: z.number(),
  steamId: z.string(),
  name: z.string(),
  minutes: z.number(),
  kills: z.number(),
  deaths: z.number(),
  headshots: z.number(),
  matches: z.number(),
  wins: z.number(),
  losses: z.number(),
  draws: z.number(),
  cash: z.number(),
  lastSeen: iso.nullable(),
});
export const boardBody = z.object({ ok: z.literal(true), rows: z.array(boardRow), total: z.number(), pageSize: z.number() });
export type WBoardRow = z.infer<typeof boardRow>;
export type WBoard = z.infer<typeof boardBody>;

const result = z.enum(['win', 'loss', 'draw']).nullable();
const careerGroup = z.object({ key: z.string(), matches: z.number(), wins: z.number(), losses: z.number(), draws: z.number(), kills: z.number(), deaths: z.number() });
const careerMatch = z.object({
  matchId: z.number(),
  serverId: z.string(),
  serverName: z.string(),
  startedAt: iso,
  endedAt: iso.nullable(),
  map: z.string().nullable(),
  faction: z.string().nullable(),
  result,
  seconds: z.number(),
  kills: z.number(),
  deaths: z.number(),
  cashDelta: z.number(),
  headshots: z.number(),
});
export const careerBody = z.object({
  ok: z.literal(true),
  career: z.object({
    rank: z.object({ server: z.number().nullable(), org: z.number().nullable() }),
    streak: z.object({ kind: z.enum(['win', 'loss']), n: z.number() }).nullable(),
    matches: z.number(),
    wins: z.number(),
    losses: z.number(),
    draws: z.number(),
    kills: z.number(),
    deaths: z.number(),
    minutes: z.number(),
    headshots: z.number(),
    longestM: z.number().nullable(),
    killStreak: z.number(),
    maps: z.array(careerGroup),
    factions: z.array(careerGroup),
    last: z.array(careerMatch),
  }),
});
export type WCareer = z.infer<typeof careerBody>['career'];
export type WCareerMatch = z.infer<typeof careerMatch>;

const kill = z.object({
  eventId: z.string(),
  ts: iso,
  map: z.string(),
  eventTime: z.number(),
  killer: z.object({ steamId: z.string(), name: z.string(), faction: z.string().nullable() }).nullable(),
  victim: z.object({ steamId: z.string(), name: z.string(), faction: z.string().nullable() }),
  cause: z.string().nullable(),
  distanceM: z.number().nullable(),
  headshot: z.boolean(),
  suicide: z.boolean(),
  teamKill: z.boolean(),
  tags: z.array(z.string()),
});
export type WKill = z.infer<typeof kill>;
export const killsBody = z.object({ ok: z.literal(true), kills: z.array(kill), total: z.number().nullable() });
export type WKills = z.infer<typeof killsBody>;

const combat = z.object({
  kills: z.number(),
  deaths: z.number(),
  headshots: z.number(),
  teamKills: z.number(),
  suicides: z.number(),
  avgDistanceM: z.number().nullable(),
  longestM: z.number().nullable(),
  causes: z.array(z.object({ cause: z.string(), kills: z.number() })),
  victims: z.array(z.object({ steamId: z.string(), name: z.string(), kills: z.number() })),
  nemeses: z.array(z.object({ steamId: z.string(), name: z.string(), deaths: z.number() })),
  recent: z.array(kill.extend({ serverId: z.string(), serverName: z.string() })),
});
export type WCombat = z.infer<typeof combat>;
export const dossierBody = z.object({
  ok: z.literal(true),
  dossier: z.object({
    steamId,
    name: z.string(),
    names: z.array(z.string()),
    online: z.object({ serverId: z.string(), serverName: z.string() }).nullable(),
    steam: z.object({ avatar: z.string() }).nullable(),
    summary: z.object({
      sessions: z.number(),
      minutes: z.number(),
      kills: z.number(),
      deaths: z.number(),
      firstSeen: iso.nullable(),
      lastSeen: iso.nullable(),
    }),
    combat: combat.nullable(),
    perServer: z.array(
      z.object({ serverId: z.string(), serverName: z.string(), minutes: z.number(), kills: z.number(), deaths: z.number(), lastSeen: iso }),
    ),
  }),
});
export type WDossier = z.infer<typeof dossierBody>['dossier'];

const matchSummary = z.object({
  id: z.number(),
  startedAt: iso,
  endedAt: iso.nullable(),
  map: z.string().nullable(),
  experiences: z.string().nullable(),
  lighting: z.string().nullable(),
  peakPlayers: z.number(),
  players: z.number(),
  finalScores: z.array(z.object({ name: z.string(), score: z.number() })).nullable(),
  winner: z.string().nullable(),
});
export type WMatchSummary = z.infer<typeof matchSummary>;
const liveFaction = z.object({ name: z.string(), colorHex: z.string().nullable(), score: z.number() });
export const matchListBody = z.object({
  ok: z.literal(true),
  matches: z.array(matchSummary),
  live: z.array(liveFaction),
  page: z.number(),
  pages: z.number(),
  total: z.number(),
});
export type WMatchList = z.infer<typeof matchListBody>;

const matchLine = z.object({
  steamId: z.string(),
  name: z.string(),
  faction: z.string().nullable(),
  seconds: z.number(),
  kills: z.number(),
  deaths: z.number(),
  cashDelta: z.number(),
  headshots: z.number(),
  longestM: z.number().nullable(),
  killStreak: z.number(),
  result,
});
export type WMatchLine = z.infer<typeof matchLine>;
export const matchBody = z.object({
  ok: z.literal(true),
  match: matchSummary,
  factions: z.array(z.object({ name: z.string(), colorHex: z.string().nullable() })),
  lines: z.array(matchLine),
  timeline: z.array(z.array(z.number())),
  awards: z.array(z.object({ key: z.string(), label: z.string(), steamId: z.string(), name: z.string(), value: z.string() })),
  kills: z.number(),
  hasFeed: z.boolean(),
});
export type WMatchView = Omit<z.infer<typeof matchBody>, 'ok'>;

export const analyticsBody = z.object({
  ok: z.literal(true),
  bucketSeconds: z.number(),
  summary: z.object({ uniquePlayers: z.number(), peakPlayers: z.number(), avgPlayers: z.number(), onlineNow: z.number(), matches: z.number() }),
  population: z.array(z.object({ ts: iso, avg: z.number().nullable(), max: z.number().nullable(), cap: z.number().nullable() })),
  maps: z.array(z.object({ map: z.string(), minutes: z.number(), matches: z.number() })),
  wins: z.object({ teams: z.array(z.object({ name: z.string(), wins: z.number(), colorHex: z.string().nullable() })) }),
  combat: z.object({ kills: z.number(), headshots: z.number() }).nullable(),
});
export type WAnalytics = z.infer<typeof analyticsBody>;

const seenPlayer = z.object({
  steamId: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  firstSeen: iso,
  lastSeen: iso,
  minutes: z.number(),
  kills: z.number(),
  deaths: z.number(),
  online: z.boolean(),
  lastServerId: z.string(),
  steam: z.object({ avatar: z.string() }).nullable(),
});
export const seenBody = z.object({ ok: z.literal(true), players: z.array(seenPlayer), total: z.number() });
export type WSeenPlayer = z.infer<typeof seenPlayer>;

export const steamProfilesBody = z.record(z.string(), z.object({ name: z.string(), avatar: z.string() }).nullable());
export type WSteamProfiles = z.infer<typeof steamProfilesBody>;
```

Note `liveBody` does not require `ok: true`: `summary` answers `ok: false` with `live: null` for a server never observed (Review Focus 1).

- [ ] **Step 4: Run the schema test**

Run: `npx vitest run src/lib/server/warcon/schemas.test.ts` — Expected: 4 passed.

- [ ] **Step 5: Write the failing api test** — `src/lib/server/warcon/api.test.ts`

```ts
import { describe, expect, test, vi } from 'vitest';
import { createApi } from './api';
import { TtlCache } from './cache';
import type { Warcon } from './http';

const fake = (body: unknown) => {
  const json = vi.fn(async (_path: string, schema: { parse(v: unknown): unknown }) => schema.parse(body));
  return { client: { json, text: vi.fn() } as unknown as Warcon, json };
};

describe('createApi', () => {
  test('board builds the documented query string', async () => {
    const { client, json } = fake({ ok: true, rows: [], total: 0, pageSize: 50 });
    await createApi(client, new TtlCache()).board('s1', { scope: 'org', range: '90d', sort: 'perHour', page: 2 });
    expect(json.mock.calls[0][0]).toBe('/api/servers/s1/leaderboard?scope=org&range=90d&sort=perHour&dir=desc&page=2&minMinutes=60');
  });

  test('kills passes only the filters that are set', async () => {
    const { client, json } = fake({ ok: true, kills: [], total: null });
    await createApi(client, new TtlCache()).kills('s1', { limit: 20, killer: '7656', kind: 'headshot', minM: null, count: true });
    expect(json.mock.calls[0][0]).toBe('/api/servers/s1/kills?limit=20&killer=7656&kind=headshot&count=1');
  });

  test('ids are URL-encoded', async () => {
    const { client, json } = fake({ ok: true, kills: [], total: null });
    await createApi(client, new TtlCache()).kills('a/b', {});
    expect(json.mock.calls[0][0]).toBe('/api/servers/a%2Fb/kills?limit=50');
  });

  test('a second call within the TTL is served from cache', async () => {
    const { client, json } = fake({ ok: true, servers: [] });
    const api = createApi(client, new TtlCache());
    await api.servers();
    await api.servers();
    expect(json).toHaveBeenCalledTimes(1);
  });

  test('steamProfiles batches by 100 and never throws', async () => {
    const json = vi.fn(async () => {
      throw new Error('steam_disabled');
    });
    const api = createApi({ json, text: vi.fn() } as unknown as Warcon, new TtlCache());
    const ids = Array.from({ length: 150 }, (_, i) => String(76561198000000000 + i));
    await expect(api.steamProfiles(ids)).resolves.toEqual({});
    expect(json).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run src/lib/server/warcon/api.test.ts` — Expected: FAIL, cannot resolve `./api`.

- [ ] **Step 7: Implement `api.ts`**

```ts
// One cached function per Warcon endpoint the site reads. Freshness per kind of data is
// spec §5.1; everything else about caching is TtlCache's.
import type { Cached, TtlCache } from './cache';
import type { Warcon } from './http';
import {
  analyticsBody, boardBody, careerBody, dossierBody, killsBody, liveBody, matchBody, matchListBody,
  seenBody, serversBody, steamProfilesBody,
  type WAnalytics, type WBoard, type WCareer, type WDossier, type WKills, type WLive, type WMatchList,
  type WMatchView, type WSeenPlayer, type WServer, type WSteamProfiles,
} from './schemas';

export const TTL = { live: 10_000, kills: 10_000, stats: 60_000, endedMatch: 3_600_000, steam: 86_400_000 } as const;

export type Range = '7d' | '30d' | '90d' | 'all';
export type Sort = 'kills' | 'deaths' | 'kd' | 'perHour' | 'playtime' | 'matches' | 'wins' | 'winRate' | 'cash';
export interface BoardQuery {
  scope: 'server' | 'org';
  range: Range;
  sort: Sort;
  dir?: 'asc' | 'desc';
  page?: number;
  minMinutes?: number;
}
export type KillKind = 'headshot' | 'teamKill' | 'suicide' | 'vehicle' | 'environment' | '';
export interface KillQuery {
  limit?: number;
  before?: { ts: string; eventTime: number } | null;
  match?: number | null;
  player?: string;
  killer?: string;
  victim?: string;
  cause?: string;
  kind?: KillKind;
  minM?: number | null;
  count?: boolean;
}

const enc = encodeURIComponent;
const qs = (params: Record<string, string | number | null | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${enc(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export function createApi(client: Warcon, cache: TtlCache) {
  const cached = <T>(path: string, ttl: number, load: () => Promise<T>): Promise<Cached<T>> => cache.get<T>(path, ttl, load);

  return {
    servers(): Promise<Cached<WServer[]>> {
      const path = '/api/servers';
      return cached(path, TTL.live, async () => (await client.json(path, serversBody)).servers);
    },

    live(serverId: string): Promise<Cached<WLive | null>> {
      const path = `/api/servers/${enc(serverId)}/summary`;
      return cached(path, TTL.live, async () => (await client.json(path, liveBody)).live);
    },

    board(serverId: string, q: BoardQuery): Promise<Cached<WBoard>> {
      const path = `/api/servers/${enc(serverId)}/leaderboard${qs({
        scope: q.scope, range: q.range, sort: q.sort, dir: q.dir ?? 'desc', page: q.page ?? 1, minMinutes: q.minMinutes ?? 60,
      })}`;
      return cached(path, TTL.stats, () => client.json(path, boardBody));
    },

    career(serverId: string, steamId: string): Promise<Cached<WCareer>> {
      const path = `/api/servers/${enc(serverId)}/players/${enc(steamId)}/career`;
      return cached(path, TTL.stats, async () => (await client.json(path, careerBody)).career);
    },

    dossier(serverId: string, steamId: string): Promise<Cached<WDossier>> {
      const path = `/api/servers/${enc(serverId)}/players/${enc(steamId)}`;
      return cached(path, TTL.stats, async () => (await client.json(path, dossierBody)).dossier);
    },

    matches(serverId: string, page = 1): Promise<Cached<WMatchList>> {
      const path = `/api/servers/${enc(serverId)}/matches${qs({ page })}`;
      return cached(path, TTL.stats, () => client.json(path, matchListBody));
    },

    match(serverId: string, matchId: number): Promise<Cached<WMatchView>> {
      const path = `/api/servers/${enc(serverId)}/matches/${matchId}`;
      // An ended match never changes; one still running is refreshed like a list.
      return cache.get<WMatchView>(path, (v) => (v.match.endedAt ? TTL.endedMatch : TTL.stats), () => client.json(path, matchBody));
    },

    kills(serverId: string, q: KillQuery): Promise<Cached<WKills>> {
      const path = `/api/servers/${enc(serverId)}/kills${qs({
        limit: q.limit ?? 50,
        before: q.before?.ts,
        beforeTime: q.before?.eventTime,
        match: q.match,
        player: q.player,
        killer: q.killer,
        victim: q.victim,
        cause: q.cause,
        kind: q.kind,
        minM: q.minM,
        count: q.count ? 1 : undefined,
      })}`;
      return cached(path, q.match ? TTL.stats : TTL.kills, () => client.json(path, killsBody));
    },

    analytics(serverId: string, range: '24h' | '7d' | '30d'): Promise<Cached<WAnalytics>> {
      const path = `/api/servers/${enc(serverId)}/analytics${qs({ range })}`;
      return cached(path, TTL.stats, () => client.json(path, analyticsBody));
    },

    seen(serverId: string, q: { limit?: number; sort?: 'lastSeen' } = {}): Promise<Cached<WSeenPlayer[]>> {
      const path = `/api/servers/${enc(serverId)}/players/seen${qs({ sort: q.sort ?? 'lastSeen', dir: 'desc', limit: q.limit ?? 30 })}`;
      return cached(path, TTL.stats, async () => (await client.json(path, seenBody)).players);
    },

    async steamProfiles(ids: string[]): Promise<WSteamProfiles> {
      const unique = [...new Set(ids)].filter((id) => /^\d{17}$/.test(id)).sort();
      const out: WSteamProfiles = {};
      for (let i = 0; i < unique.length; i += 100) {
        const batch = unique.slice(i, i + 100);
        const path = `/api/steam/profiles?ids=${batch.join(',')}`;
        try {
          Object.assign(out, (await cached(path, TTL.steam, () => client.json(path, steamProfilesBody))).value);
        } catch {
          // Avatars are decoration: no Steam key on the panel, or the limit hit, means badges.
        }
      }
      return out;
    },

    boardExportCsv(serverId: string): Promise<string> {
      return client.text(`/api/servers/${enc(serverId)}/leaderboard/export?scope=org&range=all&sort=playtime&dir=desc&minMinutes=0`);
    },
  };
}

export type WarconApi = ReturnType<typeof createApi>;
```

- [ ] **Step 8: Implement `index.ts`**

```ts
// Process-wide singletons. Next can load server modules more than once in dev; globalThis keeps
// one cache per process.
import { createApi, type WarconApi } from './api';
import { TtlCache } from './cache';
import { siteEnv } from './env';
import { createWarcon } from './http';

const g = globalThis as unknown as { __warcon?: WarconApi };

export function warcon(): WarconApi {
  if (!g.__warcon) {
    const env = siteEnv();
    g.__warcon = createApi(createWarcon({ baseUrl: env.warconBaseUrl, token: env.warconToken }), new TtlCache());
  }
  return g.__warcon;
}
```

- [ ] **Step 9: Run the tests, typecheck, commit**

Run: `npx vitest run src/lib/server/warcon/ && npm run typecheck` — Expected: all pass, no type errors.

```bash
git add src/lib/server/warcon
git commit -m "feat: Warcon schemas (privacy boundary) and cached endpoint functions"
```

---

### Task 4: Merging across servers

**Files:**
- Create: `src/lib/server/warcon/merge.ts`
- Test: `src/lib/server/warcon/merge.test.ts`

**Interfaces:**
- Produces: `interface Merged<T> { rows: T[]; failed: string[]; stale: boolean }`
- Produces: `fanOut<R>(serverIds: string[], load: (id: string) => Promise<Cached<R>>): Promise<{ ok: { id: string; value: R }[]; failed: string[]; stale: boolean }>`
- Produces: `mergeNewest<T>(lists: T[][], at: (row: T) => number, limit: number): T[]`

- [ ] **Step 1: Write the failing test** — `src/lib/server/warcon/merge.test.ts`

```ts
import { describe, expect, test } from 'vitest';
import { fanOut, mergeNewest } from './merge';

describe('fanOut', () => {
  test('collects successes and names the servers that failed', async () => {
    const r = await fanOut(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw new Error('down');
      return { value: id.toUpperCase(), stale: id === 'c' };
    });
    expect(r.ok).toEqual([{ id: 'a', value: 'A' }, { id: 'c', value: 'C' }]);
    expect(r.failed).toEqual(['b']);
    expect(r.stale).toBe(true);
  });

  test('every server failing still resolves', async () => {
    const r = await fanOut(['a'], async () => Promise.reject(new Error('x')));
    expect(r).toEqual({ ok: [], failed: ['a'], stale: false });
  });
});

describe('mergeNewest', () => {
  test('interleaves newest first and trims to the limit', () => {
    const rows = mergeNewest([[{ t: 9 }, { t: 5 }], [{ t: 7 }, { t: 1 }]], (r) => r.t, 3);
    expect(rows.map((r) => r.t)).toEqual([9, 7, 5]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/server/warcon/merge.test.ts` — Expected: FAIL, cannot resolve `./merge`.

- [ ] **Step 3: Implement `merge.ts`**

```ts
// Calling every server and putting the answers together. A server that fails is left out and
// named, so a page can say which one is missing while still showing the rest.
import type { Cached } from './cache';

export interface Merged<T> {
  rows: T[];
  /** server ids whose call failed */
  failed: string[];
  /** some part was served from cache past its freshness */
  stale: boolean;
}

export async function fanOut<R>(
  serverIds: string[],
  load: (id: string) => Promise<Cached<R>>,
): Promise<{ ok: { id: string; value: R }[]; failed: string[]; stale: boolean }> {
  const settled = await Promise.allSettled(serverIds.map((id) => load(id)));
  const ok: { id: string; value: R }[] = [];
  const failed: string[] = [];
  let stale = false;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      ok.push({ id: serverIds[i], value: s.value.value });
      stale ||= s.value.stale;
    } else {
      failed.push(serverIds[i]);
    }
  });
  return { ok, failed, stale };
}

export function mergeNewest<T>(lists: T[][], at: (row: T) => number, limit: number): T[] {
  return lists.flat().sort((a, b) => at(b) - at(a)).slice(0, limit);
}
```

- [ ] **Step 4: Run it, commit**

Run: `npx vitest run src/lib/server/warcon/merge.test.ts` — Expected: 3 passed.

```bash
git add src/lib/server/warcon/merge.ts src/lib/server/warcon/merge.test.ts
git commit -m "feat: cross-server fan-out and newest-first merge"
```

---

### Task 5: The player search index

**Files:**
- Create: `src/lib/server/warcon/search.ts`
- Modify: `src/lib/server/warcon/index.ts` (add `searchIndex()`)
- Test: `src/lib/server/warcon/search.test.ts`

**Interfaces:**
- Consumes: `WarconApi.boardExportCsv` (Task 3)
- Produces: `interface SearchHit { steamId: string; name: string; minutes: number; lastSeen: string | null }`
- Produces: `class SearchIndex { constructor(opts: { load: () => Promise<string>; refreshMs?: number; now?: () => number }); search(q: string, limit?: number): Promise<SearchHit[] | 'warming'>; get ready(): boolean }`
- Produces: `parseBoardCsv(csv: string): SearchHit[]`
- Produces (`index.ts`): `searchIndex(): SearchIndex`

- [ ] **Step 1: Write the failing test** — `src/lib/server/warcon/search.test.ts`

```ts
import { describe, expect, test, vi } from 'vitest';
import { parseBoardCsv, SearchIndex } from './search';

const CSV = [
  'rank,steam_id,name,playtime_min,seeded_min,kills,deaths,kd,kills_per_hour,headshots,team_kills,suicides,vehicle_kills,kill_streak,death_streak,matches,wins,losses,draws,win_pct,cash,last_seen',
  '1,76561198000000001,"Night, Owl",900,0,1,1,1,1,0,0,0,0,0,0,1,1,0,0,100,0,2026-10-01T00:00:00.000Z',
  '2,76561198000000002,owlbear,300,0,1,1,1,1,0,0,0,0,0,0,1,1,0,0,100,0,',
  '3,76561198000000003,"Say ""hi""",100,0,1,1,1,1,0,0,0,0,0,0,1,1,0,0,100,0,',
].join('\n');

describe('parseBoardCsv', () => {
  test('reads quoted names, commas and doubled quotes', () => {
    expect(parseBoardCsv(CSV).map((h) => h.name)).toEqual(['Night, Owl', 'owlbear', 'Say "hi"']);
    expect(parseBoardCsv(CSV)[1]).toEqual({ steamId: '76561198000000002', name: 'owlbear', minutes: 300, lastSeen: null });
  });
});

describe('SearchIndex', () => {
  const index = (load = vi.fn(async () => CSV), now = () => 0) => ({ load, idx: new SearchIndex({ load, now }) });

  test('matches part of a name, case-insensitive, most playtime first', async () => {
    const { idx } = index();
    expect((await idx.search('OWL')) as { name: string }[]).toMatchObject([{ name: 'Night, Owl' }, { name: 'owlbear' }]);
  });

  test('a SteamID matches exactly', async () => {
    const { idx } = index();
    expect(await idx.search('76561198000000003')).toMatchObject([{ name: 'Say "hi"' }]);
  });

  test('says warming while the first load is failing', async () => {
    const { idx } = index(vi.fn(async () => Promise.reject(new Error('down'))));
    expect(await idx.search('owl')).toBe('warming');
  });

  test('refreshes after 15 minutes, keeps the old list if the refresh fails', async () => {
    let t = 0;
    const load = vi.fn(async () => CSV);
    const idx = new SearchIndex({ load, now: () => t });
    await idx.search('owl');
    t = 15 * 60_000 + 1;
    load.mockRejectedValueOnce(new Error('down'));
    expect(await idx.search('owl')).toHaveLength(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('a query under two characters returns nothing', async () => {
    const { idx } = index();
    expect(await idx.search('o')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/server/warcon/search.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `search.ts`**

```ts
// Player search without spending Warcon's per-key search limit: the org's all-time board
// export (up to 10,000 players) is held in memory and refreshed every 15 minutes.

export interface SearchHit {
  steamId: string;
  name: string;
  minutes: number;
  lastSeen: string | null;
}

/** One CSV line into cells: quoted cells may hold commas and doubled quotes. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseBoardCsv(csv: string): SearchHit[] {
  const [head, ...lines] = csv.split(/\r?\n/).filter(Boolean);
  const cols = cells(head);
  const at = (name: string) => cols.indexOf(name);
  const [id, name, minutes, lastSeen] = [at('steam_id'), at('name'), at('playtime_min'), at('last_seen')];
  return lines.map((line) => {
    const c = cells(line);
    return { steamId: c[id], name: c[name], minutes: Number(c[minutes]) || 0, lastSeen: c[lastSeen] || null };
  });
}

export class SearchIndex {
  private hits: SearchHit[] | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private readonly refreshMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: { load: () => Promise<string>; refreshMs?: number; now?: () => number }) {
    this.refreshMs = opts.refreshMs ?? 15 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  get ready(): boolean {
    return this.hits !== null;
  }

  private refresh(): Promise<void> {
    return (this.loading ??= this.opts
      .load()
      .then((csv) => {
        this.hits = parseBoardCsv(csv).sort((a, b) => b.minutes - a.minutes);
        this.loadedAt = this.now();
      })
      .catch((e) => console.error('[search] board export failed:', e instanceof Error ? e.message : e))
      .finally(() => (this.loading = null)));
  }

  async search(q: string, limit = 25): Promise<SearchHit[] | 'warming'> {
    if (!this.hits || this.now() - this.loadedAt > this.refreshMs) await this.refresh();
    if (!this.hits) return 'warming';
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    if (/^\d{17}$/.test(query)) return this.hits.filter((h) => h.steamId === query);
    return this.hits.filter((h) => h.name.toLowerCase().includes(query)).slice(0, limit);
  }
}
```

- [ ] **Step 4: Add the singleton** — append to `src/lib/server/warcon/index.ts`:

```ts
import { SearchIndex } from './search';

const s = globalThis as unknown as { __search?: SearchIndex };

/** Needs one server id to ask for the org board; the first visible server is fine. */
export function searchIndex(firstServerId: () => Promise<string>): SearchIndex {
  return (s.__search ??= new SearchIndex({ load: async () => warcon().boardExportCsv(await firstServerId()) }));
}
```

(Move the new `import` line to the top of the file with the others.)

- [ ] **Step 5: Run, typecheck, commit**

Run: `npx vitest run src/lib/server/warcon/ && npm run typecheck` — Expected: pass.

```bash
git add src/lib/server/warcon
git commit -m "feat: in-memory player search index from the org board export"
```

---

### Task 6: View types and the page-facing data layer

**Files:**
- Create: `src/lib/server/views.ts`, `src/lib/server/data.ts`
- Test: `src/lib/server/data.test.ts`

**Interfaces:**
- Consumes: `warcon()`, `searchIndex()` (Tasks 3, 5); `fanOut`, `mergeNewest`, `Merged` (Task 4); `siteEnv()` (Task 1)
- Produces (`views.ts`): `PERIODS = ['7d','30d','90d','all']`, `Period`, `PERIOD_LABELS`, `parsePeriod`, `METRICS = ['kills','deaths','kd','perHour','playtime','matches','wins','winRate','cash']`, `Metric`, `METRIC_LABELS`, `parseMetric`, and the types `FactionScore`, `ServerStatus`, `LivePlayer`, `ServerRow`, `NetworkSummary`, `PopulationPoint`, `LeaderRow`, `PlayerSearchRow`, `PlayerProfile`, `WeaponUse`, `Rival`, `PlayerMatchRow`, `KillRow`, `MatchRow`, `MatchPlayerRow`, `MatchAward`, `Loaded<T>`
- Produces (`data.ts`), all async and all returning `Loaded<T> = { data: T; stale: boolean; missing: string[] }` unless noted:
  - `getServers(): Promise<Loaded<ServerRow[]>>`
  - `getServer(id: string): Promise<Loaded<ServerRow> | null>`
  - `networkSummary(servers: ServerRow[]): Promise<Loaded<NetworkSummary>>`
  - `population(serverId: string | null, range: '24h' | '7d'): Promise<Loaded<PopulationPoint[]>>`
  - `leaderboard(q: { metric: Metric; period: Period; serverId?: string | null; page?: number }): Promise<Loaded<{ rows: LeaderRow[]; total: number; pageSize: number }>>`
  - `searchPlayers(q: string): Promise<PlayerSearchRow[] | 'warming'>`
  - `recentPlayers(limit?: number): Promise<Loaded<PlayerSearchRow[]>>`
  - `getPlayer(steamId: string): Promise<Loaded<PlayerProfile> | null>`
  - `recentKills(q: { serverId?: string | null; steamId?: string; limit?: number; before?: string | null; kind?: KillKind; cause?: string; minM?: number | null }): Promise<Loaded<KillRow[]>>`
  - `listMatches(q: { serverId?: string | null; limit?: number; page?: number }): Promise<Loaded<{ rows: MatchRow[]; pages: number }>>`
  - `getMatch(serverId: string, matchId: number): Promise<Loaded<{ match: MatchRow; lines: MatchPlayerRow[]; timeline: number[][]; factions: { name: string; colorHex: string | null }[]; awards: MatchAward[]; kills: KillRow[]; weapons: { cause: string; kills: number }[] }> | null>`
  - `serverTotals(serverId: string): Promise<Loaded<{ uniquePlayers: number; matches: number; kills: number; headshots: number; peak: number }>>`
  - `factionWins(serverId: string | null): Promise<Loaded<{ faction: string; wins: number }[]>>`
  - `headToHead(a: string, b: string): Promise<Loaded<{ aKills: number; bKills: number }>>`
  - `shortNameOf(warconName: string): string`, `regionOf(shortName: string): string`

- [ ] **Step 1: Create `views.ts`** by moving the vocabulary and view types out of `queries.ts`, with the Warcon period and metric sets. Copy each interface named below **verbatim from `src/lib/server/queries.ts` / `rcon.ts`** except for the changes listed:

```ts
// The shapes pages render, and the period/metric vocabulary. Filled from Warcon by data.ts.

export const PERIODS = ['7d', '30d', '90d', 'all'] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' };
export function parsePeriod(v: unknown, fallback: Period = '7d'): Period {
  return PERIODS.includes(v as Period) ? (v as Period) : fallback;
}

export const METRICS = ['kills', 'deaths', 'kd', 'perHour', 'playtime', 'matches', 'wins', 'winRate', 'cash'] as const;
export type Metric = (typeof METRICS)[number];
export const METRIC_LABELS: Record<Metric, string> = {
  kills: 'Kills', deaths: 'Deaths', kd: 'K/D', perHour: 'Kills / hour', playtime: 'Playtime',
  matches: 'Matches', wins: 'Wins', winRate: 'Win rate', cash: 'Cash',
};
export function parseMetric(v: unknown): Metric {
  return METRICS.includes(v as Metric) ? (v as Metric) : 'kills';
}

/** What a data function returns: the data, whether any of it is past freshness, and which
 *  servers failed and were left out. */
export interface Loaded<T> {
  data: T;
  stale: boolean;
  missing: string[];
}

export interface FactionScore { name: string; colorHex: string; score: number }

export interface ServerStatus {
  serverName: string;
  map: string;
  experiences: string[];
  lighting: string | null;
  matchSeconds?: number;
  players: { current: number; max: number };
  factionScores: FactionScore[];
}

/** No ping: the public site never shows one. */
export interface LivePlayer { name: string; steamId: string; faction: string; kills: number; deaths: number; cash: number }

export interface ServerRow {
  id: string;
  /** Warcon's full name */
  name: string;
  /** the part before the first " - ", e.g. "EU#1" */
  shortName: string;
  /** the letters before "#": EU, NA, OCE */
  region: string;
  online: boolean;
  /** unix seconds of Warcon's last look */
  updatedAt: number | null;
  status: ServerStatus | null;
  players: LivePlayer[];
  playerCount: number;
  joinCode: string | null;
  startedAt: number | null;
}

export interface NetworkSummary {
  playersOnline: number;
  capacity: number;
  serversOnline: number;
  serversTotal: number;
  /** over the last 24 h, from analytics */
  killsToday: number;
  playersToday: number;
  matchesToday: number;
  peakToday: number;
}

export interface PopulationPoint { ts: number; players: number; max: number }

export interface LeaderRow {
  rank: number;
  steamId: string;
  name: string;
  avatarUrl: string | null;
  kills: number;
  deaths: number;
  headshots: number;
  playtime: number; // seconds
  matches: number;
  wins: number;
  cash: number;
  /** the sorted metric's value */
  value: number;
  lastSeen: number | null;
}

export interface PlayerSearchRow { steamId: string; name: string; avatarUrl: string | null; lastSeen: number | null; matchedAlias: string | null }

export interface WeaponUse { cause: string; kills: number }
export interface Rival { steamId: string; name: string; count: number }

export interface PlayerMatchRow {
  matchId: number;
  serverId: string;
  serverName: string;
  map: string;
  startedAt: number;
  endedAt: number | null;
  faction: string | null;
  result: 'win' | 'loss' | 'draw' | null;
  kills: number;
  deaths: number;
  timePlayed: number;
}

export interface PlayerProfile {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  aliases: string[];
  totals: { kills: number; deaths: number; headshots: number; suicides: number; teamkills: number; playtime: number; longest: number; matches: number; wins: number; losses: number; draws: number };
  rank: number | null;
  streak: { kind: 'win' | 'loss'; n: number } | null;
  onlineOn: { serverId: string; serverName: string } | null;
  weapons: WeaponUse[];
  victims: Rival[];
  nemeses: Rival[];
  servers: { serverId: string; name: string; playtime: number; kills: number }[];
  matches: PlayerMatchRow[];
  maps: { key: string; matches: number; wins: number; kills: number; deaths: number }[];
  factions: { key: string; matches: number; wins: number; kills: number; deaths: number }[];
  recentKills: KillRow[];
}

export interface KillRow {
  eventId: string;
  serverId: string;
  serverName: string;
  ts: number;
  /** Warcon's cursor for "older": the kill's ISO time and match clock */
  cursor: string;
  killerSteamId: string | null;
  killerName: string | null;
  victimSteamId: string | null;
  victimName: string | null;
  cause: string | null;
  distance: number | null;
  headshot: number;
  suicide: number;
  teamkill: number;
  tags: string;
}

export interface MatchRow {
  id: number;
  serverId: string;
  serverName: string;
  map: string;
  experiences: string[];
  lighting: string | null;
  startedAt: number;
  endedAt: number | null;
  winner: string | null;
  scores: { name: string; colorHex: string; score: number }[];
  peakPlayers: number;
  players: number;
}

export interface MatchPlayerRow {
  steamId: string;
  name: string;
  faction: string | null;
  kills: number;
  deaths: number;
  headshots: number;
  longest: number;
  cash: number;
  timePlayed: number;
  killStreak: number;
}

export interface MatchAward { key: string; label: string; steamId: string; name: string; value: string }
```

- [ ] **Step 2: Write the failing data test** — `src/lib/server/data.test.ts`. It mocks `warcon()` with fixtures.

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const api = {
  servers: vi.fn(),
  live: vi.fn(),
  board: vi.fn(),
  career: vi.fn(),
  dossier: vi.fn(),
  matches: vi.fn(),
  match: vi.fn(),
  kills: vi.fn(),
  analytics: vi.fn(),
  seen: vi.fn(),
  steamProfiles: vi.fn(async () => ({})),
};
vi.mock('./warcon', () => ({ warcon: () => api, searchIndex: () => ({ search: async () => [] }) }));

// vi.mock is hoisted above imports, so this import already sees the mocked module.
import { getPlayer, getServers, leaderboard, recentKills, regionOf, shortNameOf } from './data';

const fresh = <T>(value: T) => ({ value, stale: false });
const SERVERS = [
  { id: 's1', orgId: 'o', name: 'EU#1 - Sealclubbing = ban', sortOrder: 0 },
  { id: 's2', orgId: 'o', name: 'OC#1 - x', sortOrder: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.servers.mockResolvedValue(fresh(SERVERS));
});

describe('labels', () => {
  test('short name and region come from Warcon names', () => {
    expect(shortNameOf('EU#1 - Sealclubbing = ban')).toBe('EU#1');
    expect(regionOf('EU#1')).toBe('EU');
    expect(regionOf('OC#1')).toBe('OCE');
    expect(shortNameOf('Plain')).toBe('Plain');
  });
});

describe('getServers', () => {
  test('an unobserved or failing server is offline; the others still show', async () => {
    api.live.mockImplementation(async (id: string) => {
      if (id === 's2') throw new Error('down');
      return fresh({
        ok: true, gameServerId: 'J1', startedAt: '2026-10-04T10:00:00Z', observedAt: '2026-10-04T12:00:00Z',
        status: { serverName: 'x', map: 'M', experiences: [], lighting: 'Day', matchSeconds: 5, playerCount: 1, maxPlayers: 64, scores: [] },
        players: [{ name: 'A', steamId: '76561198000000001', faction: null, kills: 1, deaths: 0, cash: 0 }],
      });
    });
    const r = await getServers();
    expect(r.data.map((s) => [s.id, s.online, s.playerCount])).toEqual([['s1', true, 1], ['s2', false, 0]]);
    expect(r.data[0].players[0]).not.toHaveProperty('ping');
    expect(r.missing).toEqual(['s2']);
  });
});

describe('getPlayer', () => {
  test('a player Warcon has never seen is null (the page 404s)', async () => {
    api.live.mockResolvedValue(fresh(null));
    api.dossier.mockResolvedValue(fresh({ steamId: '76561198000000009', name: '76561198000000009', names: [], online: null, steam: null, summary: { sessions: 0, minutes: 0, kills: 0, deaths: 0, firstSeen: null, lastSeen: null }, combat: null, perServer: [] }));
    api.career.mockResolvedValue(fresh({ rank: { server: null, org: null }, streak: null, matches: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, minutes: 0, headshots: 0, longestM: null, killStreak: 0, maps: [], factions: [], last: [] }));
    expect(await getPlayer('76561198000000009')).toBeNull();
  });
});

describe('leaderboard', () => {
  test('maps the metric and period onto an org board and computes value', async () => {
    api.board.mockResolvedValue(fresh({ ok: true, total: 1, pageSize: 50, rows: [{ rank: 1, steamId: '76561198000000001', name: 'A', minutes: 120, kills: 40, deaths: 10, headshots: 5, matches: 3, wins: 2, losses: 1, draws: 0, cash: 9, lastSeen: null }] }));
    const r = await leaderboard({ metric: 'perHour', period: '90d' });
    expect(api.board).toHaveBeenCalledWith('s1', { scope: 'org', range: '90d', sort: 'perHour', page: 1 });
    expect(r.data.rows[0]).toMatchObject({ playtime: 7200, value: 20 });
  });
});

describe('recentKills', () => {
  test('merges servers newest first and names a failed one', async () => {
    const k = (id: string, ts: string) => ({ eventId: id, ts, map: 'M', eventTime: 1, killer: null, victim: { steamId: '76561198000000001', name: 'V', faction: null }, cause: null, distanceM: null, headshot: false, suicide: false, teamKill: false, tags: [] });
    api.kills.mockImplementation(async (id: string) => {
      if (id === 's2') throw new Error('down');
      return fresh({ ok: true, total: null, kills: [k('a', '2026-10-04T12:00:02Z'), k('b', '2026-10-04T12:00:01Z')] });
    });
    const r = await recentKills({ limit: 1 });
    expect(r.data.map((x) => x.eventId)).toEqual(['a']);
    expect(r.missing).toEqual(['s2']);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/server/data.test.ts` — Expected: FAIL, cannot resolve `./data`.

- [ ] **Step 4: Implement `data.ts`**

```ts
// Page-facing reads: Warcon's answers turned into the view types in views.ts. Every function
// is async and says whether its data is stale and which servers failed (Loaded<T>).
import { siteEnv } from './warcon/env';
import { searchIndex, warcon } from './warcon';
import { fanOut, mergeNewest } from './warcon/merge';
import type { KillKind } from './warcon/api';
import type { WKill, WLive, WMatchSummary } from './warcon/schemas';
import type {
  KillRow, LeaderRow, Loaded, MatchAward, MatchPlayerRow, MatchRow, Metric, NetworkSummary, Period,
  PlayerProfile, PlayerSearchRow, PopulationPoint, ServerRow,
} from './views';

const sec = (iso: string | null | undefined): number | null => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
const loaded = <T>(data: T, stale = false, missing: string[] = []): Loaded<T> => ({ data, stale, missing });

export const shortNameOf = (name: string) => name.split(' - ')[0].trim();
export function regionOf(shortName: string): string {
  const r = shortName.split('#')[0].toUpperCase();
  return r === 'OC' ? 'OCE' : r;
}

/** The servers to show: SERVER_IDS order when set, else Warcon's. */
async function serverList() {
  const { value, stale } = await warcon().servers();
  const ids = siteEnv().serverIds;
  const list = ids.length
    ? ids.map((id) => value.find((s) => s.id === id)).filter((s) => s !== undefined)
    : [...value].sort((a, b) => a.sortOrder - b.sortOrder);
  return { list, stale };
}

function serverRow(s: { id: string; name: string }, live: WLive | null): ServerRow {
  const st = live?.status ?? null;
  const shortName = shortNameOf(s.name);
  return {
    id: s.id,
    name: s.name,
    shortName,
    region: regionOf(shortName),
    online: !!live?.ok && !!st,
    updatedAt: sec(live?.observedAt),
    status: st && {
      serverName: st.serverName,
      map: st.map,
      experiences: st.experiences,
      lighting: st.lighting || null,
      matchSeconds: st.matchSeconds ?? undefined,
      players: { current: st.playerCount, max: st.maxPlayers },
      factionScores: st.scores,
    },
    players: (live?.players ?? []).map((p) => ({ name: p.name, steamId: p.steamId, faction: p.faction ?? '', kills: p.kills, deaths: p.deaths, cash: p.cash })),
    playerCount: st?.playerCount ?? 0,
    joinCode: live?.gameServerId || null,
    startedAt: sec(live?.startedAt),
  };
}

export async function getServers(): Promise<Loaded<ServerRow[]>> {
  const { list, stale } = await serverList();
  const r = await fanOut(list.map((s) => s.id), (id) => warcon().live(id));
  const rows = list.map((s) => serverRow(s, r.ok.find((o) => o.id === s.id)?.value ?? null));
  return loaded(rows, stale || r.stale, r.failed);
}

export async function getServer(id: string): Promise<Loaded<ServerRow> | null> {
  const { list } = await serverList();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  try {
    const live = await warcon().live(id);
    return loaded(serverRow(s, live.value), live.stale);
  } catch {
    return loaded(serverRow(s, null), false, [id]);
  }
}

export async function networkSummary(servers: ServerRow[]): Promise<Loaded<NetworkSummary>> {
  const r = await fanOut(servers.map((s) => s.id), (id) => warcon().analytics(id, '24h'));
  const sum = (f: (a: (typeof r.ok)[number]['value']) => number) => r.ok.reduce((n, o) => n + f(o.value), 0);
  return loaded(
    {
      playersOnline: servers.reduce((n, s) => n + s.playerCount, 0),
      capacity: servers.reduce((n, s) => n + (s.status?.players.max ?? 0), 0),
      serversOnline: servers.filter((s) => s.online).length,
      serversTotal: servers.length,
      killsToday: sum((a) => a.combat?.kills ?? 0),
      playersToday: sum((a) => a.summary.uniquePlayers),
      matchesToday: sum((a) => a.summary.matches),
      peakToday: sum((a) => a.summary.peakPlayers),
    },
    r.stale,
    r.failed,
  );
}

export async function population(serverId: string | null, range: '24h' | '7d'): Promise<Loaded<PopulationPoint[]>> {
  const ids = serverId ? [serverId] : (await serverList()).list.map((s) => s.id);
  const r = await fanOut(ids, (id) => warcon().analytics(id, range));
  const byTs = new Map<number, PopulationPoint>();
  for (const { value } of r.ok) {
    for (const p of value.population) {
      const ts = sec(p.ts)!;
      const cur = byTs.get(ts) ?? { ts, players: 0, max: 0 };
      cur.players += p.avg ?? 0;
      cur.max += p.cap ?? 0;
      byTs.set(ts, cur);
    }
  }
  return loaded([...byTs.values()].sort((a, b) => a.ts - b.ts), r.stale, r.failed);
}

function metricValue(metric: Metric, r: { kills: number; deaths: number; minutes: number; matches: number; wins: number; losses: number; draws: number; cash: number }) {
  switch (metric) {
    case 'kills': return r.kills;
    case 'deaths': return r.deaths;
    case 'kd': return r.kills / Math.max(1, r.deaths);
    case 'perHour': return r.minutes > 0 ? r.kills / (r.minutes / 60) : 0;
    case 'playtime': return r.minutes * 60;
    case 'matches': return r.matches;
    case 'wins': return r.wins;
    case 'winRate': {
      const decided = r.wins + r.losses + r.draws;
      return decided ? r.wins / decided : 0;
    }
    case 'cash': return r.cash;
  }
}

export async function leaderboard(q: { metric: Metric; period: Period; serverId?: string | null; page?: number }) {
  const anchor = q.serverId ?? (await serverList()).list[0]?.id;
  if (!anchor) return loaded({ rows: [] as LeaderRow[], total: 0, pageSize: 50 });
  const { value, stale } = await warcon().board(anchor, { scope: q.serverId ? 'server' : 'org', range: q.period, sort: q.metric, page: q.page ?? 1 });
  const avatars = await warcon().steamProfiles(value.rows.map((r) => r.steamId));
  const rows: LeaderRow[] = value.rows.map((r) => ({
    rank: r.rank,
    steamId: r.steamId,
    name: r.name,
    avatarUrl: avatars[r.steamId]?.avatar || null,
    kills: r.kills,
    deaths: r.deaths,
    headshots: r.headshots,
    playtime: r.minutes * 60,
    matches: r.matches,
    wins: r.wins,
    cash: r.cash,
    value: metricValue(q.metric, r),
    lastSeen: sec(r.lastSeen),
  }));
  return loaded({ rows, total: value.total, pageSize: value.pageSize }, stale);
}

export async function searchPlayers(q: string): Promise<PlayerSearchRow[] | 'warming'> {
  const idx = searchIndex(async () => (await serverList()).list[0].id);
  const hits = await idx.search(q);
  if (hits === 'warming') return hits;
  const avatars = await warcon().steamProfiles(hits.map((h) => h.steamId));
  return hits.map((h) => ({ steamId: h.steamId, name: h.name, avatarUrl: avatars[h.steamId]?.avatar || null, lastSeen: sec(h.lastSeen), matchedAlias: null }));
}

export async function recentPlayers(limit = 30): Promise<Loaded<PlayerSearchRow[]>> {
  const { list } = await serverList();
  const r = await fanOut(list.map((s) => s.id), (id) => warcon().seen(id, { limit }));
  const seen = new Map<string, PlayerSearchRow>();
  for (const p of mergeNewest(r.ok.map((o) => o.value), (p) => Date.parse(p.lastSeen), limit * list.length)) {
    if (!seen.has(p.steamId)) seen.set(p.steamId, { steamId: p.steamId, name: p.name, avatarUrl: p.steam?.avatar || null, lastSeen: sec(p.lastSeen), matchedAlias: null });
  }
  return loaded([...seen.values()].slice(0, limit), r.stale, r.failed);
}

function killRow(k: WKill, serverId: string, serverName: string): KillRow {
  return {
    eventId: k.eventId,
    serverId,
    serverName,
    ts: sec(k.ts)!,
    cursor: `${k.ts}~${k.eventTime}`,
    killerSteamId: k.killer?.steamId ?? null,
    killerName: k.killer?.name ?? null,
    victimSteamId: k.victim.steamId,
    victimName: k.victim.name,
    cause: k.cause,
    distance: k.distanceM,
    headshot: k.headshot ? 1 : 0,
    suicide: k.suicide ? 1 : 0,
    teamkill: k.teamKill ? 1 : 0,
    tags: k.tags.join(','),
  };
}

export async function getPlayer(steamId: string): Promise<Loaded<PlayerProfile> | null> {
  const { list } = await serverList();
  const anchor = list[0]?.id;
  if (!anchor) return null;
  const [dossier, career] = await Promise.all([warcon().dossier(anchor, steamId), warcon().career(anchor, steamId)]);
  const d = dossier.value;
  const c = career.value;
  if (!d.summary.firstSeen && c.matches === 0) return null;
  const nameOf = new Map(list.map((s) => [s.id, s.name]));
  const group = (g: { key: string; matches: number; wins: number; kills: number; deaths: number }) => ({ key: g.key, matches: g.matches, wins: g.wins, kills: g.kills, deaths: g.deaths });
  return loaded(
    {
      steamId,
      name: d.name,
      avatarUrl: d.steam?.avatar || null,
      firstSeen: sec(d.summary.firstSeen),
      lastSeen: sec(d.summary.lastSeen),
      aliases: d.names.filter((n) => n !== d.name),
      totals: {
        kills: c.kills, deaths: c.deaths, headshots: c.headshots, suicides: d.combat?.suicides ?? 0,
        teamkills: d.combat?.teamKills ?? 0, playtime: c.minutes * 60, longest: c.longestM ?? 0,
        matches: c.matches, wins: c.wins, losses: c.losses, draws: c.draws,
      },
      rank: c.rank.org,
      streak: c.streak,
      onlineOn: d.online,
      weapons: (d.combat?.causes ?? []).map((w) => ({ cause: w.cause, kills: w.kills })),
      victims: (d.combat?.victims ?? []).map((v) => ({ steamId: v.steamId, name: v.name, count: v.kills })),
      nemeses: (d.combat?.nemeses ?? []).map((v) => ({ steamId: v.steamId, name: v.name, count: v.deaths })),
      servers: d.perServer.map((p) => ({ serverId: p.serverId, name: p.serverName, playtime: p.minutes * 60, kills: p.kills })),
      matches: c.last.map((m) => ({
        matchId: m.matchId, serverId: m.serverId, serverName: shortNameOf(nameOf.get(m.serverId) ?? m.serverName),
        map: m.map ?? '', startedAt: sec(m.startedAt)!, endedAt: sec(m.endedAt), faction: m.faction, result: m.result,
        kills: m.kills, deaths: m.deaths, timePlayed: m.seconds,
      })),
      maps: c.maps.map(group),
      factions: c.factions.map(group),
      recentKills: (d.combat?.recent ?? []).map((k) => killRow(k, k.serverId, shortNameOf(k.serverName))),
    },
    dossier.stale || career.stale,
  );
}

export async function recentKills(q: { serverId?: string | null; steamId?: string; limit?: number; before?: string | null; kind?: KillKind; cause?: string; minM?: number | null }): Promise<Loaded<KillRow[]>> {
  const { list } = await serverList();
  const servers = q.serverId ? list.filter((s) => s.id === q.serverId) : list;
  const limit = q.limit ?? 50;
  const [ts, eventTime] = (q.before ?? '').split('~');
  const before = q.serverId && ts ? { ts, eventTime: Number(eventTime) || 0 } : null;
  const r = await fanOut(servers.map((s) => s.id), (id) =>
    warcon().kills(id, { limit, before, player: q.steamId, kind: q.kind, cause: q.cause, minM: q.minM }),
  );
  const lists = r.ok.map(({ id, value }) => value.kills.map((k) => killRow(k, id, shortNameOf(list.find((s) => s.id === id)!.name))));
  return loaded(mergeNewest(lists, (k) => k.ts, limit), r.stale, r.failed);
}

function matchRow(m: WMatchSummary, serverId: string, serverName: string, colours: Map<string, string | null>): MatchRow {
  return {
    id: m.id,
    serverId,
    serverName,
    map: m.map ?? '',
    experiences: m.experiences ? m.experiences.split(',').map((e) => e.trim()).filter(Boolean) : [],
    lighting: m.lighting,
    startedAt: sec(m.startedAt)!,
    endedAt: sec(m.endedAt),
    winner: m.winner,
    scores: (m.finalScores ?? []).map((f) => ({ name: f.name, score: f.score, colorHex: colours.get(f.name) ?? '' })),
    peakPlayers: m.peakPlayers,
    players: m.players,
  };
}

export async function listMatches(q: { serverId?: string | null; limit?: number; page?: number } = {}) {
  const { list } = await serverList();
  const servers = q.serverId ? list.filter((s) => s.id === q.serverId) : list;
  const limit = q.limit ?? 50;
  const r = await fanOut(servers.map((s) => s.id), (id) => warcon().matches(id, q.page ?? 1));
  const lists = r.ok.map(({ id, value }) => {
    const colours = new Map(value.live.map((f) => [f.name, f.colorHex]));
    return value.matches.map((m) => matchRow(m, id, shortNameOf(list.find((s) => s.id === id)!.name), colours));
  });
  const pages = Math.max(1, ...r.ok.map((o) => o.value.pages));
  return loaded({ rows: mergeNewest(lists, (m) => m.startedAt, limit), pages }, r.stale, r.failed);
}

export async function getMatch(serverId: string, matchId: number) {
  const { list } = await serverList();
  const server = list.find((s) => s.id === serverId);
  if (!server) return null;
  let view;
  try {
    view = await warcon().match(serverId, matchId);
  } catch (e) {
    if ((e as { kind?: string }).kind === 'not_found') return null;
    throw e;
  }
  const v = view.value;
  const colours = new Map(v.factions.map((f) => [f.name, f.colorHex]));
  const kills = await warcon().kills(serverId, { match: matchId, limit: 200 });
  const killRows = kills.value.kills.map((k) => killRow(k, serverId, shortNameOf(server.name)));
  const weaponCounts = new Map<string, number>();
  for (const k of killRows) if (k.cause) weaponCounts.set(k.cause, (weaponCounts.get(k.cause) ?? 0) + 1);
  const lines: MatchPlayerRow[] = v.lines.map((l) => ({
    steamId: l.steamId, name: l.name, faction: l.faction, kills: l.kills, deaths: l.deaths, headshots: l.headshots,
    longest: l.longestM ?? 0, cash: l.cashDelta, timePlayed: l.seconds, killStreak: l.killStreak,
  }));
  const awards: MatchAward[] = v.awards;
  return loaded(
    {
      match: matchRow(v.match, serverId, shortNameOf(server.name), colours),
      lines,
      timeline: v.timeline,
      factions: v.factions,
      awards,
      kills: killRows,
      weapons: [...weaponCounts].map(([cause, n]) => ({ cause, kills: n })).sort((a, b) => b.kills - a.kills).slice(0, 8),
    },
    view.stale || kills.stale,
  );
}

export async function serverTotals(serverId: string) {
  const { value, stale } = await warcon().analytics(serverId, '7d');
  return loaded(
    { uniquePlayers: value.summary.uniquePlayers, matches: value.summary.matches, kills: value.combat?.kills ?? 0, headshots: value.combat?.headshots ?? 0, peak: value.summary.peakPlayers },
    stale,
  );
}

export async function factionWins(serverId: string | null) {
  const ids = serverId ? [serverId] : (await serverList()).list.map((s) => s.id);
  const r = await fanOut(ids, (id) => warcon().analytics(id, '7d'));
  const wins = new Map<string, number>();
  for (const { value } of r.ok) for (const t of value.wins.teams) wins.set(t.name, (wins.get(t.name) ?? 0) + t.wins);
  return loaded([...wins].map(([faction, n]) => ({ faction, wins: n })).sort((a, b) => b.wins - a.wins), r.stale, r.failed);
}

export async function headToHead(a: string, b: string) {
  const { list } = await serverList();
  const count = async (killer: string, victim: string) => {
    const r = await fanOut(list.map((s) => s.id), (id) => warcon().kills(id, { killer, victim, limit: 1, count: true }));
    return { n: r.ok.reduce((s, o) => s + (o.value.total ?? 0), 0), stale: r.stale, failed: r.failed };
  };
  const [ab, ba] = await Promise.all([count(a, b), count(b, a)]);
  return loaded({ aKills: ab.n, bKills: ba.n }, ab.stale || ba.stale, [...new Set([...ab.failed, ...ba.failed])]);
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/lib/server/data.test.ts && npm run typecheck` — Expected: pass. (Pages still import `queries.ts`; nothing imports `data.ts` yet.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/views.ts src/lib/server/data.ts src/lib/server/data.test.ts
git commit -m "feat: page-facing data layer over Warcon"
```

---

### Task 7: The mock Warcon and the `<Section>` component

**Files:**
- Create: `scripts/mock-warcon.mjs`, `src/components/section.tsx`, `src/components/section.test.ts`
- Modify: `package.json` (scripts), `.env.example`

**Interfaces:**
- Produces: `npm run mock` (mock on `127.0.0.1:4100`, token `mock-token`), `npm run dev:mock`
- Produces: `<Section loaded={Loaded<T> | Error} title?: string>{(data: T) => ReactNode}</Section>` and `sectionState(r: Loaded<unknown> | Error): 'ok' | 'stale' | 'down'`; `safe<T>(p: Promise<T>): Promise<T | Error>`

- [ ] **Step 1: Write the mock** — `scripts/mock-warcon.mjs`. Plain Node `http`, no dependencies. Seeded PRNG so data is identical every run.

```js
// A fake Warcon for local development: the endpoints the site reads, with the same shapes,
// from data generated off a fixed seed. Kills keep arriving while it runs.
//   node scripts/mock-warcon.mjs        listens on 127.0.0.1:4100, token "mock-token"
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4100);
const TOKEN = process.env.MOCK_TOKEN ?? 'mock-token';

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const FACTIONS = [
  { name: 'Valkyra', colorHex: '#d4483b' },
  { name: 'Lonestar', colorHex: '#3b7bd4' },
];
const MAPS = ['Brimstone', 'Harbour', 'Pinewood', 'Quarry'];
const CAUSES = ['Id.Item.AK74M', 'Id.Item.M4A1', 'Id.Item.SVD', 'Id.Item.Glock17', 'Id.Vehicle.Humvee'];
const SERVERS = ['EU#1', 'EU#2', 'NA#1', 'NA#2', 'NA#3', 'OC#1'].map((short, i) => ({
  id: `srv-${i + 1}`,
  orgId: 'org-1',
  name: `${short} - Sealclubbing = ban - TEG.gg - ENGLISH`,
  sortOrder: i,
  host: '10.0.0.1', // private: must never reach a page
  notes: 'rcon pw in vault',
}));
const PLAYERS = Array.from({ length: 300 }, (_, i) => ({
  steamId: String(76561198000000000n + BigInt(i + 1)),
  name: `${pick(['Night', 'Iron', 'Red', 'Silent', 'Owl', 'Rook', 'Viper'])}${pick(['Owl', 'Fox', 'Bear', 'Hawk', 'Wolf'])}${i}`,
}));

const now = () => Date.now();
const iso = (ms) => new Date(ms).toISOString();

const matches = new Map(); // serverId -> MatchSummary[] newest first
const lines = new Map(); // `${serverId}:${matchId}` -> MatchLine[]
const kills = new Map(); // serverId -> KillView[] newest first
for (const s of SERVERS) {
  const list = [];
  for (let m = 40; m >= 1; m--) {
    const start = now() - m * 3_600_000;
    const ended = m > 1;
    const scores = FACTIONS.map((f) => ({ name: f.name, score: int(0, 500) }));
    list.unshift({
      id: m, startedAt: iso(start), endedAt: ended ? iso(start + 3_000_000) : null, map: pick(MAPS),
      experiences: 'King of the Hill', lighting: pick(['Day', 'Night']), peakPlayers: int(10, 64), players: 20,
      finalScores: ended ? scores : null, winner: ended ? scores.sort((a, b) => b.score - a.score)[0].name : null,
    });
    lines.set(`${s.id}:${m}`, Array.from({ length: 20 }, () => {
      const p = pick(PLAYERS);
      return { steamId: p.steamId, name: p.name, faction: pick(FACTIONS).name, seconds: int(600, 3000), kills: int(0, 40), deaths: int(0, 30), cashDelta: int(-500, 3000), headshots: int(0, 10), teamKills: 0, suicides: 0, vehicleKills: 0, longestM: int(5, 400), killStreak: int(0, 12), deathStreak: 0, result: pick(['win', 'loss']) };
    }));
  }
  matches.set(s.id, list);
  kills.set(s.id, Array.from({ length: 200 }, (_, k) => makeKill(now() - k * 20_000)));
}
function makeKill(at) {
  const killer = pick(PLAYERS);
  const victim = pick(PLAYERS);
  return {
    eventId: `k${at}${int(0, 9999)}`, ts: iso(at), map: pick(MAPS), eventTime: int(0, 3000),
    killer: { steamId: killer.steamId, name: killer.name, faction: pick(FACTIONS).name },
    victim: { steamId: victim.steamId, name: victim.name, faction: pick(FACTIONS).name },
    cause: pick(CAUSES), distanceM: int(1, 450), headshot: rand() < 0.2, suicide: false, teamKill: rand() < 0.03, tags: [],
  };
}
setInterval(() => {
  for (const s of SERVERS) kills.get(s.id).unshift(makeKill(now()));
}, 2000).unref();

function board(params) {
  const rows = PLAYERS.map((p, i) => ({
    rank: 0, steamId: p.steamId, name: p.name, minutes: 60 + ((i * 37) % 3000), seedMinutes: 0, kills: (i * 13) % 900, deaths: (i * 7) % 600 + 1,
    headshots: (i * 3) % 200, teamKills: 0, suicides: 0, vehicleKills: 0, killStreak: 5, deathStreak: 3, matches: 1 + (i % 80), wins: i % 40, losses: i % 30, draws: 0, cash: i * 100, lastSeen: iso(now() - i * 60_000),
  }));
  const sort = params.get('sort') ?? 'kills';
  const key = { perHour: (r) => r.kills / r.minutes, kd: (r) => r.kills / r.deaths, playtime: (r) => r.minutes, winRate: (r) => r.wins / (r.wins + r.losses || 1) }[sort] ?? ((r) => r[sort] ?? r.kills);
  rows.sort((a, b) => key(b) - key(a)).forEach((r, i) => (r.rank = i + 1));
  return rows;
}

const routes = [
  [/^\/api\/servers$/, () => ({ ok: true, servers: SERVERS })],
  [/^\/api\/servers\/([^/]+)\/summary$/, (_, id) => {
    const s = SERVERS.find((x) => x.id === id);
    if (id === 'srv-6') return { ok: false, live: null, error: { message: 'Not observed yet.' } }; // an offline server
    const players = PLAYERS.slice(0, 24).map((p) => ({ ...p, faction: pick(FACTIONS).name, kills: int(0, 20), deaths: int(0, 15), cash: int(0, 5000), ping: int(20, 140) }));
    return { ok: true, live: { serverId: id, ok: true, error: '', tier: 'hot', build: '1.0.0', gameServerId: `JOIN-${id}`, startedAt: iso(now() - 7_200_000), reservedSlots: 2, throttledUntil: null,
      status: { serverName: s.name, map: pick(MAPS), experiences: ['King of the Hill'], lighting: 'Day', alternator: '', scoreTick: null, scoreTickMin: null, scoreTickMax: null, scoreCap: 500, matchSeconds: 900, playerCount: players.length, maxPlayers: 64, scores: FACTIONS.map((f) => ({ ...f, score: int(0, 300) })), rotationNow: 0, rotationNext: 1 },
      players, statusAt: iso(now()), playersAt: iso(now()), observedAt: iso(now()) } };
  }],
  [/^\/api\/servers\/([^/]+)\/leaderboard$/, (q) => {
    const rows = board(q);
    const page = Number(q.get('page') ?? 1);
    return { ok: true, rows: rows.slice((page - 1) * 50, page * 50), total: rows.length, pageSize: 50, hasFeed: true };
  }],
  [/^\/api\/servers\/([^/]+)\/leaderboard\/export$/, (q) => {
    const head = 'rank,steam_id,name,playtime_min,seeded_min,kills,deaths,kd,kills_per_hour,headshots,team_kills,suicides,vehicle_kills,kill_streak,death_streak,matches,wins,losses,draws,win_pct,cash,last_seen';
    return { csv: [head, ...board(q).map((r) => `${r.rank},${r.steamId},"${r.name}",${r.minutes},0,${r.kills},${r.deaths},0,0,0,0,0,0,0,0,${r.matches},${r.wins},${r.losses},0,0,${r.cash},${r.lastSeen}`)].join('\n') };
  }],
  [/^\/api\/servers\/([^/]+)\/players\/(\d{17})\/career$/, (_, id, steamId) => {
    if (!PLAYERS.some((p) => p.steamId === steamId)) return { ok: true, career: { rank: { server: null, org: null, floorMinutes: 60 }, streak: null, matches: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, minutes: 0, headshots: 0, vehicleKills: 0, longestM: null, killStreak: 0, deathStreak: 0, maps: [], factions: [], last: [] } };
    const last = matches.get(id).slice(1, 11).map((m) => ({ matchId: m.id, serverId: id, serverName: SERVERS.find((s) => s.id === id).name, startedAt: m.startedAt, endedAt: m.endedAt, map: m.map, faction: 'Valkyra', result: pick(['win', 'loss']), seconds: 1800, kills: int(0, 30), deaths: int(0, 20), cashDelta: 500, headshots: 2, killStreak: 4 }));
    return { ok: true, career: { rank: { server: 12, org: 30, floorMinutes: 60 }, streak: { kind: 'win', n: 2 }, matches: 80, wins: 45, losses: 35, draws: 0, kills: 1200, deaths: 800, minutes: 4000, headshots: 200, vehicleKills: 5, longestM: 412, killStreak: 15, deathStreak: 6,
      maps: MAPS.map((key) => ({ key, matches: 20, wins: 11, losses: 9, draws: 0, kills: 300, deaths: 200 })), factions: FACTIONS.map((f) => ({ key: f.name, matches: 40, wins: 22, losses: 18, draws: 0, kills: 600, deaths: 400 })), last } };
  }],
  [/^\/api\/servers\/([^/]+)\/players\/(\d{17})$/, (_, id, steamId) => {
    const p = PLAYERS.find((x) => x.steamId === steamId);
    const recent = kills.get(id).slice(0, 10).map((k) => ({ ...k, serverId: id, serverName: SERVERS.find((s) => s.id === id).name }));
    return { ok: true, dossier: {
      steamId, name: p?.name ?? steamId, names: p ? [p.name, `${p.name}_old`] : [], online: null, steamEnabled: true,
      steam: p ? { persona: p.name, avatar: '', profileUrl: '', public: true, vacBans: 1 } : null,
      risk: { level: 'high' }, watch: { watched: true, reason: 'PRIVATE-WATCH-REASON', updatedByName: 'mod', updatedAt: null },
      bannedOn: [], orgServerCount: 6, orgLists: { ban: null, reserve: null, canBan: false, canReserve: false },
      summary: p ? { sessions: 40, minutes: 4000, kills: 1200, deaths: 800, firstSeen: iso(now() - 30 * 86_400_000), lastSeen: iso(now()) } : { sessions: 0, minutes: 0, kills: 0, deaths: 0, firstSeen: null, lastSeen: null },
      combat: p ? { kills: 1200, deaths: 800, headshots: 200, teamKills: 3, teamKilled: 2, suicides: 1, avgDistanceM: 60, longestM: 412,
        causes: CAUSES.map((cause, i) => ({ cause, kills: 300 - i * 50 })), victims: PLAYERS.slice(0, 5).map((v) => ({ ...v, kills: 9 })), nemeses: PLAYERS.slice(5, 10).map((v) => ({ ...v, deaths: 7 })), recent } : null,
      perServer: p ? SERVERS.slice(0, 3).map((s) => ({ serverId: s.id, serverName: s.name, sessions: 10, minutes: 1000, kills: 300, deaths: 200, lastSeen: iso(now()) })) : [],
      recent: [], notes: [{ body: 'PRIVATE-NOTE' }], actions: [] } };
  }],
  [/^\/api\/servers\/([^/]+)\/matches$/, (q, id) => {
    const all = matches.get(id);
    const page = Number(q.get('page') ?? 1);
    return { ok: true, matches: all.slice((page - 1) * 50, page * 50), live: FACTIONS.map((f) => ({ ...f, score: 0 })), page, pageSize: 50, total: all.length, pages: Math.ceil(all.length / 50) };
  }],
  [/^\/api\/servers\/([^/]+)\/matches\/(\d+)$/, (_, id, matchId) => {
    const m = matches.get(id).find((x) => x.id === Number(matchId));
    if (!m || !m.endedAt) return null;
    const l = lines.get(`${id}:${m.id}`);
    return { ok: true, match: m, factions: FACTIONS, lines: l, timeline: Array.from({ length: 30 }, (_, i) => [i * 100, i * 10, i * 9]),
      awards: [{ key: 'kills', label: 'Most kills', steamId: l[0].steamId, name: l[0].name, value: String(l[0].kills) }], kills: 200, hasFeed: true };
  }],
  [/^\/api\/servers\/([^/]+)\/kills$/, (q, id) => {
    let list = kills.get(id);
    for (const f of ['killer', 'victim', 'player']) {
      const v = q.get(f);
      if (v) list = list.filter((k) => (f !== 'victim' && k.killer?.steamId === v) || (f !== 'killer' && k.victim.steamId === v));
    }
    if (q.get('kind') === 'headshot') list = list.filter((k) => k.headshot);
    if (q.get('kind') === 'teamKill') list = list.filter((k) => k.teamKill);
    if (q.get('before')) list = list.filter((k) => k.ts < q.get('before'));
    return { ok: true, configured: true, feedAt: iso(now()), kills: list.slice(0, Number(q.get('limit') ?? 50)), total: q.get('count') === '1' ? list.length : null };
  }],
  [/^\/api\/servers\/([^/]+)\/analytics$/, (q) => {
    const hours = q.get('range') === '7d' ? 168 : q.get('range') === '30d' ? 720 : 24;
    const bucket = hours > 24 ? 3600 * 6 : 600;
    const n = Math.floor((hours * 3600) / bucket);
    return { ok: true, range: q.get('range') ?? '24h', from: iso(now() - hours * 3_600_000), to: iso(now()), sampleSeconds: 60, bucketSeconds: bucket,
      summary: { uniquePlayers: 120, peakPlayers: 60, avgPlayers: 30, uptimePct: 99, onlineNow: 24, samples: 1000, matches: 20, coveredHours: hours },
      population: Array.from({ length: n }, (_, i) => ({ ts: iso(now() - (n - i) * bucket * 1000), avg: 20 + 15 * Math.sin(i / 6), max: 50, cap: 64, ok: 1, total: 1, up: bucket, down: 0 })),
      cash: [], maps: MAPS.map((map) => ({ map, minutes: 600, matches: 5 })), wins: { teams: FACTIONS.map((f, i) => ({ ...f, wins: 10 - i * 3 })), decided: 17, draws: 0, noResult: 1 },
      players: [], matches: [], hourly: [], combat: { kills: 4000, headshots: 800, teamKills: 20, suicides: 5, vehicleKills: 30, perBucket: [], causes: [], players: [], longest: [] } };
  }],
  [/^\/api\/servers\/([^/]+)\/players\/seen$/, (q, id) => ({
    ok: true, total: PLAYERS.length,
    players: PLAYERS.slice(0, Number(q.get('limit') ?? 30)).map((p, i) => ({ ...p, aliases: [], firstSeen: iso(now() - 86_400_000), lastSeen: iso(now() - i * 90_000), sessions: 3, minutes: 300, kills: 40, deaths: 30, servers: 1, online: i < 5, lastServerId: id, lastServerName: id, banned: null, watched: i === 0, steam: null })),
  })],
  [/^\/api\/steam\/profiles$/, () => ({})],
];

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"ok":false,"error":{"message":"bad key"}}');
      return;
    }
    for (const [re, handler] of routes) {
      const m = url.pathname.match(re);
      if (!m) continue;
      const body = handler(url.searchParams, ...m.slice(1).map(decodeURIComponent));
      if (body === null) break;
      if (body.csv !== undefined) res.writeHead(200, { 'content-type': 'text/csv' }).end(body.csv);
      else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"ok":false,"error":{"code":"not_found"}}');
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock Warcon on http://127.0.0.1:${PORT} (token ${TOKEN})`));
```

- [ ] **Step 2: Add scripts and env** — in `package.json` `"scripts"` add:

```json
    "mock": "node scripts/mock-warcon.mjs",
    "dev:mock": "node scripts/mock-warcon.mjs & MOCK=$!; next dev; kill $MOCK",
```

Replace `.env.example` entirely with:

```sh
# Where Warcon answers. Production: http://warcon:3000 (Docker network warcon_default).
# Local development against the mock (npm run dev:mock):
WARCON_BASE_URL=http://127.0.0.1:4100
# A Warcon org API key with the View capability only. The mock accepts "mock-token".
WARCON_TOKEN=mock-token
# This site's public origin, no trailing slash.
SITE_URL=http://localhost:3000
# Optional: Warcon server ids to show, in order. Blank: every server the key can see.
SERVER_IDS=
# true lets search engines index the site. Leave false on the temporary address.
ALLOW_INDEXING=false
```

Then create your local env from it (Next reads `.env.local`; it is git-ignored):

Run: `cp .env.example .env.local`

- [ ] **Step 3: Smoke-test the mock**

Run: `node scripts/mock-warcon.mjs & sleep 1; curl -s -H 'authorization: Bearer mock-token' http://127.0.0.1:4100/api/servers | head -c 200; echo; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4100/api/servers; kill %1`
Expected: a JSON body starting `{"ok":true,"servers":[{"id":"srv-1"`, then `401`.

- [ ] **Step 4: Write the failing Section test** — `src/components/section.test.ts`

```ts
import { describe, expect, test } from 'vitest';
import { safe, sectionState } from './section';

describe('sectionState', () => {
  test('ok, stale and down', () => {
    expect(sectionState({ data: 1, stale: false, missing: [] })).toBe('ok');
    expect(sectionState({ data: 1, stale: true, missing: [] })).toBe('stale');
    expect(sectionState({ data: 1, stale: false, missing: ['s2'] })).toBe('stale');
    expect(sectionState(new Error('down'))).toBe('down');
  });

  test('safe() turns a rejection into an Error value', async () => {
    expect(await safe(Promise.reject(new Error('x')))).toBeInstanceOf(Error);
    expect(await safe(Promise.resolve(3))).toBe(3);
  });
});
```

- [ ] **Step 5: Implement `src/components/section.tsx`**

```tsx
// One page section's data: rendered when it loaded, flagged when part of it is stale or a
// server is missing, and replaced by a notice when it failed. Warcon's error text goes to the
// server log, never to visitors.
import type { ReactNode } from 'react';
import type { Loaded } from '@/lib/server/views';

export function sectionState(r: Loaded<unknown> | Error): 'ok' | 'stale' | 'down' {
  if (r instanceof Error) return 'down';
  return r.stale || r.missing.length ? 'stale' : 'ok';
}

/** Await a data call without throwing: a failure becomes an Error value for <Section>. */
export async function safe<T>(p: Promise<T>): Promise<T | Error> {
  try {
    return await p;
  } catch (e) {
    console.error('[data]', e instanceof Error ? e.message : e);
    return e instanceof Error ? e : new Error(String(e));
  }
}

export function Section<T>({ loaded, children }: { loaded: Loaded<T> | Error; children: (data: T) => ReactNode }) {
  const state = sectionState(loaded);
  if (state === 'down' || loaded instanceof Error) {
    return <p className="px-4 py-6 text-sm text-muted">Stats are temporarily unavailable. Try again in a minute.</p>;
  }
  return (
    <>
      {children(loaded.data)}
      {state === 'stale' && (
        <p className="px-4 pb-3 text-xs text-dim">
          {loaded.missing.length ? `${loaded.missing.length} server(s) didn't answer; ` : ''}may be out of date.
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `npm test && npm run typecheck` — Expected: pass.

```bash
git add scripts/mock-warcon.mjs src/components/section.tsx src/components/section.test.ts package.json .env.example
git commit -m "feat: mock Warcon for local development and the Section component"
```

---

### Task 8: Home, servers list and server page

**Files:**
- Modify: `src/app/page.tsx`, `src/app/servers/page.tsx`, `src/app/servers/[id]/page.tsx`, `src/components/game.tsx`

**Interfaces:**
- Consumes: `getServers`, `getServer`, `networkSummary`, `population`, `leaderboard`, `recentKills`, `factionWins`, `listMatches`, `serverTotals` (Task 6); `Section`, `safe` (Task 7); types from `views.ts`

- [ ] **Step 1: `src/components/game.tsx`** — change its type imports from `@/lib/server/queries` / `@/lib/server/rcon` to `@/lib/server/views`. In the server card, delete the `<div className="mt-1 text-xs text-muted">{server.location}</div>` line (Warcon has no location) and replace the offline line `server.lastOnlineAt ? \`Last seen ${ago(server.lastOnlineAt)}\` : 'Waiting for first contact'` with `server.updatedAt ? \`Last seen ${ago(server.updatedAt)}\` : 'Waiting for first contact'`. `KillList` keeps `k.tags` (a comma string, as before).

- [ ] **Step 2: Home (`src/app/page.tsx`)** — make the component `async` and replace its data block with:

```tsx
export default async function Home() {
  const servers = await safe(getServers());
  const serverRows = servers instanceof Error ? [] : servers.data;
  const [summary, pop, kills, kdBoard, feed, wins] = await Promise.all([
    safe(networkSummary(serverRows)),
    safe(population(null, '24h')),
    safe(leaderboard({ metric: 'kills', period: '7d' })),
    safe(leaderboard({ metric: 'kd', period: '7d' })),
    safe(recentKills({ limit: 12 })),
    safe(factionWins(null)),
  ]);
```

Then: wrap each panel's body in `<Section loaded={x}>{(data) => …}</Section>` using the variable it reads (`summary`, `pop`, `kills` → `data.rows.slice(0, 5)`, `kdBoard` → `data.rows.slice(0, 5)`, `feed`, `wins`); compute `totalWins` inside the `wins` section from `data`; **delete** the "Longest kills" panel (it used `longest`) and the "Top weapons" panel (it used `weapons`) along with their imports (`longestKills`, `weaponStats`, `causeLabel` if now unused, `metres` if now unused); replace `import { nowSec } from '@/lib/server/db'` with `const nowSec = () => Math.floor(Date.now() / 1000);` only if `now` is still used, else delete it; replace the `@/lib/server/queries` import with `@/lib/server/data`. The population chart maps `PopulationPoint` exactly as before.

- [ ] **Step 3: Servers list (`src/app/servers/page.tsx`)** — make it `async`; `const servers = await safe(getServers());` and `const pop = await safe(population(null, '24h'));`; wrap the grid in `<Section loaded={servers}>`; delete the `{s.location}` line; replace `s.lastOnlineAt` with `s.updatedAt`. `regions` is computed inside the section from `data`.

- [ ] **Step 4: Server page (`src/app/servers/[id]/page.tsx`)** — replace the data block with:

```tsx
  const { id } = await params;
  const sp = await searchParams;
  const loadedServer = await getServer(id);
  if (!loadedServer) notFound();
  const server = loadedServer.data;
  const range = sp.range === '7d' ? '7d' : '24h';
  const now = Math.floor(Date.now() / 1000);
  const [pop, totals, matches, top, kills] = await Promise.all([
    safe(population(server.id, range)),
    safe(serverTotals(server.id)),
    safe(listMatches({ serverId: server.id, limit: 8 })),
    safe(leaderboard({ metric: 'kills', period: '7d', serverId: server.id })),
    safe(recentKills({ serverId: server.id, limit: 15 })),
  ]);
  const st = server.status;
  const factions = st?.factionScores.map((f) => f.name) ?? ['Valkyra', 'Lonestar', 'Manticore'];
```

Then: wrap the population chart, totals stats, matches table (`data.rows`), top players (`data.rows.slice(0, 10)`) and kill list in `<Section>`; in the header replace `{REGION_NAMES[server.region]} · {server.location}` with `{REGION_NAMES[server.region] ?? server.region}`; in the offline line use `server.updatedAt` instead of `server.lastOnlineAt` and drop the `server.error` part; **delete the ping column**: the `<th>` for ping and `<td className="r text-dim">{p.pingMs}</td>`; change `import type { LivePlayer } from '@/lib/server/rcon'` to `@/lib/server/views`; match links become `` href={`/matches/${m.serverId}/${m.id}`} ``. The totals panel shows `uniquePlayers`, `matches`, `kills`, `headshots`, `peak` (7 days) — relabel its stats to those five.

- [ ] **Step 5: Check it against the mock**

Run: `npm run typecheck && npm run lint`, then `npm run dev:mock` and open `http://localhost:3000/`, `/servers`, `/servers/srv-1`, `/servers/srv-6`.
Expected: no type or lint errors; all four pages render; `srv-6` shows offline; no ping column anywhere; view the page source of `/servers/srv-1` and search for `ping`: no match.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/servers src/components/game.tsx
git commit -m "feat: home and server pages read from Warcon"
```

---

### Task 9: Leaderboards, players list and player profile

**Files:**
- Modify: `src/app/leaderboards/page.tsx`, `src/app/players/page.tsx`, `src/app/players/[steamId]/page.tsx`, `src/components/player.tsx`

**Interfaces:**
- Consumes: `leaderboard`, `searchPlayers`, `recentPlayers`, `getPlayer`, `getServers` (Task 6); `PERIODS`, `PERIOD_LABELS`, `METRICS`, `METRIC_LABELS`, `parsePeriod`, `parseMetric` from `views.ts`

- [ ] **Step 1: `src/components/player.tsx`** — change type imports to `@/lib/server/views`.

- [ ] **Step 2: Leaderboards** — imports from `@/lib/server/views` (vocabulary) and `@/lib/server/data` (functions). Data block:

```tsx
  const sp = await searchParams;
  const metric = parseMetric(one(sp.metric));
  const period = parsePeriod(one(sp.period), '7d');
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const servers = await safe(getServers());
  const serverList = servers instanceof Error ? [] : servers.data;
  const serverId = serverList.some((s) => s.id === one(sp.server)) ? one(sp.server)! : null;
  const board = await safe(leaderboard({ metric, period, serverId, page }));
```

Wrap the table in `<Section loaded={board}>`; rows are `data.rows`; pagination uses `data.total` and `data.pageSize` (50) instead of the old fixed limit; delete any use of `MIN_KILLS` and the "minimum kills" note (Warcon applies its own 60-minute playtime floor; say "Players with at least an hour on" instead); the value column formats by metric: `kd` with `kd()`, `perHour` with one decimal, `playtime` with `duration()`, `winRate` with `pct()`, `cash` with `money()`, others with `int()`.

- [ ] **Step 3: Players list** — data block:

```tsx
  const sp = await searchParams;
  const q = (one(sp.q) ?? '').trim();
  const servers = await safe(getServers());
  const [results, recent] = await Promise.all([q ? searchPlayers(q).catch(() => [] as const) : Promise.resolve(null), safe(recentPlayers(30))]);
```

If `results === 'warming'` render `<Empty>Search is warming up. Try again in a moment.</Empty>`. If `q` is a 17-digit SteamID and `results` is an empty array, render a link "Open profile for {q}" to `/players/${q}`. The "online now" list keeps reading `servers.data.flatMap(...)` inside a `<Section loaded={servers}>`; the "recent players" list is `<Section loaded={recent}>`. `p.lastSeen` may be `null`: show "Seen —" then.

- [ ] **Step 4: Player profile** — data block:

```tsx
  const { steamId } = await params;
  if (!/^\d{17}$/.test(steamId)) notFound();
  const loadedPlayer = await safe(getPlayer(steamId));
  if (loadedPlayer === null) notFound();
  if (loadedPlayer instanceof Error) return <Container className="mt-16"><Empty>Stats are temporarily unavailable. Try again in a minute.</Empty></Container>;
  const player = loadedPlayer.data;
  const t = player.totals;
  const weapons = player.weapons.slice(0, 15);
  const weaponKills = weapons.reduce((a, w) => a + w.kills, 0);
  const favourite = weapons[0];
  const lifetimeKd = t.kills / Math.max(1, t.deaths);
```

Then: **delete** the "this week" stats (`week`, `weekKd`) and the 30-day activity chart (`daily`, `BarChart` import); replace the `ranks` block (several metrics) with one rank line: `player.rank ? \`#${player.rank} on the all-time kills board\` : 'Unranked'`; add a streak line when `player.streak` (`${n} ${kind === 'win' ? 'wins' : 'losses'} in a row`); `rivals.victims`/`rivals.nemeses` become `player.victims`/`player.nemeses`; `servers` becomes `player.servers`; `matches` becomes `player.matches` (rows link to `/matches/${m.serverId}/${m.matchId}` and show `m.result`); `kills` becomes `player.recentKills`; the weapon table shows cause and kills only (drop headshot/longest/average columns, which Warcon does not give per weapon); `player.aliases` is now `string[]` (render each string; drop the per-alias date); `player.onlineOn` has no `live` field: show "Playing on {serverName}" and drop the faction tag; `firstSeen`/`lastSeen` may be `null`. Add a "By map" and "By faction" table from `player.maps` / `player.factions` (columns: name, matches, wins, K/D).

- [ ] **Step 5: Check it against the mock**

Run: `npm run typecheck && npm run lint`, then with `npm run dev:mock` open `/leaderboards`, `/leaderboards?metric=perHour&period=90d&page=2`, `/players`, `/players?q=owl`, `/players/76561198000000001`, `/players/76561198999999999`.
Expected: boards render 50 rows with paging; search lists Owl players; the profile shows weapons, rivals, maps and factions; the unknown ID shows the 404 page; view source of the profile and search for `PRIVATE`: no match.

- [ ] **Step 6: Commit**

```bash
git add src/app/leaderboards src/app/players src/components/player.tsx
git commit -m "feat: leaderboards and player pages read from Warcon"
```

---

### Task 10: Matches, match page, feed and compare

**Files:**
- Modify: `src/app/matches/page.tsx`, `src/app/feed/page.tsx`, `src/app/compare/page.tsx`
- Move: `src/app/matches/[id]/page.tsx` → `src/app/matches/[serverId]/[matchId]/page.tsx`

**Interfaces:**
- Consumes: `listMatches`, `getMatch`, `recentKills`, `getPlayer`, `searchPlayers`, `headToHead`, `getServers` (Task 6)

- [ ] **Step 1: Matches list** — data block: `const servers = await safe(getServers());`, `const serverId = …` (as on the leaderboard), `const matches = await safe(listMatches({ serverId, page }));`. Wrap the table in `<Section loaded={matches}>`, rows `data.rows`, pages `data.pages`; each row links to `/matches/${m.serverId}/${m.id}`; show `m.players` in the players column.

- [ ] **Step 2: Move and rewrite the match page**

Run: `mkdir -p "src/app/matches/[serverId]/[matchId]" && git mv "src/app/matches/[id]/page.tsx" "src/app/matches/[serverId]/[matchId]/page.tsx" && rmdir "src/app/matches/[id]"`

Change the props type to `PageProps<'/matches/[serverId]/[matchId]'>` and the data block to:

```tsx
  const { serverId, matchId } = await params;
  const id = Number(matchId);
  if (!Number.isInteger(id) || id < 1) notFound();
  const loadedMatch = await safe(getMatch(serverId, id));
  if (loadedMatch === null) notFound();
  if (loadedMatch instanceof Error) return <Container className="mt-16"><Empty>Stats are temporarily unavailable. Try again in a minute.</Empty></Container>;
  const { match, lines, timeline, factions, awards, kills, weapons } = loadedMatch.data;
  const now = Math.floor(Date.now() / 1000);
```

Replace `matchScoreboard(...)` with `lines`, `matchWeapons(...)` with `weapons`, `recentKills({ matchId })` with `kills`. Replace the per-minute kill timeline chart (`matchTimeline`) with a score timeline: `timeline` rows are `[secondsIntoMatch, score of factions[0], score of factions[1], …]`; render one series per faction with its `colorHex` (fallback `factionColor(name)`), x label `duration(row[0])`. Add an **Awards** panel listing `awards` (`label`, linked `name`, `value`). `generateMetadata` reads the same `getMatch` call (it is cached).

- [ ] **Step 3: Feed** — data block:

```tsx
  const sp = await searchParams;
  const servers = await safe(getServers());
  const serverList = servers instanceof Error ? [] : servers.data;
  const serverId = serverList.some((s) => s.id === one(sp.server)) ? one(sp.server)! : null;
  const before = serverId ? (one(sp.before) ?? null) : null;
  const kindParam = one(sp.kind);
  const kind = (['headshot', 'teamKill', 'suicide', 'vehicle', 'environment'] as const).find((k) => k === kindParam) ?? '';
  const minM = Number(one(sp.minM)) || null;
  const kills = await safe(recentKills({ serverId, before, limit: LIMIT, kind, minM, cause: one(sp.cause) ?? undefined }));
  const oldest = !(kills instanceof Error) && serverId ? kills.data[kills.data.length - 1]?.cursor : undefined;
```

The "Older" link shows only when `oldest` is set (one server chosen); it sets `before=oldest`. Add a second `Segmented` row for kind (All, Headshots, Team kills, Vehicles) and a "Min distance" segmented row (Any, 100 m, 250 m, 400 m) built with `withParams('/feed', sp, { kind: … , before: null })`. Wrap the list in `<Section loaded={kills}>`.

- [ ] **Step 4: Compare** — data block: both players via `safe(getPlayer(a))` / `safe(getPlayer(b))`, `safe(headToHead(a, b))` when both exist, and `searchPlayers(q)` for the picker (treat `'warming'` as no results with the warming message). Totals come from `player.data.totals`; the weapon comparison uses `player.data.weapons` (cause and kills only). Drop any "this week" comparison.

- [ ] **Step 5: Check it against the mock**

Run: `npm run typecheck && npm run lint`, then with `npm run dev:mock` open `/matches`, `/matches/srv-1/5`, `/matches/srv-1/9999`, `/feed`, `/feed?server=srv-1`, then follow "Older"; `/feed?kind=headshot`; `/compare?a=76561198000000001&b=76561198000000002`.
Expected: all render; the unknown match is the 404 page; "Older" pages back on one server; headshot filter shows only HS rows.

- [ ] **Step 6: Commit**

```bash
git add src/app/matches src/app/feed src/app/compare
git commit -m "feat: matches, feed and compare read from Warcon"
```

---

### Task 11: Public JSON API, health, robots and sitemap

**Files:**
- Modify: `src/app/api/servers/route.ts`, `src/app/api/leaderboard/route.ts`, `src/app/api/players/[steamId]/route.ts`, `src/app/api/health/route.ts`, `src/app/api-docs/page.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts`
- Test: `src/app/api/players/route.test.ts`

**Interfaces:**
- Consumes: `getServers`, `leaderboard`, `getPlayer` (Task 6); `warcon()`, `siteEnv()`, `WarconError` (Tasks 1, 3)
- Produces: `GET /api/health` → `200 { ok: true, warcon: 'ok' | 'unreachable' | 'key_rejected' | 'key_lacks_view' | 'error', servers: number }`; `503` only when `siteEnv()` throws.

- [ ] **Step 1: Write the failing route test** — `src/app/api/players/route.test.ts`

```ts
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/server/data', () => ({
  getPlayer: async () => ({
    stale: false,
    missing: [],
    data: {
      steamId: '76561198000000001', name: 'A', avatarUrl: null, firstSeen: 1, lastSeen: 2, aliases: [],
      totals: { kills: 1, deaths: 1, headshots: 0, suicides: 0, teamkills: 0, playtime: 60, longest: 0, matches: 1, wins: 1, losses: 0, draws: 0 },
      rank: 3, streak: null, onlineOn: null, weapons: [], victims: [], nemeses: [], servers: [], matches: [], maps: [], factions: [], recentKills: [],
    },
  }),
}));

describe('GET /api/players/:steamId', () => {
  test('answers the public shape and nothing private', async () => {
    const { GET } = await import('./[steamId]/route');
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ steamId: '76561198000000001' }) } as never);
    const body = await res.json();
    expect(body).toMatchObject({ steamId: '76561198000000001', name: 'A', rank: 3 });
    expect(JSON.stringify(body)).not.toMatch(/ping|watch|risk|notes|banned/i);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/app/api/players/route.test.ts` — Expected: FAIL (the route still imports `queries`).

- [ ] **Step 3: Rewrite the three public routes** — each keeps `export const dynamic = 'force-dynamic'` and its `cache-control` header. `/api/players/[steamId]`:

```ts
import { getPlayer } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/players/[steamId]'>) {
  const { steamId } = await ctx.params;
  if (!/^\d{17}$/.test(steamId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const loaded = await getPlayer(steamId).catch(() => undefined);
  if (loaded === undefined) return Response.json({ error: 'unavailable' }, { status: 503 });
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 });
  const p = loaded.data;
  return Response.json(
    {
      steamId: p.steamId, name: p.name, avatarUrl: p.avatarUrl, firstSeen: p.firstSeen, lastSeen: p.lastSeen,
      rank: p.rank, totals: p.totals, online: p.onlineOn ? { serverId: p.onlineOn.serverId } : null,
      weapons: p.weapons.slice(0, 10),
    },
    { headers: { 'cache-control': 'public, s-maxage=60' } },
  );
}
```

`/api/servers` returns `getServers().data` mapped to `{ id, name, shortName, region, online, map: status?.map ?? null, players: playerCount, maxPlayers: status?.players.max ?? null, joinCode, updatedAt }` (no `location`, no player list), `s-maxage=10`, 503 `{ error: 'unavailable' }` on failure. `/api/leaderboard` reads `metric`, `period`, `server`, `page` from the query with `parseMetric`/`parsePeriod` and returns `{ metric, period, page, total, pageSize, rows }` from `leaderboard()`, `s-maxage=60`. Update `/api-docs` to list exactly these fields and the new `metric`/`period` values.

- [ ] **Step 4: Rewrite `/api/health`**

```ts
import { WarconError } from '@/lib/server/warcon/http';
import { siteEnv } from '@/lib/server/warcon/env';
import { warcon } from '@/lib/server/warcon';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    siteEnv();
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  try {
    const { value } = await warcon().servers();
    return Response.json({ ok: true, warcon: 'ok', servers: value.length });
  } catch (e) {
    const kind = e instanceof WarconError ? e.kind : 'error';
    const warconState = kind === 'rejected' ? 'key_rejected' : kind === 'forbidden' ? 'key_lacks_view' : kind === 'unreachable' || kind === 'timeout' ? 'unreachable' : 'error';
    return Response.json({ ok: true, warcon: warconState, servers: 0 });
  }
}
```

- [ ] **Step 5: robots and sitemap** — `src/app/robots.ts`:

```ts
import type { MetadataRoute } from 'next';
import { siteEnv } from '@/lib/server/warcon/env';

export default function robots(): MetadataRoute.Robots {
  const { siteUrl, allowIndexing } = siteEnv();
  return allowIndexing
    ? { rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: `${siteUrl}/sitemap.xml` }
    : { rules: { userAgent: '*', disallow: '/' } };
}
```

In `src/app/sitemap.ts`, use `siteEnv().siteUrl` as the origin, list the static pages (`/`, `/servers`, `/leaderboards`, `/players`, `/matches`, `/feed`) plus each `/servers/<id>` from `getServers()` (skip them if it fails), and drop `/weapons` and any player/match enumeration that read SQLite.

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `npm test && npm run typecheck && npm run lint` — Expected: pass.

```bash
git add src/app/api src/app/api-docs src/app/robots.ts src/app/sitemap.ts
git commit -m "feat: public API, health, robots and sitemap read from Warcon"
```

---

### Task 12: Delete the old data layer

**Files:**
- Delete: `src/lib/server/{db,recorder,recorder.test,worker,rcon,a2s,a2s.test,steam,notify,queries,config}.ts`, `src/lib/demo/`, `src/app/api/ingest/`, `src/app/weapons/`, `src/instrumentation.ts`, `scripts/seed-demo.ts`, `scripts/backup.mjs`, `config/`
- Modify: `package.json`, `vitest.config.mts`, `.gitignore`, `src/app/layout.tsx` (nav), `src/app/not-found.tsx`/`error.tsx` if they import removed code

- [ ] **Step 1: Confirm nothing still imports the old modules**

Run: `grep -rnE "lib/server/(db|recorder|worker|rcon|a2s|steam|notify|queries|config)'|lib/demo|/weapons" src scripts --include=*.ts --include=*.tsx | grep -v "^src/lib/server/\(db\|recorder\|worker\|rcon\|a2s\|steam\|notify\|queries\|config\)" | grep -v "^src/lib/demo" | grep -v "^src/app/weapons" | grep -v "^src/app/api/ingest" | grep -v "^src/instrumentation.ts" | grep -v "^scripts/\(seed-demo\|backup\)"`
Expected: only `src/app/layout.tsx` (the Weapons nav link) and `scripts/doctor.ts` (rewritten in Task 13). Anything else: move it to `views.ts`/`data.ts` before deleting.

- [ ] **Step 2: Delete**

```bash
git rm -r -q src/lib/server/db.ts src/lib/server/recorder.ts src/lib/server/recorder.test.ts src/lib/server/worker.ts src/lib/server/rcon.ts src/lib/server/a2s.ts src/lib/server/a2s.test.ts src/lib/server/steam.ts src/lib/server/notify.ts src/lib/server/queries.ts src/lib/server/config.ts src/lib/demo src/app/api/ingest src/app/weapons src/instrumentation.ts scripts/seed-demo.ts scripts/backup.mjs config
```

- [ ] **Step 3: Tidy what referenced them**
  - `src/app/layout.tsx`: remove the Weapons nav link.
  - `package.json`: remove the `seed`, `demo` and `backup` scripts and the `better-sqlite3` / `@types/better-sqlite3` dependencies; then run `npm install` to update the lockfile.
  - `vitest.config.mts`: remove `DEMO_MODE` and `SERVERS_CONFIG` from `env`.
  - `.gitignore`: remove the `data/` and `backups/` lines if present.
  - `scripts/doctor.ts`: replace its contents with `throw new Error('rewritten in the next task');` so typecheck passes until Task 13.

- [ ] **Step 4: Verify the whole site**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass; the build lists no `/weapons` or `/api/ingest/events` route.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove the site's own collection, SQLite, demo mode and weapons pages"
```

---

### Task 13: Doctor

**Files:**
- Modify: `scripts/doctor.ts`
- Test: `src/lib/server/warcon/doctor.test.ts`
- Create: `src/lib/server/warcon/doctor.ts` (the checks, testable; the script prints them)

**Interfaces:**
- Consumes: `createWarcon`, `createApi`, `TtlCache`, `loadSiteEnv`
- Produces: `runChecks(api: WarconApi, env: SiteEnv): Promise<{ name: string; ok: boolean; detail: string }[]>`

- [ ] **Step 1: Write the failing test** — `src/lib/server/warcon/doctor.test.ts`

```ts
import { describe, expect, test, vi } from 'vitest';
import { runChecks } from './doctor';
import { WarconError } from './http';

const env = { warconBaseUrl: 'http://w', warconToken: 't', siteUrl: 'https://s', serverIds: ['s1', 'nope'], allowIndexing: false };
const okCached = <T>(value: T) => Promise.resolve({ value, stale: false });

const api = (over: Record<string, unknown> = {}) =>
  ({
    servers: () => okCached([{ id: 's1', orgId: 'o', name: 'EU#1', sortOrder: 0 }]),
    live: () => okCached(null),
    board: () => okCached({ ok: true, rows: [], total: 0, pageSize: 50 }),
    matches: () => okCached({ ok: true, matches: [], live: [], page: 1, pages: 1, total: 0 }),
    kills: () => okCached({ ok: true, kills: [], total: 0 }),
    analytics: () => okCached({}),
    seen: () => okCached([]),
    boardExportCsv: async () => 'rank,steam_id\n',
    ...over,
  }) as never;

describe('runChecks', () => {
  test('a rejected key is one clear failure', async () => {
    const r = await runChecks(api({ servers: () => Promise.reject(new WarconError('x', 'rejected', 401, '/api/servers')) }), env);
    expect(r).toEqual([{ name: 'key', ok: false, detail: expect.stringMatching(/rejected/) }]);
  });

  test('a SERVER_IDS entry the key cannot see fails', async () => {
    const r = await runChecks(api(), env);
    expect(r.find((c) => c.name === 'SERVER_IDS')).toMatchObject({ ok: false, detail: expect.stringContaining('nope') });
  });

  test('each endpoint is checked per server', async () => {
    const r = await runChecks(api(), { ...env, serverIds: [] });
    expect(r.filter((c) => c.name.endsWith('(s1)')).map((c) => c.name)).toEqual(['summary (s1)', 'leaderboard (s1)', 'matches (s1)', 'kills (s1)', 'analytics (s1)', 'players/seen (s1)']);
    expect(r.every((c) => c.ok)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/server/warcon/doctor.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/server/warcon/doctor.ts`**

```ts
// The deploy gate's checks: the key works, has View, sees the servers, and every endpoint the
// site reads answers in the shape the schemas expect.
import type { WarconApi } from './api';
import type { SiteEnv } from './env';
import { WarconError } from './http';

export interface Check { name: string; ok: boolean; detail: string }

const why = (e: unknown) =>
  e instanceof WarconError
    ? e.kind === 'rejected' ? 'key rejected (401): check WARCON_TOKEN'
    : e.kind === 'forbidden' ? 'key lacks the View capability (403)'
    : e.message
    : e instanceof Error ? e.message : String(e);

export async function runChecks(api: WarconApi, env: SiteEnv): Promise<Check[]> {
  let servers;
  try {
    servers = (await api.servers()).value;
  } catch (e) {
    return [{ name: 'key', ok: false, detail: why(e) }];
  }
  const out: Check[] = [{ name: 'key', ok: servers.length > 0, detail: `accepted; sees ${servers.length} server(s)` }];
  const unknown = env.serverIds.filter((id) => !servers.some((s) => s.id === id));
  if (env.serverIds.length) out.push({ name: 'SERVER_IDS', ok: unknown.length === 0, detail: unknown.length ? `not visible to the key: ${unknown.join(', ')}` : 'all visible' });

  const ids = env.serverIds.length ? env.serverIds.filter((id) => !unknown.includes(id)) : servers.map((s) => s.id);
  for (const id of ids) {
    const checks: [string, () => Promise<unknown>][] = [
      ['summary', () => api.live(id)],
      ['leaderboard', () => api.board(id, { scope: 'org', range: '7d', sort: 'kills' })],
      ['matches', () => api.matches(id)],
      ['kills', () => api.kills(id, { limit: 1 })],
      ['analytics', () => api.analytics(id, '24h')],
      ['players/seen', () => api.seen(id, { limit: 1 })],
    ];
    for (const [name, run] of checks) {
      try {
        await run();
        out.push({ name: `${name} (${id})`, ok: true, detail: 'answered' });
      } catch (e) {
        out.push({ name: `${name} (${id})`, ok: false, detail: why(e) });
      }
    }
  }
  try {
    const csv = await api.boardExportCsv(ids[0] ?? servers[0].id);
    out.push({ name: 'search index export', ok: csv.startsWith('rank,steam_id'), detail: `${csv.split('\n').length - 1} rows` });
  } catch (e) {
    out.push({ name: 'search index export', ok: false, detail: why(e) });
  }
  return out;
}
```

- [ ] **Step 4: Rewrite `scripts/doctor.ts`**

```ts
// npm run doctor / docker compose run --rm doctor: exits non-zero unless every check passes.
import { createApi } from '../src/lib/server/warcon/api';
import { TtlCache } from '../src/lib/server/warcon/cache';
import { runChecks } from '../src/lib/server/warcon/doctor';
import { loadSiteEnv } from '../src/lib/server/warcon/env';
import { createWarcon } from '../src/lib/server/warcon/http';

async function main() {
  let env;
  try {
    env = loadSiteEnv();
  } catch (e) {
    console.log(`FAIL  config: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  console.log(`ok    config: Warcon at ${env.warconBaseUrl}, site ${env.siteUrl}`);
  const api = createApi(createWarcon({ baseUrl: env.warconBaseUrl, token: env.warconToken }), new TtlCache());
  const checks = await runChecks(api, env);
  for (const c of checks) console.log(`${c.ok ? 'ok   ' : 'FAIL '} ${c.name}: ${c.detail}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

void main();
```

- [ ] **Step 5: Run against the mock**

Run: `npx vitest run src/lib/server/warcon/doctor.test.ts`, then `node scripts/mock-warcon.mjs & sleep 1; WARCON_BASE_URL=http://127.0.0.1:4100 WARCON_TOKEN=mock-token SITE_URL=http://localhost:3000 npx tsx scripts/doctor.ts; echo "exit $?"; WARCON_BASE_URL=http://127.0.0.1:4100 WARCON_TOKEN=wrong SITE_URL=http://localhost:3000 npx tsx scripts/doctor.ts; echo "exit $?"; kill %1`
Expected: tests pass; first run all `ok`, `exit 0`; second run `FAIL  key: key rejected (401)…`, `exit 1`.

- [ ] **Step 6: Commit**

```bash
git add scripts/doctor.ts src/lib/server/warcon/doctor.ts src/lib/server/warcon/doctor.test.ts
git commit -m "feat: doctor checks the Warcon key and every endpoint the site reads"
```

---

### Task 14: Docker, deploy script, workflows and the runbook

**Files:**
- Modify: `docker-compose.yml`, `Dockerfile`, `.github/workflows/deploy.yml`, `docs/DEPLOYMENT.md`, `README.md`, `CLAUDE.md`
- Create: `scripts/deploy.sh`
- Delete: `deploy/` (install.sh, nginx, systemd)

- [ ] **Step 1: `docker-compose.yml`** — replace entirely:

```yaml
# docker compose up -d --build            the site, on 127.0.0.1:3000 and the warcon_default network
# docker compose run --rm doctor          checks the Warcon key and every endpoint (deploy gate)

services:
  site:
    build: .
    image: teg-wardogs-site:latest
    container_name: teg-wardogs-site
    restart: unless-stopped
    env_file: .env
    ports:
      # Loopback only: the public reaches it through the Cloudflare tunnel.
      - '127.0.0.1:${PORT:-3000}:3000'
    networks: [warcon]
    stop_grace_period: 15s
    logging:
      driver: json-file
      options: { max-size: 10m, max-file: '3' }

  doctor:
    build: { context: ., target: build }
    profiles: [tools]
    env_file: .env
    environment: { HOME: /tmp }
    networks: [warcon]
    command: ['node_modules/.bin/tsx', 'scripts/doctor.ts']

networks:
  warcon:
    external: true
    # Warcon's compose project lives in /home/debian/warcon, so its default network is warcon_default.
    name: warcon_default
```

- [ ] **Step 2: `Dockerfile`** — remove the native build toolchain added for `better-sqlite3` (the `apt-get install … python3 make g++` line in the deps stage), the `mkdir`/`chown` of `/app/data` and `/app/backups`, and the copy of `scripts/backup.mjs`. Keep the `HEALTHCHECK` on `/api/health`. Then run `docker build -t teg-wardogs-site:test .` — Expected: builds.

- [ ] **Step 3: `scripts/deploy.sh`**

```sh
#!/bin/sh
# Run on the VPS by the deploy workflow: update, build, check Warcon, and only then swap.
set -eu
DEPLOY_DIR="${DEPLOY_DIR:-/home/debian/teg-wardogs-site}"
cd "$DEPLOY_DIR"
git fetch --quiet origin main
git reset --quiet --hard origin/main
docker compose build --quiet site doctor
echo "running doctor…"
docker compose run --rm doctor
docker compose up -d site
docker image prune -f >/dev/null
echo "deployed $(git rev-parse --short HEAD)"
```

Run: `chmod +x scripts/deploy.sh`

- [ ] **Step 4: `.github/workflows/deploy.yml`** — keep the existing `workflow_run` trigger on CI success for `main` and the `DEPLOY_ENABLED` gate; set the remote command to `DEPLOY_DIR=/home/debian/teg-wardogs-site sh /home/debian/teg-wardogs-site/scripts/deploy.sh`; use secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` and optional `VPS_HOST_KEY` (pin it in `known_hosts` when set, else `ssh-keyscan`), and drop `DEPLOY_PATH`.

- [ ] **Step 5: Delete the non-Docker alternative**

Run: `git rm -r -q deploy`

- [ ] **Step 6: Rewrite `docs/DEPLOYMENT.md`** with these sections, in order:
  1. **How it fits** — the diagram from spec §10; the site reads Warcon over `warcon_default`; no Access bypass needed.
  2. **Create the Warcon key** — in Warcon, org → API keys → new key, label `stats site`, capability View only; copy it.
  3. **Prepare the VPS** — `git clone https://github.com/SamMcAulay/TEGwardogsSite.git /home/debian/teg-wardogs-site`; `cp .env.example .env`; set `WARCON_BASE_URL=http://warcon:3000`, `WARCON_TOKEN=<key>`, `SITE_URL=https://stats.tegwardogs.fyi`, `ALLOW_INDEXING=false`; `docker compose run --rm doctor` must print all `ok`.
  4. **First start** — `docker compose up -d --build`; `curl -s http://127.0.0.1:3000/api/health` shows `"warcon":"ok"`.
  5. **Cloudflare tunnel hostname** — Zero Trust → Networks → Tunnels → the tunnel serving `tegwardogs.fyi` → Public hostnames → Add: subdomain `stats`, domain `tegwardogs.fyi`, type HTTP, URL `teg-wardogs-site:3000` if the tunnel's `cloudflared` runs in Docker on `warcon_default` (check with `docker ps --format '{{.Names}} {{.Networks}}' | grep cloudflared`), otherwise `127.0.0.1:3000`.
  6. **Check Access** — `curl -s -o /dev/null -w '%{http_code}\n' https://stats.tegwardogs.fyi/` must print `200`; `https://tegwardogs.fyi/` must still print `302`. If the site prints `302`, the panel's Access application uses a wildcard: narrow it to `tegwardogs.fyi` or add a Bypass application for `stats.tegwardogs.fyi`.
  7. **Automatic deploys** — repo secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (optional `VPS_HOST_KEY`), repo variable `DEPLOY_ENABLED=true`; a push to `main` runs CI then `scripts/deploy.sh`; a failed doctor leaves the old site running.
  8. **Moving to the real domain** — add the domain to Cloudflare; add it as a public hostname on the same tunnel; set `SITE_URL=https://<domain>` and `ALLOW_INDEXING=true`; `docker compose up -d`; optionally a Redirect Rule from `stats.tegwardogs.fyi/*` to the new domain.
  9. **Troubleshooting** — 1033 (tunnel not running), 502 (wrong service URL), health `key_rejected` (wrong `WARCON_TOKEN`), `key_lacks_view`, `unreachable` (site not on `warcon_default`, or Warcon down).

- [ ] **Step 7: Update `README.md` and `CLAUDE.md`** — README: what the site is, that data comes from Warcon, `npm run dev:mock` for local development, `npm test`/`lint`/`typecheck`, link to `docs/DEPLOYMENT.md`; remove RCON, ingest, demo-mode, SQLite and weapons content. `CLAUDE.md` project notes become:

```markdown
- Stats site for TEG's WARDOGS servers. All data comes from Warcon's keyed API (`src/lib/server/warcon/`),
  cached in memory; there is no database.
- Pages are async server components calling `src/lib/server/data.ts`; each section wraps its data in
  `<Section>` (src/components/section.tsx) so a Warcon failure degrades one panel, not the page.
- The zod schemas in `src/lib/server/warcon/schemas.ts` are the privacy boundary: never make them loose,
  never add ping, notes, watch, risk, bans or IPs to them.
- Colours live only in the `:root` tokens in `src/app/globals.css`.
- Local run: `npm run dev:mock` (mock Warcon on :4100 plus next dev). Checks: `npm test`, `npm run lint`,
  `npm run typecheck`.
- Deployment: `docs/DEPLOYMENT.md`. `docker compose run --rm doctor` checks the key and every endpoint.
```

- [ ] **Step 8: Final verification and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build && docker build -t teg-wardogs-site:test .`
Expected: all pass.

```bash
git add -A
git commit -m "feat: deploy beside Warcon on warcon_default, with a doctor gate; runbook rewritten"
```

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §2 keyed API, no public switches | 3 |
| §3 removed / kept | 8–12, 14 |
| §4 client, validation, trimming, rate limits, settings | 1, 3, 5 |
| §5.1–5.2 cache and failure on a page | 2, 7, 8–10 |
| §5.3 search index | 5, 9 |
| §6 pages | 8, 9, 10 |
| §7 merging | 4, 6 |
| §8 health and doctor | 11, 13 |
| §9 mock and tests | 7, all |
| §10 deployment | 14 |
| §12 corrections | 6, 8, 9 |
