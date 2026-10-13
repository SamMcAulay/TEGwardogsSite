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
`SITE_HOST_PORT` in `.env`) and has no volumes: nothing to back up.

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

## 9. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Cloudflare error 1033 | The tunnel is not running. With no SSH: OVHcloud Control Panel, the VPS, `...` beside Boot, Reboot; or its KVM console. |
| `pull access denied` on deploy | The image doesn't exist (CI failed for that commit) or the package is private; see step 4. |
| Deploy says `manifest unknown` | That commit's CI never pushed an image: only pushes to `main` are published. |
| 502 from Cloudflare | The tunnel hostname's service URL is wrong (see step 5). |
| Health shows `key_rejected` | `WARCON_TOKEN` is wrong or the key was revoked. |
| Health shows `key_lacks_view` | The key was created without the View capability. |
| Health shows `unreachable` | The site is not on `warcon_default`, or Warcon is down. |
