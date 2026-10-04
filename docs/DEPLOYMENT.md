# Deploying to a VPS behind Cloudflare

This walks through putting the site on a Linux VPS, served through Cloudflare, with no inbound
ports open. Every step is something you can do with VPS access and the Cloudflare dashboard. The
game servers are the exception: anything that has to change on them is collected in
[step 6](#6-what-the-game-server-admins-need-to-do) as a message you can send to whoever runs them.

```
 visitors ──https──▶ Cloudflare ──tunnel──▶ cloudflared ──▶ stats:3000 ──▶ SQLite (./data)
                                                                │
 game servers ──kill feed (https POST)──▶ Cloudflare ───────────┘
                                                                │
                         stats ──RCON (http :7776) / Steam query (udp)──▶ game servers
```

## What you get without access to the game servers

The site has three data sources. It uses the best one available per server and you can upgrade a
server later without losing anything.

| Source | Needs from the server admin | What the site shows |
| --- | --- | --- |
| **Steam query** (A2S, UDP) | Nothing, if the query port is reachable | Online/offline, map, player count, population history, rounds by map change |
| **RCON** (HTTP, port 7776 by default) | The RCON password, and the port reachable from your VPS IP | Everything above, plus the live scoreboard, factions and scores, join code, player profiles, playtime, kills/deaths from the scoreboard, leaderboards |
| **Kill feed** (`[WDServerFeed]`) | Two lines added to `ServerSettings.ini` | Everything above, plus weapons, headshots, distances, kill feed, nemeses |

So you can deploy today on Steam query and turn on the rest as the admins get to it.

## 1. Prepare the VPS

Any Linux VPS with 1 GB of RAM works (the build wants ~1 GB; add swap on smaller boxes). Install
Docker with the Compose plugin: <https://docs.docker.com/engine/install/>.

```sh
sudo mkdir -p /opt/teg-wardogs && sudo chown "$USER" /opt/teg-wardogs
git clone https://github.com/SamMcAulay/TEGwardogsSite.git /opt/teg-wardogs
cd /opt/teg-wardogs
./deploy/install.sh --cron
```

`install.sh` creates `data/` and `backups/` owned by uid 1001 (the container user), copies
`.env.example` to `.env` with a random kill feed token per server, copies the example server list,
and with `--cron` installs a daily backup. It never overwrites files that already exist.

## 2. Describe the servers

Edit `config/servers.json`, one entry per server:

```json
{
  "id": "eu-1",
  "name": "TEG | EU #1",
  "shortName": "EU #1",
  "region": "EU",
  "location": "Amsterdam, NL",
  "rcon": { "url": "http://203.0.113.10:7776", "passwordEnv": "RCON_PASSWORD_EU1" },
  "query": { "host": "203.0.113.10", "port": 27015 },
  "feedTokenEnv": "FEED_TOKEN_EU1"
}
```

- `id` is the URL slug and the key all stats are stored under. Pick it once.
- `region` is one of `NA`, `EU`, `OCE`, `ASIA`, `SA`.
- `rcon`, `query` and `feedTokenEnv` are each optional. Keep all three if you'll get them eventually:
  a server with an RCON block but no password yet falls back to `query`.
- The game server's IP and ports are in the server browser, on the host's control panel, or the
  admins can tell you. The **query port** is usually the game port + 1 or 27015; `npm run doctor`
  tells you whether it answers.

Then fill in `.env`: `SITE_URL`, any RCON passwords you have, and optionally `STEAM_API_KEY` and
`DISCORD_WEBHOOK_URL`. Every variable is explained in `.env.example`.

## 3. Check every connection

```sh
docker compose run --rm doctor
```

This builds the image and runs `scripts/doctor.ts` from inside it, so it tests exactly the network
path the site will use. It reports, per server, whether RCON answers and accepts the password,
whether the Steam query port answers, and which source the site will use. Fix anything marked ✘
before going on. (With Node 22 on the VPS you can also run `npm ci && npm run doctor`.)

## 4. Cloudflare Tunnel

A tunnel means the VPS needs no open ports and no TLS certificate: `cloudflared` dials out to
Cloudflare and Cloudflare sends traffic back down it.

1. Add your domain to Cloudflare if it isn't already (the nameservers must point at Cloudflare).
2. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** →
   **Cloudflared**. Name it `teg-wardogs`.
3. On the install screen, pick **Docker** and copy the token (the long string after `--token`).
   Put it in `.env` as `TUNNEL_TOKEN=...`. You don't need to run the command it shows.
4. **Public hostname**: subdomain `stats`, your domain, service type **HTTP**, URL **`stats:3000`**
   (the container name on the Compose network, not localhost).
5. Start everything:

   ```sh
   docker compose --profile tunnel up -d --build
   docker compose ps          # stats should say (healthy), cloudflared Up
   ```

6. Open `https://stats.yourdomain/` and `https://stats.yourdomain/api/health`.

Set `SITE_URL=https://stats.yourdomain` in `.env` and `docker compose --profile tunnel up -d` again
if you hadn't already.

**Firewall.** With the tunnel nothing needs to be open except SSH. On Ubuntu:
`sudo ufw allow OpenSSH && sudo ufw enable`. Docker publishes the site on `127.0.0.1:3000` only.

**Rather use nginx?** `deploy/nginx/teg-wardogs.conf` is a reverse proxy config for a proxied DNS
record with a Cloudflare Origin Certificate, and `deploy/systemd/` runs the site without Docker.

## 5. Cloudflare settings

The kill feed is a machine POSTing JSON, and Cloudflare's bot protection will block it if you let it.

- **Security → Bots → Bot Fight Mode: Off.** On the Free plan it can't be skipped per path, and it
  blocks the game server's requests. (On Pro and up, use Super Bot Fight Mode with the skip rule below.)
- **Security → WAF → Custom rules → Create rule** "Kill feed": field *URI Path*, operator *starts
  with*, value `/api/ingest/`. Action **Skip**, and tick all remaining custom rules, rate limiting,
  managed rules, Super Bot Fight Mode, Browser Integrity Check and Security Level. Put it first.
- **SSL/TLS → Overview**: *Full* (tunnel) or *Full (strict)* (nginx with an origin certificate).
  **Edge Certificates**: *Always Use HTTPS* on; turn on HSTS once you're happy everything works.
- **Rate limiting (optional, one rule on Free)**: *URI Path starts with `/api/`* and *URI Path does
  not start with `/api/ingest/`*, 120 requests per 1 minute per IP → Block for 1 minute.
- **Caching**: nothing to do. Pages are marked `no-store` and Cloudflare already caches the
  fingerprinted `/_next/static/` files. The public JSON API sends `s-maxage`, so if you want it cached
  at the edge, add a Cache Rule for *URI Path starts with `/api/` and does not start with
  `/api/ingest/` and does not equal `/api/health`* → *Eligible for cache*, *Use cache-control header*.
- **Health check (optional)**: Traffic → Health Checks (paid), or a free monitor such as UptimeRobot,
  on `https://stats.yourdomain/api/health`.

Check the kill feed path from the outside:

```sh
docker compose run --rm doctor           # with SITE_URL set it also tests the public site
```

You want "kill feed endpoint reachable (bad token rejected with 401)" and, per server, "site accepts
its kill feed token". A 403 means Cloudflare is still blocking it.

## 6. What the game server admins need to do

Send this to whoever runs the TEG servers, with the bracketed parts filled in from your `.env` and
`servers.json`. Each part is independent; the site picks each one up on its own, with no redeploy.

> Hi, I'm setting up the TEG WARDOGS stats site at https://stats.yourdomain. It only reads from the
> servers. For each server, could you:
>
> **1. RCON (read-only use).** Send me the RCON password (`Password=` under
> `[/Script/WDRCON.WDRCONSettings]` in the server config, or `Saved/RCON/ADMIN-PASSWORD.txt`), and
> make sure the RCON port (default 7776) accepts connections from my VPS at `[VPS IP]`. If the listener
> is bound to 127.0.0.1, it needs binding to the public interface, ideally firewalled to that one IP.
> The site makes about two requests per server every 5 seconds, well under the 600/min limit.
>
> **2. Kill feed.** Add this to the server's `ServerSettings.ini` and restart the server:
>
> ```ini
> [WDServerFeed]
> Url=https://stats.yourdomain
> Token=[that server's FEED_TOKEN_... value]
> ```
>
> The game posts kills to `Url/api/ingest/events` itself. The token is unique per server, so please
> don't swap them between servers.

When you get a password: put it in `.env`, then `docker compose --profile tunnel up -d` (Compose
restarts the container with the new environment). Kill feed tokens are already in `.env`, so the feed
starts working as soon as the admin restarts the game server. `GET /api/health` shows each server's
`source` (`rcon` or `query`), whether its feed is configured, and `lastKillAt`.

## 7. Day-to-day

| Task | Command |
| --- | --- |
| Logs | `docker compose logs -f stats` |
| Status | `docker compose ps`, `curl -s localhost:3000/api/health` |
| Update by hand | `git pull && docker compose --profile tunnel up -d --build` |
| Back up now | `docker compose exec stats node scripts/backup.mjs` |
| Re-check connections | `docker compose run --rm doctor` |
| Restart | `docker compose restart stats` |

**Automatic deploys.** `.github/workflows/deploy.yml` deploys `main` after CI passes, over SSH. It
does nothing until you set the repository variable `DEPLOY_ENABLED=true`; the file header lists the
secrets it needs. Make an SSH key just for it (`ssh-keygen -t ed25519 -f deploy_key -N ''`), add
`deploy_key.pub` to the VPS user's `~/.ssh/authorized_keys`, and paste `deploy_key` into the
`VPS_SSH_KEY` secret.

**Backups.** `backups/teg-wardogs-YYYYMMDD-HHMMSS.db.gz`, daily at 04:17 if you used `--cron`,
keeping `BACKUP_KEEP` (14). The backup uses SQLite's online backup API, so it is consistent while
the site runs. To keep a copy off the VPS, Cloudflare R2 works well with
[rclone](https://rclone.org/s3/#cloudflare-r2): `rclone copy backups r2:teg-wardogs-backups` after
the backup in cron.

To restore:

```sh
docker compose stop stats
gunzip -c backups/teg-wardogs-YYYYMMDD-HHMMSS.db.gz > data/teg-wardogs.db
rm -f data/teg-wardogs.db-wal data/teg-wardogs.db-shm
sudo chown 1001:1001 data/teg-wardogs.db
docker compose start stats
```

**Discord alerts.** Set `DISCORD_WEBHOOK_URL` (channel settings → Integrations → Webhooks) and the
site posts when a server goes offline (three failed polls in a row) and again when it comes back.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `docker compose ps` shows `unhealthy` | `curl -s localhost:3000/api/health`; `problems` says why. Usually no server has a working source. |
| `SqliteError: unable to open database file` | `data/` isn't writable by uid 1001: `sudo chown -R 1001:1001 data backups` |
| A server shows offline, error `unreachable` | RCON port closed to the VPS or bound to 127.0.0.1 (admin side), or wrong IP/port in `servers.json` |
| Error `password rejected` / HTTP 401 | Wrong `RCON_PASSWORD_*` or it was changed on the server |
| Steam query: `no reply` | Wrong query port, or the host blocks UDP queries. Try game port + 1, 27015, 27016 |
| Players and maps show but no weapons or kill feed | The kill feed isn't set up or isn't arriving; see step 5 and `lastKillAt` in `/api/health` |
| Kill feed 403 | Cloudflare bot protection: step 5 |
| Cloudflare error 1033 | `cloudflared` isn't running or `TUNNEL_TOKEN` is wrong: `docker compose logs cloudflared` |
| Cloudflare error 502 | Tunnel hostname points at the wrong service; it must be `http://stats:3000` |
| Site works but link previews have no image or URL | `SITE_URL` not set |
