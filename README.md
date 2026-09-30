# TEG WARDOGS Stats

Server status, player profiles, match history, leaderboards and weapon statistics for
The Employed Gamers' WARDOGS servers.

Everything comes from the game servers themselves. A background worker polls each server's
**RCON HTTP API** every few seconds, and servers can push kills to the site through the game's
**kill feed** (`[WDServerFeed]`). All of it lands in a single SQLite file.

![Home](docs/screenshots/home.png)

<p>
  <img src="docs/screenshots/server.png" width="49%" alt="Server page" />
  <img src="docs/screenshots/player.png" width="49%" alt="Player profile" />
</p>

## Features

| Page | What's on it |
| --- | --- |
| `/` | Network totals, live server cards, 24h population, faction win rates, top players, live kill feed, weapon meta |
| `/servers`, `/servers/:id` | Live map, round clock, faction scores, full scoreboard by faction, population (24h/7d), recent rounds, top players, join code |
| `/leaderboards` | Kills, K/D, kills per hour, headshots, headshot %, longest kill, playtime. Filter by today/7d/30d/all time and by server |
| `/players`, `/players/:steamId` | Search by name, past alias or Steam ID. Profile has totals, ranks, 30-day activity, weapons, favourite targets and nemeses, servers played, round history, recent kills, known names |
| `/matches`, `/matches/:id` | Every round with final score and winner. Per-faction scoreboards, kill tempo, weapons used, round kill feed |
| `/weapons`, `/weapons/:cause` | Kills, share, headshot %, average and longest distance per weapon; top users and longest kills per weapon |
| `/feed` | Live kill feed across the network or per server, with an archive |
| `/compare` | Two players side by side, with head-to-head kills |
| `/api/*` | Public read-only JSON (`/api-docs`): servers, leaderboards, players |

## Quick start (demo data)

Requires Node 22+.

```sh
npm install
DEMO_MODE=true npm run seed      # ~2 min: simulates 10 days on six servers
npm run demo                     # http://localhost:3000
```

In demo mode the six TEG servers are simulated and play live while the site runs. Nothing
connects to a real server.

## Connecting real servers

1. **Server list.** Copy `config/servers.example.json` to `config/servers.json` with one entry
   per server. `id` becomes the URL slug and the key stats are stored under, so don't change it later.
2. **Secrets.** Copy `.env.example` to `.env`. Put each server's RCON password in the variable its
   `passwordEnv` names. This is the `Password=` under `[/Script/WDRCON.WDRCONSettings]`, or the
   contents of `Saved/RCON/ADMIN-PASSWORD.txt`.
3. **Kill feed (recommended).** Without it, kills and deaths come from the scoreboard only: no
   weapons, headshots or distances. To turn it on, pick a random token per server, put it in the
   `.env` variable named by `feedTokenEnv`, and add this to the server's `ServerSettings.ini`:

   ```ini
   [WDServerFeed]
   Url=https://stats.example.com
   Token=<the same token>
   ```

   Restart the game server. It posts to `Url` + `/api/ingest/events`; the game adds that suffix
   itself, so `Url` is just the site's origin.
4. **Build and run.**

   ```sh
   npm run build
   npm start
   ```

   Or with Docker: `docker compose up -d --build` (the database lives in `./data`).

The RCON listener has to be reachable from wherever the site runs. If it's bound to `127.0.0.1`
on the game host, run the site on the same machine or put a reverse proxy in front of it.
Requests stay far below the listener's 600/min limit: two per server per poll, plus identity
checks every five minutes.

### Environment

| Variable | Default | |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/teg-wardogs.db` | SQLite file (created on first run) |
| `SERVERS_CONFIG` | `./config/servers.json` | Server list |
| `POLL_INTERVAL_MS` | `5000` | Per-server poll interval (min 2000) |
| `STEAM_API_KEY` | none | Optional; fetches Steam avatars |
| `SITE_URL` | none | Public URL, used in link previews |
| `WORKER_ENABLED` | `true` | Set `false` on extra web replicas so only one process polls |
| `DEMO_MODE` | `false` | Simulated servers, no config file needed |

## How stats are counted

- **Rounds.** A new match starts when the map changes or faction scores drop, since scores
  only rise within a round. Live builds don't report `matchSeconds` or `scoreCap`, so the site
  doesn't rely on them.
- **Kills and deaths.** From the kill feed when the server has one, otherwise from scoreboard
  deltas between polls. Teamkills (killer and victim on the same faction at the time) and suicides
  are recorded but don't count as kills.
- **Playtime.** Time between consecutive polls where the player was connected, capped at three
  poll intervals so an outage doesn't count as play.
- **Longest kill.** Infantry weapons only. Vehicle guns and artillery would otherwise hold every record.
- **Ratio boards** (K/D, headshot %, kills/hour) need a minimum sample per period, e.g. 50 kills
  over 7 days.
- Leaderboards read daily per-player rollups (`player_daily`, `weapon_daily`), so they stay fast
  as the kill table grows.

## Development

```sh
npm test          # vitest: recorder, feed ingest, formatting
npm run lint
npm run typecheck
npm run format
```

Code layout:

```
src/lib/server/rcon.ts       WDRCON client (read-only routes)
src/lib/server/recorder.ts   polls + kill feed -> matches, sessions, rollups
src/lib/server/worker.ts     polling loop, started from src/instrumentation.ts
src/lib/server/queries.ts    everything the pages read
src/lib/demo/                simulated servers for demo mode
src/app/                     pages and API routes
src/app/globals.css          colour tokens (re-skin here)
```

The RCON API reference used here is the reverse-engineered one maintained by the
[Warcon](https://github.com/warcon-app/warcon/blob/main/docs/wardogs-api.md) project.

Not affiliated with Bulkhead or Team17.
