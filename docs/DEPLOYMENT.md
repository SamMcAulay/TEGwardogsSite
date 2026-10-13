# Deploying beside Warcon

The site runs on the same VPS as Warcon, in its own compose project, and reads Warcon over Docker's
`warcon_default` network. It is served publicly through the Cloudflare tunnel that already serves the
Warcon panel.

## 1. How it fits

```
visitors ──https──▶ Cloudflare ──existing tunnel──▶ teg-wardogs-site:3000
                                                        │ Docker network warcon_default
                                                        ▼
                                                   warcon:3000
```

The site reaches Warcon over Docker, not through Cloudflare, so no Access bypass is needed for that
traffic. The container publishes `127.0.0.1:3100` only (Warcon already holds 3000; change it with
`SITE_HOST_PORT` in `.env`). Its one volume, `site-data`, holds linked Discord/Steam accounts
(`accounts.db`, see step 9); without account linking it stays empty.

## 2. Create the Warcon key

In Warcon: your org, then API keys, then new key. Label it `stats site`, capability **View only**.
Copy the key; it is shown once.

## 3. Prepare the VPS

The VPS user must be in the `docker` group (`sudo usermod -aG docker $USER`, then log in again) so it
can run `docker compose` without sudo; the automatic deploy in step 7 relies on that. If the
repository is private, the clone needs a deploy key: generate one on the VPS
(`ssh-keygen -t ed25519 -f ~/.ssh/teg_site_deploy`), add the public half under the repo's Settings,
Deploy keys (read-only), and clone with the SSH URL instead of the HTTPS one below.

```sh
git clone https://github.com/SamMcAulay/TEGwardogsSite.git /home/debian/teg-wardogs-site
cd /home/debian/teg-wardogs-site
cp .env.example .env
```

Edit `.env`:

```
WARCON_BASE_URL=http://warcon:3000
WARCON_TOKEN=<the key from step 2>
SITE_URL=https://stats.tegwardogs.fyi
ALLOW_INDEXING=false
```

## 4. First start

The VPS never builds the site: a Next.js build needs about 2 GB and starves Warcon and `cloudflared`
on a 4 GB box. CI builds the image on GitHub and pushes it to
`ghcr.io/sammcaulay/tegwardogssite`, tagged `sha-<commit>`. Deploy the head of `main`:

```sh
sh scripts/deploy.sh "$(git rev-parse origin/main)"
curl -s http://127.0.0.1:3100/api/health
```

The script pulls that commit's image, runs the doctor in it (the key and every endpoint; it must
print `ok` for every line), and only then tags it `teg-wardogs-site:current` and starts it. The
response should contain `"warcon":"ok"`.

If the pull is refused, the package is private: either make it public (GitHub, your profile,
Packages, `tegwardogssite`, Package settings, Change visibility), or `docker login ghcr.io` with a
token that has `read:packages`. Automatic deploys (step 7) log in for each deploy by themselves.

## 5. Cloudflare tunnel hostname

Zero Trust, Networks, Tunnels, the tunnel serving `tegwardogs.fyi`, Public hostnames, Add:

- Subdomain `stats`, domain `tegwardogs.fyi`, type HTTP.
- URL `teg-wardogs-site:3000` if the tunnel's `cloudflared` runs in Docker on `warcon_default`.
  Check with `docker ps --format '{{.Names}} {{.Networks}}' | grep cloudflared`.
- If `cloudflared` runs in Docker but is not on `warcon_default`, connect it first:
  `docker network connect warcon_default <cloudflared container>`, then use `teg-wardogs-site:3000`.
- Otherwise (cloudflared runs on the host) use `127.0.0.1:3100`.

## 6. Check Access

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://stats.tegwardogs.fyi/   # must print 200
curl -s -o /dev/null -w '%{http_code}\n' https://tegwardogs.fyi/         # must still print 302
```

If the site prints `302`, the Access application on the panel's hostname (`tegwardogs.fyi`) uses a
wildcard. Narrow it to `tegwardogs.fyi`, or add a Bypass application for `stats.tegwardogs.fyi`.

### Rate limiting

Every public page and `/api/*` route reads Warcon (through a short cache). Before setting
`ALLOW_INDEXING=true` or announcing the site, add a Cloudflare rate-limiting rule (Security, WAF,
Rate limiting rules) on `stats.tegwardogs.fyi`, for example 60 requests per 10 seconds per IP,
action Block or Managed Challenge, so a crawler or script can't spend Warcon's per-key limits.

## 7. Automatic deploys

In the GitHub repo, set secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (optional `VPS_HOST_KEY`, the
host's public key line, to pin it) and the variable `DEPLOY_ENABLED=true`.

A push to `main` runs CI on GitHub: lint, types, tests, then the Docker image, pushed to ghcr.io.
Only then does Deploy SSH in and, on the VPS, move the checkout to that commit and run
`scripts/deploy.sh`: pull, doctor, swap. All the heavy work happens on GitHub; the VPS only
downloads and unpacks the image. A failed pull or doctor leaves the old site running, and the job
gives up after 15 minutes rather than hang on an unresponsive VPS.

**Rolling back:** Actions, Deploy, Run workflow, and give the full sha of an earlier commit on
`main`. Or on the VPS, `sh scripts/deploy.sh <sha>`. The last few images are kept locally, so
recent rollbacks don't even need to download.

**Build by hand (not on the VPS):** `docker build -t teg-wardogs-site:current .` on any machine
with the memory to spare.

## 8. Moving to the real domain

1. Add the domain to Cloudflare.
2. Add it as a public hostname on the same tunnel (as in step 5).
3. Add the rate-limiting rule from step 6 for the new domain, then in `.env` set
   `SITE_URL=https://<domain>` and `ALLOW_INDEXING=true`.
4. `docker compose up -d` (restarts the deployed image with the new `.env`; builds nothing)
5. Optionally add a Redirect Rule from `stats.tegwardogs.fyi/*` to the new domain.

## 9. Account linking (optional)

Members sign in with Discord on `/account`, then through Steam. Their profile then shows a tag
from their Discord roles, and `/api/priority` lists linked SteamIDs with a queue tier:

| Tier | Roles (any one of) | On the profile |
| --- | --- | --- |
| 1 | `DISCORD_STAFF_ROLE_IDS` | Admin tag |
| 2 | `DISCORD_PREMIUM_ROLE_IDS` | Premium tag, gold name |
| 3 | `DISCORD_VERIFIED_ROLE_IDS` | Verified tag, pearl-blue name |

1. Discord Developer Portal: use an application (JanGuard's is fine) or make one. Under OAuth2 add the
   redirect `https://stats.tegwardogs.fyi/auth/discord/callback` (your `SITE_URL` plus that path);
   copy the client id and secret. Under Bot, copy the token. No privileged intents are needed: the
   site only reads one member at a time over REST.
2. The bot must be in the TEG server. If it isn't, invite it with
   `https://discord.com/oauth2/authorize?client_id=<client id>&scope=bot&permissions=0`.
3. Role ids: Discord settings, Advanced, Developer Mode on; then right-click a role, Copy Role ID.
   Each `*_ROLE_IDS` takes any number of ids, comma separated.
4. Fill the account block of `.env` (see `.env.example`), including
   `SESSION_SECRET=$(openssl rand -base64 48)` and, when Bulkhead are ready for it, `PRIORITY_API_KEY`.
5. `docker compose run --rm doctor` now also checks the bot token, the guild, and that every
   configured role id is a role there. Then `docker compose up -d`.

Tiers follow roles: every linked member is re-checked within about ten minutes, so a lapsed
Premium or a departed moderator loses their tag and priority without anyone acting. Unlinking on
`/account` deletes the row.

```sh
curl -s -H "Authorization: Bearer $PRIORITY_API_KEY" https://stats.tegwardogs.fyi/api/priority
# {"generatedAt":"…","players":[{"steamId":"7656…","tier":1,"linkedAt":"2026-10-13T…Z"}, …]}
```

Links made before the queue exists are kept and their tiers kept current, so on the day it goes
live this list already holds everyone (best tier first, then earliest linked). `linkedAt` only
changes when someone switches to a different Steam account.

The schema is versioned (`MIGRATIONS` in `src/lib/server/accounts/store.ts`, append-only). When a
deploy brings a new migration, the site first copies the database to `accounts.db.pre-v<n>` beside
it, then upgrades it in one transaction; a failed upgrade leaves it untouched. An older build
refuses to open a newer database, so roll back by restoring that copy.

**Never run `docker compose down -v`**: `-v` deletes the `site-data` volume and every link with it.

### Staff `/lookup` command (optional)

`/lookup member:@someone` in the TEG server replies in the channel with that member's stats profile
link (Discord shows the player card under it), or a one-line "how to link" when they haven't. It
never pings anyone. Only members with a `DISCORD_STAFF_ROLE_IDS` role can use it; others are told,
privately, that it's staff-only. There is no bot process: Discord sends each use to the site, signed with the
application's key.

1. Developer Portal, General Information: copy the **Public Key** into `.env` as
   `DISCORD_PUBLIC_KEY`, then `docker compose up -d --force-recreate site`. On start the site
   registers `/lookup` in the TEG server (its log says `[discord] slash commands: …` if it can't).
2. Same page: set **Interactions Endpoint URL** to
   `https://stats.tegwardogs.fyi/api/discord/interactions` and save. Discord tests it on save; it
   only accepts the URL once step 1 is live.

Back up `accounts.db`:
`docker run --rm -v teg-wardogs-site_site-data:/d -v "$PWD":/b debian:bookworm-slim cp /d/accounts.db /b/`
(stop the site first, or the copy may miss writes still in `accounts.db-wal`).

## 10. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Cloudflare error 1033 | The tunnel is not running. With no SSH: OVHcloud Control Panel, the VPS, `...` beside Boot, Reboot; or its KVM console. |
| `pull access denied` on deploy | The image doesn't exist (CI failed for that commit) or the package is private; see step 4. |
| Deploy says `manifest unknown` | That commit's CI never pushed an image: only pushes to `main` are published. |
| 502 from Cloudflare | The tunnel hostname's service URL is wrong (see step 5). |
| Health shows `key_rejected` | `WARCON_TOKEN` is wrong or the key was revoked. |
| Health shows `key_lacks_view` | The key was created without the View capability. |
| Health shows `unreachable` | The site is not on `warcon_default`, or Warcon is down. |
| `/account` says linking is not switched on | The account block of `.env` is empty. |
| Discord says `Invalid OAuth2 redirect_uri` | The redirect in step 9.1 doesn't match `SITE_URL` exactly. |
| Profiles never get a tag | Check the doctor's role lines, and the site log for `tier sync stopped`. |
