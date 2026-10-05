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
