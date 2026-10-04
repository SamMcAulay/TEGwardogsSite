#!/usr/bin/env bash
# One-time VPS setup for the Docker deployment. Safe to re-run: it never overwrites .env or
# config/servers.json once they exist.
#
#   ./deploy/install.sh            prepare dirs, .env (with generated feed tokens), servers.json
#   ./deploy/install.sh --cron     also install a daily database backup in your crontab
#
# Then edit config/servers.json and .env, and run: docker compose --profile tunnel up -d --build
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
APP_UID=1001

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }

command -v docker >/dev/null || { echo "Docker is not installed: https://docs.docker.com/engine/install/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "The Docker Compose plugin is missing (docker compose)." >&2; exit 1; }

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

say "Data directories (owned by uid $APP_UID, the container user)"
mkdir -p data backups config
$SUDO chown -R "$APP_UID:$APP_UID" data backups

if [ ! -f config/servers.json ]; then
  cp config/servers.example.json config/servers.json
  say "Created config/servers.json from the example: edit it with your real servers"
else
  say "config/servers.json exists, leaving it alone"
fi

if [ ! -f .env ]; then
  cp .env.example .env
  # Fill every empty FEED_TOKEN_* with a fresh random token.
  while IFS= read -r var; do
    token="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    sed -i "s|^${var}=\$|${var}=${token}|" .env
  done < <(grep -oE '^FEED_TOKEN_[A-Z0-9_]+=$' .env | tr -d '=')
  chmod 600 .env
  say "Created .env with generated kill feed tokens: set SITE_URL, the RCON passwords and TUNNEL_TOKEN"
else
  say ".env exists, leaving it alone"
fi

if [ "${1:-}" = "--cron" ]; then
  line="17 4 * * * cd $ROOT && docker compose exec -T stats node scripts/backup.mjs >> $ROOT/backups/backup.log 2>&1 # teg-wardogs-backup"
  if crontab -l 2>/dev/null | grep -q 'teg-wardogs-backup'; then
    say "Backup cron already installed"
  else
    (crontab -l 2>/dev/null; echo "$line") | crontab -
    say "Installed daily backup at 04:17 (crontab -l to see it)"
  fi
fi

# Server ids in servers.json that have no matching variables in .env yet.
if command -v node >/dev/null; then
  node -e '
    const fs = require("fs");
    const env = fs.readFileSync(".env", "utf8");
    const has = (k) => new RegExp("^" + k + "=.+", "m").test(env);
    for (const s of JSON.parse(fs.readFileSync("config/servers.json", "utf8")).servers) {
      for (const k of [s.rcon && s.rcon.passwordEnv, s.feedTokenEnv].filter(Boolean))
        if (!has(k)) console.log(`\x1b[33m!\x1b[0m ${s.id}: ${k} has no value in .env`);
    }' || true
fi

cat <<EOF

Next:
  1. Edit config/servers.json (ids, RCON urls, query ports) and .env
  2. docker compose run --rm doctor          # checks every connection from this VPS
  3. docker compose --profile tunnel up -d --build
  4. Full walkthrough: docs/DEPLOYMENT.md
EOF
