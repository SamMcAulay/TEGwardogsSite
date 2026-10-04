# Read the stats site's data from Warcon

Date: 2026-10-04
Status: approved in conversation, awaiting written-spec review

## 1. Why

The site currently collects its own data: it polls each game server over RCON (falling back
to a Steam server query), receives the game's kill feed at `POST /api/ingest/events`, and
keeps everything in SQLite. Warcon already does all of that for the same six servers. Running
both means two copies of the data that drift apart, and a kill feed conflict: a game server
sends its feed to one URL, and that URL is Warcon's.

The site will instead read everything from Warcon's API, keep no database, and become a
presentation layer. UI work comes after this foundation.

## 2. Decisions

| Question | Decision |
|---|---|
| Which Warcon API | The keyed API (`/api/servers/...`), with a dedicated org API key, View only. Not `/api/public/...`: it lacks search, analytics and kill filters, and is limited to 120 requests a minute per address. Warcon's per-server public page switches stay off; they gate only `/s/...` and `/api/public/...`, which the site does not use. |
| Caching | Approach A: an in-memory cache inside the site's own Warcon client. Not a sync into SQLite (B), not Next's fetch cache (C). |
| Weapons section | Dropped for now. (Warcon's `analytics` has a per-server `combat` section with weapons and longest kills, if it comes back later.) |
| Player privacy | Names and SteamIDs are public; profiles stay at `/players/<SteamID>`. Pings, mod notes, watchlist marks, risk flags and IPs are never shown. In-game cash is shown. |
| Local development | A mock Warcon server with seeded sample data. No tunnel to production. |
| Address | `https://stats.tegwardogs.fyi` for now, through the existing Cloudflare tunnel. A separate domain later; only `SITE_URL` and the tunnel hostname change. Search engines are kept out until then. |

## 3. What is removed and what stays

### Removed

- `src/lib/server/db.ts`, `recorder.ts`, `worker.ts`, `rcon.ts`, `a2s.ts`, `steam.ts`,
  `notify.ts`, and their tests (`recorder.test.ts`, `a2s.test.ts`).
- The worker start in `src/instrumentation.ts` (the file goes if nothing else uses it).
- `src/app/api/ingest/events/route.ts`. The game servers' kill feed goes to Warcon only.
- Demo mode: `src/lib/demo/`, `scripts/seed-demo.ts`, the `seed` and `demo` npm scripts,
  `DEMO_MODE`.
- `scripts/backup.mjs`, the `backup` npm script, the backup cron in `deploy/install.sh`,
  the `data/` and `backups/` volumes, and the `better-sqlite3` dependency.
- `config/servers.example.json` and `SERVERS_CONFIG`: the server list comes from Warcon.
- Server offline/online Discord alerts (`notify.ts`): the status bots already post these.
- `/weapons`, `/weapons/[cause]`, and every "top weapons" and "longest kills" panel outside a
  player's own career.
- The bundled `cloudflared` compose service and `TUNNEL_TOKEN`: the existing tunnel is reused.
- `deploy/nginx` and `deploy/systemd` (the non-Docker alternative), and the game-server-admin
  section of `docs/DEPLOYMENT.md`: nothing changes on the game servers.

### Kept

- Every other page (section 6), all of `src/components/`, and `src/lib/format.ts`, `game.ts`,
  `topo.ts`, `url.ts` with their tests.
- The site's public JSON API (`/api/servers`, `/api/leaderboard`, `/api/players/[steamId]`)
  and `/api-docs`, now thin wrappers over the Warcon client. Response shapes stay as close to
  today's as Warcon's data allows; `/api-docs` is updated to match.
- `/api/health`, rewritten (section 8).
- `scripts/doctor.ts`, rewritten (section 8).
- The Dockerfile, `docker-compose.yml` (minus the tunnel), CI, and the SSH deploy workflow.

## 4. The Warcon client

`src/lib/server/warcon.ts` is the only code that talks to Warcon.

- **Transport.** `fetch` to `WARCON_BASE_URL` (in production `http://warcon:3000`, over the
  `warcon_default` Docker network, never through Cloudflare) with
  `Authorization: Bearer <WARCON_TOKEN>` and an 8 s timeout.
- **Validation.** Each endpoint has a zod schema. A response that fails it throws one error
  naming the endpoint and the failing path. Non-2xx responses throw an error carrying Warcon's
  status and error code; 401/403 are distinguished so health and doctor can say "key rejected"
  or "key lacks View".
- **Trimming.** Schemas and mappers return only the fields the site shows. Pings, notes,
  watchlist marks, risk flags, IPs and anything else not listed in a page's data type are
  dropped here, so neither a page nor the public JSON API can leak them.
- **Rate limits honoured.** No page calls a rate-limited endpoint per request: `players/seen`
  (60 a minute per key) is used only for the recent-players list, cached; search uses the
  index in section 5.3; `analytics/periods` (30 a minute) is not used; `steam/profiles`
  (60 a minute) is batched up to 100 IDs and cached for 24 h.

Settings (`src/lib/server/config.ts`, validated at startup; the site refuses to start without
the required ones):

| Variable | Required | Meaning |
|---|---|---|
| `WARCON_BASE_URL` | yes | Warcon's origin. `http://warcon:3000` in production, the mock locally |
| `WARCON_TOKEN` | yes | Org API key with View only, separate from the status bots' and modlog's keys |
| `SITE_URL` | yes | Public origin, for canonical links, `sitemap.xml` and `robots.txt` |
| `SERVER_IDS` | no | Comma-separated Warcon server IDs to show, in this order. Default: every server the key can see, in Warcon's order |
| `ALLOW_INDEXING` | no | `true` lets search engines in. Default `false`: `robots.txt` disallows everything. Set it when the real domain goes live |

## 5. Caching

### 5.1 The cache

An in-memory map in the Node process, keyed by the exact request (path and query).

| Data | Fresh for |
|---|---|
| Server list and live status (`/api/servers`, `summary`) | 10 s |
| Kill feed (`kills`) | 10 s |
| Leaderboards, careers, match lists, analytics, recent players | 60 s |
| An ended match (`matches/:matchId`) and its kills | 1 h |
| Steam names and avatars (`steam/profiles`) | 24 h |

- **One request per key at a time.** Concurrent callers for the same key share one in-flight
  Warcon request.
- **Stale on error.** When a refresh fails, the last good value is served for up to 5 minutes
  past its freshness, flagged stale. After that the call fails.
- **Bounded.** At most 500 entries, least recently used evicted first. The search index
  (5.3) is held separately and does not count.

### 5.2 Failure on a page

Each page section loads its data independently. A section whose data fails shows a "stats are
temporarily unavailable" panel; the rest of the page renders. A section served stale shows a
small "may be out of date" note. Error text from Warcon is never shown to visitors; it goes to
the server log.

### 5.3 The player search index

Warcon has no org-wide search on a View key, and `players/seen` allows 60 calls a minute,
which a six-server search would exhaust at ten searches a minute. Instead:

- Every 15 minutes the site fetches `leaderboard/export?scope=org&range=all&sort=playtime`
  with the lowest `minMinutes` Warcon accepts: up to 10,000 players with names and SteamIDs
  (export allows 10 calls a minute).
- Search matches the query against that list in memory: a 17-digit SteamID exactly, else a
  case-insensitive part of the name, best playtime first, 25 results.
- A query that is a valid SteamID but not in the index links straight to the profile, which
  answers from Warcon or shows "no record".
- Until the first export loads, search shows "search is warming up".
- A player who has never finished enough of a match to appear on the board is not
  searchable. Accepted.

## 6. Pages

### 6.1 Changes visible on every page

- **Periods** become Warcon's: 7 days, 30 days, 90 days, all time. "Today" goes.
- **Leaderboard sorts** become Warcon's: kills, deaths, K/D, kills/hour, playtime, matches,
  wins, win rate, cash. Headshots, headshot % and longest kill go as sorts.
- **Network-wide data** is Warcon's `scope=org` where Warcon offers it (leaderboards, careers),
  otherwise one call per server merged by the site (sections 6.2 and 7). A server whose call
  fails is left out of a merge and named in a note; the others still show.

### 6.2 Page by page

| Page | Warcon data | Changes |
|---|---|---|
| Home | each server's status; org leaderboard top 10; recent kills from every server, merged newest first; population from `analytics?range=24h` per server | top weapons and longest kills panels go; faction wins counted from each server's recent matches |
| `/servers` | each server's status; 24 h population sparkline from `analytics` | none |
| `/servers/[id]` | `summary` with live teams; that server's leaderboard; latest matches; recent kills; population and totals from `analytics` | none |
| `/leaderboards` | `leaderboard?scope=org` or one server's, sorted and paged | 50 rows a page (Warcon's page size); sorts and periods per 6.1 |
| `/players` | search per 5.3; recent players from each server's `players/seen` sorted by last seen, merged | none |
| `/players/[steamId]` | `career` (org-wide on any server the key sees): rank, streak, results by map and faction, last ten matches, weapons, most killed, nemeses, servers played; avatar from `steam/profiles` | the daily activity chart goes; the match list is the last ten, not paged |
| `/matches` | each server's `matches?page=`, merged newest first | none |
| `/matches/[serverId]/[matchId]` | `matches/:matchId` (lines, score timeline, awards) and `kills?match=` | URL gains the server ID, since Warcon numbers matches per server; the weapons panel is counted from the match's kills; an awards panel is added |
| `/feed` | `kills` for every server merged, or one server; Warcon's filters (player, weapon, kind, minimum distance) | gains those filters |
| `/compare` | both careers; head-to-head from `kills?killer=A&victim=B&count=1`, both ways, on every server, summed | none |

`/matches/[id]` (the old URL) answers 404. Nothing external links to it yet.

## 7. Merging across servers

`src/lib/server/merge.ts` holds the merge helpers: newest-first merge for kills and matches,
by-score merge where needed, and a sum for head-to-head counts. Each returns the merged rows
plus the list of servers that failed. Merged lists are trimmed to the page's size after
merging, so each server is asked for that many rows.

## 8. Health and doctor

- **`/api/health`** returns 200 with Warcon's reachability, whether the key was accepted, and
  how many servers it sees; 503 only when the site itself is broken (config invalid). Warcon
  being down is reported in the body, not as 503, so Docker does not restart a healthy site.
  It backs the Dockerfile HEALTHCHECK as before.
- **`npm run doctor`** (also `docker compose run --rm doctor`) exits non-zero unless: config
  loads; Warcon answers; the key is accepted and has View; it sees at least one server and
  every `SERVER_IDS` entry; and each endpoint in section 6 answers for each server with a body
  that passes its schema. It prints one line per check, like the modlog bot's preflight.

## 9. Local development and testing

### 9.1 Mock Warcon

`scripts/mock-warcon.mjs` serves every endpoint in section 6 with the same shapes, from data
generated off a fixed seed: six servers, a few hundred players, several days of matches, a kill
feed that keeps advancing while it runs, analytics samples, and Steam profiles. It returns 401
without the bearer token from `.env.example`. `npm run dev:mock` starts it and the site
together. `.env.example` points `WARCON_BASE_URL` at it.

### 9.2 Tests (vitest)

- **Client:** auth header sent; timeouts and non-2xx become typed errors; 401 vs 403; a
  malformed body fails its schema with the endpoint named; **a response carrying ping, notes,
  watch and risk fields comes out without them**.
- **Cache:** freshness per kind; concurrent callers share one request; stale served for 5 min
  after a failure, then the error; LRU eviction at 500.
- **Search index:** SteamID exact match, name substring, ordering, warming-up state, refresh
  every 15 min.
- **Merge:** ordering, trimming, one failed server reported and the rest returned.
- **Mapping:** period and sort translation; each page's data function against fixtures taken
  from the mock.
- **Kept:** the existing `format` and other presentation tests.
- CI keeps lint, typecheck, test, build and Docker build. Tests for removed code are removed.

## 10. Deployment

```
visitors ──https──▶ Cloudflare ──existing tunnel──▶ teg-wardogs-site:3000
                                                        │ Docker network warcon_default
                                                        ▼
                                                   warcon:3000
```

- **Container.** Compose project at `/home/debian/teg-wardogs-site`, container
  `teg-wardogs-site`, joined to the external network `warcon_default`, port bound to
  `127.0.0.1:3000` only. No volumes: nothing to back up.
- **Cloudflare.** Add a public hostname `stats.tegwardogs.fyi` to the tunnel that already
  serves the panel. Its service is `http://teg-wardogs-site:3000` if that `cloudflared` runs
  in Docker on `warcon_default`, or `http://127.0.0.1:3000` if it runs on the host; which one
  is checked during setup. The panel's Access application must not cover the new hostname;
  checked with curl after setup (site 200, panel still 302). No Access bypass rule is needed:
  the site reaches Warcon over Docker, not through Cloudflare.
- **Deploy.** Push to `main` → CI → SSH to the VPS → `scripts/deploy.sh`: reset to
  `origin/main`, build the image, run doctor against the real Warcon, and only then replace
  the running container with `docker compose up -d`. A failed doctor stops the deploy and the
  old site keeps running. Secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (and optional
  `VPS_HOST_KEY`), as in the modlog repo.
- **One-off setup**, in `docs/DEPLOYMENT.md`: create the View-only org key in Warcon; fill
  `.env` on the VPS; add the tunnel hostname; first deploy by hand; the curl checks.
- **Moving to the real domain**, also in `docs/DEPLOYMENT.md`: add the domain to Cloudflare;
  add it as a tunnel hostname; set `SITE_URL` and `ALLOW_INDEXING=true`; redeploy; optionally
  redirect `stats.tegwardogs.fyi` to it.

## 11. Out of scope

- UI and design changes beyond what section 6 requires.
- The Weapons section.
- Any change to Warcon, the game servers, the status bots or the modlog bot.
- Buying or configuring the permanent domain.
