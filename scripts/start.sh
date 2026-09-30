#!/bin/sh
# Run the production build. The standalone server chdirs into .next/standalone, so resolve the
# data and config paths against the project root first.
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export DATABASE_PATH="${DATABASE_PATH:-$PWD/data/teg-wardogs.db}"
export SERVERS_CONFIG="${SERVERS_CONFIG:-$PWD/config/servers.json}"
exec node .next/standalone/server.js
